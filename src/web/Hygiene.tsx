import { useMemo, useState } from 'react';
import type { HygieneOperation } from '../core/roster/hygiene';
import { fillLabel } from './labels';
import type { useWorkbench } from './useWorkbench';

const en = {
  title: 'Clean & replace roster text',
  columns: 'Columns to change',
  cleanup: 'Text cleanup',
  normalizeSpaces: 'Clean spaces and stray invisible characters',
  normalizeAlef: 'Normalize Alef (أ إ آ → ا)',
  normalizeTaaMarbuta: 'Normalize Taa Marbuta (ة → ه)',
  normalizeAlefMaqsura: 'Normalize Alef Maqsura (ى → ي)',
  stripHarakat: 'Remove Arabic vowel marks (harakat)',
  find: 'Find',
  replace: 'Replace with',
  matchCase: 'Match case',
  findHelp: 'Find matches literal text. An empty replacement removes matches.',
  choose: 'Choose the columns to preview changes.',
  noChanges: 'No cells would change.',
  count: '{cells} affected cells across {rows} rows',
  sample: 'Row {row}',
  apply: 'Apply transform',
  undo: 'Undo last transform',
  applied: 'Transform applied.',
  undone: 'Last transform undone.',
  undoExpired: 'Undo is unavailable after a manual cell edit.',
  busy: 'Loading text cleanup…',
  failed: 'Text cleanup could not load. Close and reopen this panel to retry.',
};

const ar: typeof en = {
  title: 'نظّف واستبدل نصوص الجدول',
  columns: 'الأعمدة المراد تعديلها',
  cleanup: 'تنظيف النص',
  normalizeSpaces: 'نظّف المسافات والمحارف الخفية الزائدة',
  normalizeAlef: 'وحّد أشكال الألف (أ، إ، آ إلى ا)',
  normalizeTaaMarbuta: 'حوّل التاء المربوطة (ة إلى ه)',
  normalizeAlefMaqsura: 'حوّل الألف المقصورة (ى إلى ي)',
  stripHarakat: 'أزل علامات التشكيل',
  find: 'ابحث عن',
  replace: 'استبدل بـ',
  matchCase: 'طابق حالة الأحرف',
  findHelp: 'يبحث الاستبدال عن النص حرفيًا. اترك نص الاستبدال فارغًا لحذف المطابقات.',
  choose: 'اختر الأعمدة لمعاينة التعديلات.',
  noChanges: 'لن تتغيّر أي خلية.',
  count: 'عدد الخلايا التي ستتغيّر {cells} في {rows} من الصفوف',
  sample: 'الصف {row}',
  apply: 'طبّق التعديل',
  undo: 'تراجع عن آخر تعديل جماعي',
  applied: 'تم تطبيق التعديل الجماعي.',
  undone: 'تم التراجع عن آخر تعديل جماعي.',
  undoExpired: 'لا يتاح التراجع بعد تعديل خلية يدويًا.',
  busy: 'جارٍ تحميل أدوات تنظيف النص…',
  failed: 'تعذّر تحميل أدوات تنظيف النص. أغلق هذه اللوحة وافتحها مجددًا للمحاولة.',
};

const cleanup = ['normalizeSpaces', 'normalizeAlef', 'normalizeTaaMarbuta', 'normalizeAlefMaqsura', 'stripHarakat'] as const;

