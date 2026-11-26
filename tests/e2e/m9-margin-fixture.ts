import { degrees, PDFDocument } from 'pdf-lib';

// Known raw rectangles on the second page rotate clockwise: its upper edge is visibly right.
export async function physicalMarginPdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Synthetic print-margin sample');
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const form = doc.getForm();
  const pages = [doc.addPage([400, 500]), doc.addPage([400, 500])];
  const name = form.createTextField('Name');
  const id = form.createTextField('ID');
  const sentinel = form.createTextField('Unmapped');
  for (const [index, page] of pages.entries()) {
    page.setCropBox(20, 30, 350, 440);
    page.drawText('Synthetic margin sample', { x: 65, y: 325, size: 15 });
    page.drawText('Page ' + (index + 1), { x: 65, y: 300, size: 11 });
  }
  pages[1]!.setRotation(degrees(90));
  const placements = [
    { field: name, page: pages[0]!, x: 23.25, y: 205, width: 145, height: 23 },
    { field: id, page: pages[0]!, x: 29, y: 130, width: 125, height: 23 },
    { field: sentinel, page: pages[0]!, x: 21, y: 75, width: 120, height: 23 },
    { field: name, page: pages[1]!, x: 75, y: 439.5, width: 145, height: 23 },
  ];
  for (const { field, page, ...rect } of placements) {
    field.addToPage(page, { ...rect, borderWidth: 1 });
    field.acroField.getWidgets().at(-1)!.setRectangle(rect);
    field.setFontSize(12);
  }
  sentinel.setText('KEEP 00109');
  return Buffer.from(await doc.save());
}
