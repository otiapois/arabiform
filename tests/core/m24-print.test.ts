import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFHexString, PDFName, PDFRawStream } from 'pdf-lib';
import { expect, it } from 'vitest';
import { planGroupedOutput } from '../../src/core/export/grouping';
import type { PrintJobEstimate } from '../../src/core/export/print-estimator';
import { inspectImpositionCompatibility } from '../../src/core/pdf/imposition';
import { readRoster } from '../../src/core/roster';
import { createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchMergedResult, BatchSplitResult } from '../../src/core/worker/protocol';

const fonts = { arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), latin: await readFile('public/fonts/NotoSans-Regular.ttf') };
const names = { templateName: 'visitor-badge.pdf', rosterName: 'visitor-roster.csv', outputName: 'arabiform-merged.pdf' };
const noop = () => {};

it('uses the same actual 4-up sheet counts and claims only the selected ready records', async () => {
  const template = await readFile('fixtures/m24/' + names.templateName);
  const roster = await readFile('fixtures/m24/' + names.rosterName);
  const parsed = (await readRoster(roster, names.rosterName)).sheets[0]!.rows;
  const rows = parsed.map(({ values }) => ({ Name: values.Name!, 'Badge ID': values['Badge ID']! }));
  rows[2]!.Name = '';
  const grouping = planGroupedOutput(parsed, 'Track', '{{Badge ID}}.pdf');
  const worker = createBatchProcessor();
  await worker({ phase: 'preflight', input: { template, roster, rows, options: { fonts } } }, noop);
  const rowSelection = [1, 2, 3, 4, 5, 7];
  const imposition = '4-up';
  const coverSheet = { templateName: names.templateName, filenames: grouping.rows.map(({ filename }) => filename), locale: 'en', coverLanguage: 'bilingual' } as const;
  const options = { rowSelection, coverSheet, imposition, fourUp: { fourUpOrder: 'cut-and-stack', centerCutGuides: true } } as const;
  const estimate = await worker({ phase: 'estimate', ...options, grouping }, noop) as PrintJobEstimate;
  const merged = await worker({ phase: 'merged', ...options }, noop) as BatchMergedResult;
  const split = await worker({ phase: 'split', ...options, grouping }, noop) as BatchSplitResult;
  expect(estimate).toMatchObject({ totalRecords: 5, activePhysicalSheets: 3, oneUpPhysicalSheets: 6, percentPaperSavedByFourUp: 50,
    split: { activePhysicalSheets: 4, oneUpPhysicalSheets: 7, percentPaperSavedByFourUp: 42.86 } });
  expect((await PDFDocument.load(merged.bytes)).getPageCount()).toBe(estimate.activePhysicalSheets);
  const zip = unzipSync(split.bytes);
  for (const { filename, rowNumbers, activePhysicalSheets } of estimate.split!.groupBreakdowns) {
    expect((await PDFDocument.load(zip[filename]!)).getPageCount()).toBe(activePhysicalSheets);
    expect(split.groups.find((entry) => entry.filename === filename)?.rowNumbers).toEqual(rowNumbers);
  }
  const certificate = await worker({ phase: 'certificate', merged, names }, noop) as Uint8Array;
  const cert = await PDFDocument.load(certificate);
  expect(cert.getPageCount()).toBe(1);
  const streams = cert.getPage(0).node.Contents() as PDFArray;
  const content = new TextDecoder().decode(decodePDFRawStream(streams.lookup(0, PDFRawStream)).decode());
  for (const value of ['Scope: selected ready rows', 'Ready: 5  /  Excluded: 2', 'Physical sheets: 3  /  Cover pages: 1',
    'SHA-256 ' + createHash('sha256').update(merged.bytes).digest('hex')]) {
    expect(content).toContain('/ActualText ' + PDFHexString.fromText(value).toString());
  }
  const unsupportedName = 'محمَّد🙂.csv';
  const fallbackCertificate = await worker({ phase: 'certificate', merged, names: { ...names, rosterName: unsupportedName } }, noop) as Uint8Array;
  expect(JSON.parse((await PDFDocument.load(fallbackCertificate)).getSubject()!).rosterName).toBe(unsupportedName);
  const altered = { ...merged, bytes: Uint8Array.of(...merged.bytes.subarray(0, 8)) };
  await expect(worker({ phase: 'certificate', merged: altered, names }, noop)).rejects.toThrow('print-certificate-output-mismatch');
  await expect(worker({ phase: 'merged', ...options, rowSelection: [] }, noop)).rejects.toThrow('empty-export');
  await expect(worker({ phase: 'certificate', merged, names }, noop)).rejects.toThrow('print-certificate-unavailable');
}, 180_000);

it('holds a printable non-widget annotation for 4-up and estimates the original 1-up sheet count', async () => {
  const template = await PDFDocument.load(await readFile('fixtures/m24/' + names.templateName), { updateMetadata: false });
  const page = template.getPage(0);
  page.node.addAnnot(template.context.register(template.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [32, 40, 60, 70], F: 4 })));
  const bytes = await template.save({ updateFieldAppearances: false });
  expect(await inspectImpositionCompatibility(bytes)).toMatchObject({ fourUpUnavailableReason: 'imposition-unsupported-print-annotation' });
  const worker = createBatchProcessor();
  await worker({ phase: 'preflight', input: { template: bytes, roster: Uint8Array.of(1), rows: [{ Name: 'Amal', 'Badge ID': '00001' }], options: { fonts } } }, noop);
  expect(await worker({ phase: 'estimate', imposition: '4-up' }, noop)).toMatchObject({ imposition: '1-up', activePhysicalSheets: 1,
    fourUpPhysicalSheets: null, fourUpUnavailableReason: 'imposition-unsupported-print-annotation' });
  await expect(worker({ phase: 'merged', imposition: '4-up' }, noop)).rejects.toThrow('imposition-unsupported-print-annotation');
  const merged = await worker({ phase: 'merged' }, noop) as BatchMergedResult;
  expect((await PDFDocument.load(merged.bytes)).getPage(0).node.Annots()!.lookup(0)!.toString()).toContain(PDFName.of('Text').toString());
});

it('withholds the clean certificate when mapped glyphs fit the widget but are outside the visible print page', async () => {
  const template = await PDFDocument.create({ updateMetadata: false });
  const page = template.addPage([200, 200]);
  page.setCropBox(-100, 0, 300, 200);
  template.getForm().createTextField('Name').addToPage(page, { x: -85, y: 80, width: 70, height: 28 });
  const worker = createBatchProcessor();
  const checked = await worker({ phase: 'preflight', input: { template: await template.save(), roster: Uint8Array.of(1),
    rows: [{ Name: 'Amal' }], options: { fonts } } }, noop);
  expect(checked).toMatchObject({ rows: [{ status: 'pass', mappedInkOutsidePrint: true }] });
  const merged = await worker({ phase: 'merged', imposition: '4-up' }, noop) as BatchMergedResult;
  await expect(worker({ phase: 'certificate', merged, names }, noop)).rejects.toThrow('print-certificate-unavailable');
});