export default function Hygiene({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const labels = arabic ? ar : en;
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [engine, setEngine] = useState<typeof import('../core/roster/hygiene')>();
  const [operation, setOperation] = useState<HygieneOperation>({
    columns: [], normalizeSpaces: true, find: '', replace: '', matchCase: true,
  });
  const [notice, setNotice] = useState<{ kind: 'applied' | 'undone'; revision: number }>();
  const sheet = desk.sheet!;
  const preview = useMemo(() => expanded && operation.columns.length
    ? engine?.previewRosterHygiene({ ...sheet, rows: desk.rows }, operation) : undefined,
  [engine, expanded, operation, sheet, desk.rows]);
  const status = desk.undoExpired ? labels.undoExpired : notice?.revision === desk.cellRevision ? labels[notice.kind] : undefined;

  return (
    <details className="panel hygiene" onToggle={(event) => {
      const open = event.currentTarget.open;
      setExpanded(open);
      if (open && !engine) {
        setLoadError(false);
        void import('../core/roster/hygiene').then(setEngine, () => setLoadError(true));
      }
    }}>
      <summary className="hygiene-summary">{labels.title}</summary>
      <div className="panel-body">
        {!engine ? (
          <p className={loadError ? 'alert' : 'quiet'} role={loadError ? 'alert' : 'status'}>{loadError ? labels.failed : labels.busy}</p>
        ) : (
          <>
            <fieldset>
              <legend>{labels.columns}</legend>
              <div className="hygiene-options">
                {sheet.headers.map((column, index) => (
                  <label key={column}>
                    <input type="checkbox" checked={operation.columns.includes(index)} onChange={(event) => {
                      const selected = event.currentTarget.checked;
                      setOperation((current) => ({ ...current, columns: selected
                        ? [...current.columns, index] : current.columns.filter((columnIndex) => columnIndex !== index) }));
                    }} />
                    <bdi dir="auto">{column}</bdi>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{labels.cleanup}</legend>
              <div className="hygiene-options">
                {cleanup.map((key) => (
                  <label key={key}>
                    <input type="checkbox" checked={Boolean(operation[key])} onChange={(event) =>
                      setOperation({ ...operation, [key]: event.currentTarget.checked })} />
                    {labels[key]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="hygiene-find">
              <label className="full-control">
                {labels.find}
                <input type="text" dir="auto" value={operation.find ?? ''}
                  onChange={(event) => setOperation({ ...operation, find: event.currentTarget.value })} />
              </label>
              <label className="full-control">
                {labels.replace}
                <input type="text" dir="auto" value={operation.replace ?? ''}
                  onChange={(event) => setOperation({ ...operation, replace: event.currentTarget.value })} />
              </label>
            </div>
            <div className="hygiene-options">
              <label>
                <input type="checkbox" checked={operation.matchCase}
                  onChange={(event) => setOperation({ ...operation, matchCase: event.currentTarget.checked })} />
                {labels.matchCase}
              </label>
              <small>{labels.findHelp}</small>
            </div>
            <p className="quiet" role="status" data-testid="hygiene-count" data-affected-cells={preview?.affectedCells ?? 0}>
              {!operation.columns.length ? labels.choose : !preview?.affectedCells ? labels.noChanges
                : fillLabel(labels.count, { cells: preview.affectedCells, rows: preview.affectedRows })}
            </p>
            {!!preview?.samples.length && (
              <ul className="hygiene-samples" data-testid="hygiene-samples">
                {preview.samples.map(({ rowIndex, column, before, after }) => (
                  <li key={`${rowIndex}:${column}`}>
                    {fillLabel(labels.sample, { row: rowIndex + 1 })}{' · '}<bdi>{column}</bdi>{' · '}
                    <del><bdi dir="auto">{before || '∅'}</bdi></del>{' '}
                    <span aria-hidden="true">{arabic ? '←' : '→'}</span>{' '}
                    <ins><bdi dir="auto">{after || '∅'}</bdi></ins>
                  </li>
                ))}
              </ul>
            )}
            <div className="actions compact">
              <button type="button" className="button primary" disabled={!preview?.affectedCells || desk.exporting} onClick={() => {
                if (!preview) return;
                desk.applyHygiene(operation, preview);
                setNotice({ kind: 'applied', revision: desk.cellRevision + 1 });
              }}>{labels.apply}</button>
              <button type="button" className="button secondary" disabled={!desk.canUndoHygiene || desk.exporting} onClick={() => {
                desk.undoHygiene();
                setNotice({ kind: 'undone', revision: desk.cellRevision + 1 });
              }}>{labels.undo}</button>
            </div>
            {status && <p className="quiet" role="status">{status}</p>}
          </>
        )}
      </div>
    </details>
  );
}
