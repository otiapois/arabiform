import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFTextField, TextAlignment } from 'pdf-lib';
import { createAudit, createMergedPdf, createZip, inspectTemplate, preflightRow } from '../../src/core/pdf';
import { createShaper } from '../../src/core/pdf/shaping';

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
    expect(overflow).toMatchObject({ status: 'flagged', diagnostics: [{ field: 'Name', code: 'too-narrow', widgetIndex: 1 }, { field: 'ID', code: 'exceeds-maxlen' }] });
    expect(overflow.pdfBytes).toBeUndefined();
    expect((await preflightRow(source, { Name: ' ' }, config)).diagnostics).toEqual([{ field: 'Name', code: 'missing-required' }]);
  });

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
});

describe('batch exports', () => {
  it('returns real ZIP bytes and noninteracting flattened merged copies', async () => {
    const source = await makeTemplate();
    const config = { fonts: await fonts(), minFontSize: 8, preferredFont: 'auto' as const };
    const first = await preflightRow(source, { Name: 'بَنِي يَمَن' }, config);
    const second = await preflightRow(source, { Name: 'يُسْرَى مُؤْمِن' }, config);
    const rows = [{ filename: '00007-بَنِي.pdf', pdfBytes: first.pdfBytes! }, { filename: '00123-يُسْرَى.pdf', pdfBytes: second.pdfBytes! }];
    const zipped = unzipSync(createZip(rows));
    expect(Object.keys(zipped)).toEqual(rows.map((row) => row.filename));
    for (const row of rows) expect(zipped[row.filename]).toEqual(row.pdfBytes);
    const merged = await PDFDocument.load(await createMergedPdf(rows));
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
  });
});
