import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

const output = fileURLToPath(new URL('../fixtures/', import.meta.url));
const metadataDate = new Date('2026-11-26T00:00:00Z');
const ink = rgb(0.10, 0.16, 0.13);
const forest = rgb(0.14, 0.32, 0.25);
const muted = rgb(0.29, 0.35, 0.31);
const rule = rgb(0.63, 0.68, 0.63);
const fill = rgb(0.98, 0.98, 0.95);

const headings = ['Name', 'ID', 'Title', 'Notes'];
const roster = [
  ['ليلى حسن', '00123', 'Workshop participant', 'Synthetic Sample. Workshop check-in.\nمُحَمَّد فِي قَاعَةِ التَّدْرِيبِ'],
  ['أحمد سالم', '00007', 'أحمد سالم - 00123', 'Bring the session handout.\nNotes may contain Arabic and English.'],
  ['بَنِي يَمَن', '00891', 'يُسْرَى مُؤْمِن', 'ن / ى / ي / م / ق\nFollow-up at desk A.'],
  ['سَلْمَى بِنْت يَاسِين', 'AR-00042 / ق', 'Group B', 'Confirm reading group.\nReference: SALMA-00042.'],
  ['عبد الرحمن بن ناصر بن سعيد بن راشد بن سليمان بن حمد بن خالد بن فارس بن سالم بن وليد بن عبد الله بن منصور بن أحمد بن يوسف بن طارق بن نواف بن ماجد بن صالح بن عبد العزيز بن عمر بن فهد بن محمد بن عادل بن زيد بن هاشم بن جابر بن عيسى بن إبراهيم', '00068', 'Guest', 'Check the participant name against the roster.'],
];

