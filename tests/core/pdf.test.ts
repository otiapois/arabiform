import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFTextField, TextAlignment } from 'pdf-lib';
import { createAudit, createMergedPdf, createZip, inspectCustomFont, inspectTemplate, preflightRow, type FieldDiagnostic } from '../../src/core/pdf';
import { createShaper } from '../../src/core/pdf/shaping';
import { readRoster } from '../../src/core/roster';

const key = PDFName.of;
const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
const fonts = async () => ({
  arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
  latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
});

async function makeTemplate(secondWidth = 170) {
  const source = await PDFDocument.create();
  const first = source.addPage([300, 400]);
  const second = source.addPage([260, 390]);
  second.setRotation(degrees(90));
  const form = source.getForm();
  const name = form.createTextField('Name');
  name.enableRequired();
  name.setAlignment(TextAlignment.Right);
  name.addToPage(first, { x: 20, y: 310, width: 160, height: 22 });
  name.addToPage(second, { x: 30, y: 220, width: secondWidth, height: 24 });
  name.acroField.getWidgets()[1]!.dict.set(key('V'), PDFHexString.fromText('stale local value'));
  const notes = form.createTextField('Notes');
  notes.enableMultiline();
  notes.addToPage(first, { x: 20, y: 178, width: 108, height: 74 });
  const id = form.createTextField('ID');
  id.setMaxLength(5);
  id.addToPage(first, { x: 20, y: 137, width: 92, height: 20 });
  const sentinel = form.createTextField('Sentinel');
  sentinel.addToPage(first, { x: 20, y: 71, width: 120, height: 22 });
  sentinel.setText('KEEP 00109');
  return source.save();
}

function valueAndAppearances(field: PDFTextField) {
  return {
    value: field.acroField.dict.get(key('V'))?.toString(),
    appearances: field.acroField.getWidgets().map((widget) => {
      const stream = widget.dict.context.lookup(widget.getNormalAppearance());
      if (!(stream instanceof PDFRawStream)) throw new Error('Missing appearance stream');
      return stream.getContents();
    }),
  };
}

