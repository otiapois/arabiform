import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { createCustodyManifest } from '../../src/core/audit/custody';
import { createAudit } from '../../src/core/pdf';
import { makeFilenames, readRoster } from '../../src/core/roster';
import { createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchProgress } from '../../src/core/worker/protocol';
import { resolveRowSelection } from '../../src/core/worker/row-selection';

const asset = (filename: string) => readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', filename));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ignoreProgress = () => {};

async function preflightFixture() {
  const [template, roster, arabic, latin] = await Promise.all([
    asset('fixtures/golden/template.pdf'), asset('fixtures/golden/roster.csv'),
    asset('public/fonts/NotoNaskhArabic-Regular.ttf'), asset('public/fonts/NotoSans-Regular.ttf'),
  ]);
  const rows = (await readRoster(roster, 'roster.csv')).sheets[0]!.rows.map(({ values }) => values);
  const filenames = makeFilenames(rows, 'Operator copy.pdf');
  const processBatch = createBatchProcessor();
  const checked = await processBatch({ phase: 'preflight', input: { template, roster, rows, options: { fonts: { arabic, latin } } } }, ignoreProgress);
  if (!checked || !('rows' in checked)) throw new Error('Expected preflight results');
  expect(checked.rows.map(({ status }) => status)).toEqual(['pass', 'pass', 'pass', 'pass', 'flagged']);
  return { checked, filenames, processBatch, roster, rows, template };
}

it('generates only effective selected PDF rows in roster order with the full batch collision suffixes', async () => {
  const { checked, filenames, processBatch, roster, rows, template } = await preflightFixture();
  const rowSelection = [4, 5, 2, 4, 0, 2.5, NaN, 91];
  const progress: BatchProgress[] = [];
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  let rendered = 0;
  const zip = await processBatch({ phase: 'zip', filenames, rowSelection }, (update) => progress.push(update)).finally(() => {
    rendered = save.mock.calls.length;
    save.mockRestore();
  });
  if (!zip || zip instanceof Uint8Array || !('entries' in zip)) throw new Error('Expected archive');
  const members = unzipSync(zip.bytes);
  expect(Object.keys(members)).toEqual(['Operator copy-2.pdf', 'Operator copy-4.pdf']);
  expect(rendered).toBe(2);
  expect(progress).toEqual([0, 1, 2].map((completed) => ({ phase: 'zip', completed, total: 2 })));
  for (const index of [1, 3]) {
    const bytes = members[filenames[index]!]!;
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getTextField('ID').getText()).toBe(rows[index]!.ID);
    expect(form.getTextField('Name').getText()).toBe(rows[index]!.Name);
    expect(form.getTextField('Sentinel').getText()).toBe('KEEP 00109');
    const preview = await processBatch({ phase: 'preview', rowIndex: index }, ignoreProgress);
    if (!(preview instanceof Uint8Array)) throw new Error('Expected preview PDF');
    expect(digest(bytes)).toBe(digest(preview));
  }
  const receipts = Object.entries(members).map(([filename, bytes]) => ({ filename, sha256: digest(bytes), bytes: bytes.length }));
  expect(zip.entries).toEqual(receipts);

  progress.length = 0;
  const printed = await processBatch({ phase: 'merged', rowSelection,
    coverSheet: { locale: 'en', templateName: 'Workshop.pdf', filenames, includeCustody: true } }, (update) => progress.push(update));
  if (!printed || !('mergedPdfSha256' in printed)) throw new Error('Expected printable PDF');
  const pdf = await PDFDocument.load(printed.bytes);
  expect(pdf.getPageCount()).toBe(3);
  expect(pdf.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  expect(progress).toEqual([0, 1, 2].map((completed) => ({ phase: 'merged', completed, total: 2 })));
  const scope = resolveRowSelection(checked.rows, rowSelection);
  expect(JSON.parse(createCustodyManifest(checked.custody, { entries: zip.entries, mergedPdfSha256: printed.mergedPdfSha256 }, scope)))
    .toEqual({ version: 1, templateSha256: digest(template), rosterSha256: digest(roster), entries: receipts,
      mergedPdfSha256: digest(printed.bytes), exportScope: 'selected-subset', selectedRowNumbers: [2, 4] });
}, 30_000);

it('rejects empty or stale subsets without progress and preserves the all-ready defaults', async () => {
  const { filenames, processBatch } = await preflightFixture();
  const progress = vi.fn();
  const outcome = (result: Promise<unknown>) => result.then(() => 'unexpected-export', (error: Error) => error.message);
  for (const rowSelection of [[], [5], [6, 12, -1]]) {
    expect(await outcome(processBatch({ phase: 'zip', filenames, rowSelection }, progress))).toBe('empty-export');
    expect(await outcome(processBatch({ phase: 'merged', rowSelection }, progress))).toBe('empty-export');
  }
  await expect(processBatch({ phase: 'zip', filenames: [filenames[1]!], rowSelection: [2] }, progress))
    .rejects.toThrow(/^batch-filename-count-mismatch$/);
  await expect(processBatch({ phase: 'merged', rowSelection: [2],
    coverSheet: { locale: 'en', templateName: 'Workshop.pdf', filenames: [filenames[1]!] } }, progress))
    .rejects.toThrow(/^cover-sheet-invalid-metadata$/);
  expect(progress).not.toHaveBeenCalled();

  for (const rowSelection of [undefined, 'all-ready'] as const) {
    const result = await processBatch({ phase: 'zip', filenames, rowSelection }, ignoreProgress);
    if (!result || result instanceof Uint8Array || !('entries' in result)) throw new Error('Expected archive');
    expect(Object.keys(unzipSync(result.bytes))).toEqual(filenames.slice(0, 4));
  }
}, 30_000);

it('keeps the audit fields and original row numbers in both formats', async () => {
  const { checked, filenames } = await preflightFixture();
  const auditRows = checked.rows.map((row, index) => ({ ...row, rowNumber: index + 1, filename: filenames[index]! }));
  const all = createAudit(auditRows);
  expect(JSON.parse(all.json)).toHaveLength(5);
  expect(JSON.parse(all.json).at(-1)).toMatchObject({ rowNumber: 5, status: 'flagged' });
  expect(createAudit(auditRows, { exportScope: 'all-ready', selectedRowNumbers: [1, 2, 3, 4] })).toEqual(all);
  for (const selectedRowNumbers of [[], [5, 14]]) {
    expect(() => createAudit(auditRows, { exportScope: 'selected-subset', selectedRowNumbers })).toThrow(/^empty-export$/);
  }
  const subset = createAudit(auditRows, { exportScope: 'selected-subset', selectedRowNumbers: [2, 4] });
  expect(JSON.parse(subset.json)).toEqual([JSON.parse(all.json)[1], JSON.parse(all.json)[3]]);
  const [header, first, second, end] = subset.csv.split('\r\n');
  expect(header).toBe('rowNumber,filename,status,diagnostics,fontSizes');
  expect(first).toBe(all.csv.split('\r\n')[2]);
  expect(second).toBe(all.csv.split('\r\n')[4]);
  expect(end).toBe('');
}, 30_000);
