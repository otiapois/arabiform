import { useEffect, useRef, useState } from 'react';
import type { RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { StudioCustomization, StudioTemplateId, generateStudioTemplate } from '../core/studio/templates';
import { errorCode, loadFonts, saveDownload } from './resources';
import './template-studio.css';

const en = {
  heading: 'Create template',
  description: 'Start with a fillable PDF and a matching sample roster.',
  template: 'Starter template',
  organization: 'Organization name',
  subtitle: 'Document subtitle',
  accent: 'Accent palette',
  language: 'Header language',
  preview: 'Template preview',
  preparing: 'Preparing the template preview…',
  invalid: 'Choose a supported template and check the header settings.',
  unsupported: 'The bundled fonts cannot display some characters in the header. Replace those characters and try again.',
  long: 'The header text does not fit. Shorten the organization name or subtitle.',
  failed: 'The template could not be generated. Change the settings or reload the page to try again.',
  previewFailed: 'The PDF preview could not be rendered. You can still download the template.',
  download: 'Download AcroForm Template',
  starterCsv: 'Download Starter CSV',
  sample: 'The starter CSV contains synthetic sample records.',
  use: 'Use in Fill PDFs Now',
};

const ar: typeof en = {
  heading: 'إنشاء قالب',
  description: 'ابدأ بقالب PDF قابل للتعبئة وجدول سجلات تجريبي مطابق له.',
  template: 'القالب الجاهز',
  organization: 'اسم المؤسسة',
  subtitle: 'العنوان الفرعي للمستند',
  accent: 'لون القالب',
  language: 'لغة الترويسة',
  preview: 'معاينة القالب',
  preparing: 'جارٍ تجهيز معاينة القالب…',
  invalid: 'اختر قالبًا مدعومًا وراجع إعدادات الترويسة.',
  unsupported: 'يتعذّر عرض بعض أحرف الترويسة بالخطوط المرفقة. استبدل هذه الأحرف وحاول مجددًا.',
  long: 'النص أطول من المساحة المخصصة للترويسة. اختصر اسم المؤسسة أو العنوان الفرعي.',
  failed: 'تعذّر إنشاء القالب. غيّر الإعدادات أو أعد تحميل الصفحة للمحاولة مجددًا.',
  previewFailed: 'تعذّر عرض معاينة ملف PDF. يمكنك تنزيل القالب.',
  download: 'نزّل قالب AcroForm',
  starterCsv: 'نزّل جدول CSV التجريبي',
  sample: 'يحتوي الجدول التجريبي على سجلات اصطناعية.',
  use: 'استخدم القالب في تعبئة ملفات PDF الآن',
};

const templates = {
  'certificate-bilingual': ['Bilingual Certificate', 'شهادة إتمام ثنائية اللغة'],
  'hr-letter-bilingual': ['HR Employment Letter', 'خطاب إثبات عمل'],
  'clinic-consent-bilingual': ['Clinic Consent Form', 'استمارة موافقة المريض'],
  'visitor-badge-a6': ['A6 Visitor Badge', 'بطاقة زائر بحجم A6'],
} satisfies Record<StudioTemplateId, readonly [string, string]>;

const palettes = {
  forest: ['Forest', 'أخضر داكن', 'rgb(10% 30% 23%)'],
  navy: ['Navy', 'أزرق داكن', 'rgb(13% 25% 41%)'],
  burgundy: ['Burgundy', 'عنّابي', 'rgb(38% 15% 23%)'],
  slate: ['Slate', 'رمادي أردوازي', 'rgb(25% 30% 35%)'],
} satisfies Record<NonNullable<StudioCustomization['accentPalette']>, readonly [string, string, string]>;

const languages = {
  bilingual: ['Arabic + English', 'عربي وإنجليزي'],
  ar: ['Arabic', 'العربية'],
  en: ['English', 'الإنجليزية'],
} satisfies Record<NonNullable<StudioCustomization['headerLanguage']>, readonly [string, string]>;

type Settings = Required<StudioCustomization> & { id: StudioTemplateId };
type Template = Awaited<ReturnType<typeof generateStudioTemplate>>;
type Generation = { settings: Settings; template: Template; code?: never } | { settings: Settings; code: string; template?: never };

function StudioPreview({ bytes, copy }: { bytes: Uint8Array; copy: typeof en }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'ready' | 'failed'>();

  useEffect(() => {
    const target = canvas.current!;
    let active = true;
    let dispose: (() => Promise<void>) | undefined;
    let rendering: RenderTask | undefined;

    async function render() {
      const { openPreviewDocument } = await import('./pdf-preview-document');
      if (!active) return;
      const task = openPreviewDocument(bytes);
      dispose = () => task.destroy();
      const pdf = await task.promise;
      if (!active) return;
      const page = await pdf.getPage(1);
      if (!active) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(760 / base.width, 710 / base.height) });
      const scale = Math.min(2, window.devicePixelRatio || 1);
      target.width = Math.ceil(viewport.width * scale);
      target.height = Math.ceil(viewport.height * scale);
      target.style.inlineSize = viewport.width + 'px';
      rendering = page.render({ canvas: target, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      await rendering.promise;
      if (active) setState('ready');
    }

    void render().catch(() => { if (active) setState('failed'); });
    return () => {
      active = false;
      rendering?.cancel();
      void dispose?.().catch(() => undefined);
    };
  }, [bytes]);

  return (
    <>
      {state === 'failed' && <p className="alert" role="alert">{copy.previewFailed}</p>}
      {!state && <p className="quiet" role="status">{copy.preparing}</p>}
      {/* PDF.js places glyphs with LTR canvas start alignment. */}
      <canvas ref={canvas} dir="ltr" role="img" aria-label={copy.preview} data-testid="studio-canvas"
        data-rendered={state === 'ready' ? 'true' : undefined} hidden={state !== 'ready'} />
    </>
  );
}

export default function TemplateStudio({ arabic, onUseInFill }: { arabic: boolean; onUseInFill: (file: File) => void }) {
  const copy = arabic ? ar : en;
  const locale = arabic ? 1 : 0;
  const [settings, setSettings] = useState<Settings>({
    id: 'certificate-bilingual', organizationName: '', documentSubtitle: '', accentPalette: 'forest', headerLanguage: 'bilingual',
  });
  const [generation, setGeneration] = useState<Generation>();
  const current = generation?.settings === settings ? generation : undefined;
  const template = current?.template;
  const errors: Record<string, string> = {
    'studio-invalid-settings': copy.invalid,
    'studio-unsupported-text': copy.unsupported,
    'studio-text-does-not-fit': copy.long,
  };

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const [{ generateStudioTemplate }, fonts] = await Promise.all([import('../core/studio/templates'), loadFonts()]);
        if (!active) return;
        const { id, ...customization } = settings;
        const template = await generateStudioTemplate(id, customization, fonts);
        if (active) setGeneration({ settings, template });
      } catch (error) {
        if (active) setGeneration({ settings, code: errorCode(error, 'studio-generation-failed') || 'studio-generation-failed' });
      }
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [settings]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <section className="panel" aria-labelledby="studio-heading">
      <header><h2 id="studio-heading">{copy.heading}</h2><p>{copy.description}</p></header>
      <div className="panel-body template-studio">
        <div className="studio-settings">
          <label className="full-control">
            {copy.template}
            <select data-testid="studio-template" value={settings.id}
              onChange={(event) => update('id', event.currentTarget.value as StudioTemplateId)}>
              {Object.entries(templates).map(([id, name]) => <option key={id} value={id}>{name[locale]}</option>)}
            </select>
          </label>
          <label className="full-control">
            {copy.organization}
            <input type="text" dir="auto" data-testid="studio-organization" value={settings.organizationName}
              onChange={(event) => update('organizationName', event.currentTarget.value)} />
          </label>
          <label className="full-control">
            {copy.subtitle}
            <input type="text" dir="auto" data-testid="studio-subtitle" value={settings.documentSubtitle}
              onChange={(event) => update('documentSubtitle', event.currentTarget.value)} />
          </label>
          <fieldset className="studio-palettes">
            <legend>{copy.accent}</legend>
            {Object.entries(palettes).map(([name, label]) => (
              <label key={name}>
                <input type="radio" name="studio-accent" value={name} checked={settings.accentPalette === name}
                  onChange={() => update('accentPalette', name as Settings['accentPalette'])} />
                <span aria-hidden="true" style={{ backgroundColor: label[2] }} />
                {label[locale]}
              </label>
            ))}
          </fieldset>
          <label className="full-control">
            {copy.language}
            <select data-testid="studio-header-language" value={settings.headerLanguage}
              onChange={(event) => update('headerLanguage', event.currentTarget.value as Settings['headerLanguage'])}>
              {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name[locale]}</option>)}
            </select>
          </label>
          <div className="actions studio-actions">
            <button type="button" className="button primary" data-testid="studio-download" disabled={!template}
              onClick={() => template && saveDownload(template.pdfBytes, template.filename, 'application/pdf')}>
              <span>{copy.download} <bdi dir="ltr">(.pdf)</bdi></span>
            </button>
            <button type="button" className="button secondary" data-testid="studio-csv" disabled={!template} aria-describedby="studio-csv-note"
              onClick={() => template && saveDownload(template.csv, template.csvFilename, 'text/csv;charset=utf-8')}>{copy.starterCsv}</button>
            <button type="button" className="button secondary" data-testid="studio-use-fill" disabled={!template}
              onClick={() => template && onUseInFill(new File([Uint8Array.from(template.pdfBytes)], template.filename, { type: 'application/pdf' }))}>{copy.use}</button>
          </div>
          <p className="quiet" id="studio-csv-note">{copy.sample}</p>
        </div>
        <div className="studio-preview" role="region" aria-label={copy.preview} aria-live="polite">
          {template ? <StudioPreview bytes={template.pdfBytes} copy={copy} />
            : current?.code !== undefined ? <p className="alert" role="alert">{errors[current.code] ?? copy.failed}</p>
              : <p className="quiet" role="status">{copy.preparing}</p>}
        </div>
      </div>
    </section>
  );
}
