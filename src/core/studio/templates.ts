import { PDFDocument, PDFOperator, PDFOperatorNames as Op, rgb } from 'pdf-lib';
import { authorFlatPdf, type FieldDraftSpec } from '../designer/author';
import { appendPositionedText } from '../pdf/appearances';
import { copyBundledFont } from '../pdf/bundled-fonts';
import { createShaper, textInputDiagnostic, type FontBytes } from '../pdf/shaping';
import { key, number } from '../pdf/template';

export const STUDIO_TEMPLATE_IDS = ['certificate-bilingual', 'hr-letter-bilingual', 'clinic-consent-bilingual', 'visitor-badge-a6'] as const;
export const STUDIO_ACCENT_PALETTES = ['forest', 'navy', 'burgundy', 'slate'] as const;
export const STUDIO_HEADER_LANGUAGES = ['bilingual', 'ar', 'en'] as const;

export type StudioTemplateId = typeof STUDIO_TEMPLATE_IDS[number];
export type StudioAccentPalette = typeof STUDIO_ACCENT_PALETTES[number];
export type StudioHeaderLanguage = typeof STUDIO_HEADER_LANGUAGES[number];
export type StudioCustomization = {
  organizationName?: string;
  documentSubtitle?: string;
  accentPalette?: StudioAccentPalette;
  headerLanguage?: StudioHeaderLanguage;
};

type Labels = readonly [en: string, ar: string];
type Field = { name: string; label: Labels } & (
  { kind: 'text' | 'checkbox' } |
  { kind: 'dropdown'; options: readonly string[] } |
  { kind: 'radio'; options: readonly { value: string; label: Labels }[] }
);

interface StarterTemplate {
  size: [width: number, height: number];
  title: Labels;
  introduction: Labels;
  rows: readonly (readonly Field[])[];
  sampleRows: readonly (readonly string[])[];
}

const a4: [number, number] = [595.28, 841.89];
const templates: Record<StudioTemplateId, StarterTemplate> = {
  'certificate-bilingual': {
    size: [a4[1], a4[0]],
    title: ['Certificate of Completion', 'شهادة إتمام'],
    introduction: ['This certificate recognizes successful completion of the course below.', 'تُمنح هذه الشهادة تقديرًا لإتمام الدورة الموضحة أدناه.'],
    rows: [
      [{ name: 'RecipientName', kind: 'text', label: ['Recipient name', 'اسم المستفيد'] }],
      [{ name: 'CourseTitle', kind: 'text', label: ['Course title', 'اسم الدورة'] }],
      [{ name: 'IssueDate', kind: 'text', label: ['Issue date', 'تاريخ الإصدار'] },
        { name: 'CertificateID', kind: 'text', label: ['Certificate ID', 'رقم الشهادة'] }],
      [{ name: 'HonorsCheck', kind: 'checkbox', label: ['Completed with honors', 'أتمّ الدورة بامتياز'] }],
    ],
    sampleRows: [
      ['مَرْيَمُ بِنْتُ يَاسِين', 'إِدَارَةُ المَشَارِيع', '2026-11-27', '00123', 'yes'],
      ['Alex Taylor', 'Project Management', '2026-11-28', '00007', 'no'],
    ],
  },
  'hr-letter-bilingual': {
    size: a4,
    title: ['Employment Verification', 'إفادة عمل'],
    introduction: ['This letter confirms the employment details shown below.', 'تؤكد هذه الإفادة بيانات العمل المبينة أدناه.'],
    rows: [
      [{ name: 'EmployeeName', kind: 'text', label: ['Employee name', 'اسم الموظف'] }],
      [{ name: 'EmployeeID', kind: 'text', label: ['Employee ID', 'الرقم الوظيفي'] },
        { name: 'JobTitle', kind: 'text', label: ['Job title', 'المسمى الوظيفي'] }],
      [{ name: 'Department', kind: 'text', label: ['Department', 'القسم'] },
        { name: 'StartDate', kind: 'text', label: ['Start date', 'تاريخ بدء العمل'] }],
      [{ name: 'ActiveStatus', kind: 'checkbox', label: ['Currently employed', 'على رأس العمل'] }],
    ],
    sampleRows: [
      ['سَلْمَى بِنْتُ يَاسِين', '00123', 'مُدِيرَةُ المَشَارِيع', 'الْعَمَلِيَّات', '2021-03-15', 'yes'],
      ['Alex Taylor', '00007', 'Operations Coordinator', 'Operations', '2024-08-12', 'no'],
    ],
  },
  'clinic-consent-bilingual': {
    size: a4,
    title: ['Patient Consent Form', 'نموذج موافقة المريض'],
    introduction: ['I consent to the care discussed with my clinician.', 'أوافق على الرعاية التي ناقشتها مع مقدم الرعاية.'],
    rows: [
      [{ name: 'PatientName', kind: 'text', label: ['Patient name', 'اسم المريض'] }],
      [{ name: 'NationalID', kind: 'text', label: ['National ID', 'رقم الهوية'] }],
      [{ name: 'ClinicBranch', kind: 'dropdown', label: ['Clinic branch', 'فرع العيادة'], options: ['Central / المركز', 'North / الشمال', 'South / الجنوب'] }],
      [{ name: 'ConsentCheck', kind: 'checkbox', label: ['I consent', 'أوافق'] }],
      [{ name: 'ContactPreference', kind: 'radio', label: ['Preferred contact', 'طريقة التواصل المفضلة'], options: [
        { value: 'Phone', label: ['Phone', 'الهاتف'] },
        { value: 'Email', label: ['Email', 'البريد الإلكتروني'] },
        { value: 'SMS', label: ['SMS', 'رسالة نصية'] },
      ] }],
    ],
    sampleRows: [
      ['مُحَمَّدٌ بْنُ سَالِم', '00123', 'Central / المركز', 'yes', 'SMS'],
      ['Alex Taylor', '00007', 'North / الشمال', 'no', 'Email'],
    ],
  },
  'visitor-badge-a6': {
    size: [419.53, 297.64],
    title: ['Visitor Badge', 'بطاقة زائر'],
    introduction: ['', ''],
    rows: [
      [{ name: 'VisitorName', kind: 'text', label: ['Visitor name', 'اسم الزائر'] }],
      [{ name: 'Organization', kind: 'text', label: ['Organization', 'الجهة'] }],
      [{ name: 'BadgeID', kind: 'text', label: ['Badge ID', 'رقم البطاقة'] },
        { name: 'AccessZone', kind: 'dropdown', label: ['Access zone', 'منطقة الدخول'], options: ['Lobby / البهو', 'Meeting / اجتماع', 'Guest / ضيف'] }],
    ],
    sampleRows: [
      ['يُوسُفُ بْنُ عُمَر', 'مَرْكَزُ الأَمَان', '00123', 'Lobby / البهو'],
      ['Alex Taylor', 'Example Studio', '00007', 'Meeting / اجتماع'],
    ],
  },
};

