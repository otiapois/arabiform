import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePDFRawStream, degrees, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFRadioGroup, PDFRawStream, PDFString, PDFTextField, type PDFObject } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { createAudit, createFlattenedZip, createMergedPdf, createZip, inspectCustomFont, inspectTemplate, preflightRow, type PdfExportRow } from '../src/core/pdf';
import { makeFilenames, readRoster } from '../src/core/roster';
import { createBatchProcessor } from '../src/core/worker/batch';

const assetRoot = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const root = resolve('test-results/pdf-pixels');
const asset = (path: string) => resolve(assetRoot, path);
const key = PDFName.of;
const settings = { fonts: {
  arabic: await readFile(asset('public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(asset('public/fonts/NotoSans-Regular.ttf')),
}, minFontSize: 8 };
interface ExpectedChoices {
  checkboxes?: Record<string, string>;
  dropdowns?: Record<string, { label: string; index?: number }>;
  radios?: Record<string, { state: string; widgets: string[] }>;
}

type AlignmentMode = 'auto' | 'rtl' | 'ltr' | 'center';
type ExpectedAlignment = Record<string, { mode: AlignmentMode; anchor: 'rtl' | 'ltr' | 'center' }>;
const cases: ({ before: string; after: string; values: Record<string, string>; label: string; customFont?: boolean; alignments?: ExpectedAlignment } & ExpectedChoices)[] = [];
const templateResults: { name: string; sha256: string; expected: string; result: string; detail?: string }[] = [];
const m2TemplateResults: { name: string; sha256: string; expected: string; detail?: string }[] = [];
const originalSnapshots = new Set<string>();

function appearanceSnapshot(object: PDFObject | undefined): unknown {
  if (object instanceof PDFRawStream) return { dictionary: object.dict.toString(), bytes: Buffer.from(object.getContents()) };
  if (object instanceof PDFDict) return { dictionary: object.toString(), entries: object.keys().map((key) => appearanceSnapshot(object.lookup(key))) };
  return object?.toString();
}

async function compareRawPdf(before: Uint8Array, after: Uint8Array, expected: Record<string, string>, { checkboxes, dropdowns, radios }: ExpectedChoices) {
  const original = await PDFDocument.load(before);
  const newDoc = await PDFDocument.load(after);
  const originalFields = original.getForm().getFields();
  const newFields = newDoc.getForm().getFields();
  assert.deepEqual(newFields.map((field) => field.getName()), originalFields.map((field) => field.getName()));
  for (const [index, field] of newFields.entries()) {
    const originalField = originalFields[index]!;
    const name = field.getName();
    const mapped = Object.hasOwn(expected, name);
    const checkbox = checkboxes?.[name];
    const radio = radios?.[name];
    const dropdown = dropdowns?.[name];
    const value = field.acroField.dict.lookup(key('V'));
    if (mapped && checkbox !== undefined) {
      assert(field instanceof PDFCheckBox, name);
      assert.equal(field.acroField.dict.get(key('V'))?.toString(), `/${checkbox}`, `canonical checkbox /V of ${name}`);
    } else if (mapped && radio) {
      assert(field instanceof PDFRadioGroup, name);
      assert.equal(value, key(radio.state), `canonical radio /V of ${name}`);
      assert.equal(field.acroField.dict.get(key('Opt'))?.toString(), originalField.acroField.dict.get(key('Opt'))?.toString(), `raw /Opt of ${name}`);
    } else if (mapped && dropdown) {
      assert(field instanceof PDFDropdown && (value instanceof PDFString || value instanceof PDFHexString), name);
      assert.equal(value.decodeText(), expected[name], `canonical dropdown export /V of ${name}`);
      assert.equal(field.acroField.dict.get(key('Opt'))?.toString(), originalField.acroField.dict.get(key('Opt'))?.toString(), `raw /Opt of ${name}`);
      const index = dropdown.index === undefined ? undefined : `[ ${dropdown.index} ]`;
      assert.equal(field.acroField.dict.get(key('I'))?.toString(), index, `dropdown /I of ${name}`);
    } else if (mapped) {
      assert(field instanceof PDFTextField, name);
      assert.equal(field.getText(), expected[name], `canonical /V of ${name}`);
    } else {
      for (const attribute of ['V', 'AS', 'I', 'Opt']) {
        assert.equal(field.acroField.dict.get(key(attribute))?.toString(), originalField.acroField.dict.get(key(attribute))?.toString(), `unmapped /${attribute} of ${name}`);
      }
    }
    const originalWidgets = originalField.acroField.getWidgets();
    const widgets = field.acroField.getWidgets();
    assert.equal(widgets.length, originalWidgets.length);
    for (const [widgetIndex, widget] of widgets.entries()) {
      const appearance = widget.dict.lookupMaybe(key('AP'), PDFDict);
      const normal = appearance?.lookup(key('N'));
      if (!mapped || checkbox !== undefined || radio) {
        const old = originalWidgets[widgetIndex]!.dict;
        for (const attribute of ['V', 'AS']) {
          const previous = old.get(key(attribute))?.toString();
          const wanted = radio && attribute === 'AS' ? `/${radio.widgets[widgetIndex]}`
            : (radio || checkbox !== undefined) && (attribute === 'AS' || previous !== undefined) ? `/${radio?.state ?? checkbox}` : previous;
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
      const display = dropdown?.label ?? expected[name]!;
      if (!display.trim()) continue;
      if (dropdown) assert(stream.includes(PDFHexString.fromText(display).toString()), `${name} uses the display label in its AP`);
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
  { customFont, expected = values, alignments, ...choices }: ExpectedChoices & { customFont?: Uint8Array; expected?: Record<string, string>; alignments?: ExpectedAlignment } = {}) {
  const alignOverrides = alignments && Object.fromEntries(Object.entries(alignments).map(([name, { mode }]) => [name, mode]));
  const options = { ...settings, minFontSize, customFont, alignOverrides };
  const result = await preflightRow(source, values, options);
  assert.equal(result.status, 'pass', `${label}: ${JSON.stringify(result.diagnostics)}`);
  assert(result.pdfBytes);
  await compareRawPdf(source, result.pdfBytes, expected, choices);
  const before = `source-${createHash('sha256').update(source).digest('hex')}.pdf`;
  if (!originalSnapshots.has(before)) {
    await writeFile(resolve(root, before), source);
    originalSnapshots.add(before);
  }
  await writeFile(resolve(root, filename), result.pdfBytes);
  cases.push({ before, after: filename, values: expected, label, alignments, ...choices, ...(customFont && { customFont: true }) });
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
    assert.deepEqual(flagged.diagnostics, [{ field: 'Name', code: 'too-narrow', widgetIndex: 0, pageNumbers: [1] }]);
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
for (const mode of ['auto', 'rtl', 'ltr', 'center'] as const) {
  const values = { Repeated: '  بَنِي يَمَن #00123 ', 'Widget Rotate': ' A-7  ' };
  await passingCase(edge, values, `align-${mode}.pdf`, `${mode} alignment on repeated and rotated widgets`, settings.minFontSize, {
    alignments: {
      Repeated: { mode, anchor: mode === 'auto' ? 'rtl' : mode },
      'Widget Rotate': { mode, anchor: mode === 'auto' ? 'ltr' : mode },
    },
  });
}
const rejected = await preflightRow(edge, { AtomicRepeat: 'رُقَيَّة نَاجِي', 'Too Narrow': 'ليلى حسن', 'Too Low': 'مُحَمَّد', 'Exceeds MaxLen': '00123' }, settings);
assert.equal(rejected.status, 'flagged');
assert.deepEqual(rejected.diagnostics, [
  { field: 'AtomicRepeat', code: 'too-narrow', widgetIndex: 1, pageNumbers: [4] }, { field: 'Too Narrow', code: 'too-narrow', widgetIndex: 0, pageNumbers: [1] },
  { field: 'Too Low', code: 'too-low', widgetIndex: 0, pageNumbers: [1] }, { field: 'Exceeds MaxLen', code: 'exceeds-maxlen', maxLengthExcess: 1, pageNumbers: [1] },
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
    assert.deepEqual(flagged.diagnostics, [{ field: 'Name', code: 'too-narrow', widgetIndex: 0, requiredFontSizePt: 7.58, pageNumbers: [1] }]);
    assert.equal(flagged.pdfBytes, undefined);
    floor = flagged.diagnostics[0]!.requiredFontSizePt!;
    result.detail = `Name flags at 8 pt and passes at the indicated ${floor} pt without changing the roster value.`;
  }
  if (name === 'access-code.pdf') {
    const unsupported = await preflightRow(bytes, { 'Printed Code': '0007١٢', 'Comb Code': '00123' }, settings);
    assert.equal(unsupported.status, 'flagged');
    assert.equal(unsupported.pdfBytes, undefined);
    assert.deepEqual(unsupported.diagnostics, [
      { field: 'Printed Code', code: 'exceeds-maxlen', maxLengthExcess: 2, pageNumbers: [1] },
      { field: 'Comb Code', code: 'exceeds-maxlen', maxLengthExcess: 1, pageNumbers: [1] }, { field: 'Comb Code', code: 'unsupported-field-mode', pageNumbers: [1] },
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
assert.deepEqual(invalidConsent.diagnostics, [{ field: 'Consent', code: 'invalid-checkbox-value', pageNumbers: [1] }]);
assert.equal(invalidConsent.pdfBytes, undefined);
assert.equal(inspectCustomFont(settings.fonts.arabic).family, 'Noto Naskh Arabic');
mixedRows.push(await passingCase(consent, { Name: 'سَلْمَى بِنْت يَاسِين' }, 'consent-custom.ttf.pdf',
  'M3 clinic consent: custom Noto Naskh Arabic TrueType', 8, { customFont: settings.fonts.arabic }));
const latinOnArabic = await preflightRow(consent, { Name: 'ليلى حسن' }, { ...settings, customFont: settings.fonts.latin });
assert.deepEqual(latinOnArabic.diagnostics, [{ field: 'Name', code: 'missing-glyphs', widgetIndex: 0, pageNumbers: [1] }]);
const cffPath = process.env.ARABIFORM_CUSTOM_CFF_FONT;
if (cffPath) {
  const customFont = await readFile(cffPath);
  assert.equal(customFont.subarray(0, 4).toString('ascii'), 'OTTO', 'CFF proof needs an actual CFF OpenType container');
  mixedRows.push(await passingCase(consent, { ID: 'Office 00109' }, 'consent-custom.otf.pdf',
    `M3 clinic consent: custom ${inspectCustomFont(customFont).family} OpenType CFF (SHA-256 ${createHash('sha256').update(customFont).digest('hex')})`, 8, { customFont }));
}
const mixedMerged = { pdf: 'consent-merged.pdf', rows: mixedRows.map(({ filename }) => filename) };
await writeFile(resolve(root, mixedMerged.pdf), await createMergedPdf(mixedRows));

const m4 = await readFile(asset('fixtures/m4/multi-page-hr-choices.pdf'));
const m4Rows: PdfExportRow[] = [];
const arabicClinic = 'عِيَادَةُ الرِّيَاضِ';
const clinicOptions = [{ value: 'RIY', label: arabicClinic }, { value: 'JED', label: 'Jeddah Clinic' }];
const [m4Csv, m4Xlsx] = await Promise.all(['csv', 'xlsx'].map(async (ext) => {
  const filename = `multi-page-hr-choices.${ext}`;
  return (await readRoster(await readFile(asset(`fixtures/m4/${filename}`)), filename)).sheets[0]!;
}));
assert.deepEqual(m4Csv?.rows, m4Xlsx?.rows);
const [correction, exportMatch, labelMatch] = m4Csv!.rows.map(({ values }) => values);
assert(correction && exportMatch && labelMatch);
const clinicInvalid = await preflightRow(m4, correction, settings);
assert.deepEqual(clinicInvalid.pageNumbers, [2]);
assert.deepEqual(clinicInvalid.diagnostics, [{ field: 'Clinic', code: 'invalid-choice', choices: clinicOptions, pageNumbers: [2] }]);
assert.equal(clinicInvalid.pdfBytes, undefined);

const contactOn = { state: '0', widgets: ['0', 'Off'] };
const contactOff = { state: '1', widgets: ['Off', '1'] };
m4Rows.push(await passingCase(m4, { ...correction, Clinic: arabicClinic }, 'clinic-choice-arabic.pdf',
  'M4 corrected Arabic display label, activated checkbox and radio', 8, {
    expected: { ...correction, Clinic: 'RIY' }, checkboxes: { Acknowledged: 'Yes' },
    dropdowns: { Clinic: { label: arabicClinic } }, radios: { Contact: contactOn },
  }));
m4Rows.push(await passingCase(m4, exportMatch, 'clinic-choice-export.pdf', 'M4 exact export match and custom Arabic face', 8, {
  customFont: settings.fonts.arabic,
  checkboxes: { Acknowledged: 'Off' }, dropdowns: { Clinic: { label: arabicClinic } }, radios: { Contact: contactOff },
}));
m4Rows.push(await passingCase(m4, labelMatch, 'clinic-choice-latin.pdf', 'M4 Latin label and trimmed radio export', 8, {
  expected: { ...labelMatch, Clinic: 'JED' }, checkboxes: { Acknowledged: 'Yes' },
  dropdowns: { Clinic: { label: 'Jeddah Clinic' } }, radios: { Contact: contactOn },
}));

const duplicates = await PDFDocument.load(m4, { updateMetadata: false });
const duplicateDropdown = duplicates.getForm().getDropdown('Clinic').acroField.dict;
duplicateDropdown.lookup(key('Opt'), PDFArray).lookup(1, PDFArray).set(0, PDFString.of('RIY'));
duplicateDropdown.set(key('V'), PDFString.of('RIY'));
duplicateDropdown.set(key('I'), duplicates.context.obj([1]));
const duplicateBytes = Buffer.from(await duplicates.save({ updateFieldAppearances: false }));
const ambiguous = await preflightRow(duplicateBytes, exportMatch, settings);
assert.equal(ambiguous.diagnostics[0]?.code, 'invalid-choice');
assert.equal(ambiguous.pdfBytes, undefined);
m4Rows.push(await passingCase(duplicateBytes, { ...exportMatch, Clinic: arabicClinic }, 'clinic-choice-index.pdf',
  'M4 duplicate exports, selected by unique label with updated index', 8, {
    expected: exportMatch, checkboxes: { Acknowledged: 'Off' },
    dropdowns: { Clinic: { label: arabicClinic, index: 0 } }, radios: { Contact: contactOff },
  }));

const m4Merged = { pdf: 'choices-merged.pdf', rows: m4Rows.map(({ filename }) => filename) };
await writeFile(resolve(root, m4Merged.pdf), await createMergedPdf(m4Rows));

const coverSource = await PDFDocument.create();
const coverSourcePage = coverSource.addPage([180, 140]);
const coverSourceField = coverSource.getForm().createTextField('ID');
coverSourceField.addToPage(coverSourcePage, { x: 20, y: 60, width: 120, height: 20 });
const coverSourceBytes = Buffer.from(await coverSource.save());
const singlePageCoverRow = await passingCase(coverSourceBytes, { ID: 'بَنِي يَمَن 00123' },
  'cover-index-source.pdf', 'M6 compact one-page filled form for covered merge parity');
const longFilename = `00123-${'يَاسِين'.repeat(10)}-${'W'.repeat(50)}.pdf`;
const templateName = 'نَمُوذَج HR (00123).pdf';
const coveredMerged = [];
for (const locale of ['en', 'ar'] as const) {
  const en = locale === 'en';
  const sources = en ? [m4Rows[0]!, singlePageCoverRow] : Array.from({ length: 25 }, (_, index) => (
    index === 0 ? m4Rows[1]! : index === 24 ? m4Rows[2]! : singlePageCoverRow
  ));
  const filenames = sources.map((_, index) => en ? [longFilename, 'Layla 00007.pdf'][index]! : `${index + 1}-${longFilename}`);
  const rows = sources.map(({ pdfBytes }, index) => ({ pdfBytes, filename: filenames[index]! }));
  const rowNumbers = rows.map((_, index) => index + 2);
  const fontOptions = { ...settings, minFontSize: 7.25, preferredFont: 'latin' as const,
    ...(en ? {} : { customFont: settings.fonts.latin }) };
  const coverPages = en ? 1 : 2;
  const spec = {
    pdf: `m6-covered-${locale}.pdf`, plainPdf: `m6-plain-${locale}.pdf`,
    rows: sources.map(({ filename }) => filename), coverPages,
    expectedText: {
      title: en ? 'ArabiForm · Batch Print Manifest' : 'ArabiForm · سجل طباعة الدفعة',
      headings: en ? ['#', 'Row', 'Filename', 'Pages'] : ['#', 'الصف', 'اسم الملف', 'الصفحات'],
      details: en ? ['Export date', '2026-11-27', 'Template', templateName,
        'Ready: 2   ·   Flagged: 1   ·   Skipped: 1', 'Min font size: 7.25 pt   ·   Font mode: Latin']
        : ['تاريخ التصدير', '2026-11-27', 'القالب', templateName,
          'جاهز: 25   ·   يحتاج إلى مراجعة: 1   ·   تم تخطيه: 1', 'الحد الأدنى لحجم الخط: 7.25 نقطة   ·   وضع الخط: مخصص'],
      filenames, rowNumbers, wrappedFilenames: filenames.filter((name) => name.includes(longFilename)),
    },
  };
  const plain = await createMergedPdf(rows);
  const covered = await createMergedPdf(rows, undefined, {
    locale, templateName, exportedAt: new Date(2026, 10, 27, 23, 59),
    preflight: fontOptions, rowNumbers, flagged: 1, skipped: 1,
  });
  const plainDoc = await PDFDocument.load(plain);
  const coveredDoc = await PDFDocument.load(covered);
  assert.equal(coveredDoc.getPageCount(), plainDoc.getPageCount() + coverPages);
  assert(!coveredDoc.catalog.has(key('AcroForm')));
  for (const page of coveredDoc.getPages().slice(0, coverPages)) {
    const resources = page.node.Resources()!.lookup(key('Font'), PDFDict);
    for (const [name, bytes] of [['ArabiFormCoverArabic', settings.fonts.arabic], ['ArabiFormCoverLatin', settings.fonts.latin]] as const) {
      const descriptor = resources.lookup(key(name), PDFDict).lookup(key('DescendantFonts'), PDFArray)
        .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
      const file = descriptor.lookup(key('FontFile2'));
      assert(file instanceof PDFRawStream);
      assert.deepEqual(Buffer.from(decodePDFRawStream(file).decode()), bytes);
    }
  }
  await writeFile(resolve(root, spec.pdf), covered);
  await writeFile(resolve(root, spec.plainPdf), plain);
  coveredMerged.push(spec);
}

const custodyRoster = Buffer.from('\uFEFFID\r\nبَنِي يَمَن 00123\r\n', 'utf8');
const custodyRows = (await readRoster(custodyRoster, 'roster.csv')).sheets[0]!.rows.map(({ values }) => values);
const custodyBatch = createBatchProcessor();
const ignoreProgress = () => {};
await custodyBatch({ phase: 'preflight', input: { template: coverSourceBytes, roster: custodyRoster, rows: custodyRows, options: settings } }, ignoreProgress);
const custodyName = 'نَمُوذَج 00123.pdf';
const custodyFilenames = ['00123-سَالِم.pdf'];
const custodyPlainPdf = 'm9-custody-plain.pdf';
const templatePrefix = createHash('sha256').update(coverSourceBytes).digest('hex').slice(0, 12);
const rosterPrefix = createHash('sha256').update(custodyRoster).digest('hex').slice(0, 12);
const plain = await custodyBatch({ phase: 'merged' }, ignoreProgress);
assert(plain && 'mergedPdfSha256' in plain);
await writeFile(resolve(root, custodyPlainPdf), plain.bytes);
for (const locale of ['en', 'ar'] as const) {
  const now = new Date();
  const rendered = await custodyBatch({ phase: 'merged', coverSheet: { locale, templateName: custodyName, filenames: custodyFilenames, includeCustody: true } }, ignoreProgress);
  assert(rendered && 'mergedPdfSha256' in rendered);
  assert.equal(rendered.mergedPdfSha256, createHash('sha256').update(rendered.bytes).digest('hex'));
  const en = locale === 'en';
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pdf = `m9-custody-covered-${locale}.pdf`;
  const spec = {
    pdf, plainPdf: custodyPlainPdf, rows: [singlePageCoverRow.filename], coverPages: 1,
    expectedText: {
      title: en ? 'ArabiForm · Batch Print Manifest' : 'ArabiForm · سجل طباعة الدفعة',
      headings: en ? ['#', 'Row', 'Filename', 'Pages'] : ['#', 'الصف', 'اسم الملف', 'الصفحات'],
      details: en ? ['Export date', date, 'Template', custodyName,
        'Ready: 1   ·   Flagged: 0   ·   Skipped: 0', 'Min font size: 8 pt   ·   Font mode: Auto']
        : ['تاريخ التصدير', date, 'القالب', custodyName,
          'جاهز: 1   ·   يحتاج إلى مراجعة: 0   ·   تم تخطيه: 0', 'الحد الأدنى لحجم الخط: 8 نقطة   ·   وضع الخط: تلقائي'],
      filenames: custodyFilenames, rowNumbers: [1], wrappedFilenames: [],
      footer: `Template SHA-256 ${templatePrefix}   ·   Roster SHA-256 ${rosterPrefix}`,
    },
  };
  await writeFile(resolve(root, pdf), rendered.bytes);
  coveredMerged.push(spec);
}

coverSourceField.addToPage(coverSource.addPage([200, 160]), { x: 30, y: 70, width: 120, height: 20 });
const subsetTemplate = Buffer.from(await coverSource.save());
const subsetIds = ['بَنِي يَمَن 00123', '00007'];
const subsetReferences = await Promise.all(subsetIds.map((ID, index) => passingCase(subsetTemplate, { ID },
  `m10-subset-source-${index + 1}.pdf`, `M10 subset: two-page editable form reference ${index + 1}`)));
const subsetRoster = Buffer.from(['ID', ...Array.from({ length: 52 }, (_, index) =>
  index === 2 || index === 51 ? 'W'.repeat(200) : subsetIds[index % 3 === 0 ? 1 : 0]!)].join('\r\n'));
const subsetInputs = (await readRoster(subsetRoster, 'roster.csv')).sheets[0]!.rows.map(({ values }) => values);
const subsetFiles = makeFilenames(subsetInputs, longFilename);
const subsetBatch = createBatchProcessor();
const subsetChecked = await subsetBatch({ phase: 'preflight', input: {
  template: subsetTemplate, roster: subsetRoster, rows: subsetInputs, options: settings,
} }, ignoreProgress);
assert(subsetChecked && 'rows' in subsetChecked);
assert.deepEqual(subsetChecked.rows.flatMap(({ status }, index) => status === 'flagged' ? [index + 1] : []), [3, 52]);
const subsetRowNumbers = Array.from({ length: 25 }, (_, index) => 2 * (index + 1));
const subsetNames = subsetRowNumbers.map((number) => subsetFiles[number - 1]!);
const subsetRows = subsetRowNumbers.map((number) => subsetReferences[(number - 1) % 3 === 0 ? 1 : 0]!);
const subsetCover = 'm10-subset-covered.pdf';
const subsetPlain = 'm10-subset-reference-plain.pdf';
const subsetDate = new Date();
const subsetRendered = await subsetBatch({ phase: 'merged', rowSelection: [52, ...subsetRowNumbers.toReversed(), 2],
  coverSheet: { locale: 'en', templateName, filenames: subsetFiles, includeCustody: true } }, ignoreProgress);
assert(subsetRendered && 'mergedPdfSha256' in subsetRendered);
assert.equal(subsetRendered.mergedPdfSha256, createHash('sha256').update(subsetRendered.bytes).digest('hex'));
assert.equal((await PDFDocument.load(subsetRendered.bytes)).getPageCount(), 52);
await writeFile(resolve(root, subsetCover), subsetRendered.bytes);
await writeFile(resolve(root, subsetPlain), await createMergedPdf(subsetRows));
const subsetTemplatePrefix = createHash('sha256').update(subsetTemplate).digest('hex').slice(0, 12);
const subsetRosterPrefix = createHash('sha256').update(subsetRoster).digest('hex').slice(0, 12);
coveredMerged.push({
  pdf: subsetCover, plainPdf: subsetPlain, rows: subsetRows.map(({ filename }) => filename), coverPages: 2,
  expectedText: {
    title: 'ArabiForm · Batch Print Manifest', headings: ['#', 'Row', 'Filename', 'Pages'],
    details: ['Export date', `${subsetDate.getFullYear()}-${String(subsetDate.getMonth() + 1).padStart(2, '0')}-${String(subsetDate.getDate()).padStart(2, '0')}`,
      'Template', templateName, 'Ready: 25   ·   Flagged: 2   ·   Skipped: 27', 'Min font size: 8 pt   ·   Font mode: Auto'],
    filenames: subsetNames, rowNumbers: subsetRowNumbers, wrappedFilenames: subsetNames,
    footer: `Template SHA-256 ${subsetTemplatePrefix}   ·   Roster SHA-256 ${subsetRosterPrefix}`,
  },
});

const choiceZip = { editable: 'choices-editable.zip', flattened: 'choices-flattened.zip', rows: m4Merged.rows };
const editableZip = createZip(m4Rows);
const flattenedZip = await createFlattenedZip(m4Rows);
const editableMembers = unzipSync(editableZip);
const flattenedMembers = unzipSync(flattenedZip);
assert.deepEqual(Object.keys(editableMembers), choiceZip.rows);
assert.deepEqual(Object.keys(flattenedMembers), choiceZip.rows);
for (const { filename, pdfBytes } of m4Rows) {
  assert.deepEqual(Buffer.from(editableMembers[filename]!), Buffer.from(pdfBytes));
  const flat = await PDFDocument.load(flattenedMembers[filename]!);
  assert.equal(flat.getPageCount(), 2);
  assert(!flat.catalog.has(key('AcroForm')));
  assert(flat.context.enumerateIndirectObjects().every(([, object]) => !(object instanceof PDFDict) || object.lookup(key('Subtype')) !== key('Widget')));
}
await writeFile(resolve(root, choiceZip.editable), editableZip);
await writeFile(resolve(root, choiceZip.flattened), flattenedZip);

const stampSource = await PDFDocument.create();
const portrait = stampSource.addPage([400, 520]);
portrait.setCropBox(24, 35, 350, 445);
const landscape = stampSource.addPage([320, 480]);
landscape.setCropBox(32, 38, 270, 397);
landscape.setRotation(degrees(90));
const stampName = stampSource.getForm().createTextField('Name');
stampName.addToPage(portrait, { x: 100, y: 232, width: 190, height: 26 });
stampName.addToPage(landscape, { x: 68, y: 213, width: 175, height: 26 });
const stampSentinel = stampSource.getForm().createTextField('Sentinel');
stampSentinel.addToPage(portrait, { x: 90, y: 90, width: 130, height: 23 });
stampSentinel.setText('KEEP 00109');
const stampRow = await passingCase(Buffer.from(await stampSource.save()), { Name: 'سَلْمَى 00123' },
  'm8-stamp-source.pdf', 'M8 watermark source, two CropBoxes with a repeated name');
const watermarkProofs = [];
const plainPdf = 'm8-stamp-plain.pdf';
await writeFile(resolve(root, plainPdf), await createMergedPdf([stampRow]));
for (const [kind, label, text, angle, opacity] of [
  ['draft', 'English DRAFT', 'DRAFT', 45, 0.14],
  ['draft-ar', 'Arabic draft', 'مسودة', -45, 0.22],
] as const) {
  const pdf = 'm8-watermark-' + kind + '.pdf';
  const zip = 'm8-watermark-' + kind + '.zip';
  const watermark = { settings: { kind, angle, opacity }, fonts: settings.fonts };
  const output = await createMergedPdf([stampRow], undefined, undefined, watermark);
  const flat = await createFlattenedZip([stampRow], undefined, watermark);
  for (const bytes of [output, unzipSync(flat)[stampRow.filename]!]) {
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 2);
    assert(!doc.catalog.has(key('AcroForm')));
    const family = kind === 'draft-ar' ? 'arabic' : 'latin';
    for (const page of doc.getPages()) {
      const resources = page.node.Resources()!.lookup(key('Font'), PDFDict);
      const name = resources.keys().find((name) => name.decodeText().startsWith('ArabiFormWatermark'));
      assert(name, 'stamp font is embedded');
      const descriptor = resources.lookup(name, PDFDict).lookup(key('DescendantFonts'), PDFArray)
        .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
      const file = descriptor.lookup(key('FontFile2'));
      assert(file instanceof PDFRawStream, 'stamp uses a local TrueType face');
      assert.deepEqual(Buffer.from(decodePDFRawStream(file).decode()), settings.fonts[family]);
    }
  }
  await writeFile(resolve(root, pdf), output);
  await writeFile(resolve(root, zip), flat);
  watermarkProofs.push({ pdf, plainPdf, zip, member: stampRow.filename, label, text, angle, opacity });
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

await writeFile(resolve(root, 'manifest.json'), JSON.stringify({ cases, merged: { pdf: mergedName, rows: staged.map(({ filename }) => filename) }, mixedMerged, m4Merged, coveredMerged, choiceZip, watermarkProofs, leadingZeros: { csv: ids, xlsx: ids }, m2Templates: m2TemplateResults, publicTemplates: templateResults }, null, 2));
console.log(`pdf-lib: ${cases.length} fills verified, 4 protections rejected, CSV/XLSX IDs and ZIP verified (${root}).`);