async function createPdf(title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Synthetic Sample - ${title}`);
  pdf.setCreator('ArabiForm fixture generator');
  pdf.setProducer('ArabiForm fixture generator');
  pdf.setCreationDate(metadataDate);
  pdf.setModificationDate(metadataDate);
  return pdf;
}

function addWidget(field, page, [x, y, width, height], font, borderWidth = 1, rotation = 0) {
  // pdf-lib includes the outer half of the border on all sides of /Rect.
  const inset = borderWidth / 2;
  field.addToPage(page, {
    x: x + inset,
    y: y + inset,
    width: width - borderWidth,
    height: height - borderWidth,
    rotate: degrees(rotation),
    borderWidth,
    borderColor: rule,
    backgroundColor: fill,
    textColor: ink,
    font,
  });
}

async function attendanceTemplate() {
  const pdf = await createPdf('Workshop attendance');
  const page = pdf.addPage([612, 792]);
  pdf.registerFontkit(fontkit);
  const fontBytes = await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url));
  // Keep the complete font to preserve visible glyphs in PDF.js and PyMuPDF.
  const sans = await pdf.embedFont(fontBytes);

  page.drawRectangle({ x: 64, y: 713, width: 484, height: 4, color: forest });
  page.drawText('FIELDWORK  /  WORKSHOP RECORD', { x: 64, y: 687, size: 9, color: forest, font: sans });
  page.drawText('Synthetic Sample', { x: 458, y: 687, size: 10, color: forest, font: sans });
  page.drawText('Workshop attendance', { x: 64, y: 624, size: 40, color: ink, font: sans });
  page.drawText('Participant details and session notes', { x: 65, y: 602, size: 13, color: muted, font: sans });

  const form = pdf.getForm();
  const fields = [
    { name: 'Name', label: 'PARTICIPANT NAME', rect: [64, 536, 484, 40], value: 'Sample participant' },
    { name: 'ID', label: 'REGISTRATION ID', rect: [64, 436, 218, 36], value: '00000' },
    { name: 'Title', label: 'ROLE OR TITLE', rect: [310, 436, 238, 36], value: 'Workshop participant' },
    { name: 'Notes', label: 'SESSION NOTES', rect: [64, 280, 484, 102], value: 'Check-in and session notes.\nWorkshop sample copy.' },
    { name: 'Sentinel', label: 'TEMPLATE REFERENCE', rect: [64, 172, 250, 34], value: 'KEEP 00109' },
  ];
  for (const { name, label, rect, value } of fields) {
    const [x, y, , height] = rect;
    page.drawText(label, { x, y: y + height + 8, size: 9, color: forest, font: sans });
    const field = form.createTextField(name);
    if (name === 'Notes') field.enableMultiline();
    addWidget(field, page, rect, sans);
    field.setFontSize(12);
    field.setText(value);
  }
  page.drawText('Keep the registration ID as printed on the roster.', { x: 64, y: 419, size: 9, color: muted, font: sans });
  page.drawText('Record access needs, materials or follow-up.', { x: 64, y: 263, size: 9, color: muted, font: sans });
  page.drawLine({ start: { x: 64, y: 112 }, end: { x: 548, y: 112 }, thickness: 0.6, color: rule });
  page.drawText('SAMPLE WORKSHOP SERIES', { x: 64, y: 93, size: 8, color: forest, font: sans });
  page.drawText('ATTENDANCE COPY', { x: 462, y: 93, size: 8, color: forest, font: sans });

  form.updateFieldAppearances(sans);
  return pdf.save({ updateFieldAppearances: false });
}

async function edgeCases() {
  const pdf = await createPdf('AcroForm geometry cases');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();
  const pages = [0, 90, 180, 270].map((angle) => {
    const page = pdf.addPage([420, 540]);
    page.setRotation(degrees(angle));
    page.drawText(`Synthetic Sample / Page rotation ${angle}`, { x: 28, y: 506, font, size: 14 });
    return page;
  });

  const cases = [
    { name: 'Repeated', value: 'ORIGINAL', widgets: [[0, 28, 442, 200, 28], [1, 28, 442, 104, 25], [2, 28, 442, 124, 25], [3, 28, 442, 110, 24]] },
    { name: 'AtomicRepeat', value: 'ID', widgets: [[0, 28, 370, 180, 26], [3, 28, 370, 19, 24]] },
    { name: 'Multiline', widgets: [[1, 28, 282, 154, 76]] },
    { name: 'Too Narrow', widgets: [[0, 28, 300, 9, 24]] },
    { name: 'Too Low', widgets: [[0, 28, 241, 110, 5]] },
    { name: 'Exceeds MaxLen', maxLength: 4, widgets: [[0, 28, 172, 140, 26]] },
    { name: 'Widget Rotate', widgets: [[2, 50, 280, 122, 28, 90]] },
  ];
  for (const { name, widgets, value, maxLength } of cases) {
    const field = form.createTextField(name);
    if (name === 'Multiline') field.enableMultiline();
    if (maxLength) field.setMaxLength(maxLength);
    for (const [index, x, y, width, height, widgetRotation = 0] of widgets) {
      const page = pages[index];
      // pdf-lib rotates a 90-degree widget around the supplied origin.
      const rect = widgetRotation ? [x + width, y, height, width] : [x, y, width, height];
      addWidget(field, page, rect, font, 0, widgetRotation);
      page.drawText(name, { x, y: y + height + 8, font, size: 10 });
    }
    field.setFontSize(12);
    if (value) field.setText(value);
  }
  form.updateFieldAppearances(font);
  return pdf.save({ updateFieldAppearances: false });
}

async function intakeGuard(kind) {
  const pdf = await createPdf(`${kind} intake guard`);
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(`Synthetic Sample / ${kind} intake guard`, { x: 60, y: 695, font, size: 18 });
  if (kind === 'Flat') return pdf.save();

  const form = pdf.getForm();
  const field = form.createTextField('Name');
  addWidget(field, page, [60, 622, 240, 32], font);
  if (kind === 'XFA') {
    const packet = pdf.context.flateStream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>');
    form.acroForm.dict.set(PDFName.of('XFA'), pdf.context.register(packet));
  } else {
    const signature = pdf.context.register(pdf.context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 0, 0, 0],
      Contents: PDFHexString.of('00'),
    }));
    const signatureField = pdf.context.register(pdf.context.obj({
      FT: 'Sig',
      T: PDFHexString.fromText('Signature'),
      V: signature,
    }));
    form.acroForm.addField(signatureField);
    form.acroForm.dict.set(PDFName.of('SigFlags'), pdf.context.obj(3));
  }
  return pdf.save({ updateFieldAppearances: false, useObjectStreams: false });
}

function encryptedPdf() {
  // Fixed test vector for the PDF Standard Security Handler, V=1 / R=2.
  // Object 5 decrypts to a synthetic page heading with user password "synthetic".
  const id = 'c764d3d87c3574e2cc30b8b017ea167b';
  const owner = '110b9f994ede50b83f125e424bf25fa3a226dd85f2f0dd2ed20075183e3a2c9f';
  const user = '4e2e3a581ffa00f9207e741d0c4eb524602333a0f3e360f888b38aaed9eb3d61';
  const content = Buffer.from('b0df7743b14840c2b1610dc9b90f386c93b66308b9d82f5b9269e45c1b6c9f10765c6ae1717bd368f8babff9ae9057d6', 'hex');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content.toString('latin1')}\nendstream`,
    `<< /Filter /Standard /V 1 /R 2 /P -4 /O <${owner}> /U <${user}> >>`,
  ];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const xref = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    xref.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n${xref.join('')}trailer\n<< /Size ${count} /Root 1 0 R /Encrypt 6 0 R /ID [<${id}><${id}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function csv(rows) {
  return '\uFEFF' + rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}

const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentTypePrefix = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

function worksheet(rows) {
  const data = rows.map((row, index) => {
    const number = index + 1;
    const columns = row.map((value, column) => {
      const reference = `${String.fromCharCode(65 + column)}${number}`;
      if (typeof value === 'object') {
        if ('formula' in value) {
          const cached = value.cached === undefined ? '' : `<v>${value.cached}</v>`;
          return `<c r="${reference}" t="b"><f>${value.formula}</f>${cached}</c>`;
        }
        const style = value.scientific ? ' s="1"' : '';
        return `<c r="${reference}"${style}><v>${value.number}</v></c>`;
      }
      const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '&#10;');
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
    }).join('');
    return `<row r="${number}">${columns}</row>`;
  }).join('');
  return `<worksheet xmlns="${spreadsheetNs}"><sheetData>${data}</sheetData></worksheet>`;
}

