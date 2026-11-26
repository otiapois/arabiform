import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import { degrees, PDFDocument } from 'pdf-lib';
import { expect, it } from 'vitest';
import { inspectTemplate } from '../../src/core/pdf';
import { createCapacityCsv, inspectTemplateCapacities } from '../../src/core/pdf/capacity-inspector';

const asset = (filename: string) => readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', filename));

it('uses true padded widget rectangles and widget rotation across repeated controls without a roster', async () => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([300, 400]);
  const second = doc.addPage([300, 400]);
  second.setRotation(degrees(180));
  const form = doc.getForm();
  const name = form.createTextField('=Name');
  name.addToPage(first, { x: 30, y: 40, width: 100, height: 22, borderWidth: 1 });
  name.addToPage(second, { x: 30, y: 40, width: 80, height: 26, borderWidth: 3, rotate: degrees(90) });
  name.acroField.getWidgets()[0]!.setRectangle({ x: 30, y: 40, width: 100, height: 22 });
  name.acroField.getWidgets()[1]!.setRectangle({ x: 30, y: 40, width: 26, height: 80 });
  name.setFontSize(12);
  name.setMaxLength(30);
  const comb = form.createTextField('Comb');
  comb.setMaxLength(4);
  comb.enableCombing();
  comb.addToPage(first, { x: 30, y: 220, width: 30, height: 16 });
  form.createCheckBox('Consent').addToPage(first, { x: 30, y: 150 });
  const dropdown = form.createDropdown('Clinic');
  dropdown.addOptions(['Main']);
  dropdown.addToPage(second, { x: 30, y: 250 });
  const bytes = await doc.save();
  const fonts = {
    arabic: await asset('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await asset('public/fonts/NotoSans-Regular.ttf'),
  };
  const report = await inspectTemplateCapacities(bytes, fonts, 8);
  expect(report).toEqual(await inspectTemplateCapacities(await inspectTemplate(bytes), fonts, 8));
  expect(report.fieldCount).toBe(4);
  expect(report.rows).toHaveLength(5);
  const [firstWidget, secondWidget, combRow, checkboxRow, dropdownRow] = report.rows;
  expect(firstWidget).toMatchObject({ fieldName: '=Name', widgetNumber: 1, pageNumber: 1, widgetRotation: 0, maxLength: 30,
    innerWidth: 94.8, innerHeight: 16.8 });
  expect(secondWidget).toMatchObject({ fieldName: '=Name', widgetNumber: 2, pageNumber: 2, widgetRotation: 90, maxLength: 30,
    innerWidth: 70.8, innerHeight: 16.8 });
  for (const widget of [firstWidget!, secondWidget!]) {
    expect(widget.arabicCharacters).toBeGreaterThan(widget.latinCharacters!);
    expect(widget.arabicCharacters).toBeLessThanOrEqual(30);
  }
  expect(combRow).toMatchObject({ maxLength: 4, arabicCharacters: null, latinCharacters: null });
  expect(checkboxRow).toMatchObject({ kind: 'checkbox', maxLength: null, arabicCharacters: null, latinCharacters: null });
  expect(dropdownRow).toMatchObject({ kind: 'dropdown', maxLength: null, arabicCharacters: null, latinCharacters: null });
  const stricter = await inspectTemplateCapacities(bytes, fonts, 10);
  expect(stricter.rows[0]!.latinCharacters).toBeLessThan(firstWidget!.latinCharacters!);
  const csv = Papa.parse<string[]>(createCapacityCsv(report)).data;
  expect(csv[1]!.slice(0, 5)).toEqual(["'=Name", 'text', '1', '1', '0']);
  expect(csv[3]!.slice(-4)).toEqual(['4', '', '', '8']);
  expect(csv[4]!.slice(-4)).toEqual(['', '', '', '8']);
  await expect(inspectTemplateCapacities(await asset('fixtures/golden/encrypted.pdf'), fonts)).rejects.toThrow('encrypted-pdf');
  await expect(inspectTemplateCapacities(bytes, fonts, 12)).rejects.toThrow('invalid-min-font-size');
});
