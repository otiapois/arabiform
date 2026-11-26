import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { expect, it } from 'vitest';
import { createFlattenedZip, createMergedPdf, createZip, inspectTemplate, matchChoice, preflightRow } from '../../src/core/pdf';

const key = PDFName.of;
const label = 'عِيَادَةُ الرِّيَاضِ';
const clinicOptions = [{ value: 'RIY', label }, { value: 'JED', label: 'Jeddah Clinic' }];
const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const fonts = async () => ({
  arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
});

async function makeTemplate() {
  const doc = await PDFDocument.create();
  const [one, two] = [doc.addPage(), doc.addPage()];
  const form = doc.getForm();
  const choice = form.createDropdown('Clinic');
  choice.addOptions(['Default']);
  choice.select('Default');
  choice.addToPage(two, { x: 30, y: 80, width: 180, height: 28 });
  const contact = form.createRadioGroup('Contact');
  contact.addOptionToPage('Phone', one, { x: 30, y: 40 });
  contact.addOptionToPage('Email', two, { x: 30, y: 40 });
  contact.select('Email');
  form.updateFieldAppearances();
  choice.acroField.dict.set(key('Opt'), doc.context.obj([
    [PDFString.of('RIY'), PDFHexString.fromText(label)],
    [PDFString.of('JED'), PDFString.of('Jeddah Clinic')],
  ]));
  contact.acroField.dict.set(key('Opt'), doc.context.obj([PDFString.of('CALL'), PDFHexString.fromText('بريد')]));
  return doc;
}

const save = (doc: PDFDocument) => doc.save({ updateFieldAppearances: false });

it('resolves choice text exactly first, then by a unique whitespace trim', () => {
  const options = [{ value: 'a', label: ' A ' }, { value: ' A', label: 'a' }, { value: 'B', label: 'Bi' }];
  expect(matchChoice(options, 'a')).toBeUndefined();
  expect(matchChoice(options, ' A ')).toBe(0);
  expect(matchChoice(options, ' A    ')).toBeUndefined();
  expect(matchChoice(options, ' Bi ')).toBe(2);
  expect(matchChoice(options, 'b')).toBeUndefined();
  expect(matchChoice([{ value: 'é', label: 'Composed' }], 'e\u0301')).toBeUndefined();
});

it('reads exported pairs, writes exact dropdown values and radio names, and uses the display text in the AP', async () => {
  const source = await save(await makeTemplate());
  const metadata = await inspectTemplate(source);
  expect(metadata.fields).toMatchObject([
    { name: 'Clinic', readOnly: false, choices: clinicOptions },
    { name: 'Contact', readOnly: false, choices: [{ value: 'CALL', label: 'CALL' }, { value: 'بريد', label: 'بريد' }] },
  ]);
  const result = await preflightRow(source, { Clinic: ` ${label} `, Contact: 'CALL' }, { fonts: await fonts() });
  expect(result).toMatchObject({ status: 'pass', pageNumbers: [], diagnostics: [] });
  const document = await PDFDocument.load(result.pdfBytes!);
  const form = document.getForm();
  const dropdown = form.getDropdown('Clinic');
  expect(dropdown.acroField.dict.lookup(key('V'), PDFString).decodeText()).toBe('RIY');
  const stream = document.context.lookup(dropdown.acroField.getWidgets()[0]!.getNormalAppearance());
  if (!(stream instanceof PDFRawStream)) throw new Error('Missing normal appearance');
  expect(new TextDecoder().decode(decodePDFRawStream(stream).decode())).toContain(PDFHexString.fromText(label).toString());
  const radio = form.getRadioGroup('Contact');
  expect(radio.acroField.dict.lookup(key('V'), PDFName)).toBe(key('0'));
  expect(radio.acroField.getWidgets().map((widget) => widget.getAppearanceState())).toEqual([key('0'), key('Off')]);
});

it('handles duplicate exports only by an unambiguous label and sets its /I index', async () => {
  const source = await makeTemplate();
  const dropdown = source.getForm().getDropdown('Clinic');
  const options = dropdown.acroField.dict.lookup(key('Opt'), PDFArray);
  options.lookup(1, PDFArray).set(0, PDFString.of('RIY'));
  const bytes = await save(source);
  const config = { fonts: await fonts() };
  expect((await preflightRow(bytes, { Clinic: 'RIY' }, config)).diagnostics[0]).toMatchObject({ code: 'invalid-choice', pageNumbers: [2] });
  const filled = await preflightRow(bytes, { Clinic: 'Jeddah Clinic' }, config);
  const written = (await PDFDocument.load(filled.pdfBytes!)).getForm().getDropdown('Clinic').acroField.dict;
  expect(written.get(key('V'))?.toString()).toBe('(RIY)');
  expect(written.get(key('I'))?.toString()).toBe('[ 1 ]');
});

