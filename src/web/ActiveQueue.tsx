import { fillLabel } from './labels';
import { activeFillLabels } from './active-fill-labels';
import Queue from './Queue';
import { sourceProblem } from './source-problems';

const en = {
  addMapping: 'Map at least one PDF field to check the rows.',
  addMappingForExport: 'Map at least one PDF field to export PDFs.',
  preflight: 'Checking rows',
  zip: 'Creating ZIP',
  merged: 'Merging PDFs',
  split: 'Merging PDFs by group',
  cancelBatch: 'Cancel batch',
  resumeBatch: 'Resume batch',
  pausedBatch: 'Batch canceled. Your files and edits are ready to check again.',
  sourceWarningCount: '{count} rows have source warnings. Review those values before using the PDFs.',
};

const ar: typeof en = {
  addMapping: 'اربط حقل PDF واحدًا على الأقل لفحص الصفوف.',
  addMappingForExport: 'اربط حقل PDF واحدًا على الأقل لتصدير الملفات.',
  preflight: 'فحص الصفوف',
  zip: 'إنشاء أرشيف ZIP',
  merged: 'دمج ملفات PDF',
  split: 'دمج ملفات PDF حسب المجموعة',
  cancelBatch: 'أوقف الدفعة',
  resumeBatch: 'استأنف الدفعة',
  pausedBatch: 'توقّفت الدفعة. يمكنك إعادة الفحص بالملفات والتعديلات الحالية.',
  sourceWarningCount: 'صفوف بها تنبيهات: {count}. راجع هذه القيم قبل استخدام ملفات PDF.',
};

export default function ActiveQueue(props: Parameters<typeof Queue>[0]) {
  const { desk, language: { arabic } } = props;
  const { progress, warningRows } = desk;
  const labels = arabic ? ar : en;
  const phaseLabel = progress && progress.phase !== 'dispatch' ? labels[progress.phase] : undefined;

  return (
    <>
      {warningRows > 0 && <p className="alert warning">{fillLabel(labels.sourceWarningCount, { count: warningRows })}</p>}
      {desk.preflightError && <p role="alert" className="alert">{sourceProblem(desk.preflightError, arabic) ?? activeFillLabels(arabic).pdfError}</p>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{phaseLabel}</p>
      {progress && phaseLabel && (
        <div className="batch-state">
          <div className="batch-meter">
            <div className="batch-meter-caption" data-testid="batch-progress-status">
              <label htmlFor="batch-meter">{phaseLabel}</label>
              <bdi dir="ltr">{progress.completed} / {progress.total}</bdi>
            </div>
            <progress id="batch-meter" data-testid="batch-progress" data-phase={progress.phase} value={progress.completed} max={progress.total} />
          </div>
          <button type="button" className="button secondary" data-testid="cancel-batch" onClick={desk.cancel}>{labels.cancelBatch}</button>
        </div>
      )}
      {desk.paused && (
        <div className="batch-state">
          <p role="status">{labels.pausedBatch}</p>
          <button type="button" className="button secondary" data-testid="resume-batch"
            disabled={(!desk.hasMapping && !desk.schemaRules.length) || desk.fontBlocked} onClick={desk.resume}>
            {labels.resumeBatch}
          </button>
        </div>
      )}
      {desk.template && !desk.hasMapping && <p className="queue-note">{desk.schemaRules.length ? labels.addMappingForExport : labels.addMapping}</p>}
      <Queue {...props} />
    </>
  );
}
