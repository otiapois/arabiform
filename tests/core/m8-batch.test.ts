import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { preflightRow } from '../../src/core/pdf';
import { BATCH_CHUNK_SIZE, createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchProgress } from '../../src/core/worker/protocol';

const asset = (filename: string) => readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', filename));
const fonts = async () => ({
  arabic: await asset('public/fonts/NotoNaskhArabic-Regular.ttf'),
  latin: await asset('public/fonts/NotoSans-Regular.ttf'),
});

it('checks 500 real bilingual mapped rows in 25-row chunks without serializing any ready PDF', async () => {
  const template = await asset('fixtures/golden/template.pdf');
  const options = { fonts: await fonts() };
  const rows = Array.from({ length: 500 }, (_, index) => ({
    Name: index % 50 === 49 ? 'M'.repeat(200) : index % 2 ? '\u0628\u064e\u0646\u0650\u064a \u064a\u064e\u0645\u064e\u0646' : 'Layla Hasan',
    ID: String(index + 1).padStart(5, '0'),
  }));
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  const load = vi.spyOn(PDFDocument, 'load');
  try {
    const processBatch = createBatchProcessor();
    const progress: BatchProgress[] = [];
    const yielded: number[] = [];
    const start = performance.now();
    const checked = await processBatch({ phase: 'preflight', input: { rows, template, options } }, (update) => {
      progress.push(update);
      if (update.completed > 0 && update.completed < update.total) {
        setTimeout(() => yielded.push(update.completed), 0);
      }
    });
    const elapsed = performance.now() - start;
    expect(save).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(Array.from({ length: 21 }, (_, chunk) => ({
      phase: 'preflight', completed: chunk * BATCH_CHUNK_SIZE, total: 500,
    })));
    expect(yielded).toEqual(progress.slice(1, -1).map(({ completed }) => completed));
    if (!Array.isArray(checked)) throw new Error('Expected checked rows');
    expect(checked).toHaveLength(500);
    for (const [index, result] of checked.entries()) {
      expect(Object.keys(result).sort()).toEqual(['diagnostics', 'fontSizes', 'pageNumbers', 'status']);
      expect(result.status).toBe(index % 50 === 49 ? 'flagged' : 'pass');
      if (result.status === 'flagged') expect(result.diagnostics.map(({ code }) => code)).toEqual(['too-narrow']);
    }
    const preview = (rowIndex: number) => processBatch({ phase: 'preview', rowIndex }, () => {});
    expect(await preview(49)).toBeUndefined();
    expect(await preview(500)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    const [first, last] = await Promise.all([preview(0), preview(498)]);
    expect(save).toHaveBeenCalledTimes(2);
    for (const [bytes, index] of [[first, 0], [last, 498]] as const) {
      if (!(bytes instanceof Uint8Array)) throw new Error('Expected preview bytes');
      const document = await PDFDocument.load(bytes);
      expect(document.getForm().getTextField('ID').getText()).toBe(rows[index]!.ID);
      expect(document.getForm().getTextField('Name').getText()).toBe(rows[index]!.Name);
      expect(document.getForm().getTextField('Sentinel').getText()).toBe('KEEP 00109');
      expect(bytes).toEqual((await preflightRow(template, rows[index]!, options)).pdfBytes);
    }
    console.info('M8 batch: 500 actual rows, 490 ready, 10 flagged, 20 chunks, one parse, zero preflight PDF saves, %s ms.', elapsed.toFixed(0));
  } finally {
    load.mockRestore();
    save.mockRestore();
  }
}, 60_000);

it('isolates batches, preserves editable bytes, stages one row at a time and recovers after export errors', async () => {
  const template = await asset('fixtures/golden/template.pdf');
  const rows = [{ Name: 'Noura', ID: '00123' }, { Name: 'M'.repeat(200), ID: '00008' }, { Name: 'Samir', ID: '00007' }];
  const input = { rows, template, options: { fonts: await fonts() } };
  const filenames = ['first.pdf', 'skipped.pdf', 'last.pdf'];
  const processBatch = createBatchProcessor();
  const notify = vi.fn();
  await expect(processBatch({ phase: 'preview', rowIndex: 0 }, notify)).rejects.toThrow('batch-not-ready');
  await processBatch({ phase: 'preflight', input }, notify);
  await expect(processBatch({ phase: 'preflight', input }, notify)).rejects.toThrow('batch-already-started');
  await expect(processBatch({ phase: 'zip', filenames: ['one.pdf'] }, notify)).rejects.toThrow('batch-filename-count-mismatch');
  await expect(processBatch({ phase: 'zip', filenames: ['../bad.pdf', 'skipped.pdf', 'last.pdf'] }, notify)).rejects.toThrow('invalid-export-filename');
  const watermark = { kind: 'custom', text: '\u{10348}', opacity: 0.14, angle: 45 } as const;
  await expect(processBatch({ phase: 'merged', watermark }, notify)).rejects.toThrow('watermark-missing-glyph');
  await expect(processBatch({ phase: 'zip', filenames, flattenZip: true, watermark }, notify)).rejects.toThrow('watermark-missing-glyph');

  // Every append observes exactly one new serialized row since the previous append.
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  try {
    const boundaries: number[] = [];
    const editable = await processBatch({ phase: 'zip', filenames, watermark }, () => boundaries.push(save.mock.calls.length));
    expect(boundaries).toEqual([0, 1, 2]);
    if (!(editable instanceof Uint8Array)) throw new Error('Expected editable archive');
    const members = unzipSync(editable);
    expect(Object.keys(members)).toEqual(['first.pdf', 'last.pdf']);
    for (const index of [0, 2]) {
      expect(members[filenames[index]!]).toEqual(await processBatch({ phase: 'preview', rowIndex: index }, notify));
    }
    const merged = await processBatch({ phase: 'merged' }, notify);
    if (!(merged instanceof Uint8Array)) throw new Error('Expected merged PDF');
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe((await PDFDocument.load(template)).getPageCount() * 2);
    expect(doc.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  } finally {
    save.mockRestore();
  }
}, 30_000);

it('transfers an unchanged one-row preview without detaching the retained ArrayBuffer template', async () => {
  const source = await PDFDocument.create();
  source.getForm().createTextField('Name').addToPage(source.addPage());
  const template = Uint8Array.from(await source.save()).buffer;
  const processBatch = createBatchProcessor();
  const notify = () => {};
  const fonts = { arabic: new Uint8Array(), latin: new Uint8Array() };
  await processBatch({ phase: 'preflight', input: { template, rows: [{}], options: { fonts } } }, notify);
  const preview = await processBatch({ phase: 'preview', rowIndex: 0 }, notify);
  if (!(preview instanceof Uint8Array)) throw new Error('Expected preview bytes');
  const transferred = structuredClone(preview, { transfer: [preview.buffer as ArrayBuffer] });
  expect(preview.byteLength).toBe(0);
  expect(template.byteLength).toBe(transferred.byteLength);
  expect(await processBatch({ phase: 'preview', rowIndex: 0 }, notify)).toEqual(transferred);
});
