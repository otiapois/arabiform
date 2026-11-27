import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodePDFRawStream, degrees, rgb, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFRadioGroup, PDFRawStream, PDFString, PDFTextField, type PDFObject } from 'pdf-lib';
import { unzipSync } from 'fflate';
import { createAudit, createFlattenedZip, createMergedPdf, createZip, inspectCustomFont, inspectTemplate, preflightRow, type PdfExportRow } from '../src/core/pdf';
import type { ApprovalSealSettings } from '../src/core/pdf/approval-seal-settings';
import type { FieldTypographyMap } from '../src/core/pdf/field-typography';
import { inspectRosterWorkbook, makeFilenames, readRoster } from '../src/core/roster';
import { localVirtualDate, resolveVirtualColumn, resolveVirtualMapping, virtualFilenameToken } from '../src/core/roster/virtual-columns';
import { createBatchProcessor } from '../src/core/worker/batch';
import { encodeQr, resolveQrPayload } from '../src/core/pdf/qr-encoder';
import type { QrPrintRequest } from '../src/core/pdf/qr-settings';
import { proveQrMatrix } from '../tests/core/qr-proof';
import { authorFlatPdf, inspectFlatPdf, type FieldDraftSpec } from '../src/core/designer/author';
import { displayToSource, type NormalizedRect } from '../src/core/designer/geometry';
import { loadFieldLayout, saveFieldLayout } from '../src/core/designer/layout';
import { extractBatch } from '../src/core/extractor/extract';
import { planGroupedOutput, SPLIT_CUSTODY_PATH } from '../src/core/export/grouping';
import { createCustodyManifest, MERGED_CUSTODY_FILENAME } from '../src/core/audit/custody';
import { parseCustodyManifest, verifyCustodyPdf, verifyCustodyQr } from '../src/core/custody/verify';
import { generateStudioTemplate, STUDIO_TEMPLATE_IDS } from '../src/core/studio/templates';

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
interface DesignerProof { source: string; rotation: number; rects: Record<string, NormalizedRect | readonly NormalizedRect[]> }
const cases: ({ before: string; after: string; values: Record<string, string>; label: string; customFont?: boolean;
  alignments?: ExpectedAlignment; designer?: DesignerProof } & ExpectedChoices)[] = [];
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

async function snapshotSource(source: Uint8Array) {
  const before = `source-${createHash('sha256').update(source).digest('hex')}.pdf`;
  if (!originalSnapshots.has(before)) {
    await writeFile(resolve(root, before), source);
    originalSnapshots.add(before);
  }
  return before;
}

