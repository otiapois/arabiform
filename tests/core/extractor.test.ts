import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from 'pdf-lib';
import { expect, it, vi } from 'vitest';
import { extractBatch, type ExtractBatchResult } from '../../src/core/extractor/extract';
import { preflightRow } from '../../src/core/pdf';
import { inspectRosterWorkbook } from '../../src/core/roster';

const key = PDFName.of;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const digest = (bytes: Uint8Array | ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
const save = (doc: PDFDocument) => doc.save({ updateFieldAppearances: false });

function csvRows(result: ExtractBatchResult): string[][] {
  const { csv } = result.artifacts;
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const parsed = Papa.parse<string[]>(decoder.decode(csv), { newline: '\r\n' });
  expect(parsed.errors).toEqual([]);
  return parsed.data.slice(0, -1);
}

function xlsxValues(result: ExtractBatchResult) {
  const { xlsx } = result.artifacts;
  const files = unzipSync(xlsx);
  const xml = decoder.decode(files['xl/worksheets/sheet1.xml']!);
  expect(xml).not.toMatch(/<f(?:\s|>)/);
  expect([...xml.matchAll(/<c /g)]).toHaveLength([...xml.matchAll(/<c r="[A-Z]+\d+" t="inlineStr">/g)].length);
  return inspectRosterWorkbook(xlsx).readSheet();
}

function audit(result: ExtractBatchResult) {
  const { audit, csv, xlsx } = result.artifacts;
  const receipt = JSON.parse(decoder.decode(audit));
  expect(receipt).toMatchObject({ version: 1, columns: result.columns, rows: result.rows, csvSha256: digest(csv), xlsxSha256: digest(xlsx) });
  return receipt;
}

it('roundtrips real ArabiForm fill output with vocalized Arabic, multiline notes, IDs and choice exports', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  form.createTextField('الاسم').addToPage(page, { x: 30, y: 500, width: 210, height: 34 });
  form.createTextField('ID').addToPage(page, { x: 30, y: 455, width: 210, height: 34 });
  const notes = form.createTextField('Notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 30, y: 370, width: 210, height: 70 });
  const check = form.createCheckBox('Consent');
  check.addToPage(page, { x: 30, y: 330 });
  const dropdown = form.createDropdown('Clinic');
  dropdown.addOptions(['Home']);
  dropdown.addToPage(page, { x: 65, y: 320, width: 175, height: 34 });
  const radio = form.createRadioGroup('Contact');
  radio.addOptionToPage('Call', page, { x: 30, y: 280 });
  radio.addOptionToPage('Email', page, { x: 64, y: 280 });
  form.updateFieldAppearances();
  const displayLabel = 'عِيَادَةُ الرِّيَاضِ';
  dropdown.acroField.dict.set(key('Opt'), doc.context.obj([[PDFString.of('RIY'), PDFHexString.fromText(displayLabel)]]));
  radio.acroField.dict.set(key('Opt'), doc.context.obj([PDFString.of('CALL'), PDFHexString.fromText('بَرِيد')]));
  const template = await save(doc);
  const fonts = {
    arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
  };
  const records = [
    { الاسم: 'مُحَمَّد سَالِم (A)', ID: '00123', Notes: 'السَّطْر 1\r\nLine "2", #0007', Consent: 'yes', Clinic: 'RIY', Contact: 'بَرِيد' },
    { الاسم: 'نُور نَبِيل', ID: '00007', Notes: 'مرحبا\nSecond', Consent: 'no', Clinic: displayLabel, Contact: 'CALL' },
  ];
  const input = await Promise.all(records.map(async (record, index) => {
    const filled = await preflightRow(template, record, { fonts });
    expect(filled).toMatchObject({ status: 'pass', diagnostics: [] });
    return { filename: 'حالة ' + index + '.pdf', bytes: filled.pdfBytes! };
  }));
  const extracted = await extractBatch(input);
  expect(extracted.rows.map(({ status }) => status)).toEqual(['extracted', 'extracted']);
  expect(extracted.rows.map(({ sourceSha256 }) => sourceSha256)).toEqual(input.map(({ bytes }) => digest(bytes)));
  expect(extracted.rows[0]?.fields).toEqual({
    الاسم: { kind: 'text', value: records[0]!.الاسم }, ID: { kind: 'text', value: '00123' },
    Notes: { kind: 'text', value: records[0]!.Notes },
    Consent: { kind: 'checkbox', value: 'checked', nativeValue: 'Yes' },
    Clinic: { kind: 'dropdown', value: 'RIY', displayLabel },
    Contact: { kind: 'radio', value: 'بَرِيد', nativeValue: '1' },
  });
  const sheet = xlsxValues(extracted);
  expect(sheet.headers).toEqual([
    'Filename', 'Source SHA-256', 'Status', 'الاسم', 'ID', 'Notes', 'Consent', 'Consent (native export)', 'Clinic', 'Clinic (display label)', 'Contact',
  ]);
  const csv = csvRows(extracted);
  expect(csv[0]).toEqual(sheet.headers);
  for (const [index, record] of records.entries()) {
    const row = extracted.rows[index]!;
    const cells = [
      row.filename, row.sourceSha256, 'extracted', record.الاسم, record.ID, record.Notes,
      index === 0 ? 'checked' : 'unchecked', index === 0 ? 'Yes' : 'Off', 'RIY', displayLabel, record.Contact,
    ];
    expect(csv[index + 1]).toEqual(cells);
    expect(Object.values(sheet.rows[index]!.values)).toEqual(cells);
    expect(sheet.rows[index]!.warnings).toEqual([]);
  }
  audit(extracted);
  expect((await extractBatch(input)).artifacts).toEqual(extracted.artifacts);
});

it('preserves native read-only fields, inherited names and PDF encodings with distinct controls', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const form = doc.getForm();
  const title = form.createTextField('Record.Legacy');
  title.enableReadOnly();
  title.acroField.dict.set(key('V'), PDFString.of('\\200\\240\\226\\(A\\) One\\\r\nTwo\rThree'));
  const unicode = form.createTextField('Record.Unicode');
  unicode.enableReadOnly();
  const exact = '  سَالِم \u200e🙂\r\n00123 &<> _x000D_ and _x005f_x0042_\x00\x1f\ufeff  ';
  const rawUnicode = PDFHexString.fromText(exact).asString().replace(/.{4}/g, '$& ');
  unicode.acroField.dict.set(key('V'), PDFHexString.of(rawUnicode));
  const consent = form.createCheckBox('Record.Consent');
  consent.enableReadOnly();
  consent.acroField.dict.set(key('V'), key('Approved#20by#20office'));
  const choice = form.createDropdown('Record.Clinic');
  const label = 'عِيَادَة';
  choice.acroField.dict.set(key('Opt'), doc.context.obj([[PDFString.of('001'), PDFHexString.fromText(label)]]));
  choice.acroField.dict.set(key('V'), doc.context.obj([PDFHexString.fromText(label)]));
  const list = form.createOptionList('Record.List');
  list.acroField.dict.set(key('V'), doc.context.obj([PDFString.of('a, b'), PDFHexString.fromText('دُبَيّ')]));
  const radio = form.createRadioGroup('Record.Radio');
  radio.acroField.dict.set(key('V'), key('CustomName'));
  const result = await extractBatch([{ filename: ' \u061c＋orders.pdf', bytes: await save(doc) }]);
  expect(result.rows[0]?.status).toBe('extracted');
  expect(result.rows[0]?.fields).toEqual({
    'Record.Legacy': { kind: 'text', value: '•€Œ(A) OneTwo\nThree' },
    'Record.Unicode': { kind: 'text', value: exact },
    'Record.Consent': { kind: 'checkbox', value: 'checked', nativeValue: 'Approved by office' },
    'Record.Clinic': { kind: 'dropdown', value: '001', nativeValue: label, selectedValues: ['001'], displayLabel: label },
    'Record.List': { kind: 'listbox', value: '["a, b","دُبَيّ"]', selectedValues: ['a, b', 'دُبَيّ'] },
    'Record.Radio': { kind: 'radio', value: 'CustomName' },
  });
  expect(csvRows(result)[1]?.[0]).toBe("' \u061c＋orders.pdf");
  expect(xlsxValues(result).rows[0]?.values['Record.Unicode']).toBe(exact);
  audit(result);
});

