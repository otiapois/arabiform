import { useState } from 'react';
import type { BatchDraftSource } from '../core/draft/batch-draft';
import * as presetCodec from './presets';
import { errorCode, saveDownload } from './resources';
import type { useWorkbench } from './useWorkbench';

const en = {
  title: 'Batch draft',
  save: 'Save Draft',
  load: 'Load Draft',
  help: 'Save changes and settings to a local file. No cloud or browser storage. Load it with the original PDF, roster, and worksheet selected.',
  saved: 'Draft saved.',
  restored: 'Draft loaded. The batch will be checked with the restored changes.',
  saving: 'Preparing draft…',
  loading: 'Checking draft…',
  saveError: 'The draft could not be saved.',
  invalid: 'This is not a valid ArabiForm draft. Your batch is unchanged.',
  sources: 'The draft belongs to a different PDF, roster, or worksheet. Choose the original files and worksheet to load it.',
  font: 'This draft uses a different custom font. Choose the original font file and load the draft again.',
  changed: 'The batch changed while checking the draft. Try again with the current files.',
};

const ar: typeof en = {
  title: 'مسودة الدفعة',
  save: 'احفظ المسودة',
  load: 'حمّل المسودة',
  help: 'احفظ التعديلات والإعدادات في ملف محلي. لا تُخزّن في السحابة أو في المتصفح. لتحميل المسودة، اختر ملف PDF والجدول وورقة العمل الأصلية.',
  saved: 'تم حفظ المسودة.',
  restored: 'تم تحميل المسودة. سيُعاد فحص الدفعة بالتعديلات المستعادة.',
  saving: 'جارٍ تجهيز المسودة…',
  loading: 'جارٍ التحقّق من المسودة…',
  saveError: 'تعذّر حفظ المسودة.',
  invalid: 'هذا الملف ليس مسودة ArabiForm صالحة. بقيت دفعتك كما هي.',
  sources: 'ترتبط المسودة بملف PDF أو جدول أو ورقة عمل أخرى. اختر الملفات الأصلية وورقة العمل المرتبطة بها.',
  font: 'تستخدم هذه المسودة خطًا مخصصًا مختلفًا. اختر ملف الخط الأصلي وحمّل المسودة مجددًا.',
  changed: 'تغيّرت الدفعة أثناء التحقّق من المسودة. حاول مجددًا بالملفات الحالية.',
};

type Notice = Exclude<keyof typeof en, 'title' | 'save' | 'load' | 'help'>;

export default function BatchDraftControls({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const labels = arabic ? ar : en;
  const [notice, setNotice] = useState<Notice>();
  const pending = notice === 'saving' || notice === 'loading';
  const alert = notice === 'invalid' || notice === 'sources' || notice === 'font' || notice === 'saveError' || notice === 'changed';

  async function run(file?: File) {
    if (pending || desk.exporting || (!file && (desk.fontBlocked || desk.watermarkBlocked || desk.virtualTemplateBlocked))) return;
    const current = desk.beginDraft(Boolean(file));
    const { template, roster, sheet, customFont } = desk;
    setNotice(file ? 'loading' : 'saving');
    try {
      const engine = await import('../core/draft/batch-draft');
      const [templateSha256, rosterSha256, fontSha256, text] = await Promise.all([
        engine.hashBatchDraftInput(template!.bytes),
        engine.hashBatchDraftInput(roster!.bytes),
        customFont?.status === 'ready' ? engine.hashBatchDraftInput(customFont.bytes) : undefined,
        file?.text(),
      ]);
      if (!current()) {
        setNotice('changed');
        return;
      }
      const source: BatchDraftSource = {
        templateSha256, rosterSha256, fields: desk.fields.map(({ name }) => name),
        sheetName: sheet!.name, columns: sheet!.headers, rowCount: sheet!.rows.length,
      };
      if (text !== undefined) {
        const draft = engine.parseBatchDraft(text, source, fontSha256);
        const textFields = new Set(desk.fields.filter(({ kind }) => kind === 'text').map(({ name }) => name));
        if (Object.keys(draft.settings.alignOverrides).some((field) => !textFields.has(field))
          || (draft.settings.version === 6 && Object.keys(draft.settings.virtualMappings).some((field) => !textFields.has(field)))) {
          throw new Error('invalid-batch-draft');
        }
        desk.restoreDraft(draft, presetCodec);
        setNotice('restored');
      } else {
        const data = engine.serializeBatchDraft({
          kind: 'arabiform-batch-draft', version: 1, source, customFontSha256: fontSha256 ?? null,
          edits: desk.edits, hygiene: desk.hygiene, settings: presetCodec.makeDraftSettings(...desk.presetInputs()),
        });
        saveDownload(data, 'arabiform-batch-draft.json', 'application/json');
        setNotice('saved');
      }
    } catch (error) {
      const code = errorCode(error, 'invalid-batch-draft');
      setNotice(!current() ? 'changed' : !file ? 'saveError'
        : code === 'batch-draft-source-mismatch' ? 'sources' : code === 'batch-draft-custom-font-mismatch' ? 'font' : 'invalid');
    }
  }

  return (
    <div className="preset-controls">
      <h3>{labels.title}</h3>
      <p className="quiet">{labels.help}</p>
      <div className="actions compact">
        <button type="button" className="button secondary" data-testid="draft-download" aria-label={`${labels.save} (.json)`}
          disabled={pending || desk.exporting || desk.fontBlocked || desk.watermarkBlocked || desk.virtualTemplateBlocked} onClick={() => void run()}>{labels.save}{'\u00A0'}<bdi dir="ltr">(.json)</bdi></button>
        <label className="button secondary preset-picker">
          {labels.load}{'\u00A0'}<bdi dir="ltr">(.json)</bdi>
          <input type="file" data-testid="draft-upload" aria-label={`${labels.load} (.json)`} accept=".json,application/json"
            disabled={pending || desk.exporting || desk.customFont?.status === 'loading'} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void run(file);
            }} />
        </label>
      </div>
      {notice && <p className={alert ? 'alert' : 'quiet'} role={alert ? 'alert' : 'status'} data-testid="draft-status">{labels[notice]}</p>}
    </div>
  );
}
