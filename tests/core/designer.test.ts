import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { degrees, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFTextField } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { authorFlatPdf, inspectFlatPdf, type FieldDraftSpec } from '../../src/core/designer/author';
import { clampDisplayRect, displayToSource, sourceToDisplay, type DesignerPage } from '../../src/core/designer/geometry';
import { loadFieldLayout, saveFieldLayout } from '../../src/core/designer/layout';
import { validateFieldRect } from '../../src/core/designer/spec';
import { extractBatch } from '../../src/core/extractor/extract';
import { inspectTemplate, preflightRow } from '../../src/core/pdf';

const key = PDFName.of;
const field: FieldDraftSpec = { name: 'Person.Name', kind: 'text', pageIndex: 0, rectPdf: [30, 45, 120, 30] };
const sourceFile = (name: string) => readFile('fixtures/golden/' + name + '.pdf');

describe('flat AcroForm authoring', () => {
  it.each([
    ['encrypted', 'encrypted-pdf'], ['signed', 'signed-pdf-warning'],
    ['xfa', 'xfa-unsupported'], ['template', 'existing-form-fields'],
  ])('rejects the real %s fixture before writing a form', async (name, code) => {
    const bytes = await sourceFile(name);
    await expect(inspectFlatPdf(bytes)).rejects.toMatchObject({ code });
    await expect(authorFlatPdf(bytes, [field])).rejects.toMatchObject({ code });
  });

  it.each(['unsupported', 'orphan', 'detached', 'signature', 'dangling', 'geometry', 'reversed-crop'])('detects a %s source outside the supported editable schema', async (mode) => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage();
    const object = doc.context.obj({ Type: 'Annot', Subtype: 'Widget' });
    if (mode === 'unsupported') doc.getForm().createOptionList('List');
    if (mode === 'orphan') page.node.set(key('Annots'), doc.context.obj([doc.context.register(object)]));
    if (mode === 'detached') doc.context.register(object);
    if (mode === 'signature') doc.context.register(doc.context.obj({ FT: 'Sig' }));
    if (mode === 'dangling') page.node.set(key('Annots'), doc.context.obj([doc.context.nextRef()]));
    if (mode === 'geometry') page.node.set(key('Rotate'), PDFNumber.of(89));
    if (mode === 'reversed-crop') page.node.set(key('CropBox'), doc.context.obj([70, 50, 10, 20]));
    const bytes = await doc.save({ updateFieldAppearances: false });
    const code = mode === 'signature' ? 'signed-pdf-warning'
      : mode === 'dangling' ? 'invalid-pdf' : mode === 'geometry' || mode === 'reversed-crop' ? 'invalid-page-geometry' : 'existing-form-fields';
    await expect(inspectFlatPdf(bytes)).rejects.toMatchObject({ code });
  });

  it('detects malformed input and rejects invalid fields without changing the source', async () => {
    await expect(inspectFlatPdf(new Uint8Array([0, 1, 2]))).rejects.toMatchObject({ code: 'invalid-pdf' });
    const bytes = await sourceFile('flat');
    const source = await inspectFlatPdf(bytes);
    expect(source.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await expect(authorFlatPdf(bytes, [])).rejects.toMatchObject({ code: 'no-fields' });
    await expect(authorFlatPdf(bytes, [field, field])).rejects.toMatchObject({ code: 'duplicate-field-name', fieldIndex: 1 });
    const parent = { ...field, name: 'Person' };
    for (const pair of [[field, parent], [parent, field]]) {
      await expect(authorFlatPdf(bytes, pair)).rejects.toMatchObject({ code: 'field-name-conflict', fieldIndex: 1 });
    }
    for (const name of ['', 'a..b', ' a', 'a. ', 'a. b', 'a.\u202eb', 'a.\ud800']) {
      await expect(authorFlatPdf(bytes, [{ ...field, name }])).rejects.toMatchObject({ code: 'invalid-field-name', fieldIndex: 0 });
    }
    const out = { ...field, rectPdf: [-3, 40, 20, 20] as const };
    await expect(authorFlatPdf(bytes, [out])).rejects.toMatchObject({
      code: 'field-out-of-bounds', fieldIndex: 0, rectPdf: out.rectPdf, bounds: [0, 0, 612, 792],
    });
    await expect(inspectFlatPdf(bytes)).resolves.toEqual(source);
  });

  it('keeps the canonical empty editable form, page content and annotation graphics through a fill/extract roundtrip', async () => {
    const doc = await PDFDocument.load(await sourceFile('flat'), { updateMetadata: false });
    const page = doc.getPage(0);
    page.setRotation(degrees(-270));
    page.setCropBox(17, 29, 400, 545);
    doc.getForm(); // An empty AcroForm dictionary is eligible.
    const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [18, 40, 35, 55], Border: [0, 0, 0] }));
    page.node.set(key('Annots'), doc.context.obj([link]));
    const bytes = await doc.save({ updateFieldAppearances: false });
    const metadata = await inspectFlatPdf(bytes);
    expect(metadata.pages).toEqual([{ rotation: 90, visibleBox: { x: 17, y: 29, width: 400, height: 545 }, userUnit: 1 }]);
    const fields = [
      { ...field, rectPdf: [150, 100, 50, 160], fontSize: 15.5, alignment: 'rtl', maxLen: 40, multiline: true },
      { name: 'Person.Verified', pageIndex: 0, kind: 'checkbox', rectPdf: [240, 315, 25, 20] },
    ] as const satisfies FieldDraftSpec[];
    const authored = await authorFlatPdf(bytes, fields);
    const template = await inspectTemplate(authored);
    expect(template.fields[0]).toMatchObject({ name: field.name, kind: 'text', readOnly: false, multiline: true, defaultFontSize: 15.5, maxLength: 40, value: '',
      widgets: [{ rotation: 90, pageIndex: 0, x: 150, y: 100, width: 50, height: 160, usable: true }] });
    expect(template.fields[1]).toMatchObject({ name: 'Person.Verified', kind: 'checkbox', value: 'Off' });
    const saved = await PDFDocument.load(authored, { updateMetadata: false });
    const savedPage = saved.getPage(0);
    const savedText = saved.getForm().getTextField(field.name);
    expect(savedText.getAlignment()).toBe(2);
    expect(savedText.getText() ?? '').toBe('');
    expect(savedPage.node.get(key('Contents'))?.toString()).toBe(page.node.get(key('Contents'))?.toString());
    expect(savedPage.node.get(key('Resources'))?.toString()).toBe(page.node.get(key('Resources'))?.toString());
    expect(savedPage.node.Annots()?.get(0).toString()).toBe(link.toString());
    expect(savedPage.node.Annots()?.size()).toBe(3);
    expect(savedText.acroField.getWidgets()[0]?.dict.lookup(key('AP'), PDFDict).lookup(key('N'))).toBeInstanceOf(PDFRawStream);
    expect(saved.getForm().acroForm.dict.lookup(key('DR'), PDFDict).lookup(key('Font'), PDFDict).lookup(key('Helvetica'))).toBeInstanceOf(PDFDict);
    const canonical = 'مُحَمَّد سَالِم 00123\nRiyadh 00007';
    const fonts = {
      arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
      latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
    };
    const result = await preflightRow(authored, { [field.name]: canonical, 'Person.Verified': 'نعم' }, { fonts });
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe('pass');
    const filled = await PDFDocument.load(result.pdfBytes!, { updateMetadata: false });
    const filledText = filled.getForm().getTextField(field.name);
    expect(filledText).toBeInstanceOf(PDFTextField);
    expect(filledText.acroField.dict.lookup(key('V'), PDFHexString).decodeText()).toBe(canonical);
    const extraction = await extractBatch([{ filename: 'certificate.pdf', bytes: result.pdfBytes! }]);
    expect(extraction.rows[0]?.fields).toEqual({
      [field.name]: { kind: 'text', value: canonical },
      'Person.Verified': { kind: 'checkbox', value: 'checked', nativeValue: 'Yes' },
    });
    await expect(inspectFlatPdf(authored)).rejects.toMatchObject({ code: 'existing-form-fields' });
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toEqual([]);
  });

  it('binds layout JSON to the complete flat source bytes and revalidates the loaded geometry', async () => {
    const bytes = await sourceFile('flat');
    const source = await inspectFlatPdf(bytes);
    const layout = await saveFieldLayout(source, [field]);
    expect(JSON.parse(layout)).toEqual({ version: 1, sourceSha256: source.sourceSha256, fields: [field] });
    await expect(loadFieldLayout(layout, source)).resolves.toEqual([field]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.setTitle('Identical page geometry, different PDF bytes');
    const other = await inspectFlatPdf(await doc.save());
    expect(other.pages).toEqual(source.pages);
    await expect(loadFieldLayout(layout, other)).rejects.toMatchObject({ code: 'layout-source-mismatch' });
    await expect(loadFieldLayout(JSON.stringify({ ...JSON.parse(layout), fields: [{ ...field, pageIndex: 1 }] }), source))
      .rejects.toMatchObject({ code: 'invalid-field-page', fieldIndex: 0 });
    await expect(loadFieldLayout('{"version":2}', source)).rejects.toMatchObject({ code: 'invalid-layout' });
  });
});

