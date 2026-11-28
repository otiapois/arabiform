import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { preflightRow } from '../core/pdf';
import { loadFonts } from './bundled-assets';

const demoRows = [
  { Name: 'سَلْمَى بِنْتُ يَاسِين', ID: '00123', Consent: 'yes', Clinic: 'RIY', Contact: 'CALL' },
  { Name: 'مُحَمَّد سَالِم', ID: '00007', Consent: 'no', Clinic: 'JED', Contact: 'MAIL' },
  { Name: 'Layla حَسَن', ID: '00891', Consent: 'yes', Clinic: 'RIY', Contact: 'MAIL', Notes: 'موعد صباحي' },
] as const;

async function createTemplate(extraField: boolean) {
  const document = await PDFDocument.create();
  document.setTitle('Synthetic Sample — Clinic registration');
  const page = document.addPage([480, 425]);
  const form = document.getForm();
  page.drawText('Synthetic Sample', { x: 38, y: 380, size: 11 });
  page.drawText('Clinic registration', { x: 38, y: 344, size: 24 });

  const textField = (name: string, y: number, width = 400) => {
    page.drawText(name, { x: 38, y: y + 31, size: 10 });
    form.createTextField(name).addToPage(page, { x: 38, y, width, height: 24 });
  };
  textField('Name', 284);
  textField('ID', 231, 110);

  page.drawText('Consent', { x: 176, y: 240, size: 10 });
  form.createCheckBox('Consent').addToPage(page, { x: 222, y: 236, width: 16, height: 16 });

  page.drawText('Clinic', { x: 38, y: 204, size: 10 });
  const clinic = form.createDropdown('Clinic');
  clinic.addOptions(['Riyadh', 'Jeddah']);
  clinic.addToPage(page, { x: 38, y: 173, width: 180, height: 24 });
  clinic.acroField.dict.set(PDFName.of('Opt'), document.context.obj([
    [PDFString.of('RIY'), PDFHexString.fromText('عِيَادَةُ الرِّيَاضِ')],
    [PDFString.of('JED'), PDFHexString.fromText('عِيَادَةُ جِدَّةَ')],
  ]));

  page.drawText('Contact', { x: 38, y: 146, size: 10 });
  const contact = form.createRadioGroup('Contact');
  contact.addOptionToPage('CALL', page, { x: 38, y: 118, width: 16, height: 16 });
  page.drawText('Phone', { x: 60, y: 121, size: 10 });
  contact.addOptionToPage('MAIL', page, { x: 115, y: 118, width: 16, height: 16 });
  page.drawText('Email', { x: 137, y: 121, size: 10 });

  if (extraField) textField('Notes', 57);
  return document.save({ updateFieldAppearances: false });
}

export async function createExtractorDemo() {
  const [fonts, common, extended] = await Promise.all([loadFonts(), createTemplate(false), createTemplate(true)]);
  return Promise.all(demoRows.map(async (row) => {
    const { pdfBytes } = await preflightRow('Notes' in row ? extended : common, row, { fonts });
    if (!pdfBytes) throw new Error('extractor-demo-fill-failed');
    return { filename: `synthetic-clinic-${row.ID}.pdf`, bytes: pdfBytes };
  }));
}