describe('PDF intake and fill', () => {
  it('rejects flat, raw XFA and unsigned signature-field templates', async () => {
    const flat = await PDFDocument.create();
    flat.addPage();
    await expect(inspectTemplate(await flat.save())).rejects.toThrow('flat-scanned-no-fields');

    const xfa = await PDFDocument.load(await makeTemplate());
    xfa.catalog.getAcroForm()!.dict.set(key('XFA'), xfa.context.obj(['x', 'y']));
    await expect(inspectTemplate(await xfa.save({ updateFieldAppearances: false }))).rejects.toThrow('xfa-unsupported');

    const signed = await PDFDocument.load(await makeTemplate());
    const fields = signed.catalog.getAcroForm()!.dict.lookup(key('Fields'), PDFArray);
    fields.push(signed.context.register(signed.context.obj({ FT: 'Sig' })));
    await expect(inspectTemplate(await signed.save({ updateFieldAppearances: false }))).rejects.toThrow('signed-pdf-warning');
  });

  it('writes exact /V, shaped appearances on both pages and preserves the unmapped bytes', async () => {
    const source = await makeTemplate();
    const metadata = await inspectTemplate(source);
    expect(metadata.pages.map((page) => page.rotation)).toEqual([0, 90]);
    expect(metadata.fields.find((field) => field.name === 'Name')?.widgets.map((widget) => widget.pageIndex)).toEqual([0, 1]);
    const values = { Name: 'سَلْمَى بِنْت Alex (00123)', ID: '00007', Notes: 'رُقَيَّة نَاجِي\r\nSecond wrapped line with more words.' };
    const result = await preflightRow(source, values, { fonts: await fonts(), minFontSize: 8, preferredFont: 'auto' });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe('pass');
    const filled = await PDFDocument.load(result.pdfBytes!);
    const form = filled.getForm();
    for (const [fieldName, value] of Object.entries(values)) {
      const field = form.getTextField(fieldName);
      expect(field.getText()).toBe(value);
      for (const widget of field.acroField.getWidgets()) {
        const localValue = widget.dict.lookupMaybe(key('V'), PDFHexString);
        if (localValue) expect(localValue.decodeText()).toBe(value);
        const stream = filled.context.lookup(widget.getNormalAppearance());
        if (!(stream instanceof PDFRawStream)) throw new Error('Missing appearance stream');
        expect(stream.dict.lookup(key('Resources'), PDFDict).lookup(key('Font'), PDFDict).keys().length).toBeGreaterThan(0);
        expect(new TextDecoder().decode(decodePDFRawStream(stream).decode())).toContain(' Tj');
      }
    }
    const original = (await PDFDocument.load(source)).getForm().getTextField('Sentinel');
    expect(valueAndAppearances(form.getTextField('Sentinel'))).toEqual(valueAndAppearances(original));
  });

  it('never emits a partially written PDF when one repeated widget, MaxLen, or required value fails', async () => {
    const config = { fonts: await fonts(), minFontSize: 8, preferredFont: 'auto' as const };
    const source = await makeTemplate(8);
    const overflow = await preflightRow(source, { Name: 'سَلْمَى بِنْت يَاسِين', ID: '000007' }, config);
    expect(overflow).toMatchObject({ status: 'flagged', diagnostics: [{ field: 'Name', code: 'too-narrow', widgetIndex: 1 }, { field: 'ID', code: 'exceeds-maxlen', maxLengthExcess: 1 }] });
    expect(overflow.pdfBytes).toBeUndefined();
    expect((await preflightRow(source, { Name: ' ' }, config)).diagnostics).toEqual([{ field: 'Name', code: 'missing-required', pageNumbers: [1, 2] }]);
  });

  it('keeps auto byte-equivalent and changes mapped text alignment on every widget without changing logical values', async () => {
    const initial = await PDFDocument.load(await makeTemplate());
    const initialName = initial.getForm().getTextField('Name');
    initialName.acroField.getWidgets()[1]!.dict.set(key('Q'), initial.context.obj(TextAlignment.Right));
    const source = await initial.save({ updateFieldAppearances: false });
    const options = { fonts: await fonts() };
    const values = { Name: '  سَلْمَى Alex #00123 ' };
    const baseline = await preflightRow(source, values, options);
    const autoOptions = { ...options, alignOverrides: { Name: 'auto' } as const };
    expect((await preflightRow(source, values, autoOptions)).pdfBytes).toEqual(baseline.pdfBytes);
    const baselineForm = (await PDFDocument.load(baseline.pdfBytes!)).getForm();
    const old = valueAndAppearances(baselineForm.getTextField('Sentinel'));
    for (const [mode, quadding] of [['center', TextAlignment.Center], ['ltr', TextAlignment.Left], ['rtl', TextAlignment.Right]] as const) {
      const explicitOptions = { ...options, alignOverrides: { Name: mode, Sentinel: mode } };
      const result = await preflightRow(source, values, explicitOptions);
      expect(result.status).toBe('pass');
      expect(result.fontSizes).toEqual(baseline.fontSizes);
      const form = (await PDFDocument.load(result.pdfBytes!)).getForm();
      const name = form.getTextField('Name');
      expect(name.getText()).toBe(values.Name);
      expect(name.getAlignment()).toBe(quadding);
      expect(name.acroField.getWidgets()[1]!.dict.get(key('Q'))?.toString()).toBe(String(quadding));
      expect(valueAndAppearances(form.getTextField('Sentinel'))).toEqual(old);
    }
  }, 15_000);

  it('writes Latin letters and digits left to right within an Arabic paragraph', async () => {
    const bundled = await fonts();
    const sans = fontkit.create(bundled.latin);
    const naskh = fontkit.create(bundled.arabic);
    const value = 'أحمد سالم - AR-00123';
    const shaped = createShaper(bundled, 'auto').line(value)!;
    expect(shaped.direction).toBe('rtl');
    const latin = shaped.glyphs.filter((glyph) => glyph.font === 'latin');
    const run = [...'AR-00123-'].map((character) => sans.glyphForCodePoint(character.codePointAt(0)!).id);
    expect(latin.map((glyph) => glyph.id)).toEqual(run);
    const arabic = shaped.glyphs.filter((glyph) => glyph.font === 'arabic');
    const native = naskh.layout('أحمد سالم').glyphs.filter((glyph) => glyph.bbox.maxX > glyph.bbox.minX).map((glyph) => glyph.id);
    expect(arabic.map((glyph) => glyph.id)).toEqual(native);
    expect(latin.at(-1)!.x).toBeLessThan(arabic[0]!.x);
  });

  it('keeps number groups, phone punctuation, and paired brackets in visual order', async () => {
    const bundled = await fonts();
    const sans = fontkit.create(bundled.latin);
    const naskh = fontkit.create(bundled.arabic);
    const shaper = createShaper(bundled, 'auto');
    const ids = (s: string, font = sans) => [...s].map((character) => font.glyphForCodePoint(character.codePointAt(0)!).id);
    for (const [text, expectedLatin] of [
      ['الطلب #00123 - Riyadh 2026', 'Riyadh2026-#00123'],
      ['الطلب +966 50 012 3456', '+966500123456'],
      ['(أحمد - 0045)', '(0045-)'],
    ]) {
      const shaped = shaper.line(text!)!;
      expect(shaped.glyphs.filter((glyph) => glyph.font === 'latin').map((glyph) => glyph.id)).toEqual(ids(expectedLatin!));
    }
    const numbers = ids('١٢٣٤٥٦', naskh);
    const indic = shaper.line('الطلب ١٢٣٤٥٦')!.glyphs.map((glyph) => glyph.id);
    expect(indic.slice(0, numbers.length)).toEqual(numbers);
  });

  it('fails closed for unsupported directional controls and malformed Unicode', async () => {
    const bundled = await fonts();
    const source = await makeTemplate();
    for (const Name of ['أحمد\u202e00123', 'ليلى\u2066ABC\u2069', 'ABC\u200d', 'ID\0X', 'ID\uD800']) {
      const result = await preflightRow(source, { Name }, { fonts: bundled });
      expect(result.status).toBe('flagged');
      expect(result.pdfBytes).toBeUndefined();
    }
  });

  it('applies the exact advertised font floor to a flagged roster row', async () => {
    const source = await readFile(resolve(assets, 'fixtures/m2/landscape-badge.pdf'));
    const [row] = (await readRoster(await readFile(resolve(assets, 'fixtures/m2/badge-roster.csv')), 'badge-roster.csv')).sheets[0]!.rows;
    const bundled = await fonts();
    const preview = await preflightRow(source, row!.values, { fonts: bundled });
    expect(preview.status).toBe('flagged');
    expect(preview.diagnostics).toEqual([{ field: 'Name', code: 'too-narrow', widgetIndex: 0, requiredFontSizePt: 7.58, pageNumbers: [1] }]);
    const size = preview.diagnostics[0]!.requiredFontSizePt!;
    const fixed = await preflightRow(source, row!.values, { fonts: bundled, minFontSize: size });
    expect(fixed.status).toBe('pass');
    expect((await PDFDocument.load(fixed.pdfBytes!)).getForm().getTextField('Name').getText()).toBe(row!.values.Name);
    expect((await preflightRow(source, row!.values, { fonts: bundled, minFontSize: size + 0.01 })).status).toBe('flagged');
  });
});