async function passingCase(source: Buffer, values: Record<string, string>, filename: string, label: string, minFontSize = settings.minFontSize,
  { customFont, expected = values, alignments, designer, fieldTypography, ...choices }: ExpectedChoices & {
    customFont?: Uint8Array; expected?: Record<string, string>; alignments?: ExpectedAlignment; designer?: DesignerProof; fieldTypography?: FieldTypographyMap;
  } = {}) {
  const alignOverrides = !designer && alignments ? Object.fromEntries(Object.entries(alignments).map(([name, { mode }]) => [name, mode])) : undefined;
  const options = { ...settings, minFontSize, customFont, alignOverrides, fieldTypography };
  const result = await preflightRow(source, values, options);
  assert.equal(result.status, 'pass', `${label}: ${JSON.stringify(result.diagnostics)}`);
  assert(result.pdfBytes);
  await compareRawPdf(source, result.pdfBytes, expected, choices);
  const before = await snapshotSource(source);
  await writeFile(resolve(root, filename), result.pdfBytes);
  cases.push({ before, after: filename, values: expected, label, alignments, designer, ...choices, ...(customFont && { customFont: true }) });
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

const virtualSource = await readFile(asset('fixtures/m2/hr-onboarding.pdf'));
const virtualDate = localVirtualDate(new Date(2026, 10, 27, 0, 1));
const virtualFilenames = makeFilenames([{}, {}], `m11-${virtualFilenameToken('PADDED_ROW_001')}.pdf`, { localDate: virtualDate });
assert.deepEqual(virtualFilenames, ['m11-0001.pdf', 'm11-0002.pdf']);
for (const [index, serial] of ['0001', '0002'].entries()) {
  const rowNumber = index + 1;
  const inputs = {
    Name: resolveVirtualMapping({ column: 'PADDED_ROW_001', template: 'CERT-{{PADDED_ROW_001}}' }, rowNumber, virtualDate),
    'Employee ID': resolveVirtualColumn('PADDED_ROW_001', rowNumber, virtualDate),
    'Start Date': resolveVirtualColumn('TODAY_AR', rowNumber, virtualDate),
  };
  await passingCase(virtualSource, inputs, virtualFilenames[index]!, `M11 virtual serial ${serial} and Arabic-Indic date`, settings.minFontSize, {
    expected: { Name: `CERT-${serial}`, 'Employee ID': serial, 'Start Date': '٢٠٢٦-١١-٢٧' },
  });
}

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

const bilingualSources = Array.from({ length: 30 }, (_, index) => index === 0 ? m4Rows[0]! : singlePageCoverRow);
const bilingualRows = bilingualSources.map(({ pdfBytes }, index) => ({ pdfBytes, filename: `${index + 1}-${longFilename}` }));
const bilingualRowNumbers = bilingualRows.map((_, index) => 2 * index + 1);
const bilingualTemplateName = `توريد ${'Workshop-'.repeat(8)}00123.pdf`;
const bilingualSpec = {
  pdf: 'm12-bilingual-covered.pdf', plainPdf: 'm12-bilingual-plain.pdf', coverPages: 3,
  rows: bilingualSources.map(({ filename }) => filename),
  expectedText: {
    titles: ['ArabiForm · Batch Print Manifest', 'ArabiForm · سجل طباعة الدفعة'],
    headings: ['#', 'Row', 'Filename', 'Pages', 'الصف', 'اسم الملف', 'الصفحات'],
    details: ['Export date', '2026-11-27', 'Template', bilingualTemplateName,
      'Ready: 30   ·   Flagged: 3   ·   Skipped: 7', 'Min font size: 7.25 pt   ·   Font mode: Latin',
      'تاريخ التصدير', '2026-11-27', 'القالب', bilingualTemplateName,
      'جاهز: 30   ·   يحتاج إلى مراجعة: 3   ·   تم تخطيه: 7', 'الحد الأدنى لحجم الخط: 7.25 نقطة   ·   وضع الخط: لاتيني'],
    filenames: bilingualRows.map(({ filename }) => filename), rowNumbers: bilingualRowNumbers,
    wrappedFilenames: bilingualRows.map(({ filename }) => filename),
  },
};
const bilingualCover = await createMergedPdf(bilingualRows, undefined, {
  locale: 'bilingual', templateName: bilingualTemplateName, exportedAt: new Date(2026, 10, 27, 23, 59),
  preflight: { ...settings, minFontSize: 7.25, preferredFont: 'latin' }, rowNumbers: bilingualRowNumbers, flagged: 3, skipped: 7,
});
const bilingualPlain = await createMergedPdf(bilingualRows);
assert.equal((await PDFDocument.load(bilingualCover)).getPageCount(), (await PDFDocument.load(bilingualPlain)).getPageCount() + bilingualSpec.coverPages);
for (const page of (await PDFDocument.load(bilingualCover)).getPages().slice(0, bilingualSpec.coverPages)) {
  for (const [name, local] of [['ArabiFormCoverArabic', settings.fonts.arabic], ['ArabiFormCoverLatin', settings.fonts.latin]] as const) {
    const file = page.node.Resources()!.lookup(key('Font'), PDFDict).lookup(key(name), PDFDict).lookup(key('DescendantFonts'), PDFArray)
      .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict).lookup(key('FontFile2'));
    assert(file instanceof PDFRawStream);
    assert.deepEqual(Buffer.from(decodePDFRawStream(file).decode()), local);
  }
}
await writeFile(resolve(root, bilingualSpec.pdf), bilingualCover);
await writeFile(resolve(root, bilingualSpec.plainPdf), bilingualPlain);
coveredMerged.push(bilingualSpec);