describe('designer geometry', () => {
  it.each([
    [0, [0.1, 0.6, 0.2, 0.2]], [90, [0.2, 0.1, 0.2, 0.2]],
    [180, [0.7, 0.2, 0.2, 0.2]], [270, [0.6, 0.7, 0.2, 0.2]],
  ] as const)('projects a nonzero cropped source at %d°', (rotation, expected) => {
    const page = { visibleBox: { x: -30, y: 50, width: 500, height: 220 }, rotation, userUnit: 1 } satisfies DesignerPage;
    const pdf = [20, 94, 100, 44] as const;
    expect(sourceToDisplay(pdf, page)).toEqual(expected);
    for (const [index, value] of displayToSource(expected, page).entries()) expect(value).toBeCloseTo(pdf[index]!, 10);
  });

  it('clips drags and validates the minimum physical displayed dimensions', async () => {
    expect(clampDisplayRect([-0.25, 0.75, 0.75, 0.6])).toEqual([0, 0.75, 0.5, 0.25]);
    const doc = await PDFDocument.create();
    const page = doc.addPage([250, 400]);
    page.node.set(key('UserUnit'), PDFNumber.of(2));
    page.node.set(key('CropBox'), doc.context.obj([-20, 30, 240, 440]));
    page.setRotation(degrees(270));
    const { pages } = await inspectFlatPdf(await doc.save());
    expect(pages[0]).toEqual({ rotation: 270, visibleBox: { x: 0, y: 30, width: 240, height: 370 }, userUnit: 2 });
    expect(validateFieldRect([30, 40, 5, 6], pages[0]!, 'text')).toEqual([30, 40, 5, 6]);
    expect(() => validateFieldRect([30, 40, 6, 5], pages[0]!, 'text')).toThrow('field-too-small');
  });
});