describe('batch exports', () => {
  it('returns real ZIP bytes and noninteracting flattened merged copies', async () => {
    const source = await makeTemplate();
    const config = { fonts: await fonts(), minFontSize: 8, preferredFont: 'auto' as const };
    const first = await preflightRow(source, { Name: 'بَنِي يَمَن' }, config);
    const second = await preflightRow(source, { Name: 'يُسْرَى مُؤْمِن' }, config);
    const rows = [{ filename: '00007-بَنِي.pdf', pdfBytes: first.pdfBytes! }, { filename: '00123-يُسْرَى.pdf', pdfBytes: second.pdfBytes! }];
    const zipProgress: [number, number][] = [];
    const zipped = unzipSync(createZip(rows, (complete, total) => zipProgress.push([complete, total])));
    expect(Object.keys(zipped)).toEqual(rows.map((row) => row.filename));
    for (const row of rows) expect(zipped[row.filename]).toEqual(row.pdfBytes);
    expect(zipProgress).toEqual([[0, 2], [1, 2], [2, 2]]);
    const mergeProgress: [number, number][] = [];
    const merged = await PDFDocument.load(await createMergedPdf(rows, (complete, total) => mergeProgress.push([complete, total])));
    expect(mergeProgress).toEqual(zipProgress);
    expect(merged.getPages().map((page) => page.getRotation().angle)).toEqual([0, 90, 0, 90]);
    expect(merged.catalog.has(key('AcroForm'))).toBe(false);
    expect(merged.getPages().every((page) => !page.node.Annots()?.size())).toBe(true);
  });

  it('emits stable JSON and CSV with formula escaping', () => {
    const rows = [{ rowNumber: 1, filename: '=1+1.pdf', status: 'pass' as const, diagnostics: [], fontSizes: { Name: [8, 10], ID: [12] } }];
    const report = createAudit(rows);
    expect(report).toEqual(createAudit(rows));
    expect(JSON.parse(report.json)[0]).toMatchObject(rows[0]!);
    expect(report.csv).toContain("'=1+1.pdf");
    expect(createAudit([{ ...rows[0]!, filename: '  ＋1+1.pdf' }]).csv).toContain("'  ＋1+1.pdf");
  });

  it('keeps diagnostic page numbers available to the preview without exporting them in the audit', () => {
    const expected = [
      { field: 'Name', code: 'too-narrow', widgetIndex: 1, requiredFontSizePt: 7.58 },
      { field: 'ID', code: 'exceeds-maxlen', maxLengthExcess: 1 },
      { field: 'Clinic', code: 'invalid-choice', choices: [{ value: 'RIY', label: 'عِيَادَةُ الرِّيَاضِ' }] },
    ] satisfies Omit<FieldDiagnostic, 'pageNumbers'>[];
    const diagnostics = expected.map((issue, index) => ({ ...issue, pageNumbers: [index + 1] }));
    const report = createAudit([{ rowNumber: 1, filename: '00123.pdf', status: 'flagged', diagnostics, fontSizes: {} }]);
    const csv = Papa.parse<{ diagnostics: string }>(report.csv, { header: true }).data[0]!;
    expect(JSON.parse(report.json)[0].diagnostics).toEqual(expected);
    expect(JSON.parse(csv.diagnostics)).toEqual(expected);
    expect(diagnostics.map(({ pageNumbers }) => pageNumbers)).toEqual([[1], [2], [3]]);
  });

  it('independently rejects unsafe or colliding ZIP entry names', () => {
    const row = (filename: string) => ({ filename, pdfBytes: new Uint8Array() });
    for (const name of ['../A.pdf', 'x\\A.pdf', 'COM1.txt.pdf', 'NUL .pdf', 'a\u200fb.pdf', '／foo.pdf', 'a'.repeat(300) + '.pdf']) {
      expect(() => createZip([row(name)])).toThrow('invalid-export-filename');
    }
    expect(() => createZip([row('résumé.pdf'), row('RE\u0301SUME\u0301.PDF')])).toThrow('invalid-export-filename');
  });
});

