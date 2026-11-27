import type { useWorkbench } from './useWorkbench';

type Desk = ReturnType<typeof useWorkbench>;

export default function CustomFontFeedback({ desk, customFont, arabic }: {
  desk: Desk;
  customFont: Exclude<NonNullable<Desk['customFont']>, { status: 'loading' }>;
  arabic: boolean;
}) {
  if (customFont.status === 'invalid') {
    const { maxMiB } = customFont;
    const message = maxMiB === undefined
      ? arabic ? 'تعذّرت قراءة الخط المخصص. اختر ملف ‎.ttf أو ‎.otf صالحًا، أو أزل الخط المخصص.'
        : 'This custom font could not be read. Choose a valid .ttf or .otf file, or clear the font.'
      : arabic ? `اختر ملف خط لا يتجاوز ${maxMiB} ميبي بايت، أو أزل الخط المخصص.`
        : `Choose a font file of ${maxMiB} MiB or smaller, or clear the custom font.`;
    return <p className="alert" role="alert" data-testid="custom-font-error">{message}</p>;
  }
  const textMapped = Object.keys(desk.virtualMappings).length > 0
    || desk.fields.some(({ kind, name }) => (kind === 'text' || kind === 'dropdown') && desk.mapping[name]);
  const missingGlyphs = desk.results?.some((result) => result.diagnostics.some(({ code }) => code === 'missing-glyphs'));
  const message = !desk.results || !textMapped
    ? arabic ? 'يتحقّق الفحص من أن الخط يدعم أحرف النصوص المرتبطة.' : 'Preflight checks glyph coverage for mapped text.'
    : missingGlyphs ? arabic ? 'يفتقد الخط بعض الأحرف المطلوبة. راجع الصفوف التي تحتاج إلى مراجعة.'
      : 'Some text needs glyphs this font lacks. Review the flagged rows.'
      : arabic ? 'لم يرصد الفحص أحرفًا يفتقدها الخط.' : 'Preflight reported no missing glyphs.';
  return <small role="status" data-testid="custom-font-status">{message}</small>;
}