const qrTemplate = await PDFDocument.create();
const qrField = qrTemplate.getForm().createTextField('ID');
for (const [index, rotation] of [0, 90, 180, 270].entries()) {
  const page = qrTemplate.addPage([220, 190]);
  page.setMediaBox(-19, -13, 220, 190);
  page.setCropBox(index === 3 ? -28 : 2, 8, 198, 151);
  page.setRotation(degrees(rotation));
  if (index === 1) page.node.set(key('UserUnit'), qrTemplate.context.register(qrTemplate.context.obj(2)));
  if (index === 2) page.node.set(key('UserUnit'), qrTemplate.context.obj(1.5));
  page.drawRectangle({ x: -19, y: -13, width: 220, height: 190, color: rgb(0.85, 0.9, 0.96) });
  qrField.addToPage(page, { x: 65, y: 78, width: 46, height: 20 });
}
const qrTemplateBytes = Buffer.from(await qrTemplate.save());
const qrRowA = await passingCase(qrTemplateBytes, { ID: '00123' }, 'm12-qr-ascii.pdf', 'M12 QR source: four CropBoxes and rotations');
const qrRowB = await passingCase(qrTemplateBytes, { ID: '00007' }, 'm12-qr-arabic.pdf', 'M12 QR source: second row with independent UTF-8 stamp');
const qrProofs = [];
for (const [corner, sizePt, payload] of [
  ['bottom-right', 72, resolveQrPayload('CERT-{{ID}}', { ID: '00123' }, 1, '2026-11-27')],
  ['top-left', 36, resolveQrPayload('{{ID}}', { ID: 'ل'.repeat(52) + 'A' }, 2, '2026-11-27')],
] as const) {
  const row = corner === 'bottom-right' ? qrRowA : qrRowB;
  const symbol = encodeQr(payload);
  proveQrMatrix(symbol, payload);
  const qrStamp: QrPrintRequest = { placement: corner, sizePt, payloads: [payload] };
  const watermark = { settings: { kind: 'draft-ar', opacity: 0.22, angle: 45 } as const, fonts: settings.fonts };
  const pdf = `m12-qr-${corner}-covered.pdf`;
  const plainPdf = `m12-qr-${corner}-plain.pdf`;
  const zip = `m12-qr-${corner}.zip`;
  const cover = { locale: 'bilingual', templateName: bilingualTemplateName, exportedAt: new Date(2026, 10, 27),
    preflight: settings, rowNumbers: [corner === 'bottom-right' ? 1 : 2], flagged: 0, skipped: 0 } as const;
  await writeFile(resolve(root, pdf), await createMergedPdf([row], undefined, cover, watermark, qrStamp));
  await writeFile(resolve(root, plainPdf), await createMergedPdf([row], undefined, cover, watermark));
  await writeFile(resolve(root, zip), await createFlattenedZip([row], undefined, watermark, qrStamp));
  qrProofs.push({ pdf, plainPdf, zip, member: row.filename, coverPages: 1, corner, sizePt, modules: symbol.modules });
}

const impositionWorkbook = inspectRosterWorkbook(await readFile(asset('fixtures/m13/multi-sheet-roster.xlsx')));
assert.deepEqual(impositionWorkbook.sheetNames, ['Summary', 'Roster_AR']);
assert.equal(impositionWorkbook.readSheet().name, 'Summary');
const impositionRoster = impositionWorkbook.readSheet('Roster_AR').rows.map(({ values }) => values);
assert.deepEqual(impositionRoster.map(({ ID }) => ID), ['00123', '00007', '00042']);
const impositionProofs = [];
for (const [kind, rotation] of [['portrait', 0], ['rotated-landscape', 90]] as const) {
  const template = await PDFDocument.create();
  const source = template.addPage([305, 410]);
  source.setRotation(degrees(rotation));
  source.setMediaBox(-18, -8, 305, 410);
  if (rotation) {
    source.setCropBox(-27, 14, 260, 354);
    source.node.set(key('UserUnit'), template.context.register(template.context.obj(1.5)));
  } else {
    source.setCropBox(12, 10, 270, 355);
  }
  source.drawRectangle({ x: 5, y: 27, width: 30, height: 15, color: rgb(0.72, 0.21, 0.18) });
  source.drawRectangle({ x: 47, y: 287, width: 103, height: 6, color: rgb(0.03, 0.25, 0.39) });
  const form = template.getForm();
  form.createTextField('Name').addToPage(source, { x: 48, y: 185, width: 133, height: 24 });
  form.createTextField('ID').addToPage(source, { x: 48, y: 142, width: 80, height: 21 });
  const sourceBytes = Buffer.from(await template.save());
  const rows = [];
  for (const [index, values] of impositionRoster.entries()) {
    rows.push(await passingCase(sourceBytes, { Name: values.Name!, ID: values.ID! }, `m13-${kind}-source-${index + 1}.pdf`,
      `M13 ${kind}, record ${index + 1}`));
  }
  const payloads = impositionRoster.map(({ ID, Name }) => `BADGE-${ID} ${Name}`);
  const modules = payloads.map((payload) => {
    const symbol = encodeQr(payload);
    proveQrMatrix(symbol, payload);
    return symbol.modules;
  });
  const corner = 'bottom-right';
  const sizePt = 54;
  const watermark = { settings: { kind: 'draft-ar', opacity: 0.22, angle: -45 } as const, fonts: settings.fonts };
  const qrStamp: QrPrintRequest = { placement: corner, sizePt, payloads };
  const cover = { locale: 'bilingual', templateName: `Visitor badge ${kind}.pdf`, exportedAt: new Date(2026, 10, 27),
    preflight: settings, rowNumbers: [1, 2, 3], flagged: 0, skipped: 0 } as const;
  const spec = { pdf: `m13-${kind}-imposed.pdf`, referencePdf: `m13-${kind}-record-reference.pdf`,
    coverPages: 1, filenames: rows.map(({ filename }) => filename), rowNumbers: cover.rowNumbers, corner, sizePt, modules, payloads };
  const imposed = await createMergedPdf(rows, undefined, cover, watermark, qrStamp, '2-up');
  const reference = await createMergedPdf(rows, undefined, cover, watermark, qrStamp);
  const imposedDoc = await PDFDocument.load(imposed);
  assert.equal(imposedDoc.getPageCount(), 3);
  assert.equal((await PDFDocument.load(reference)).getPageCount(), 4);
  assert(!imposedDoc.catalog.has(key('AcroForm')));
  await writeFile(resolve(root, spec.pdf), imposed);
  await writeFile(resolve(root, spec.referencePdf), reference);
  impositionProofs.push(spec);
}

