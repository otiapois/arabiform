import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { createCustodyManifest } from '../../src/core/audit/custody';
import { createZip, preflightRow } from '../../src/core/pdf';
import { BATCH_CHUNK_SIZE, createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchProgress } from '../../src/core/worker/protocol';

const asset = (filename: string) => readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', filename));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
  const roster = new TextEncoder().encode(['Name,ID', ...rows.map(({ Name, ID }) => `${Name},${ID}`)].join('\r\n'));
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  const load = vi.spyOn(PDFDocument, 'load');
  const embed = vi.spyOn(PDFDocument.prototype, 'embedFont');
  try {
    const processBatch = createBatchProcessor();
    const progress: BatchProgress[] = [];
    const yielded: number[] = [];
    const start = performance.now();
    const checked = await processBatch({ phase: 'preflight', input: { rows, template, roster, options } }, (update) => {
      progress.push(update);
      if (update.completed > 0 && update.completed < update.total) {
        setTimeout(() => yielded.push(update.completed), 0);
      }
    });
    const elapsed = performance.now() - start;
    expect(save).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(Array.from({ length: 21 }, (_, chunk) => ({
      phase: 'preflight', completed: chunk * BATCH_CHUNK_SIZE, total: 500,
    })));
    expect(yielded).toEqual(progress.slice(1, -1).map(({ completed }) => completed));
    if (!checked || !('rows' in checked)) throw new Error('Expected checked rows');
    expect(checked.custody).toEqual({ templateSha256: digest(template), rosterSha256: digest(roster) });
    expect(checked.rows).toHaveLength(500);
    expect(checked.spotlight).toMatchObject({ longestMappedTextRow: 50, firstFlaggedRow: 50 });
    for (const [index, result] of checked.rows.entries()) {
      expect(result.status).toBe(index % 50 === 49 ? 'flagged' : 'pass');
      const { inkClearancePt, smallestInkFontSizePt, ...legacyFields } = result;
      expect(Object.keys(legacyFields).sort()).toEqual(['diagnostics', 'fontSizes', 'pageNumbers', 'status']);
      if (result.status === 'flagged') {
        expect(result.diagnostics.map(({ code }) => code)).toEqual(['too-narrow']);
        expect(smallestInkFontSizePt).toBeUndefined();
        expect(inkClearancePt).toBeUndefined();
      } else {
        expect(smallestInkFontSizePt).toBe(Math.min(...Object.values(result.fontSizes).flat()));
        expect(inkClearancePt).toBeGreaterThan(0);
      }
    }
    const preview = (rowIndex: number) => processBatch({ phase: 'preview', rowIndex }, () => {});
    expect(await preview(49)).toBeUndefined();
    expect(await preview(500)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    const [first, last] = await Promise.all([preview(0), preview(497)]);
    expect(save).toHaveBeenCalledTimes(2);
    for (const [bytes, index] of [[first, 0], [last, 497]] as const) {
      if (!(bytes instanceof Uint8Array)) throw new Error('Expected preview bytes');
      const document = await PDFDocument.load(bytes);
      expect(document.getForm().getTextField('ID').getText()).toBe(rows[index]!.ID);
      expect(document.getForm().getTextField('Name').getText()).toBe(rows[index]!.Name);
      expect(document.getForm().getTextField('Sentinel').getText()).toBe('KEEP 00109');
      expect(bytes).toEqual((await preflightRow(template, rows[index]!, options)).pdfBytes);
    }
    expect(embed).toHaveBeenCalledTimes(2);
    console.info('M8 batch: 500 actual rows, 490 ready, 10 flagged, 20 chunks, one parse, zero preflight PDF saves, %s ms.', elapsed.toFixed(0));
  } finally {
    load.mockRestore();
    save.mockRestore();
    embed.mockRestore();
  }
}, 180_000);

it('isolates batches, preserves editable bytes, stages one row at a time and recovers after export errors', async () => {
  const template = await asset('fixtures/golden/template.pdf');
  const rows = [{ Name: 'Noura', ID: '00123' }, { Name: 'M'.repeat(200), ID: '00008' }, { Name: 'Samir', ID: '00007' }];
  const roster = new TextEncoder().encode(['Name,ID', ...rows.map(({ Name, ID }) => `${Name},${ID}`)].join('\r\n'));
  const input = { rows, template, roster, options: { fonts: await fonts() } };
  const filenames = ['first.pdf', 'skipped.pdf', 'last.pdf'];
  const processBatch = createBatchProcessor();
  const notify = vi.fn();
  await expect(processBatch({ phase: 'preview', rowIndex: 0 }, notify)).rejects.toThrow('batch-not-ready');
  const checked = await processBatch({ phase: 'preflight', input }, notify);
  if (!checked || !('rows' in checked)) throw new Error('Expected checked rows');
  const sources = { version: 1, templateSha256: digest(template), rosterSha256: digest(roster) };
  expect(JSON.parse(createCustodyManifest(checked.custody))).toEqual(sources);
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
    if (!editable || editable instanceof Uint8Array || !('entries' in editable)) throw new Error('Expected editable archive');
    const members = unzipSync(editable.bytes);
    expect(Object.keys(members)).toEqual(['first.pdf', 'last.pdf']);
    expect(editable.bytes).toEqual(createZip(Object.entries(members).map(([filename, pdfBytes]) => ({ filename, pdfBytes }))));
    const receipts = (files: Record<string, Uint8Array>) => Object.entries(files).map(([filename, bytes]) => ({
      filename, sha256: digest(bytes), bytes: bytes.byteLength,
    }));
    expect(editable.entries).toEqual(receipts(members));
    for (const index of [0, 2]) {
      expect(members[filenames[index]!]).toEqual(await processBatch({ phase: 'preview', rowIndex: index }, notify));
    }
    const flattened = await processBatch({ phase: 'zip', filenames, flattenZip: true,
      watermark: { kind: 'draft', angle: -45, opacity: 0.14 } }, notify);
    if (!flattened || flattened instanceof Uint8Array || !('entries' in flattened)) throw new Error('Expected flattened archive');
    const flattenedMembers = unzipSync(flattened.bytes);
    expect(flattened.entries).toEqual(receipts(flattenedMembers));
    expect(flattened.entries).not.toEqual(editable.entries);
    const merged = await processBatch({ phase: 'merged' }, notify);
    if (!merged || !('mergedPdfSha256' in merged)) throw new Error('Expected merged PDF');
    expect(merged.mergedPdfSha256).toBe(digest(merged.bytes));
    expect(JSON.parse(createCustodyManifest(checked.custody, { entries: editable.entries, mergedPdfSha256: merged.mergedPdfSha256 })))
      .toEqual({ ...sources, entries: receipts(members), mergedPdfSha256: digest(merged.bytes) });
    const doc = await PDFDocument.load(merged.bytes);
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
  await processBatch({ phase: 'preflight', input: { template, roster: new Uint8Array(), rows: [{}], options: { fonts } } }, notify);
  const preview = await processBatch({ phase: 'preview', rowIndex: 0 }, notify);
  if (!(preview instanceof Uint8Array)) throw new Error('Expected preview bytes');
  const transferred = structuredClone(preview, { transfer: [preview.buffer as ArrayBuffer] });
  expect(preview.byteLength).toBe(0);
  expect(template.byteLength).toBe(transferred.byteLength);
  expect(await processBatch({ phase: 'preview', rowIndex: 0 }, notify)).toEqual(transferred);
});
