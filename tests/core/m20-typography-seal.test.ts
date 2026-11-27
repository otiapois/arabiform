import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { expect, it } from 'vitest';
import { validateMappingPreset } from '../../src/core/draft/mapping-preset';
import { planGroupedOutput } from '../../src/core/export/grouping';
import { prepareRowPreflight, preflightRow } from '../../src/core/pdf';
import { validateApprovalSealSettings, type ApprovalSealSettings } from '../../src/core/pdf/approval-seal-settings';
import { createBatchProcessor } from '../../src/core/worker/batch';

const key = PDFName.of;
const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const fonts = {
  arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
};
const seal: ApprovalSealSettings = { placement: 'top-left', labelEn: 'Records Office', labelAr: 'مَكْتَبُ السِّجِلَّاتِ', issueDate: '2028-02-29' };

async function template({ obstacle = false, flags = 4, rotated = false } = {}) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([280, 300]);
  if (rotated) {
    page.setRotation(degrees(90));
    page.setCropBox(10, 20, 240, 240);
    page.node.set(key('UserUnit'), doc.context.register(doc.context.obj(2)));
  }
  const form = doc.getForm();
  for (const [name, x, width] of [['Date', 30, 120], ['ID', 160, 90], ['Tight', 55, 25]] as const) {
    const field = form.createTextField(name);
    field.addToPage(page, { x, y: name === 'Tight' ? 130 : 145, width, height: name === 'Tight' ? 12 : 32, borderWidth: 1 });
    field.setFontSize(12);
  }
  const keep = form.createTextField('Office.Keep');
  keep.setText('KEEP 00109');
  keep.addToPage(page, obstacle ? (rotated ? { x: 16, y: 34, width: 23, height: 37 } : { x: 14, y: 252, width: 90, height: 24 })
    : { x: 72, y: 91, width: 115, height: 18 });
  keep.acroField.getWidgets()[0]!.dict.set(key('F'), doc.context.obj(flags));
  return doc.save();
}

function content(page: PDFPage) {
  const streams = page.node.Contents();
  return (streams instanceof PDFArray ? streams.asArray() : [streams]).map((ref) => {
    const stream = page.doc.context.lookup(ref);
    return stream instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(stream).decode()) : '';
  }).join('\n');
}

function sealTextCount(doc: PDFDocument) {
  const actualText = '/ActualText ' + PDFHexString.fromText(seal.labelAr).toString();
  const page = doc.getPage(0);
  const original = content(page);
  if (original.includes(actualText)) return original.split(actualText).length - 1;
  const xObjects = page.node.Resources()?.lookupMaybe(key('XObject'), PDFDict);
  return (xObjects?.keys() ?? []).reduce((count, key) => {
    const stream = xObjects?.lookup(key);
    return count + Number(stream instanceof PDFRawStream && new TextDecoder().decode(decodePDFRawStream(stream).decode()).includes(actualText));
  }, 0);
}

it('converts only bound text values before fit and preserves unchanged widget appearances', async () => {
  const source = await template();
  const values = { Date: '۰۰١2٣', ID: '۰٠١۲3' };
  const options = { fonts, fieldTypography: {
    Date: { numeralPolicy: 'eastern-arabic', paddingPt: 4 }, ID: { numeralPolicy: 'western-ascii' },
    'Office.Keep': { numeralPolicy: 'eastern-arabic' }, Tight: { paddingPt: 6 },
  } } as const;
  const check = await prepareRowPreflight(source, options);
  const filled = await preflightRow(source, values, options);
  const { pdfBytes, ...checked } = filled;
  expect(await check(values)).toEqual(checked);
  expect(filled.status).toBe('pass');
  const form = (await PDFDocument.load(pdfBytes!)).getForm();
  expect(form.getTextField('Date').getText()).toBe('٠٠١٢٣');
  expect(form.getTextField('ID').getText()).toBe('00123');
  expect(form.getTextField('Office.Keep').getText()).toBe('KEEP 00109');
  const appearance = (field: ReturnType<typeof form.getTextField>) => field.acroField.getWidgets()[0]!.dict.lookupMaybe(key('AP'), PDFDict)?.lookup(key('N')) as PDFRawStream;
  expect(appearance(form.getTextField('Office.Keep')).getContents())
    .toEqual(appearance((await PDFDocument.load(source)).getForm().getTextField('Office.Keep')).getContents());
  expect((await check({ Tight: '0' })).diagnostics).toMatchObject([{ field: 'Tight', code: 'too-low' }]);
});

