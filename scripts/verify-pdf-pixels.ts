import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFTextField, type PDFObject } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { createAudit, createMergedPdf, createZip, inspectTemplate, preflightRow, type PdfExportRow } from '../src/core/pdf';
import { readRoster } from '../src/core/roster';

const assetRoot = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const root = resolve('test-results/pdf-pixels');
const asset = (path: string) => resolve(assetRoot, path);
const key = PDFName.of;
const settings = { fonts: {
  arabic: await readFile(asset('public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(asset('public/fonts/NotoSans-Regular.ttf')),
}, minFontSize: 8 };
const cases: { before: string; after: string; values: Record<string, string>; label: string }[] = [];
const templateResults: { name: string; sha256: string; expected: string; result: string; detail?: string }[] = [];
const originalSnapshots = new Set<string>();

async function compareRawPdf(before: Uint8Array, after: Uint8Array, expected: Record<string, string>) {
  const original = await PDFDocument.load(before);
  const newDoc = await PDFDocument.load(after);
  const originalFields = original.getForm().getFields();
  const newFields = newDoc.getForm().getFields();
  assert.deepEqual(newFields.map((field) => field.getName()), originalFields.map((field) => field.getName()));
  for (const [index, field] of newFields.entries()) {
    const originalField = originalFields[index]!;
    const name = field.getName();
    const mapped = Object.hasOwn(expected, name);
    if (mapped) {
      assert(field instanceof PDFTextField, name);
      assert.equal(field.getText(), expected[name], `canonical /V of ${name}`);
    } else {
      assert.equal(field.acroField.dict.get(key('V'))?.toString(), originalField.acroField.dict.get(key('V'))?.toString(), `unmapped /V of ${name}`);
    }
    const originalWidgets = originalField.acroField.getWidgets();
    const widgets = field.acroField.getWidgets();
    assert.equal(widgets.length, originalWidgets.length);
    for (const [widgetIndex, widget] of widgets.entries()) {
      const appearance = widget.dict.lookupMaybe(key('AP'), PDFDict);
      const normal = appearance?.lookup(key('N'));
      if (!mapped) {
        const oldAppearance = originalWidgets[widgetIndex]!.dict.lookupMaybe(key('AP'), PDFDict);
        const oldNormal = oldAppearance?.lookup(key('N'));
        assert.equal(appearance?.toString(), oldAppearance?.toString(), `unmapped /AP of ${name}`);
        if (oldNormal instanceof PDFRawStream && normal instanceof PDFRawStream) {
          assert.deepEqual(Buffer.from(normal.getContents()), Buffer.from(oldNormal.getContents()), `unmapped /AP/N bytes of ${name}`);
        } else if (oldNormal instanceof PDFDict && normal instanceof PDFDict) {
          for (const state of oldNormal.keys()) {
            const oldStream: PDFObject | undefined = oldNormal.lookup(state);
            const currentStream: PDFObject | undefined = normal.lookup(state);
            if (oldStream instanceof PDFRawStream && currentStream instanceof PDFRawStream) {
              assert.deepEqual(Buffer.from(currentStream.getContents()), Buffer.from(oldStream.getContents()));
            }
          }
        }
        continue;
      }
      assert(normal instanceof PDFRawStream && normal.getContentsSize() > 0, `${name} needs a normal appearance`);
      const stream = new TextDecoder().decode(decodePDFRawStream(normal).decode());
      assert.match(stream, /\/Tx BMC/);
      const fontRefs = normal.dict.lookup(key('Resources'), PDFDict).lookup(key('Font'), PDFDict);
      if (!(expected[name] ?? '').trim()) continue;
      assert.match(stream, / Tj\b/);
      assert(fontRefs.keys().length > 0, `${name} needs an embedded font`);
      for (const fontName of fontRefs.keys()) {
        const font = fontRefs.lookup(fontName, PDFDict);
        const fontDescriptor = font.lookup(key('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
        const file = fontDescriptor.lookup(key('FontFile2')) ?? fontDescriptor.lookup(key('FontFile3'));
        assert(file instanceof PDFRawStream && file.getContentsSize() > 0, `${name} contains no embedded font data`);
      }
    }
  }
}

async function passingCase(source: Buffer, values: Record<string, string>, filename: string, label: string, minFontSize = settings.minFontSize) {
  const result = await preflightRow(source, values, { ...settings, minFontSize });
  assert.equal(result.status, 'pass', `${label}: ${JSON.stringify(result.diagnostics)}`);
  assert(result.pdfBytes);
  await compareRawPdf(source, result.pdfBytes, values);
  const before = `source-${createHash('sha256').update(source).digest('hex')}.pdf`;
  if (!originalSnapshots.has(before)) {
    await writeFile(resolve(root, before), source);
    originalSnapshots.add(before);
  }
  await writeFile(resolve(root, filename), result.pdfBytes);
  cases.push({ before, after: filename, values, label });
  return { filename, pdfBytes: result.pdfBytes, fontSizes: result.fontSizes };
}

await mkdir(root, { recursive: true });
const fixture = (filename: string) => asset(`fixtures/golden/${filename}`);
const sourcePath = fixture('template.pdf');
const source = await readFile(sourcePath);
const csv = (await readRoster(await readFile(fixture('roster.csv')), 'roster.csv')).sheets[0]!;
const workbook = await readRoster(await readFile(fixture('roster.xlsx')), 'roster.xlsx');
const excel = workbook.sheets.find((sheet) => sheet.name === 'Roster')!;
assert.deepEqual(csv.headers, excel.headers);
assert.deepEqual(csv.rows, excel.rows);
const ids = ['00123', '00007'];
assert.deepEqual(csv.rows.slice(0, 2).map(({ values }) => values.ID), ids);
assert.deepEqual(excel.rows.slice(0, 2).map(({ values }) => values.ID), ids);
const numericIds = workbook.sheets.find((sheet) => sheet.name === 'Numeric IDs')!;
assert(numericIds.rows.some(({ warnings }) => warnings.some(({ code }) => code === 'excel-scientific-notation-warning')));
assert(numericIds.rows.some(({ values, warnings }) => values.ID === '7' && warnings.some(({ code }) => code === 'excel-numeric-identifier-warning')));
assert.equal(csv.rows.length, 5);
const staged: PdfExportRow[] = [];
const report: Parameters<typeof createAudit>[0][number][] = [];
for (const [index, { values }] of csv.rows.entries()) {
  const filename = `roster-${index + 1}.pdf`;
  if (index === 4) {
    const flagged = await preflightRow(source, values, settings);
    assert.equal(flagged.status, 'flagged');
    assert.deepEqual(flagged.diagnostics, [{ field: 'Name', code: 'too-narrow', widgetIndex: 0 }]);
    assert.equal(flagged.pdfBytes, undefined);
    report.push({ rowNumber: 5, filename, status: flagged.status, diagnostics: flagged.diagnostics, fontSizes: flagged.fontSizes });
  }
  const tested = index === 4 ? { ...values, Name: 'ليلى حسن' } : values;
  const result = await passingCase(source, tested, filename, `Golden roster row ${index + 1}${index === 4 ? ' (corrected)' : ''}`);
  staged.push(result);
  if (index < 4) report.push({ rowNumber: index + 1, filename, status: 'pass', diagnostics: [], fontSizes: result.fontSizes });
}
const audit = createAudit(report);
await writeFile(resolve(root, 'audit.json'), audit.json);
await writeFile(resolve(root, 'audit.csv'), audit.csv);
const zip = createZip(staged);
const members = unzipSync(zip);
assert.deepEqual(Object.keys(members), staged.map(({ filename }) => filename));
for (const { filename, pdfBytes } of staged) assert.deepEqual(Buffer.from(members[filename]!), Buffer.from(pdfBytes));
await writeFile(resolve(root, 'roster.zip'), zip);
const merged = await createMergedPdf(staged);
const mergedName = 'merged.pdf';
await writeFile(resolve(root, mergedName), merged);
const mergedDoc = await PDFDocument.load(merged);
assert.equal(mergedDoc.getPageCount(), staged.length);
assert(!mergedDoc.catalog.has(key('AcroForm')));

const edgePath = fixture('edge-cases.pdf');
const edge = await readFile(edgePath);
const edgeMetadata = await inspectTemplate(edge);
assert.deepEqual(edgeMetadata.pages.map(({ rotation }) => rotation), [0, 90, 180, 270]);
assert.equal(edgeMetadata.fields.find(({ name }) => name === 'Repeated')?.widgets.length, 4);
await passingCase(edge, { Repeated: 'رُقَيَّة نَاجِي', Multiline: 'سَلْمَى بِنْت يَاسِين\nReview the workshop handout before check-in. Reference 00007.', 'Widget Rotate': 'A-7' }, 'edge-pass.pdf', 'Repeated and rotated widgets');
const rejected = await preflightRow(edge, { AtomicRepeat: 'رُقَيَّة نَاجِي', 'Too Narrow': 'ليلى حسن', 'Too Low': 'مُحَمَّد', 'Exceeds MaxLen': '00123' }, settings);
assert.equal(rejected.status, 'flagged');
assert.deepEqual(rejected.diagnostics, [
  { field: 'AtomicRepeat', code: 'too-narrow', widgetIndex: 1 }, { field: 'Too Narrow', code: 'too-narrow', widgetIndex: 0 },
  { field: 'Too Low', code: 'too-low', widgetIndex: 0 }, { field: 'Exceeds MaxLen', code: 'exceeds-maxlen' },
]);
assert.equal(rejected.pdfBytes, undefined);
for (const [file, code] of [['xfa.pdf', 'xfa-unsupported'], ['encrypted.pdf', 'encrypted-pdf'], ['signed.pdf', 'signed-pdf-warning'], ['flat.pdf', 'flat-scanned-no-fields']]) {
  const bytes = await readFile(fixture(file!));
  await assert.rejects(inspectTemplate(bytes), { message: code });
  await assert.rejects(preflightRow(bytes, {}, settings), { message: code });
}

const templateRoot = process.env.ARABIFORM_PUBLIC_TEMPLATES;
if (templateRoot) {
  const publicCases: { name: string; values: Record<string, string> }[] = [
    { name: 'uspto-sb01.pdf', values: { 'First Named Inventor': 'بَنِي يَمَن', 'Application Number': '00007', Name: 'سَلْمَى بِنْت يَاسِين' } },
    { name: 'uscourts-ao440.pdf', values: { 'Civil action number': '00123', 'Place Served2': 'ليلى حسن', Plaintiff: 'بَنِي يَمَن' } },
    { name: 'uscis-i9.pdf', values: { 'Last Name (Family Name)': 'يُسْرَى مُؤْمِن', 'ZIP Code': '00123' } },
    { name: 'irs-w9.pdf', values: {} },
  ];
  for (const { name, values } of publicCases) {
    const path = resolve(templateRoot, name);
    const bytes = await readFile(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (name === 'irs-w9.pdf') {
      await assert.rejects(inspectTemplate(bytes), { message: 'xfa-unsupported' });
      templateResults.push({ name, sha256, expected: 'xfa-unsupported', result: 'xfa-unsupported' });
    } else {
      await passingCase(bytes, values, `filled-${name}`, name);
      const templateResult: typeof templateResults[number] = { name, sha256, expected: 'pass', result: 'pass' };
      if (name === 'uscourts-ao440.pdf') {
        const defendant = { Defendant2: 'فَاطِمَة حُسَيْن' };
        const atDefault = await preflightRow(bytes, defendant, settings);
        assert.equal(atDefault.status, 'flagged');
        assert.deepEqual(atDefault.diagnostics, [{ field: 'Defendant2', code: 'too-low', widgetIndex: 0 }]);
        const calibrated = await passingCase(bytes, defendant, 'calibrated-uscourts-ao440.pdf', `${name} (Defendant2 with a 6 pt floor)`, 6);
        templateResult.detail = `Defendant2 flags at an 8 pt floor and fits at ${calibrated.fontSizes.Defendant2?.[0]} pt when the floor is set to 6 pt.`;
      }
      templateResults.push(templateResult);
    }
  }
  const initial = await readFile(resolve(templateRoot, 'uscis-i9.pdf'));
  const overflow = await preflightRow(initial, { 'Employee Middle Initial (if any)': 'أحمد سالم أحمد سالم أحمد سالم' }, settings);
  assert.equal(overflow.status, 'flagged');
  assert(overflow.diagnostics.some((item) => item.field === 'Employee Middle Initial (if any)'));
}

await writeFile(resolve(root, 'manifest.json'), JSON.stringify({ cases, merged: { pdf: mergedName, rows: staged.map(({ filename }) => filename) }, leadingZeros: { csv: ids, xlsx: ids }, publicTemplates: templateResults }, null, 2));
console.log(`pdf-lib: ${cases.length} fills verified, 4 protections rejected, CSV/XLSX IDs and ZIP verified (${root}).`);