it('keeps Unicode exports literal and falls back to raw radio on names without /Opt', async () => {
  const doc = await makeTemplate();
  const form = doc.getForm();
  const sourceExport = PDFHexString.fromText('ر-١٢٣');
  const dropdown = form.getDropdown('Clinic');
  dropdown.acroField.dict.lookup(key('Opt'), PDFArray).lookup(0, PDFArray).set(0, sourceExport);
  form.getRadioGroup('Contact').acroField.dict.delete(key('Opt'));
  const source = await save(doc);
  const info = await inspectTemplate(source);
  expect(info.fields[1]?.choices).toEqual([{ value: '0', label: '0' }, { value: '1', label: '1' }]);
  const result = await preflightRow(source, { Clinic: 'ر-١٢٣', Contact: '0' }, { fonts: await fonts() });
  expect(result.status).toBe('pass');
  const newForm = (await PDFDocument.load(result.pdfBytes!)).getForm();
  expect(newForm.getDropdown('Clinic').acroField.dict.get(key('V'))?.toString()).toBe(sourceExport.toString());
  expect(newForm.getRadioGroup('Contact').acroField.dict.lookup(key('V'), PDFName)).toBe(key('0'));
});

it('reports all field-only pages and only specific bad widget pages, with no partial PDF', async () => {
  const doc = await makeTemplate();
  const config = { fonts: await fonts() };
  const invalid = await preflightRow(await save(doc), { Clinic: 'riy', Contact: 'bad', Unknown: 'x' }, config);
  expect(invalid).toMatchObject({ status: 'flagged', pageNumbers: [1, 2], diagnostics: [
    { field: 'Unknown', code: 'unknown-field', pageNumbers: [] },
    { field: 'Clinic', code: 'invalid-choice', choices: clinicOptions, pageNumbers: [2] },
    { field: 'Contact', code: 'invalid-choice', pageNumbers: [1, 2] },
  ] });
  const radio = doc.getForm().getRadioGroup('Contact');
  const normal = radio.acroField.getWidgets()[1]!.dict.lookup(key('AP'), PDFDict).lookup(key('N'), PDFDict);
  normal.delete(key('Off'));
  const blocked = await preflightRow(await save(doc), { Clinic: 'RIY', Contact: 'CALL' }, config);
  expect(blocked.pdfBytes).toBeUndefined();
  expect(blocked).toMatchObject({ status: 'flagged', pageNumbers: [2], diagnostics: [
    { field: 'Contact', code: 'unsupported-radio-appearance', widgetIndex: 1, pageNumbers: [2] },
  ] });
});

it('preserves structurally unsupported controls when unmapped and refuses to choose between duplicate radio states', async () => {
  const doc = await makeTemplate();
  const form = doc.getForm();
  const radio = form.getRadioGroup('Contact');
  radio.clear();
  const normal = radio.acroField.getWidgets()[1]!.dict.lookup(key('AP'), PDFDict).lookup(key('N'), PDFDict);
  normal.set(key('0'), normal.get(key('1'))!);
  normal.delete(key('1'));
  const bytes = await save(doc);
  const config = { fonts: await fonts() };
  const result = await preflightRow(bytes, { Clinic: 'JED', Contact: 'CALL' }, config);
  expect(result.diagnostics).toEqual([{ field: 'Contact', code: 'unsupported-radio-appearance', pageNumbers: [1, 2] }]);
  expect(result.pdfBytes).toBeUndefined();
  const skipped = await preflightRow(bytes, { Clinic: 'JED' }, config);
  expect(skipped.status).toBe('pass');
  const preserved = (await PDFDocument.load(skipped.pdfBytes!)).getForm().getRadioGroup('Contact').acroField;
  expect(preserved.dict.get(key('V'))?.toString()).toBe('/Off');
  for (const [ordinal, widget] of preserved.getWidgets().entries()) {
    const rawWidget = radio.acroField.getWidgets()[ordinal]!.dict;
    for (const attribute of ['V', 'AS', 'AP']) expect(widget.dict.get(key(attribute))?.toString()).toBe(rawWidget.get(key(attribute))?.toString());
  }
});

it('flattens members individually and flags a visible legacy widget with no reusable appearance', async () => {
  const doc = await makeTemplate();
  const one = { filename: '00123.pdf', pdfBytes: await save(doc) };
  const progress: number[][] = [];
  const flattened = unzipSync(await createFlattenedZip([one], (...args) => progress.push(args)));
  expect(progress).toEqual([[0, 1], [1, 1]]);
  const rebuilt = await PDFDocument.load(flattened[one.filename]!);
  expect(rebuilt.catalog.has(key('AcroForm'))).toBe(false);
  expect(rebuilt.getPages().every((page) => !page.node.Annots()?.size())).toBe(true);

  const original = doc.getForm().getDropdown('Clinic');
  original.acroField.dict.set(key('V'), doc.context.obj([PDFString.of('Default')]));
  original.acroField.getWidgets()[0]!.dict.delete(key('AP'));
  const legacy = { filename: 'legacy.pdf', pdfBytes: await save(doc) };
  expect(unzipSync(createZip([legacy]))[legacy.filename]).toEqual(legacy.pdfBytes);
  await expect(createMergedPdf([legacy])).rejects.toThrow('unflattenable-widget');
  await expect(createFlattenedZip([one, legacy])).rejects.toThrow('unflattenable-widget');

  const missingState = await makeTemplate();
  missingState.getForm().getRadioGroup('Contact').acroField.getWidgets()[1]!.dict.delete(key('AS'));
  const unsafeState = { filename: 'missing-state.pdf', pdfBytes: await save(missingState) };
  await expect(createMergedPdf([unsafeState])).rejects.toThrow('unflattenable-widget');
  await expect(createFlattenedZip([unsafeState])).rejects.toThrow('unflattenable-widget');
});