for (const [rotation, mode] of [[0, 'auto'], [90, 'rtl'], [180, 'ltr'], [270, 'center']] as const) {
  const flat = await PDFDocument.create({ updateMetadata: false });
  const page = flat.addPage([420, 330]);
  page.setCropBox(23.25, 18.75, 370, 288);
  page.setRotation(degrees(rotation));
  page.drawRectangle({ x: 36, y: 35, width: 330, height: 253, borderWidth: 1, borderColor: rgb(0.12, 0.25, 0.42) });
  page.drawRectangle({ x: 50, y: 251, width: 100, height: 8, color: rgb(0.07, 0.21, 0.37) });
  page.drawRectangle({ x: 58, y: 116, width: 285, height: 86, color: rgb(0.94, 0.96, 0.99) });
  const original = await flat.save();
  const source = await inspectFlatPdf(original);
  const rects = { Name: [0.16, 0.32, 0.63, 0.14], Verified: [0.18, 0.52, 0.075, 0.08] } as const;
  const fields = [
    { name: 'Name', kind: 'text', pageIndex: 0, rectPdf: displayToSource(rects.Name, source.pages[0]!),
      alignment: mode, multiline: true, maxLen: 55, fontSize: 16 },
    { name: 'Verified', kind: 'checkbox', pageIndex: 0, rectPdf: displayToSource(rects.Verified, source.pages[0]!) },
  ] satisfies FieldDraftSpec[];
  const layout = await saveFieldLayout(source, fields);
  assert.deepEqual(await loadFieldLayout(layout, source), fields);
  const bytes = Buffer.from(await authorFlatPdf(original, fields));
  const inspected = await inspectTemplate(bytes);
  assert.deepEqual(inspected.fields.map(({ name, kind, value }) => [name, kind, value]), [['Name', 'text', ''], ['Verified', 'checkbox', 'Off']]);
  assert.equal(inspected.fields[0]?.maxLength, 55);
  assert.equal(inspected.fields[0]?.defaultFontSize, 16);
  for (const [index, field] of inspected.fields.entries()) {
    const { x, y, width, height, rotation: widgetRotation } = field.widgets[0]!;
    assert.equal(widgetRotation, rotation);
    for (const [axis, value] of [x, y, width, height].entries()) assert(Math.abs(value - fields[index]!.rectPdf[axis]!) < 1e-8);
  }
  const designer = { source: await snapshotSource(original), rotation, rects };
  const values = { Name: 'مُحَمَّد عَبْدُ ٱللَّٰه 00123', Verified: 'نعم' };
  const options = { designer, alignments: { Name: { mode, anchor: mode === 'auto' ? 'rtl' as const : mode } },
    checkboxes: { Verified: 'Yes' }, expected: { Name: values.Name, Verified: 'Yes' } };
  const row = await passingCase(bytes, values, `m15-designer-${rotation}.pdf`, `M15 authored flat, rotation ${rotation}`, settings.minFontSize, options);
  const readback = await extractBatch([{ filename: row.filename, bytes: row.pdfBytes }]);
  assert.deepEqual({ ...readback.rows[0]?.fields }, {
    Name: { kind: 'text', value: values.Name },
    Verified: { kind: 'checkbox', value: 'checked', nativeValue: 'Yes' },
  });
  if (rotation !== 90) continue;
  const custom = 'سَلْمَى بِنْت يَاسِين';
  const second = await passingCase(bytes, { Name: custom, Verified: 'لا' }, 'm15-designer-custom.pdf',
    'M15 authored rotated, local custom Arabic face', settings.minFontSize, {
      ...options, checkboxes: { Verified: 'Off' }, expected: { Name: custom, Verified: 'Off' }, customFont: settings.fonts.arabic,
    });
  const payloads = ['CERT-00123', 'شهادة 00007'];
  const modules = payloads.map((payload) => {
    const symbol = encodeQr(payload);
    proveQrMatrix(symbol, payload);
    return symbol.modules;
  });
  const corner = 'bottom-right';
  const sizePt = 36;
  const qrStamp: QrPrintRequest = { placement: corner, sizePt, payloads };
  const watermark = { settings: { kind: 'draft-ar', opacity: 0.22, angle: -45 } as const, fonts: settings.fonts };
  const rows = [row, second];
  const spec = { pdf: 'm15-designer-imposed.pdf', referencePdf: 'm15-designer-qr-reference.pdf',
    coverPages: 0, filenames: rows.map(({ filename }) => filename), rowNumbers: [1, 2], corner, sizePt, modules, payloads };
  await writeFile(resolve(root, spec.pdf), await createMergedPdf(rows, undefined, undefined, watermark, qrStamp, '2-up'));
  await writeFile(resolve(root, spec.referencePdf), await createMergedPdf(rows, undefined, undefined, watermark, qrStamp));
  impositionProofs.push(spec);
}