const palette = {
  forest: [0.10, 0.30, 0.23],
  navy: [0.13, 0.25, 0.41],
  burgundy: [0.38, 0.15, 0.23],
  slate: [0.25, 0.30, 0.35],
} satisfies Record<StudioAccentPalette, [number, number, number]>;

function customLine(value: string | undefined): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 160 || /[\r\n\t\p{Zl}\p{Zp}]/u.test(value) || textInputDiagnostic(value)) {
    throw new Error('studio-unsupported-text');
  }
  return value.trim();
}

export async function generateStudioTemplate(id: StudioTemplateId, customization: StudioCustomization, fonts: FontBytes) {
  const { organizationName, documentSubtitle, accentPalette = 'navy', headerLanguage = 'bilingual' } = customization;
  if (!STUDIO_TEMPLATE_IDS.includes(id) || !STUDIO_ACCENT_PALETTES.includes(accentPalette) || !STUDIO_HEADER_LANGUAGES.includes(headerLanguage)) {
    throw new Error('studio-invalid-settings');
  }
  const { size, title, introduction, rows, sampleRows } = templates[id];
  const organization = customLine(organizationName);
  const subtitle = customLine(documentSubtitle);
  const ar = headerLanguage !== 'en';
  const en = headerLanguage !== 'ar';
  const sampleOrganization = en && ar ? 'Sample Organization / مؤسسة نموذجية' : en ? 'Sample Organization' : 'مؤسسة نموذجية';
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(en ? title[0] : title[1]);
  const page = doc.addPage(size);
  const compact = id === 'visitor-badge-a6';
  const landscape = id === 'certificate-bilingual';
  const [width, height] = size;
  // Side gutters leave the entire 72 pt stamp area plus its 9 pt inset free
  // in all four corners, including on the smallest A6 sheet.
  const left = landscape ? 121 : 86;
  const right = width - left;
  const inner = right - left;
  const shaper = createShaper(fonts, 'auto');
  const [arabicRef, latinRef] = await Promise.all([
    copyBundledFont(doc, fonts, 'arabic', 'NotoNaskhArabic-Regular'),
    copyBundledFont(doc, fonts, 'latin', 'NotoSans-Regular'),
  ]);
  const resources = { arabic: { name: 'ArabiFormStudioArabic', ref: arabicRef }, latin: { name: 'ArabiFormStudioLatin', ref: latinRef } };
  for (const { name, ref } of Object.values(resources)) page.node.setFontDictionary(key(name), ref);
  const accent = palette[accentPalette];
  const ink = [0.14, 0.17, 0.20] as const;
  const draw = (text: string, x: number, y: number, box: number, preferred: number, align: 'left' | 'right' | 'center' = 'center',
    direction?: 'ltr' | 'rtl', heading = false) => {
    const line = shaper.line(text, direction);
    if (!line?.painted) throw new Error('studio-unsupported-text');
    const { minX, maxX, minY, maxY } = line.bounds;
    const size = Math.min(preferred, box / (maxX - minX), (preferred + 2) / (maxY - minY));
    if (size < 7) throw new Error('studio-text-does-not-fit');
    const spare = box - (maxX - minX) * size;
    const origin = x - minX * size + (align === 'center' ? spare / 2 : align === 'right' ? spare : 0);
    const baseline = y - (maxY + minY) * size / 2;
    const operators = [PDFOperator.of(Op.PushGraphicsState),
      PDFOperator.of(Op.NonStrokingColorRgb, (heading ? accent : ink).map(number))];
    appendPositionedText(operators, text, [{ line, origin, baseline }], size, (family) => resources[family === 'arabic' ? 'arabic' : 'latin']);
    page.pushOperators(...operators, PDFOperator.of(Op.PopGraphicsState));
  };

  // Whole-point widgets keep their ink raster-equivalent when print exports
  // replace interactive annotations with their vector appearance streams.
  let y = Math.floor(height) - (compact ? 25 : 52);
  page.drawRectangle({ x: left, y: y + (compact ? 12 : 17), width: inner, height: compact ? 2 : 3, color: rgb(...accent) });
  draw(organization || sampleOrganization, left, y, inner, compact ? 12 : 17, 'center', undefined, true);
  y -= compact ? 23 : 42;
  if (en) {
    draw(title[0], left, y, inner, compact ? 24 : 35, 'center', 'ltr', true);
    y -= compact ? 26 : 43;
  }
  if (ar) {
    draw(title[1], left, y, inner, compact ? 23 : 34, 'center', 'rtl', true);
    y -= compact ? 24 : 39;
  }
  if (subtitle) {
    draw(subtitle, left, y, inner, compact ? 10 : 15);
    y -= compact ? 16 : 29;
  }
  if (introduction[0]) {
    if (en) { draw(introduction[0], left, y, inner, 11, 'center', 'ltr'); y -= 20; }
    if (ar) { draw(introduction[1], left, y, inner, 13, 'center', 'rtl'); y -= 20; }
  }
  y -= compact ? 6 : 21;
  const specs: FieldDraftSpec[] = [];
  const labeled = (label: Labels, x: number, baselineCenter: number, box: number, small = compact) => {
    draw(label[0], x, baselineCenter, box * 0.49, small ? 8 : 10, 'left', 'ltr');
    draw(label[1], x + box * 0.51, baselineCenter, box * 0.49, small ? 9 : 12, 'right', 'rtl');
  };
  for (const row of rows) {
    const gap = compact ? 14 : 24;
    const column = Math.floor((inner - (row.length - 1) * gap) / row.length);
    for (const [index, field] of row.entries()) {
      const { name, kind, label } = field;
      const x = left + (column + gap) * index;
      if (kind === 'checkbox') {
        specs.push({ name, kind, pageIndex: 0, rectPdf: [x, y - 9, 18, 18] });
        labeled(label, x + 28, y, column - 28);
      } else if (kind === 'radio') {
        labeled(label, x, y, column);
        const optionWidth = Math.floor(column / field.options.length);
        for (const [position, option] of field.options.entries()) {
          const xOption = x + position * optionWidth;
          specs.push({ name, kind, pageIndex: 0, rectPdf: [xOption, y - 33, 15, 15], exportValue: option.value });
          labeled(option.label, xOption + 20, y - 25, optionWidth - 28, true);
        }
      } else {
        labeled(label, x, y, column);
        const fieldHeight = compact ? 22 : 31;
        const fieldY = y - fieldHeight - (compact ? 8 : 10);
        page.drawRectangle({ x, y: fieldY, width: column, height: fieldHeight,
          borderColor: rgb(...accent), borderWidth: 0.65, color: rgb(1, 1, 1) });
        specs.push({ name, kind, pageIndex: 0, rectPdf: [x + 1, fieldY + 1, column - 2, fieldHeight - 2],
          ...(kind === 'dropdown' && { options: [...field.options] }) });
      }
    }
    y -= compact ? 42 : landscape ? 63 : 76;
  }
  const ruleY = compact ? 19 : 42;
  page.drawLine({ start: { x: left, y: ruleY + 10 }, end: { x: right, y: ruleY + 10 }, thickness: 1, color: rgb(...accent) });
  if (!organization) {
    const sample = en && ar ? 'Synthetic Sample / عينة اصطناعية' : en ? 'Synthetic Sample' : 'عينة اصطناعية';
    draw(sample, left, ruleY - 1, inner, compact ? 8 : 9);
  }

  const headers = rows.flat().map(({ name }) => name);
  const csv = '\uFEFF' + [headers, ...sampleRows].map((row) => row.join(',')).join('\r\n') + '\r\n';
  return {
    pdfBytes: await authorFlatPdf(await doc.save(), specs),
    csv,
    filename: `${id}.pdf`,
    csvFilename: `${id}-synthetic-sample.csv`,
  };
}