it('quarantines bad PDFs before defining the schema and compares later schemas with the first success', async () => {
  const first = await PDFDocument.create();
  first.addPage();
  for (const name of ['ID', 'Name', 'Department']) first.getForm().createTextField(name);
  const second = await PDFDocument.create();
  second.addPage();
  second.getForm().createCheckBox('ID');
  second.getForm().createTextField('Other');
  second.getForm().createTextField('Name');
  const third = await PDFDocument.create();
  third.addPage();
  for (const name of ['Department', 'ID', 'Name']) third.getForm().createTextField(name);
  const valid = await Promise.all([first, second, third].map(save));
  const malformed = await PDFDocument.create();
  malformed.addPage();
  const bad = malformed.getForm().createTextField('Poison');
  bad.acroField.dict.set(key('V'), PDFRef.of(1200));
  const cycle = malformed.getForm().createTextField('Cycle');
  cycle.acroField.dict.set(key('Kids'), malformed.context.obj([cycle.ref]));
  const fixtureNames = ['flat', 'encrypted', 'xfa', 'signed'] as const;
  const fixtures = await Promise.all(fixtureNames.map(async (fixture) => ({
    filename: fixture + '.pdf', bytes: await readFile('fixtures/golden/' + fixture + '.pdf'),
  })));
  const buffer = new Uint8Array(valid[0]!.length + 17).fill(0xbe);
  buffer.set(valid[0]!, 7);
  const inputs = [
    { filename: 'broken.pdf', bytes: encoder.encode('not a PDF') },
    ...fixtures,
    { filename: 'primary.pdf', bytes: buffer.subarray(7, 7 + valid[0]!.length) },
    { filename: 'schema.pdf', bytes: Uint8Array.from(valid[1]!).buffer },
    { filename: 'another.pdf', bytes: valid[2]! },
    { filename: 'invalid-tree.pdf', bytes: await save(malformed) },
    { filename: 'truncated.pdf', bytes: valid[0]!.slice(0, -5) },
  ];
  const warn = vi.spyOn(console, 'warn');
  const log = vi.spyOn(console, 'error');
  const progress = vi.fn();
  try {
    const result = await extractBatch(inputs, progress);
    expect(result.rows.map(({ status }) => status)).toEqual([
      'blocked-invalid', 'blocked-flat', 'blocked-encrypted', 'blocked-xfa', 'blocked-signed',
      'extracted', 'warning-schema-mismatch', 'extracted', 'blocked-invalid', 'blocked-invalid',
    ]);
    expect(result.columns).toEqual(['ID', 'Name', 'Department', 'Other'].map((name) => ({ name, kind: 'text' })));
    expect(result.rows[6]?.schema).toEqual({
      missing: ['Department'], extra: ['Other'], typeChanged: [{ name: 'ID', expected: 'text', actual: 'checkbox' }],
    });
    expect(result.rows[6]?.fields.ID).toEqual({ kind: 'checkbox', value: 'unchecked', nativeValue: 'Off' });
    for (const [index, { bytes }] of inputs.entries()) {
      const row = result.rows[index]!;
      expect(row.sourceSha256).toBe(digest(bytes));
      if (row.status.startsWith('blocked-')) expect(Object.keys(row.fields)).toEqual([]);
      expect(progress).toHaveBeenNthCalledWith(index + 1, index + 1, inputs.length);
    }
    audit(result);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
});

it('keeps arbitrarily named fields and safe, unique worksheet headers', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const form = doc.getForm();
  const fields = ['Filename', 'filename', 'Filename (2)', 'Status', 'Consent (native export)', '__proto__', '＠Calculation', '۔۔۔'];
  for (const name of fields) {
    form.createTextField(name).acroField.dict.set(key('V'), PDFHexString.fromText(' \u200e＝＝"أ،ة"\r\n' + name));
  }
  form.createCheckBox('Consent');
  const result = await extractBatch([{ filename: 'test.pdf', bytes: await save(doc) }]);
  const receipt = audit(result);
  expect(result.columns.map(({ name }) => name)).toEqual([...fields, 'Consent']);
  expect(receipt.spreadsheetColumns.map(({ header }: {header: string}) => header)).toEqual([
    'Filename', 'Source SHA-256', 'Status', 'Filename (3)', 'filename (4)', 'Filename (2)', 'Status (2)',
    'Consent (native export)', '__proto__', '＠Calculation', 'Field (2)', 'Consent', 'Consent (native export) (2)',
  ]);
  const row = xlsxValues(result).rows[0]!;
  const csv = csvRows(result);
  expect(Object.getPrototypeOf(result.rows[0]?.fields)).toBeNull();
  expect(Object.hasOwn(result.rows[0]!.fields, '__proto__')).toBe(true);
  expect(csv[0]?.[9]).toBe("'＠Calculation");
  expect(csv[1]?.[3]).toBe("' \u200e＝＝\"أ،ة\"\r\nFilename");
  expect(row.values['Filename (3)']).toBe(' \u200e＝＝"أ،ة"\r\nFilename');
  expect(row.values['Consent (native export) (2)']).toBe('Off');
});

it('limits batches to 1?200 inputs and exports receipts if every file is blocked', async () => {
  const invalid = { filename: 'bad.pdf', bytes: encoder.encode('malformed') };
  await expect(extractBatch([])).rejects.toThrow('extract-batch-size');
  await expect(extractBatch(Array(201).fill(invalid))).rejects.toThrow('extract-batch-size');
  const result = await extractBatch(Array(200).fill(invalid));
  expect(result.columns).toEqual([]);
  expect(result.rows).toHaveLength(200);
  expect(result.rows.every(({ status }) => status === 'blocked-invalid')).toBe(true);
  expect(csvRows(result)).toHaveLength(201);
  expect(xlsxValues(result).rows).toHaveLength(200);
  audit(result);
});