it('prints the same vector seal in preview, flattened ZIP, merged and split 2-up output while preserving editable ZIP', async () => {
  const source = await template({ rotated: true });
  const rows = [{ Date: '00123', Department: 'A' }, { Date: '00007', Department: 'A' }];
  const run = createBatchProcessor();
  const notify = () => {};
  await run({ phase: 'preflight', input: { template: source, roster: new Uint8Array(), rows: rows.map(({ Date }) => ({ Date })), options: { fonts } } }, notify);
  const qrStamp = { placement: 'bottom-right', sizePt: 48, payloads: ['00123', '00007'] } as const;
  const stampSettings = { approvalSeal: seal, qrStamp };
  const filenames = ['00123.pdf', '00007.pdf'];
  const grouping = planGroupedOutput(rows.map((values) => ({ values, warnings: [] })), 'Department', '{{Date}}.pdf');
  const results = await Promise.all([
    run({ phase: 'preview', rowIndex: 0, ...stampSettings }, notify),
    run({ phase: 'zip', filenames, ...stampSettings, flattenZip: true }, notify),
    run({ phase: 'merged', ...stampSettings, imposition: '2-up' }, notify),
    run({ phase: 'split', grouping, ...stampSettings, imposition: '2-up' }, notify),
    run({ phase: 'zip', filenames, ...stampSettings }, notify),
  ]);
  const [preview, printed, twoUp, split, editable] = results;
  if (!(preview instanceof Uint8Array) || !printed || !('bytes' in printed) || !twoUp || !('bytes' in twoUp)
    || !split || !('bytes' in split) || !editable || !('bytes' in editable)) throw new Error('missing print bytes');
  const docs = await Promise.all([
    PDFDocument.load(preview), PDFDocument.load(unzipSync(printed.bytes)[filenames[0]!]!), PDFDocument.load(twoUp.bytes),
    PDFDocument.load(unzipSync(split.bytes)['A-merged.pdf']!), PDFDocument.load(unzipSync(editable.bytes)[filenames[0]!]!),
  ]);
  expect(docs.map(sealTextCount)).toEqual([1, 1, 2, 2, 0]);
  expect(docs[0]!.getForm().getTextField('Date').getText()).toBe('00123');
  expect(docs[4]!.getForm().getTextField('Office.Keep').getText()).toBe('KEEP 00109');
});

it('blocks visible and print-only unmapped widgets and the full QR footprint before returning any print output', async () => {
  const notify = () => {};
  const prepare = async (source: Uint8Array) => {
    const run = createBatchProcessor();
    await run({ phase: 'preflight', input: {
      template: source, roster: new Uint8Array(), rows: [{ Date: '00123' }], options: { fonts },
    } }, notify);
    return run;
  };
  for (const flags of [0, 4, 36]) {
    const run = await prepare(await template({ obstacle: true, flags, rotated: true }));
    const outcome = await run({ phase: 'preview', rowIndex: 0, approvalSeal: seal }, notify).then(() => 'resolved', (error: unknown) => error);
    expect(outcome).toMatchObject({
      code: 'approval-seal-widget-overlap', pageNumber: 1, fieldName: 'Office.Keep',
    });
    await expect(run({ phase: 'zip', filenames: ['00123.pdf'], flattenZip: true, approvalSeal: seal }, notify))
      .rejects.toThrow('approval-seal-widget-overlap');
    await expect(run({ phase: 'zip', filenames: ['00123.pdf'], approvalSeal: seal }, notify)).resolves.toHaveProperty('bytes');
  }
  const run = await prepare(await template());
  const qrStamp = { placement: 'top-left', sizePt: 48, payloads: ['00123'] } as const;
  await expect(run({ phase: 'merged', qrStamp, approvalSeal: seal }, notify)).rejects.toMatchObject({ code: 'approval-seal-qr-overlap', pageNumber: 1 });
});

it('validates V10 optional controls and canonical issue dates without changing V9', () => {
  const v9 = {
    version: 9, mapping: { Date: 'Date' }, filenamePattern: '{{Date}}.pdf', minFontSize: 8, font: 'auto', flattenZip: true,
    includeCoverSheet: false, alignOverrides: {}, watermark: { kind: 'none' }, virtualMappings: {}, qrStamp: { placement: 'none' },
    coverLanguage: 'auto', imposition: '1-up', groupByColumn: null,
  };
  const v10 = { ...v9, version: 10, fieldTypography: { Date: { paddingPt: 4, lineHeightScale: 1.15, numeralPolicy: 'eastern-arabic' } }, approvalSeal: seal };
  expect(validateMappingPreset(v9)).toEqual(v9);
  expect(validateMappingPreset(v10)).toEqual(v10);
  expect(validateMappingPreset({ ...v10, approvalSeal: null })).toMatchObject({ approvalSeal: null });
  expect(validateMappingPreset({ ...v10, fieldTypography: { Keep: { paddingPt: 4 } } })).toBeUndefined();
  for (const issueDate of ['2026-02-29', '2026-11-31', '0000-01-01', '2026-3-01', '٢٠٢٦-١١-٢٨']) {
    expect(validateApprovalSealSettings({ ...seal, issueDate })).toBeUndefined();
  }
  expect(validateApprovalSealSettings({ ...seal, labelAr: '\u202E' + seal.labelAr })).toBeUndefined();
});