function workbook(rows) {
  const archive = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="${contentTypePrefix}.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="${contentTypePrefix}.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="${contentTypePrefix}.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="${contentTypePrefix}.styles+xml"/>
    </Types>`,
    '_rels/.rels': `<Relationships xmlns="${packageNs}"><Relationship Id="rId1" Type="${relationshipsNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${spreadsheetNs}" xmlns:r="${relationshipsNs}"><sheets>
      <sheet name="Roster" sheetId="1" r:id="rId1"/><sheet name="Numeric IDs" sheetId="2" r:id="rId2"/>
    </sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageNs}">
      <Relationship Id="rId1" Type="${relationshipsNs}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${relationshipsNs}/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="${relationshipsNs}/styles" Target="styles.xml"/>
    </Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${spreadsheetNs}">
      <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00000E+00"/></numFmts>
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
      <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`,
    'xl/worksheets/sheet1.xml': worksheet(rows),
    'xl/worksheets/sheet2.xml': worksheet([
      headings,
      ['ليلى حسن', '00123', 'Text cell', 'Synthetic Sample. Preserve all five characters.'],
      ['أحمد سالم', { number: '7' }, 'Numeric cell', 'Leading zeros were lost before import.'],
      ['يُسْرَى مُؤْمِن', { number: '1.23457E+11', scientific: true }, 'Scientific number cell', 'Check the original ID before use.'],
      ['بَنِي يَمَن', '1.23457E+11', 'Scientific text cell', 'Scientific notation stored as literal text.'],
    ]),
  };

  const files = Object.fromEntries(Object.entries(archive).map(([name, contents]) => [name, strToU8(`<?xml version="1.0" encoding="UTF-8"?>\n${contents}`)]));
  // fflate uses local date fields for DOS timestamps.
  return zipSync(files, { mtime: new Date(2020, 0, 1, 0, 0, 0), level: 6 });
}

const m2Specifications = {
  'hr-onboarding.pdf': { title: 'HR onboarding', size: [420, 500], fields: [
    { name: 'Name', widgets: [[42, 349, 336, 38]], required: true },
    { name: 'Employee ID', widgets: [[42, 263, 125, 28]], maxLength: 9 },
    { name: 'Start Date', widgets: [[195, 263, 182, 28]], alignment: 1 },
  ] },
  'clinic-intake.pdf': { title: 'Clinic intake', size: [435, 555], fields: [
    { name: 'Patient', widgets: [[42, 408, 350, 32]] },
    { name: 'Phone', widgets: [[42, 336, 240, 25]], alignment: 0 },
    { name: 'Intake Notes', widgets: [[42, 170, 350, 104]], multiline: true },
  ] },
  'bilingual-certificate.pdf': { title: 'Training certificate', arabicTitle: 'شَهَادَةُ التَّدْرِيبِ', size: [530, 375], fields: [
    { name: 'Name', widgets: [[52, 216, 426, 35]], alignment: 1 },
    { name: 'Course Title', widgets: [[52, 138, 426, 30]], alignment: 1 },
    { name: 'Record Number', widgets: [[315, 56, 163, 22]], alignment: 2 },
  ] },
  'landscape-badge.pdf': { title: 'Landscape visitor badge', size: [300, 420], rotations: [90], fields: [
    { name: 'Name', widgets: [[147, 111, 25, 92, 0, 90]], required: true },
    { name: 'Badge ID', widgets: [[198, 111, 22, 118, 0, 90]] },
  ] },
  'access-code.pdf': { title: 'Access code request', size: [360, 430], fields: [
    { name: 'Officer', widgets: [[45, 276, 265, 29]] },
    { name: 'Printed Code', widgets: [[45, 191, 68, 24]], maxLength: 4 },
    { name: 'Comb Code', widgets: [[175, 191, 135, 24]], maxLength: 4, comb: true },
  ] },
  'dispatch-header.pdf': { title: 'Dispatch packet', size: [425, 490], rotations: [0, 270, 180], fields: [
    { name: 'Header', widgets: [[42, 351, 334, 36], [167, 95, 26, 132, 1, 270], [82, 265, 175, 28, 2, 180]] },
    { name: 'Consignment', widgets: [[42, 266, 160, 26]] },
  ] },
  'mailing-address.pdf': { title: 'Mailing address', size: [380, 450], fields: [
    { name: 'Recipient', widgets: [[42, 311, 292, 29]] },
    { name: 'Address', widgets: [[42, 139, 180, 110]], multiline: true },
    { name: 'Postal Code', widgets: [[247, 198, 85, 27]], maxLength: 9 },
  ] },
  'remittance-slip.pdf': { title: 'Remittance slip', size: [480, 412], fields: [
    { name: 'Beneficiary', widgets: [[45, 268, 385, 30]], alignment: 2 },
    { name: 'Reference', widgets: [[45, 179, 223, 27]] },
    { name: 'Amount', widgets: [[296, 179, 134, 27]], alignment: 2 },
  ] },
};

async function m2Template({ title, size, fields, rotations = [0], arabicTitle }) {
  const pdf = await createPdf(title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const label = (page, text, x, y, options = {}) => page.drawText(text, { x, y, font, size: 9, color: forest, ...options });
  const pages = rotations.map((rotation, index) => {
    const page = pdf.addPage(size);
    page.setRotation(degrees(rotation));
    const [x, y] = rotation === 90 ? [76, 40] : rotation === 270 ? [size[0] - 76, size[1] - 40]
      : rotation === 180 ? [size[0] - 42, 76] : [42, size[1] - 76];
    label(page, title, x, y, { font: heading, size: 25, rotate: degrees(rotation), color: ink });
    const [dx, dy] = rotation === 90 ? [21, 0] : rotation === 270 ? [-21, 0] : rotation === 180 ? [0, 21] : [0, -21];
    label(page, `Synthetic Sample / ${index + 1} of ${rotations.length}`, x + dx, y + dy, { rotate: degrees(rotation) });
    return page;
  });
  if (arabicTitle) {
    pdf.registerFontkit(fontkit);
    const arabicFont = await pdf.embedFont(await readFile(new URL('../public/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url)));
    label(pages[0], arabicTitle, 350, size[1] - 75, { font: arabicFont, size: 24, color: ink });
  }

  const rotatedBadge = rotations[0] === 90;
  const sentinel = rotatedBadge ? [251, 111, 25, 121, 0, 90] : [42, 42, 150, 25];
  for (const config of [...fields, { name: 'Sentinel', widgets: [sentinel] }]) {
    const field = form.createTextField(config.name);
    if (config.required) field.enableRequired();
    if (config.multiline) field.enableMultiline();
    if (config.maxLength) field.setMaxLength(config.maxLength);
    if (config.comb) field.enableCombing();
    if (config.alignment !== undefined) field.setAlignment(config.alignment);
    for (const [x, y, width, height, index = 0, angle = 0] of config.widgets) {
      const page = pages[index];
      const rect = angle === 90 ? [x + width, y, height, width] : angle === 180 ? [x + width, y + height, width, height]
        : angle === 270 ? [x, y + height, height, width] : [x, y, width, height];
      addWidget(field, page, rect, font, 1, angle);
      const [labelX, labelY] = angle === 90 ? [x - 8, y] : angle === 180 ? [x + width, y - 8] : angle === 270 ? [x + width + 8, y + height] : [x, y + height + 7];
      label(page, config.name === 'Sentinel' ? 'TEMPLATE REFERENCE' : config.name.toUpperCase(), labelX, labelY, { rotate: degrees(angle) });
    }
    field.setFontSize(12);
    if (config.name === 'Sentinel') field.setText('KEEP 00109');
  }
  form.updateFieldAppearances(font);
  return pdf.save({ updateFieldAppearances: false });
}

const args = process.argv.slice(2);
async function clinicConsent() {
  const pdf = await createPdf('Clinic consent');
  const page = pdf.addPage([510, 465]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const label = (text, x, y) => page.drawText(text, { x, y, size: 10, color: forest, font });
  page.drawText('Clinic consent', { x: 38, y: 400, size: 30, color: ink, font: heading });
  label('Synthetic Sample / Mixed AcroForm', 38, 380);
  page.drawLine({ start: { x: 38, y: 365 }, end: { x: 472, y: 365 }, thickness: 1, color: rule });
  for (const [name, title, rect] of [
    ['Name', 'PATIENT NAME', [38, 308, 434, 31]],
    ['ID', 'REGISTRATION ID', [38, 246, 188, 28]],
    ['Sentinel', 'TEMPLATE REFERENCE', [38, 48, 188, 29]],
  ]) {
    const field = form.createTextField(name);
    addWidget(field, page, rect, font);
    label(title, rect[0], rect[1] + rect[3] + 7);
    field.setFontSize(12);
    if (name === 'Sentinel') field.setText('KEEP 00109');
  }
  const checkboxOptions = { width: 17, height: 17, borderWidth: 0.7, borderColor: rule, backgroundColor: fill, textColor: ink };
  const consent = form.createCheckBox('Consent');
  consent.addToPage(page, { ...checkboxOptions, x: 39, y: 200 });
  label('Patient consent', 65, 205);
  consent.addToPage(page, { ...checkboxOptions, x: 240, y: 200 });
  label('Patient consent (copy)', 266, 205);
  const verified = form.createCheckBox('Verified');
  verified.addToPage(page, { ...checkboxOptions, x: 39, y: 160 });
  verified.check();
  label('Intake verified', 65, 165);
  const contact = form.createRadioGroup('Contact');
  contact.addOptionToPage('Email', page, { ...checkboxOptions, x: 39, y: 119 });
  contact.addOptionToPage('Phone', page, { ...checkboxOptions, x: 121, y: 119 });
  contact.select('Phone');
  label('Email', 65, 124);
  label('Phone', 148, 124);
  const clinic = form.createDropdown('Clinic');
  clinic.addOptions(['North clinic', 'South clinic']);
  clinic.select('North clinic');
  clinic.addToPage(page, { x: 240, y: 116, width: 200, height: 26, font, borderColor: rule, backgroundColor: fill });
  label('CLINIC', 240, 149);
  form.updateFieldAppearances(font);
  return pdf.save({ updateFieldAppearances: false });
}

async function multiPageChoices() {
  const pdf = await createPdf('HR onboarding and clinic assignment');
  const employeePage = pdf.addPage([510, 465]);
  const clinicPage = pdf.addPage([510, 465]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const heading = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.registerFontkit(fontkit);
  const arabic = await pdf.embedFont(await readFile(new URL('../public/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url)));
  const form = pdf.getForm();
  for (const [page, title, translation, index] of [
    [employeePage, 'HR onboarding', 'تَسْجِيلُ الْمُوَظَّفِ', 1],
    [clinicPage, 'Clinic assignment', 'تَحْدِيدُ الْعِيَادَةِ', 2],
  ]) {
    page.drawText(title, { x: 38, y: 399, size: 25, color: ink, font: heading });
    page.drawText(translation, { x: 339, y: 399, size: 23, color: ink, font: arabic });
    page.drawText(`Synthetic Sample / ${index} of 2`, { x: 38, y: 376, size: 10, color: forest, font });
    page.drawLine({ start: { x: 38, y: 364 }, end: { x: 472, y: 364 }, thickness: 1, color: rule });
  }
  const label = (page, text, x, y) => page.drawText(text, { x, y, size: 10, color: forest, font });
  const employee = form.createTextField('Employee');
  employee.enableRequired();
  for (const page of [employeePage, clinicPage]) {
    label(page, 'EMPLOYEE NAME', 38, 334);
    addWidget(employee, page, [38, 294, 434, 32], font);
  }
  employee.setFontSize(12);
  const button = { width: 17, height: 17, borderWidth: 0.7, borderColor: rule, backgroundColor: fill, textColor: ink };
  form.createCheckBox('Acknowledged').addToPage(employeePage, { ...button, x: 39, y: 253 });
  label(employeePage, 'Policy acknowledged', 64, 258);

  const radio = (name, title, y) => {
    const group = form.createRadioGroup(name);
    label(employeePage, title, 38, y + 28);
    for (const [index, text] of ['Phone', 'Email'].entries()) {
      const x = 39 + 94 * index;
      group.addOptionToPage(String(index), employeePage, { ...button, x, y });
      label(employeePage, text, x + 25, y + 5);
    }
    group.select('1');
    return group;
  };
  const contact = radio('Contact', 'CONTACT METHOD', 191);
  radio('PreservedContact', 'EXISTING CONTACT METHOD', 118).enableReadOnly();

  const combo = (name, title, y) => {
    const dropdown = form.createDropdown(name);
    dropdown.addOptions(['Jeddah Clinic', 'TEMPLATE CLINIC']);
    dropdown.select(name === 'Clinic' ? 'Jeddah Clinic' : 'TEMPLATE CLINIC');
    dropdown.addToPage(clinicPage, { x: 38, y, width: 251, height: 30, font, borderColor: rule, backgroundColor: fill });
    label(clinicPage, title, 38, y + 37);
    return dropdown;
  };
  const clinic = combo('Clinic', 'ASSIGNED CLINIC', 214);
  combo('PreservedClinic', 'EXISTING CLINIC', 131).enableReadOnly();
  const sentinel = form.createTextField('Sentinel');
  addWidget(sentinel, clinicPage, [38, 49, 188, 27], font);
  sentinel.setText('KEEP 00109');
  label(clinicPage, 'TEMPLATE REFERENCE', 38, 83);
  form.updateFieldAppearances(font);
  // Keep the Latin default appearance that was painted above, while using
  // distinct export values and an actual Arabic label in the dropdown.
  clinic.acroField.dict.set(PDFName.of('Opt'), pdf.context.obj([
    [PDFString.of('RIY'), PDFHexString.fromText('عِيَادَةُ الرِّيَاضِ')],
    [PDFString.of('JED'), PDFString.of('Jeddah Clinic')],
  ]));
  clinic.acroField.dict.set(PDFName.of('V'), PDFString.of('JED'));
  contact.acroField.dict.set(PDFName.of('Opt'), pdf.context.obj([PDFString.of('CALL'), PDFString.of('MAIL')]));
  return pdf.save({ updateFieldAppearances: false });
}

if (args.length && (args.length !== 1 || args[0] !== '--check')) {
  throw new Error('Usage: node scripts/generate-fixtures.mjs [--check]');
}
const check = args[0] === '--check';
const rows = [headings, ...roster];
const consentRows = [
  ['Name', 'ID', 'Consent'],
  ['ليلى حسن', '00001', 'نعم'],
  ['أحمد سالم', '00002', 'لا'],
  ['سَلْمَى بِنْت يَاسِين', 'AR-00042', 'review'],
];
const choiceRows = [
  ['Employee', 'Acknowledged', 'Clinic', 'Contact'],
  ['سَلْمَى بِنْتُ يَاسِين', 'نعم', 'Unknown Clinic', 'CALL'],
  ['مُحَمَّد 00123', 'false', 'RIY', 'MAIL'],
  ['Layla 00007', 'yes', 'Jeddah Clinic', ' CALL '],
];
const fixtures = {
  'golden/template.pdf': await attendanceTemplate(),
  'golden/roster.csv': csv(rows),
  'golden/roster.xlsx': workbook(rows),
  'golden/edge-cases.pdf': await edgeCases(),
  'golden/xfa.pdf': await intakeGuard('XFA'),
  'golden/flat.pdf': await intakeGuard('Flat'),
  'golden/encrypted.pdf': encryptedPdf(),
  'golden/signed.pdf': await intakeGuard('Signed'),
  'm2/badge-roster.csv': csv([['Name', 'Badge ID'], ['سَلْمَى بِنْت يَاسِين / AR-00042', '00007']]),
  ...Object.fromEntries(await Promise.all(Object.entries(m2Specifications).map(async ([name, spec]) => [`m2/${name}`, await m2Template(spec)]))),
  'm3/clinic-consent-mixed.pdf': await clinicConsent(),
  'm3/clinic-consent-roster.csv': csv(consentRows),
  'm3/clinic-consent-formulas.xlsx': workbook([
    consentRows[0], [consentRows[1][0], consentRows[1][1], { formula: '1=1', cached: '1' }],
    [consentRows[2][0], consentRows[2][1], { formula: '1=1' }],
  ]),
  'm4/multi-page-hr-choices.pdf': await multiPageChoices(),
  'm4/multi-page-hr-choices.csv': csv(choiceRows),
  'm4/multi-page-hr-choices.xlsx': workbook(choiceRows),
};

if (!check) await Promise.all(['golden', 'm2', 'm3', 'm4'].map((folder) => mkdir(join(output, folder), { recursive: true })));
for (const [name, bytes] of Object.entries(fixtures)) {
  const file = join(output, name);
  if (check) {
    if (!Buffer.from(bytes).equals(await readFile(file))) throw new Error(`Fixture differs: ${name}`);
  } else {
    await writeFile(file, bytes);
  }
}
console.log(`${check ? 'Verified' : 'Generated'} ${Object.keys(fixtures).length} synthetic fixtures.`);
