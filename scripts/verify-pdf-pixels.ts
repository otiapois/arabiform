import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePDFRawStream, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFTextField, type PDFObject } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { createAudit, createMergedPdf, createZip, inspectCustomFont, inspectTemplate, preflightRow, type PdfExportRow } from '../src/core/pdf';
import { readRoster } from '../src/core/roster';

const assetRoot = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const root = resolve('test-results/pdf-pixels');
const asset = (path: string) => resolve(assetRoot, path);
const key = PDFName.of;
const settings = { fonts: {
  arabic: await readFile(asset('public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(asset('public/fonts/NotoSans-Regular.ttf')),
}, minFontSize: 8 };
const cases: { before: string; after: string; values: Record<string, string>; label: string; checkboxes?: Record<string, string>; customFont?: boolean }[] = [];
const templateResults: { name: string; sha256: string; expected: string; result: string; detail?: string }[] = [];
const m2TemplateResults: { name: string; sha256: string; expected: string; detail?: string }[] = [];
const originalSnapshots = new Set<string>();

function appearanceSnapshot(object: PDFObject | undefined): unknown {
  if (object instanceof PDFRawStream) return { dictionary: object.dict.toString(), bytes: Buffer.from(object.getContents()) };
  if (object instanceof PDFDict) return { dictionary: object.toString(), entries: object.keys().map((key) => appearanceSnapshot(object.lookup(key))) };
  return object?.toString();
}

async function compareRawPdf(before: Uint8Array, after: Uint8Array, expected: Record<string, string>, checkboxes: Record<string, string> = {}) {
  const original = await PDFDocument.load(before);
  const newDoc = await PDFDocument.load(after);
  const originalFields = original.getForm().getFields();
  const newFields = newDoc.getForm().getFields();
  assert.deepEqual(newFields.map((field) => field.getName()), originalFields.map((field) => field.getName()));
  for (const [index, field] of newFields.entries()) {
    const originalField = originalFields[index]!;
    const name = field.getName();
    const mapped = Object.hasOwn(expected, name);
    const checkbox = checkboxes[name];
    if (mapped && checkbox !== undefined) {
      assert(field instanceof PDFCheckBox, name);
      assert.equal(field.acroField.dict.get(key('V'))?.toString(), `/${checkbox}`, `canonical checkbox /V of ${name}`);
    } else if (mapped) {
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
      if (!mapped || checkbox !== undefined) {
        const old = originalWidgets[widgetIndex]!.dict;
        for (const attribute of ['V', 'AS']) {
          const previous = old.get(key(attribute))?.toString();
          const wanted = checkbox !== undefined && (attribute === 'AS' || previous !== undefined) ? `/${checkbox}` : previous;
          assert.equal(widget.dict.get(key(attribute))?.toString(), wanted, `widget ${widgetIndex} /${attribute} of ${name}`);
        }
        assert.equal(widget.dict.get(key('AP'))?.toString(), old.get(key('AP'))?.toString(), `raw /AP of ${name}`);
        assert.deepEqual(appearanceSnapshot(appearance), appearanceSnapshot(old.lookup(key('AP'))), `unchanged /AP streams of ${name}`);
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

async function passingCase(source: Buffer, values: Record<string, string>, filename: string, label: string, minFontSize = settings.minFontSize,
  { checkboxes, customFont }: { checkboxes?: Record<string, string>; customFont?: Uint8Array } = {}) {
  const result = await preflightRow(source, values, { ...settings, minFontSize, customFont });
  assert.equal(result.status, 'pass', `${label}: ${JSON.stringify(result.diagnostics)}`);
  assert(result.pdfBytes);
  await compareRawPdf(source, result.pdfBytes, values, checkboxes);
  const before = `source-${createHash('sha256').update(source).digest('hex')}.pdf`;
  if (!originalSnapshots.has(before)) {
    await writeFile(resolve(root, before), source);
    originalSnapshots.add(before);
  }
  await writeFile(resolve(root, filename), result.pdfBytes);
  cases.push({ before, after: filename, values, label, checkboxes, ...(customFont && { customFont: true }) });
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
  { field: 'Too Low', code: 'too-low', widgetIndex: 0 }, { field: 'Exceeds MaxLen', code: 'exceeds-maxlen', maxLengthExcess: 1 },
]);
assert.equal(rejected.pdfBytes, undefined);
for (const [file, code] of [['xfa.pdf', 'xfa-unsupported'], ['encrypted.pdf', 'encrypted-pdf'], ['signed.pdf', 'signed-pdf-warning'], ['flat.pdf', 'flat-scanned-no-fields']]) {
  const bytes = await readFile(fixture(file!));
  await assert.rejects(inspectTemplate(bytes), { message: code });
  await assert.rejects(preflightRow(bytes, {}, settings), { message: code });
}

const badgeRoster = await readRoster(await readFile(asset('fixtures/m2/badge-roster.csv')), 'badge-roster.csv');
const badgeValues = badgeRoster.sheets[0]!.rows[0]!.values;
const m2Cases: { name: string; label: string; values: Record<string, string> }[] = [
  { name: 'hr-onboarding.pdf', label: 'HR onboarding: Arabic with ASCII ID and Latin year', values: { Name: 'الطلب #00123 - Riyadh 2026', 'Employee ID': '00123', 'Start Date': '2026-11-26' } },
  { name: 'clinic-intake.pdf', label: 'Clinic intake: phone groups and explicit bilingual notes', values: { Patient: 'مُحَمَّد سَالِم', Phone: '+966 50 012 3456', 'Intake Notes': 'اتصال +966 50 012 3456\nRequest a morning appointment.' } },
  { name: 'bilingual-certificate.pdf', label: 'Bilingual certificate: bracketed RTL and Arabic-Indic digits', values: { Name: '(أحمد - 0045)', 'Course Title': 'تَدْرِيب Riyadh 2026', 'Record Number': '١٢٣٤٥٦' } },
  { name: 'landscape-badge.pdf', label: 'Landscape visitor badge: rotated widget at exact safe floor', values: badgeValues },
  { name: 'access-code.pdf', label: 'Access code request: leading zeros in narrow MaxLen field', values: { Officer: 'بَنِي يَمَن', 'Printed Code': '0007' } },
  { name: 'dispatch-header.pdf', label: 'Dispatch packet: repeated header on three rotated pages', values: { Header: 'مَهَا نَاجِي #00123', Consignment: '00007-AR' } },
  { name: 'mailing-address.pdf', label: 'Mailing address: explicit newlines, wrapping, and Arabic harakat', values: { Recipient: 'سَلْمَى بِنْت يَاسِين', Address: 'مَبْنَى ١٢٣٤٥٦\n15 Workshop Lane, North Entrance\nRiyadh, Saudi Arabia', 'Postal Code': '00123' } },
  { name: 'remittance-slip.pdf', label: 'Remittance slip: RTL beneficiary and mixed script reference', values: { Beneficiary: 'يُسْرَى مُؤْمِن', Reference: 'الطلب #00123 - Riyadh 2026', Amount: '١٢٣٤٥٦ SAR' } },
];
for (const { name, label, values } of m2Cases) {
  const bytes = await readFile(asset(`fixtures/m2/${name}`));
  const result = { name, sha256: createHash('sha256').update(bytes).digest('hex'), expected: 'pass', detail: undefined as string | undefined };
  let floor = settings.minFontSize;
  if (name === 'landscape-badge.pdf') {
    const flagged = await preflightRow(bytes, values, settings);
    assert.equal(flagged.status, 'flagged');
    assert.deepEqual(flagged.diagnostics, [{ field: 'Name', code: 'too-narrow', widgetIndex: 0, requiredFontSizePt: 7.58 }]);
    assert.equal(flagged.pdfBytes, undefined);
    floor = flagged.diagnostics[0]!.requiredFontSizePt!;
    result.detail = `Name flags at 8 pt and passes at the indicated ${floor} pt without changing the roster value.`;
  }
  if (name === 'access-code.pdf') {
    const unsupported = await preflightRow(bytes, { 'Printed Code': '0007١٢', 'Comb Code': '00123' }, settings);
    assert.equal(unsupported.status, 'flagged');
    assert.equal(unsupported.pdfBytes, undefined);
    assert.deepEqual(unsupported.diagnostics, [
      { field: 'Printed Code', code: 'exceeds-maxlen', maxLengthExcess: 2 },
      { field: 'Comb Code', code: 'exceeds-maxlen', maxLengthExcess: 1 }, { field: 'Comb Code', code: 'unsupported-field-mode' },
    ]);
    result.detail = 'Overlength code and comb fill refused without writing an output PDF.';
  }
  await passingCase(bytes, values, `filled-${name}`, label, floor);
  m2TemplateResults.push(result);
}
assert.equal(new Set(m2TemplateResults.map(({ sha256 }) => sha256)).size, 8);

const consent = await readFile(asset('fixtures/m3/clinic-consent-mixed.pdf'));
const roster3 = await readRoster(await readFile(asset('fixtures/m3/clinic-consent-roster.csv')), 'roster.csv');
const formulas = await readRoster(await readFile(asset('fixtures/m3/clinic-consent-formulas.xlsx')), 'formulas.xlsx');
assert.deepEqual(formulas.sheets[0]!.rows.map(({ warnings }) => warnings), [
  [{ column: 'Consent', source: { row: 2, column: 'C' }, code: 'excel-formula-warning', formulaHasCachedValue: true }],
  [{ column: 'Consent', source: { row: 3, column: 'C' }, code: 'excel-formula-warning', formulaHasCachedValue: false }],
]);
const [{ values: consentOn }, { values: consentOff }, { values: consentInvalid }] = roster3.sheets[0]!.rows as [typeof csv.rows[number], typeof csv.rows[number], typeof csv.rows[number]];
const mixedRows: PdfExportRow[] = [];
mixedRows.push(await passingCase(consent, consentOn, 'consent-on.pdf', 'M3 clinic consent: check both widgets', 8, { checkboxes: { Consent: 'Yes' } }));
const checkedSource = Buffer.from(mixedRows[0]!.pdfBytes);
mixedRows.push(await passingCase(checkedSource, consentOff, 'consent-off.pdf', 'M3 clinic consent: clear both widgets', 8, { checkboxes: { Consent: 'Off' } }));
const invalidConsent = await preflightRow(consent, consentInvalid, settings);
assert.deepEqual(invalidConsent.diagnostics, [{ field: 'Consent', code: 'invalid-checkbox-value' }]);
assert.equal(invalidConsent.pdfBytes, undefined);
assert.equal(inspectCustomFont(settings.fonts.arabic).family, 'Noto Naskh Arabic');
mixedRows.push(await passingCase(consent, { Name: 'سَلْمَى بِنْت يَاسِين' }, 'consent-custom.ttf.pdf',
  'M3 clinic consent: custom Noto Naskh Arabic TrueType', 8, { customFont: settings.fonts.arabic }));
const latinOnArabic = await preflightRow(consent, { Name: 'ليلى حسن' }, { ...settings, customFont: settings.fonts.latin });
assert.deepEqual(latinOnArabic.diagnostics, [{ field: 'Name', code: 'missing-glyphs', widgetIndex: 0 }]);
const cffPath = process.env.ARABIFORM_CUSTOM_CFF_FONT;
if (cffPath) {
  const customFont = await readFile(cffPath);
  assert.equal(customFont.subarray(0, 4).toString('ascii'), 'OTTO', 'CFF proof needs an actual CFF OpenType container');
  mixedRows.push(await passingCase(consent, { ID: 'Office 00109' }, 'consent-custom.otf.pdf',
    `M3 clinic consent: custom ${inspectCustomFont(customFont).family} OpenType CFF (SHA-256 ${createHash('sha256').update(customFont).digest('hex')})`, 8, { customFont }));
}
const mixedMerged = { pdf: 'consent-merged.pdf', rows: mixedRows.map(({ filename }) => filename) };
await writeFile(resolve(root, mixedMerged.pdf), await createMergedPdf(mixedRows));

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
        assert.equal(atDefault.diagnostics.length, 1);
        const [diagnostic] = atDefault.diagnostics;
        assert.equal(diagnostic?.field, 'Defendant2');
        assert.equal(diagnostic.code, 'too-low');
        const calibrated = await passingCase(bytes, defendant, 'calibrated-uscourts-ao440.pdf', `${name} (Defendant2 with a 6 pt floor)`, 6);
        assert.equal(diagnostic.requiredFontSizePt, calibrated.fontSizes.Defendant2?.[0]);
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

await writeFile(resolve(root, 'manifest.json'), JSON.stringify({ cases, merged: { pdf: mergedName, rows: staged.map(({ filename }) => filename) }, mixedMerged, leadingZeros: { csv: ids, xlsx: ids }, m2Templates: m2TemplateResults, publicTemplates: templateResults }, null, 2));
console.log(`pdf-lib: ${cases.length} fills verified, 4 protections rejected, CSV/XLSX IDs and ZIP verified (${root}).`);