for (const rotation of [0, 90, 180, 270]) {
  const flat = await PDFDocument.create({ updateMetadata: false });
  const page = flat.addPage([430, 385]);
  page.setCropBox(22.25, 18.75, 360, 330);
  page.setRotation(degrees(rotation));
  page.drawRectangle({ x: 34, y: 28, width: 310, height: 302, borderWidth: 1.5, borderColor: rgb(0.12, 0.25, 0.42) });
  page.drawRectangle({ x: 64, y: 308, width: 94, height: 8, color: rgb(0.07, 0.21, 0.37) });
  const original = await flat.save();
  const meta = await inspectFlatPdf(original);
  const rects = {
    Clinic: [0.20, 0.32, 0.58, 0.12],
    Contact: [[0.24, 0.53, 0.07, 0.09], [0.54, 0.53, 0.07, 0.09]],
  } as const;
  const dropdowns = ['مُسْتَوْصَف الرِّيَاض 00123', 'Jeddah Clinic 00007'];
  const radios = ['بَرِيد', 'CALL'];
  const fields: FieldDraftSpec[] = [
    { name: 'Clinic', kind: 'dropdown', pageIndex: 0, options: dropdowns, rectPdf: displayToSource(rects.Clinic, meta.pages[0]!) },
    ...rects.Contact.map((rect, index): FieldDraftSpec => ({
      name: 'Contact', kind: 'radio', pageIndex: 0, exportValue: radios[index]!, rectPdf: displayToSource(rect, meta.pages[0]!),
    })),
  ];
  const restored = await loadFieldLayout(await saveFieldLayout(meta, fields), meta);
  const template = Buffer.from(await authorFlatPdf(original, restored));
  const inspected = await inspectTemplate(template);
  assert.deepEqual(inspected.fields.map(({ kind, choices }) => ({ kind, choices })), [
    { kind: 'dropdown', choices: dropdowns.map((value) => ({ value, label: value })) },
    { kind: 'radio', choices: radios.map((value) => ({ value, label: value })) },
  ]);
  const designer = { source: await snapshotSource(original), rotation, rects };
  const passed: PdfExportRow[] = [];
  for (const [index, locale] of ['ar', 'en'].entries()) {
    const values = { Clinic: dropdowns[index]!, Contact: radios[index]! };
    const row = await passingCase(template, values, `m16-designer-${rotation}-${locale}.pdf`,
      `M16 dropdown and radio, rotation ${rotation}, ${locale}`, settings.minFontSize, {
        designer, dropdowns: { Clinic: { label: values.Clinic } },
        radios: { Contact: { state: String(index), widgets: index === 0 ? ['0', 'Off'] : ['Off', '1'] } },
      });
    const readback = await extractBatch([{ filename: row.filename, bytes: row.pdfBytes }]);
    assert.deepEqual({ ...readback.rows[0]?.fields }, {
      Clinic: { kind: 'dropdown', value: values.Clinic },
      Contact: { kind: 'radio', value: values.Contact, nativeValue: String(index) },
    });
    passed.push(row);
  }
  if (rotation !== 90) continue;
  const rows = ['الرياض', 'Jeddah', '', 'الرياض', 'Jeddah', 'الرياض'].map((Branch, index) => ({
    Branch, Clinic: dropdowns[index % 2]!, Contact: radios[index % 2]!, ID: String(index + 1).padStart(5, '0'),
  }));
  const grouping = planGroupedOutput(rows, 'Branch', '{{ID}}.pdf');
  const rowSelection = [6, 4, 5, 2, 1];
  const payloads = rows.map(({ Clinic, ID }) => `${ID} ${Clinic}`);
  const corner = 'bottom-right', sizePt = 48;
  const qrStamp: QrPrintRequest = { placement: corner, sizePt, payloads };
  const watermark = { kind: 'draft-ar', opacity: 0.22, angle: -45 } as const;
  const roster = new TextEncoder().encode(JSON.stringify(rows));
  const worker = createBatchProcessor();
  await worker({ phase: 'preflight', input: { template, roster, rows: rows.map(({ Clinic, Contact }) => ({ Clinic, Contact })), options: settings } }, () => {});
  const coverSheet = { locale: 'en', coverLanguage: 'bilingual', templateName: 'Clinic.pdf', filenames: makeFilenames(rows, '{{ID}}.pdf') } as const;
  const split = await worker({ phase: 'split', grouping, rowSelection, coverSheet, watermark, qrStamp, imposition: '2-up' }, () => {});
  assert(split && 'groups' in split);
  const members = unzipSync(split.bytes);
  const receipt = JSON.parse(new TextDecoder().decode(members[SPLIT_CUSTODY_PATH]));
  assert.equal(receipt.templateSha256, createHash('sha256').update(template).digest('hex'));
  assert.equal(receipt.rosterSha256, createHash('sha256').update(roster).digest('hex'));
  assert.deepEqual(receipt.groups, split.groups);
  assert.deepEqual(receipt.groups.map(({ rowNumbers }: { rowNumbers: number[] }) => rowNumbers), [[1, 4, 6], [2, 5]]);
  for (const [index, { zipPath, rowNumbers, sha256, bytes }] of split.groups.entries()) {
    const pack = members[zipPath]!;
    assert.equal(pack.length, bytes);
    assert.equal(createHash('sha256').update(pack).digest('hex'), sha256);
    const recordPayloads = rowNumbers.map((number) => payloads[number - 1]!);
    const modules = recordPayloads.map((payload) => {
      const symbol = encodeQr(payload);
      proveQrMatrix(symbol, payload);
      return symbol.modules;
    });
    const records = rowNumbers.map((number) => ({
      pdfBytes: passed[(number - 1) % 2]!.pdfBytes, filename: grouping.rows[number - 1]!.filename,
    }));
    const cover = { locale: 'bilingual', templateName: coverSheet.templateName, exportedAt: new Date(),
      preflight: settings, rowNumbers, flagged: 0, skipped: 0 } as const;
    const reference = await createMergedPdf(records, undefined, cover, { settings: watermark, fonts: settings.fonts },
      { placement: corner, sizePt, payloads: recordPayloads });
    const spec = { pdf: `m16-split-${index}.pdf`, referencePdf: `m16-split-${index}-reference.pdf`,
      coverPages: 1, filenames: records.map(({ filename }) => filename), rowNumbers, corner, sizePt, modules, payloads: recordPayloads };
    await writeFile(resolve(root, spec.pdf), pack);
    await writeFile(resolve(root, spec.referencePdf), reference);
    impositionProofs.push(spec);
  }
}

