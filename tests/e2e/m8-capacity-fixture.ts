import { PDFDocument, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createShaper, fitText } from '../../src/core/pdf/shaping';

const quoted = '="Division, A"';
// Known source widget rectangles in PDF points. The repeated field deliberately
// has different logical widths and a quarter-turn widget on a rotated page.
export const capacityWidgets = [
  { name: 'Employee name', kind: 'text', page: 1, widget: 1, rotation: 0, w: 142, h: 24 },
  { name: 'Employee name', kind: 'text', page: 2, widget: 2, rotation: 90, w: 24, h: 82 },
  { name: quoted, kind: 'text', page: 1, widget: 1, rotation: 0, w: 104, h: 24, max: 5 },
  { name: 'Comb ID', kind: 'text', page: 1, widget: 1, rotation: 0, w: 80, h: 20, max: 4, comb: true },
  { name: 'Approved', kind: 'checkbox', page: 1, widget: 1, rotation: 0, w: 18, h: 18 },
  { name: 'Office', kind: 'dropdown', page: 2, widget: 1, rotation: 0, w: 70, h: 20 },
  { name: 'Shift', kind: 'radio', page: 2, widget: 1, rotation: 0, w: 18, h: 18 },
];

export async function makeCapacityPdf() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([360, 450]), doc.addPage([360, 450])];
  pages[1]!.setRotation(degrees(90));
  const form = doc.getForm();
  const name = form.createTextField('Employee name');
  for (const [index, spec] of capacityWidgets.entries()) {
    const page = pages[spec.page - 1]!;
    const x = 30, y = 350 - index * 42;
    const rect = { x, y, width: spec.w, height: spec.h };
    const opts = { ...rect, borderWidth: 1 };
    if (spec.kind === 'text') {
      const field = spec.name === 'Employee name' ? name : form.createTextField(spec.name);
      if (spec.max) field.setMaxLength(spec.max);
      if (spec.comb) field.enableCombing();
      field.addToPage(page, opts);
      field.setFontSize(12);
    } else if (spec.kind === 'checkbox') form.createCheckBox(spec.name).addToPage(page, opts);
    else if (spec.kind === 'radio') form.createRadioGroup(spec.name).addOptionToPage('AM', page, opts);
    else {
      const dropdown = form.createDropdown(spec.name);
      dropdown.addOptions(['Central']);
      dropdown.addToPage(page, opts);
    }
    const widget = form.getField(spec.name).acroField.getWidgets().at(-1)!;
    widget.setRectangle(rect);
    widget.getOrCreateAppearanceCharacteristics().setRotation(spec.rotation);
  }
  return Buffer.from(await doc.save());
}

export const capacityColumns = ['fieldName', 'kind', 'pageNumber', 'widgetNumber', 'widgetRotation',
  'innerWidthPt', 'innerHeightPt', 'maxLength', 'arabicCharacters', 'latinCharacters', 'minFontSizePt'];

export async function expectedCapacity(min: number) {
  const fonts = { arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), latin: await readFile('public/fonts/NotoSans-Regular.ttf') };
  const shapers = { arabic: createShaper(fonts, 'arabic'), latin: createShaper(fonts, 'latin') };
  return capacityWidgets.map(spec => {
    // 1 pt border + 1.6 pt padding on both sides, independently of the inspector.
    const width = (spec.rotation === 90 ? spec.h : spec.w) - 5.2;
    const height = (spec.rotation === 90 ? spec.w : spec.h) - 5.2;
    function estimate(family: keyof typeof fonts, sample: string) {
      if (spec.kind !== 'text' || spec.comb) return '';
      // Exhaust the reference strings in these small fixtures via actual text fit.
      // This avoids deriving expected values from the capacity report's own search.
      const ceiling = spec.max ?? 128;
      const text = sample.repeat(Math.ceil(ceiling / sample.length));
      let best = 0;
      for (let count = 1; count <= ceiling; count++) {
        const fit = fitText(shapers[family], text.slice(0, count), false,
          { min, max: min, innerWidth: width, innerHeight: height, padding: 0 });
        if (!('code' in fit)) best = count;
      }
      if (!spec.max && best === ceiling) throw new Error('Fixture capacity exceeds the exhaustive reference range');
      return String(best);
    }
    return { fieldName: spec.name, kind: spec.kind, pageNumber: String(spec.page), widgetNumber: String(spec.widget),
      widgetRotation: String(spec.rotation), innerWidthPt: String(width), innerHeightPt: String(height),
      maxLength: String(spec.max ?? ''), arabicCharacters: estimate('arabic', 'مُحَمَّد سَالِم '),
      latinCharacters: estimate('latin', 'Marwan Salem '), minFontSizePt: String(min) };
  });
}
