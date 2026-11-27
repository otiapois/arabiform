import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export async function createDesignerDemo(): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Synthetic Sample — Workshop Certificate');
  const versionDate = new Date('2026-01-01T00:00:00Z');
  pdf.setCreationDate(versionDate);
  pdf.setModificationDate(versionDate);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([600, 440]);
  const ink = rgb(.10, .24, .20);
  const accent = rgb(.44, .32, .14);
  page.drawRectangle({ x: 18, y: 18, width: 564, height: 404, color: rgb(.99, .98, .94),
    borderColor: accent, borderWidth: 2 });
  page.drawRectangle({ x: 28, y: 28, width: 544, height: 384, borderColor: accent, borderWidth: .5 });
  page.drawText('SYNTHETIC SAMPLE', { x: 63, y: 362, font: bold, size: 11, color: accent });
  page.drawText('Workshop Certificate', { x: 63, y: 309, font: bold, size: 31, color: ink });
  page.drawText('This certificate is presented to', { x: 63, y: 258, font: regular, size: 14, color: ink });
  page.drawLine({ start: { x: 63, y: 192 }, end: { x: 533, y: 192 }, thickness: 1, color: accent });
  page.drawText('Participant name', { x: 63, y: 167, font: regular, size: 11, color: ink });
  page.drawRectangle({ x: 63, y: 102, width: 20, height: 20, borderColor: ink, borderWidth: 1 });
  page.drawText('Verified attendance', { x: 96, y: 106, font: regular, size: 13, color: ink });
  return new File([Uint8Array.from(await pdf.save())], 'synthetic-flat-certificate.pdf', { type: 'application/pdf' });
}
