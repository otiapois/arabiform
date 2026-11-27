import { degrees, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { getWidgetOverlays, inspectTemplate } from '../../src/core/pdf';

const key = PDFName.of;

describe('canvas widget projection', () => {
  it('matches the pinned PDF.js viewport on cropped and rotated pages with repeated, clipped and hidden widgets', async () => {
    const source = await PDFDocument.create();
    const form = source.getForm();
    const serial = form.createTextField('Serial');
    const partial = form.createTextField('Partial');
    const detached = form.createTextField('Detached');
    const hidden = form.createTextField('Hidden');
    const outside = form.createTextField('Outside');
    const unlinked = form.createTextField('Unlinked');
    const visibleRect = [12, 44, 80, 73] as const;
    for (const [index, angle] of [0, 90, 180, 270].entries()) {
      const page = source.addPage([250, 200]);
      page.setMediaBox(-10, 15, 250, 200);
      page.setCropBox(index === 3 ? 300 : 5, 25, 260, 130);
      page.setRotation(degrees(angle));
      page.node.set(key('UserUnit'), PDFNumber.of(1 + index / 2));
      serial.addToPage(page, { x: visibleRect[0], y: visibleRect[1], width: visibleRect[2] - visibleRect[0], height: visibleRect[3] - visibleRect[1], borderWidth: 0, rotate: degrees(90) });
      // Replace the rotated authoring bounds with a fixed PDF rectangle independent of the widget's /MK /R.
      serial.acroField.getWidgets()[index]!.dict.set(key('Rect'), source.context.obj([...visibleRect]));
      if (index === 3) continue;
      partial.addToPage(page, { x: -2, y: 18, width: 27, height: 26, borderWidth: 0 });
      hidden.addToPage(page, { x: 12, y: 80, width: 40, height: 16, borderWidth: 0 });
      hidden.acroField.getWidgets()[index]!.dict.set(key('F'), PDFNumber.of([1, 2, 32][index]!));
      outside.addToPage(page, { x: 50, y: 170, width: 30, height: 15, borderWidth: 0 });
      if (index !== 0) continue;
      detached.addToPage(page, { x: 55, y: 80, width: 40, height: 16, borderWidth: 0 });
      const annots = page.node.Annots()!;
      annots.remove(annots.size() - 1);
      unlinked.addToPage(page, { x: 55, y: 80, width: 40, height: 16, borderWidth: 0 });
      const widget = unlinked.acroField.getWidgets()[0]!.dict;
      expect(widget.lookup(key('Parent'))).toBeInstanceOf(PDFDict);
      widget.delete(key('Parent'));
    }

    const bytes = await source.save();
    const metadata = await inspectTemplate(bytes);
    expect(metadata.fields.find(({ name }) => name === 'Partial')?.widgets[0]?.usable).toBe(false);
    const overlays = getWidgetOverlays(metadata);
    expect(overlays.map(({ fieldName, pageNumber, widgetIndex }) => [fieldName, pageNumber, widgetIndex])).toEqual([
      ['Serial', 1, 1], ['Serial', 2, 2], ['Serial', 3, 3], ['Serial', 4, 4],
      ['Partial', 1, 1], ['Partial', 2, 2], ['Partial', 3, 3],
    ]);
    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      for (const { fieldName, pageNumber, rect } of overlays) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2.25 });
        const bounds = fieldName === 'Serial' ? visibleRect : [5, 25, 25, 44] as const;
        const [x1, y1] = viewport.convertToViewportPoint(bounds[0], bounds[1]);
        const [x2, y2] = viewport.convertToViewportPoint(bounds[2], bounds[3]);
        const expected = [Math.min(x1!, x2!) / viewport.width, Math.min(y1!, y2!) / viewport.height,
          Math.abs(x1! - x2!) / viewport.width, Math.abs(y1! - y2!) / viewport.height];
        for (const [index, component] of rect.entries()) expect(component).toBeCloseTo(expected[index]!, 12);
      }
    } finally {
      await task.destroy();
    }
  });
});
