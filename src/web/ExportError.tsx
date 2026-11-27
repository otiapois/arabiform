import type { translator } from './labels';
import { sourceProblem } from './source-problems';

const problems: Record<string, readonly [string, string]> = {
  'unflattenable-widget': ['A field has no saved appearance for printing. Use an editable ZIP or choose a template with saved field appearances.', 'لا يحتوي أحد الحقول على مظهر محفوظ للطباعة. نزّل ملف ZIP دون تسطيح أو اختر قالبًا يحتوي على مظاهر محفوظة لحقوله.'],
  'cover-sheet-invalid-metadata': ['The cover sheet could not match the current batch. Run preflight again or turn off the cover sheet.', 'تعذّرت مطابقة صفحة الغلاف مع الدفعة الحالية. أعد فحص الدفعة أو ألغِ إدراج صفحة الغلاف.'],
  'cover-sheet-unsupported-text': ['A filename contains characters the cover sheet cannot print. Use an Arabic or Latin filename for the template or affected row, or turn off the cover sheet.', 'يتضمن اسم أحد الملفات أحرفًا يتعذّر طباعتها في صفحة الغلاف. استخدم اسمًا بأحرف عربية أو لاتينية للقالب أو للصف المعني، أو ألغِ إدراج صفحة الغلاف.'],
  'cover-sheet-layout-overflow': ['A filename will not fit on the cover sheet. Shorten the filename or turn off the cover sheet.', 'اسم أحد الملفات أطول من المساحة المتاحة في صفحة الغلاف. اختصر الاسم أو ألغِ إدراج صفحة الغلاف.'],
  'cover-sheet-export-failed': ['The cover sheet could not be prepared. Try again or turn off the cover sheet.', 'تعذّر تجهيز صفحة الغلاف. حاول مجددًا أو ألغِ إدراج صفحة الغلاف.'],
  'invalid-watermark': ['Check the print watermark settings and try again.', 'راجع إعدادات العلامة المائية للطباعة وحاول مجددًا.'],
  'watermark-missing-glyph': ['The print fonts cannot render this watermark. Choose a preset or enter different text.', 'يتعذّر على خطوط الطباعة عرض هذه العلامة المائية. اختر علامة جاهزة أو أدخل نصًا آخر.'],
  'watermark-does-not-fit': ['The watermark does not fit on a record page. Use shorter text or a different angle.', 'لا تتسع إحدى صفحات السجلات للعلامة المائية. استخدم نصًا أقصر أو زاوية أخرى.'],
  'qr-stamp-invalid-settings': ['Enter a QR pattern to print or save these settings.', 'أدخل نمط رمز QR للطباعة أو لحفظ الإعدادات.'],
  'qr-stamp-invalid-payload': ['Check the QR pattern and the characters in the row.', 'تحقّق من نمط رمز QR ومن الأحرف في الصف.'],
  'qr-stamp-unknown-token': ['The QR pattern references an unknown column or computed token.', 'يتضمن نمط رمز QR عمودًا أو قيمة محسوبة غير معروفة.'],
  'qr-stamp-empty-payload': ['This row gives an empty QR code. Check its values or change the pattern.', 'يعطي هذا الصف رمز QR فارغًا. تحقّق من القيم أو غيّر النمط.'],
  'qr-stamp-payload-too-long': ['This row exceeds the QR byte limit. Use a shorter value or pattern.', 'تجاوز هذا الصف الحد الأقصى لبايتات رمز QR. استخدم قيمة أو نمطًا أقصر.'],
  'qr-stamp-does-not-fit': ['The QR stamp will not fit inside a record page’s print margin. Use a smaller size or turn off the stamp.', 'لا يتسع هامش الطباعة في إحدى صفحات السجلات لرمز QR. قلّل الحجم أو أوقف طباعة الرمز.'],
  'qr-stamp-widget-overlap': ['The QR stamp overlaps a form field. Choose another corner or use a smaller size.', 'يتداخل رمز QR مع حقل في النموذج. اختر زاوية أخرى أو قلّل الحجم.'],
  'approval-seal-widget-overlap': ['The seal overlaps a PDF field. Choose another corner.', 'يتداخل الختم مع حقل في ملف PDF. اختر زاوية أخرى.'],
  'approval-seal-qr-overlap': ['The seal overlaps the print QR stamp. Move either mark to another corner.', 'يتداخل الختم مع رمز QR للطباعة. انقل أحدهما إلى زاوية أخرى.'],
  'approval-seal-page-too-small': ['The seal does not fit on a record page. Clear it to print.', 'مساحة إحدى صفحات السجل لا تكفي للختم. امسح الختم للمتابعة إلى الطباعة.'],
  'approval-seal-text-unrenderable': ['The print fonts cannot draw the seal label. Edit the labels to print.', 'يتعذّر على خطوط الطباعة عرض نص الختم. عدّل الاسمين للمتابعة إلى الطباعة.'],
  'approval-seal-invalid-settings': ['The seal settings could not be used. Review the labels, date and corner.', 'تعذّر استخدام إعدادات الختم. راجع الاسمين والتاريخ والزاوية.'],
  'imposition-requires-single-page': ['2-up requires a single-page template. Choose 1-up for this template.', 'يتطلب وضع السجلين قالبًا من صفحة واحدة. اختر التخطيط القياسي لهذا القالب.'],
  'imposition-invalid-page-geometry': ['This page size or rotation cannot be used with 2-up. Choose 1-up for this template.', 'لا يدعم وضع السجلين حجم هذه الصفحة أو تدويرها. اختر التخطيط القياسي لهذا القالب.'],
  'imposition-unsupported-print-annotation': ['Use 1-up to retain the printable annotation in this template.', 'اختر التخطيط القياسي للاحتفاظ بالتعليق التوضيحي القابل للطباعة في هذا القالب.'],
  'invalid-imposition': ['Choose a valid merged PDF sheet layout.', 'اختر تخطيطًا صالحًا للأوراق في ملف PDF المدمج.'],
  'invalid-grouping-column': ['Choose a grouping column from the active roster and try again.', 'اختر عمودًا للتجميع من الجدول الحالي وحاول مجددًا.'],
};

export function printProblem(code: string, arabic: boolean) {
  return problems[code]?.[arabic ? 1 : 0];
}

export default function ExportError({ error, language }: {
  error: { code: string; rowNumber?: number };
  language: ReturnType<typeof translator>;
}) {
  const { arabic } = language;
  return <p className="alert" role="alert" data-testid="export-error">
    {error.rowNumber !== undefined && <>{arabic ? 'الصف' : 'Row'} {error.rowNumber}.{' '}</>}
    {printProblem(error.code, arabic) ?? sourceProblem(error.code, arabic)
      ?? (arabic ? 'تعذّر تجهيز التنزيل. حاول مجددًا.' : 'The download could not be prepared. Try again.')}
  </p>;
}