const studioProofs = [];
const studioTitles = [
  ['Certificate of Completion', 'شهادة إتمام'],
  ['Employment Verification', 'إفادة عمل'],
  ['Patient Consent Form', 'نموذج موافقة المريض'],
  ['Visitor Badge', 'بطاقة زائر'],
];
for (const [templateIndex, id] of STUDIO_TEMPLATE_IDS.entries()) {
  const organizationName = 'مَرْكَزُ الأَمَان · Example Studio 00123';
  const documentSubtitle = 'دَوْرَةُ ٢٠٢٦ / Workshop';
  const studio = await generateStudioTemplate(id, { organizationName, documentSubtitle, accentPalette: 'burgundy' }, settings.fonts);
  const template = Buffer.from(studio.pdfBytes);
  const templateDoc = await PDFDocument.load(template);
  const page = templateDoc.getPage(0);
  const resources = page.node.Resources()!.lookup(key('Font'), PDFDict);
  for (const [name, local] of [['ArabiFormStudioArabic', settings.fonts.arabic], ['ArabiFormStudioLatin', settings.fonts.latin]] as const) {
    const descriptor = resources.lookup(key(name), PDFDict).lookup(key('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
    const embedded = descriptor.lookup(key('FontFile2'));
    assert(embedded instanceof PDFRawStream);
    assert.deepEqual(Buffer.from(decodePDFRawStream(embedded).decode()), local);
  }
  const roster = new TextEncoder().encode(studio.csv);
  const rows = (await readRoster(roster, studio.csvFilename)).sheets[0]!.rows.map(({ values }) => values);
  const { fields } = await inspectTemplate(template);
  const records = [];
  for (const [index, values] of rows.entries()) {
    const expected = { ...values };
    const choices: Required<ExpectedChoices> = { checkboxes: {}, dropdowns: {}, radios: {} };
    for (const { kind, name, choices: options } of fields) {
      if (kind === 'checkbox') expected[name] = choices.checkboxes[name] = values[name] === 'yes' ? 'Yes' : 'Off';
      if (kind === 'dropdown') choices.dropdowns[name] = { label: values[name]! };
      if (kind === 'radio') {
        const selected = options!.findIndex(({ value }) => values[name] === value);
        choices.radios[name] = { state: String(selected), widgets: options!.map((_, option) => option === selected ? String(option) : 'Off') };
      }
    }
    const record = await passingCase(template, values, `m17-${id}-${index + 1}.pdf`,
      `M17 ${id} ${index === 0 ? 'vocalized Arabic' : 'English'}`, settings.minFontSize, { ...choices, expected });
    const extracted = await extractBatch([{ filename: record.filename, bytes: record.pdfBytes }]);
    assert.equal(extracted.rows[0]!.status, 'extracted');
    for (const { kind, name } of fields) {
      assert.equal(extracted.rows[0]!.fields[name]!.value, kind === 'checkbox' ? values[name] === 'yes' ? 'checked' : 'unchecked' : values[name]);
    }
    records.push(record);
  }
  const printed = `m17-${id}-print-parity.pdf`;
  await writeFile(resolve(root, printed), await createMergedPdf(records));
  studioProofs.push({ id, before: await snapshotSource(template), after: records.map(({ filename }) => filename),
    header: [organizationName, ...studioTitles[templateIndex]!, documentSubtitle], sizePt: [page.getWidth(), page.getHeight()], printed });
  const worker = createBatchProcessor();
  const prepared = await worker({ phase: 'preflight', input: { template, roster, rows, options: settings } }, () => {});
  assert(prepared && 'custody' in prepared && prepared.rows.every(({ status }) => status === 'pass'));
  const filenames = records.map(({ filename }) => filename);
  const corner = 'bottom-right', sizePt = 72;
  const qrStamp = { placement: corner, sizePt, custodyRecord: true } as const;
  const rowSelection = [1];
  const flatZip = await worker({ phase: 'zip', filenames, rowSelection, flattenZip: true, qrStamp }, () => {});
  const merged = await worker({ phase: 'merged', rowSelection, qrStamp }, () => {});
  assert(flatZip && !(flatZip instanceof Uint8Array) && 'entries' in flatZip && merged && 'mergedPdfSha256' in merged);
  assert.deepEqual(flatZip.qrRecords, merged.qrRecords);
  const receipt = await parseCustodyManifest(createCustodyManifest(prepared.custody, { ...flatZip, ...merged }, {
    exportScope: 'selected-subset', selectedRowNumbers: rowSelection,
  }));
  const payload = flatZip.qrRecords![0]!.payload;
  assert.equal(verifyCustodyQr(receipt, payload).status, 'VERIFIED_QR_RECORD');
  assert.equal((await verifyCustodyPdf(receipt, { filename: MERGED_CUSTODY_FILENAME, bytes: merged.bytes })).status, 'VERIFIED_EXACT_MATCH');
  assert.equal((await verifyCustodyPdf(receipt, { filename: filenames[0]!, bytes: unzipSync(flatZip.bytes)[filenames[0]!]! })).status, 'VERIFIED_EXACT_MATCH');
  const symbol = encodeQr(payload);
  proveQrMatrix(symbol, payload);
  const qr = { pdf: `m17-${id}-stamped.pdf`, plainPdf: `m17-${id}-plain.pdf`, zip: `m17-${id}-stamped.zip`,
    member: filenames[0]!, coverPages: 0, corner, sizePt, modules: symbol.modules };
  await writeFile(resolve(root, qr.pdf), merged.bytes);
  await writeFile(resolve(root, qr.plainPdf), await createMergedPdf([records[0]!]));
  await writeFile(resolve(root, qr.zip), flatZip.bytes);
  qrProofs.push(qr);

  const twoUp = await worker({ phase: 'merged', imposition: '2-up', qrStamp }, () => {});
  assert(twoUp && 'mergedPdfSha256' in twoUp && twoUp.qrRecords?.length === 2);
  const payloads = twoUp.qrRecords.map(({ payload }) => payload);
  const modules = payloads.map((value) => {
    const symbol = encodeQr(value);
    proveQrMatrix(symbol, value);
    return symbol.modules;
  });
  const imposed = { pdf: `m17-${id}-2up.pdf`, referencePdf: `m17-${id}-2up-reference.pdf`,
    coverPages: 0, filenames, rowNumbers: [1, 2], corner, sizePt, modules, payloads, requireWatermark: false };
  await writeFile(resolve(root, imposed.pdf), twoUp.bytes);
  await writeFile(resolve(root, imposed.referencePdf), await createMergedPdf(records, undefined, undefined, undefined, { placement: corner, sizePt, payloads }));
  impositionProofs.push(imposed);
}

const m20 = await PDFDocument.create({ updateMetadata: false });
const m20Pages = [m20.addPage([360, 320]), m20.addPage([360, 320])];
for (const page of m20Pages) page.setCropBox(14, 20, 300, 260);
m20Pages[1]!.setRotation(degrees(90));
m20Pages[1]!.node.set(key('UserUnit'), m20.context.register(m20.context.obj(2)));
const m20Form = m20.getForm();
for (const [name, x, y, width, height] of [['Date', 100, 130, 92, 22], ['ID', 220, 130, 62, 22], ['Notes', 92, 60, 152, 51], ['Sentinel', 120, 170, 103, 20]] as const) {
  const field = m20Form.createTextField(name);
  if (name === 'Notes') field.enableMultiline();
  if (name === 'Sentinel') field.setText('KEEP 00109');
  for (const page of m20Pages) field.addToPage(page, { x, y, width, height, borderWidth: 0.8 });
  field.setFontSize(12);
}
const m20Source = Buffer.from(await m20.save());
const numeralValues = { Date: '00123', ID: '۰۰١2٣', Notes: 'مُحَمَّد سَالِم\nبَنِي يَمَن' };
const m20Typography: FieldTypographyMap = { Date: { numeralPolicy: 'eastern-arabic', paddingPt: 4 },
  ID: { numeralPolicy: 'western-ascii' }, Notes: { lineHeightScale: 1.3, paddingPt: 6 } };
const eastWest = await passingCase(m20Source, numeralValues, 'm20-eastern-and-western.pdf', 'M20 numeral policy and typography', 8, {
  fieldTypography: m20Typography, expected: { ...numeralValues, Date: '٠٠١٢٣', ID: '00123' },
});
const m20Legacy = await passingCase(m20Source, { ...numeralValues, ID: '00123' }, 'm20-typography-default.pdf', 'M20 default typography reference');
const m20Approval: ApprovalSealSettings = { placement: 'top-left', labelEn: 'Records Office', labelAr: 'مَكْتَبُ السِّجِلَّاتِ', issueDate: '2028-02-29' };
const m20Seal = { settings: m20Approval, fonts: settings.fonts };
const m20Qr = { placement: 'bottom-right', sizePt: 48, payloads: ['00123'] } as const;
const m20QrReference = { pdf: 'm20-qr-only.pdf', plainPdf: 'm20-unmarked.pdf', zip: 'm20-qr-only.zip', member: eastWest.filename,
  coverPages: 0, corner: m20Qr.placement, sizePt: m20Qr.sizePt, modules: encodeQr('00123').modules };
const m20Proof = { filled: eastWest.filename, original: m20Legacy.filename, pdf: 'm20-approved.pdf', preview: 'm20-approved-preview.pdf',
  zip: 'm20-approved.zip', qrReference: m20QrReference.pdf, seal: m20Approval, widthPt: 126, heightPt: 44,
  overlapWithWidget: 'approval-seal-widget-overlap', overlapWithQr: 'approval-seal-qr-overlap' };
const m20Batch = createBatchProcessor();
const m20Idle = () => {};
await m20Batch({ phase: 'preflight', input: { template: m20Source, roster: new Uint8Array(), rows: [numeralValues],
  options: { ...settings, fieldTypography: m20Typography } } }, m20Idle);
const m20Preview = await m20Batch({ phase: 'preview', rowIndex: 0, approvalSeal: m20Approval, qrStamp: m20Qr }, m20Idle);
assert(m20Preview instanceof Uint8Array);
await writeFile(resolve(root, m20Proof.preview), m20Preview);
await writeFile(resolve(root, m20Proof.pdf), await createMergedPdf([eastWest], undefined, undefined, undefined, m20Qr, '1-up', m20Seal));
await writeFile(resolve(root, m20Proof.zip), await createFlattenedZip([eastWest], undefined, undefined, m20Qr, m20Seal));
await writeFile(resolve(root, m20QrReference.pdf), await createMergedPdf([eastWest], undefined, undefined, undefined, m20Qr));
await writeFile(resolve(root, m20QrReference.plainPdf), await createMergedPdf([eastWest]));
await writeFile(resolve(root, m20QrReference.zip), await createFlattenedZip([eastWest], undefined, undefined, m20Qr));
qrProofs.push(m20QrReference);
await assert.rejects(createMergedPdf([eastWest], undefined, undefined, undefined, { ...m20Qr, placement: 'top-left' }, '1-up', m20Seal),
  { code: m20Proof.overlapWithQr, pageNumber: 1 });
const m20Obstacle = m20Form.createTextField('UnmappedPrintWidget');
m20Obstacle.addToPage(m20Pages[0]!, { x: 35, y: 243, width: 66, height: 15 });
m20Obstacle.acroField.getWidgets()[0]!.dict.set(key('F'), m20.context.obj(36));
await assert.rejects(createFlattenedZip([{ ...eastWest, pdfBytes: await m20.save() }], undefined, undefined, m20Qr, m20Seal),
  { code: m20Proof.overlapWithWidget, pageNumber: 1, fieldName: 'UnmappedPrintWidget' });

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

await writeFile(resolve(root, 'manifest.json'), JSON.stringify({ cases, merged: { pdf: mergedName, rows: staged.map(({ filename }) => filename) }, mixedMerged, m4Merged, coveredMerged, choiceZip, watermarkProofs, qrProofs, impositionProofs, studioProofs, m20Proof, leadingZeros: { csv: ids, xlsx: ids }, m2Templates: m2TemplateResults, publicTemplates: templateResults }, null, 2));
console.log(`pdf-lib: ${cases.length} fills verified, 4 protections rejected, CSV/XLSX IDs and ZIP verified (${root}).`);