describe('M3 PDF widgets and custom fonts', () => {
  async function consent() {
    const source = await PDFDocument.create();
    const form = source.getForm();
    const page = source.addPage([350, 340]);
    const name = form.createTextField('Name');
    name.addToPage(page, { x: 20, y: 260, width: 190, height: 30 });
    const checked = form.createCheckBox('Checked');
    checked.addToPage(page, { x: 20, y: 200 });
    checked.check();
    const approval = form.createCheckBox('Approval');
    approval.addToPage(page, { x: 20, y: 160 });
    approval.addToPage(page, { x: 70, y: 160 });
    const group = form.createRadioGroup('Contact');
    group.addOptionToPage('Email', page, { x: 20, y: 120 });
    group.addOptionToPage('Phone', page, { x: 70, y: 120 });
    group.select('Phone');
    const dropdown = form.createDropdown('Site');
    dropdown.addOptions(['North', 'South']);
    dropdown.select('North');
    dropdown.addToPage(page, { x: 20, y: 80, width: 100 });
    const keep = form.createTextField('Sentinel');
    keep.addToPage(page, { x: 20, y: 30, width: 100 });
    keep.setText('KEEP 00109');
    form.updateFieldAppearances();
    for (const { dict } of approval.acroField.getWidgets()) {
      const normal = dict.lookup(key('AP'), PDFDict).lookup(key('N'), PDFDict);
      normal.set(key('Consent'), normal.get(key('Yes'))!);
      normal.delete(key('Yes'));
    }
    return source.save({ updateFieldAppearances: false });
  }

  function rawAppearance(dict: PDFDict) {
    function snapshot(object: unknown): unknown {
      if (object instanceof PDFRawStream) return { dictionary: object.dict.toString(), bytes: object.getContents() };
      if (object instanceof PDFDict) return Object.fromEntries(object.keys().map((name) => [name.toString(), snapshot(object.lookup(name))]));
      return String(object);
    }
    return { raw: dict.get(key('AP'))?.toString(), contents: snapshot(dict.lookup(key('AP'))) };
  }

  it('roundtrips every button/choice widget and reuses the on/off streams by name', async () => {
    const template = await consent();
    const metadata = await inspectTemplate(template);
    expect(metadata.fields.map(({ name, kind, readOnly }) => [name, kind, readOnly])).toEqual([
      ['Name', 'text', false], ['Checked', 'checkbox', false], ['Approval', 'checkbox', false],
      ['Contact', 'radio', false], ['Site', 'dropdown', false], ['Sentinel', 'text', false],
    ]);
    const result = await preflightRow(template, { Name: 'سَلْمَى 00123', Approval: ' نعم ' }, { fonts: await fonts() });
    expect(result.diagnostics).toEqual([]);
    const before = (await PDFDocument.load(template)).getForm();
    const after = (await PDFDocument.load(result.pdfBytes!)).getForm();
    for (const fieldName of ['Checked', 'Contact', 'Site', 'Sentinel', 'Approval']) {
      const previous = before.getField(fieldName);
      const written = after.getField(fieldName);
      const expected = fieldName === 'Approval' ? '/Consent' : previous.acroField.dict.get(key('V'))?.toString();
      expect(written.acroField.dict.get(key('V'))?.toString()).toBe(expected);
      const oldWidgets = previous.acroField.getWidgets();
      const newWidgets = written.acroField.getWidgets();
      expect(newWidgets).toHaveLength(oldWidgets.length);
      for (const [index, { dict }] of newWidgets.entries()) {
        const old = oldWidgets[index]!.dict;
        expect(dict.get(key('AS'))?.toString()).toBe(fieldName === 'Approval' ? '/Consent' : old.get(key('AS'))?.toString());
        expect(rawAppearance(dict)).toEqual(rawAppearance(old));
      }
    }
    expect(after.getTextField('Name').getText()).toBe('سَلْمَى 00123');
    const unchecked = await preflightRow(result.pdfBytes!, { Approval: 'لا' }, { fonts: await fonts() });
    expect((await PDFDocument.load(unchecked.pdfBytes!)).getForm().getCheckBox('Approval').isChecked()).toBe(false);
  });

  it('flags bad roster tokens, read-only fields, mismatched on names, and missing Off appearances', async () => {
    const template = await consent();
    const options = { fonts: await fonts() };
    const invalid = await preflightRow(template, { Approval: 'unknown', Contact: 'email', Site: 'south' }, options);
    expect(invalid.pdfBytes).toBeUndefined();
    expect(invalid.diagnostics).toEqual([
      { field: 'Approval', code: 'invalid-checkbox-value', pageNumbers: [1] },
      { field: 'Contact', code: 'invalid-choice', choices: [{ value: 'Email', label: 'Email' }, { value: 'Phone', label: 'Phone' }], pageNumbers: [1] },
      { field: 'Site', code: 'invalid-choice', choices: [{ value: 'North', label: 'North' }, { value: 'South', label: 'South' }], pageNumbers: [1] },
    ]);
    for (const { remove, add } of [{ remove: 'Consent', add: 'Different' }, { remove: 'Off', add: 'Inactive' }]) {
      const broken = await PDFDocument.load(template);
      const widget = broken.getForm().getCheckBox('Approval').acroField.getWidgets()[1]!;
      const normal = widget.dict.lookup(key('AP'), PDFDict).lookup(key('N'), PDFDict);
      normal.set(key(add), normal.get(key(remove))!);
      normal.delete(key(remove));
      const contents = await broken.save({ updateFieldAppearances: false });
      const flagged = await preflightRow(contents, { Approval: 'yes', Name: 'ليلى' }, options);
      expect(flagged.pdfBytes).toBeUndefined();
      expect(flagged.diagnostics).toContainEqual({ field: 'Approval', code: 'unsupported-checkbox-appearance', widgetIndex: 1, pageNumbers: [1] });
      expect((await preflightRow(contents, { Name: 'ليلى' }, options)).status).toBe('pass');
    }
  });

  it('accepts an editable checkbox-only form and rejects a dropdown with no options', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage();
    const form = source.getForm();
    form.createCheckBox('Approval').addToPage(page, { x: 20, y: 20 });
    const checkboxOnly = await source.save();
    expect((await inspectTemplate(checkboxOnly)).fields[0]?.kind).toBe('checkbox');
    const result = await preflightRow(checkboxOnly, { Approval: ' x ' }, { fonts: await fonts() });
    expect(result.diagnostics).toEqual([]);
    expect((await PDFDocument.load(result.pdfBytes!)).getForm().getCheckBox('Approval').isChecked()).toBe(true);
    const choices = await PDFDocument.create();
    choices.getForm().createDropdown('Region').addToPage(choices.addPage(), { x: 20, y: 20 });
    await expect(inspectTemplate(await choices.save())).rejects.toThrow('flat-scanned-no-fields');
  });

  it('uses the actual custom family and flags unsupported glyphs without bundled fallback', async () => {
    const template = await consent();
    const bundled = await fonts();
    expect(inspectCustomFont(bundled.arabic).family).toBe('Noto Naskh Arabic');
    expect(inspectCustomFont(bundled.latin).family).toBe('Noto Sans');
    expect(() => inspectCustomFont(Uint8Array.of(0, 1, 0, 0))).toThrow('invalid-custom-font');
    await expect(preflightRow(template, {}, { fonts: bundled, customFont: Uint8Array.of(0, 1, 0, 0) })).rejects.toThrow('invalid-custom-font');
    const blocked = await preflightRow(template, { Name: 'مُحَمَّد' }, { fonts: bundled, customFont: bundled.latin });
    expect(blocked.diagnostics).toEqual([{ field: 'Name', widgetIndex: 0, code: 'missing-glyphs', pageNumbers: [1] }]);
    expect(blocked.pdfBytes).toBeUndefined();
    const good = await preflightRow(template, { Name: 'مُحَمَّد' }, { fonts: bundled, customFont: bundled.arabic });
    expect(good.diagnostics).toEqual([]);
    expect((await PDFDocument.load(good.pdfBytes!)).getForm().getTextField('Name').getText()).toBe('مُحَمَّد');
  });
});
