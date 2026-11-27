import { lazy, Suspense, useId, useState } from 'react';
import { Diagnostics } from './Diagnostics';
import PdfPreview from './PdfPreview';
import { activeFillLabels } from './active-fill-labels';
import { fillLabel, type translator } from './labels';
import type { BatchWorker } from './useBatch';
import type { useWorkbench } from './useWorkbench';
import './preview-gallery.css';

const PrintMarginAdvisory = lazy(() => import('./PrintMarginAdvisory'));
const RowCompare = lazy(() => import('./RowCompare'));

const en = {
  previewReady: 'Generated row',
  previewSealed: 'Generated row · official approval seal',
  previewFlagged: 'Original template · failed fields outlined',
  previewTemplate: 'Original template',
  spotlight: 'Jump to a boundary row',
  longest: 'Longest name',
  longestHelp: 'Checks every mapped text field for the longest value.',
  jumpRow: 'Jump to row {row}.',
  smallest: 'Smallest font',
  flagged: 'First flagged',
  compare: 'Compare two rows',
};

const ar: typeof en = {
  previewReady: 'الصف بعد التعبئة',
  previewSealed: 'الصف بعد التعبئة · ختم الاعتماد الرسمي',
  previewFlagged: 'القالب الأصلي · الحقول التي تحتاج مراجعة محاطة بإطار',
  previewTemplate: 'القالب الأصلي',
  spotlight: 'انتقل إلى صف للمراجعة',
  longest: 'أطول اسم',
  longestHelp: 'يُبحث عن أطول قيمة في جميع الحقول النصية المرتبطة.',
  jumpRow: 'انتقل إلى الصف {row}.',
  smallest: 'أصغر حجم خط',
  flagged: 'أول صف يحتاج مراجعة',
  compare: 'قارن بين صفّين',
};

type Desk = ReturnType<typeof useWorkbench>;

export default function WorkbenchPreview({ template, desk, language }: {
  template: NonNullable<Desk['template']>;
  desk: Desk;
  language: ReturnType<typeof translator>;
}) {
  const { arabic, labels } = language;
  const copy = arabic ? ar : en;
  const [compareWorker, setCompareWorker] = useState<BatchWorker>();
  const galleryId = useId();
  const drawerId = `${galleryId}-compare`;
  const { checkedWorker, results, selected, spotlight } = desk;
  const comparing = Boolean(checkedWorker && checkedWorker === compareWorker);
  const selectedResult = results?.[selected];
  const bytes = selectedResult?.status === 'pass' ? desk.previewBytes : template.bytes;
  const status = selectedResult?.status;
  const rowLabel = activeFillLabels(arabic).selected;
  const jumps = [
    { id: 'longest', label: copy.longest, row: spotlight?.longestMappedTextRow },
    { id: 'smallest', label: copy.smallest, row: spotlight?.smallestFontRow },
    { id: 'flagged', label: copy.flagged, row: spotlight?.firstFlaggedRow },
  ];
  const canCompare = Boolean(results && results.length > 1);

  return (
    <>
      <header className="preview-heading wide-heading">
        <div>
          <h2 id="preview-heading">{labels.preview}</h2>
          {!comparing && <p>{status === 'pass' ? desk.approvalSeal && bytes ? copy.previewSealed : copy.previewReady
            : status === 'flagged' ? copy.previewFlagged : copy.previewTemplate}</p>}
        </div>
        {!comparing && status && <span className={`tag tag-${status}`}>{fillLabel(rowLabel, { row: selected + 1 })}</span>}
      </header>
      {spotlight && checkedWorker && (canCompare || jumps.some(({ row }) => row !== undefined)) && (
        <div className="preview-gallery" data-testid="preview-gallery">
          <div className="boundary-jumps" role="group" aria-label={copy.spotlight}>
            {jumps.map(({ id, label, row }) => {
              if (row === undefined) return null;
              const description = `${galleryId}-${id}`;
              return <button key={id} type="button" className="page-pill" data-testid={`spotlight-${id}`} data-row={row}
                aria-label={label} aria-describedby={description} aria-pressed={!comparing && row === selected + 1}
                onClick={() => { desk.selectRow(row - 1); setCompareWorker(undefined); }}>
                {label}<span className="spotlight-row" aria-hidden="true"><bdi dir="ltr">{row}</bdi></span>
                <span id={description} className="sr-only">{fillLabel(copy.jumpRow, { row })}{id === 'longest' ? ` ${copy.longestHelp}` : ''}</span>
              </button>;
            })}
            {canCompare && (
              <button type="button" className="button secondary" data-testid="toggle-row-compare"
                aria-expanded={comparing} aria-controls={drawerId}
                onClick={() => setCompareWorker(comparing ? undefined : checkedWorker)}>{copy.compare}</button>
            )}
          </div>
          <div id={drawerId} hidden={!comparing}>
            {comparing && results && (
              <Suspense fallback={<p className="preview-message" role="status">{labels.previewBusy}</p>}>
                <RowCompare results={results} selected={selected} spotlight={spotlight} worker={checkedWorker}
                  template={template} minSize={desk.minFontSize} language={language} render={desk.renderRecord} blocked={desk.sealPreviewBlocked} />
              </Suspense>
            )}
          </div>
        </div>
      )}
      {!comparing && <>
        {desk.hasMapping && (
          <Suspense>
            <PrintMarginAdvisory template={template.info} mapping={desk.mapping} virtualMappings={desk.virtualMappings} arabic={arabic} />
          </Suspense>
        )}
        {!!selectedResult?.diagnostics.length && (
          <div className="preview-diagnostics">
            <Diagnostics issues={selectedResult.diagnostics} minSize={desk.minFontSize} language={language} testId="preview-diagnostics" />
          </div>
        )}
        <PdfPreview bytes={bytes} fields={template.info.fields} overlays={template.overlays} diagnostics={selectedResult?.diagnostics}
          minSize={desk.minFontSize} unavailable={status === 'pass' && desk.previewError} language={language}
          fieldSelection={desk.fieldSelection} onWidgetSelect={desk.selectWidget}
          requestedPage={desk.previewPage} onPageChange={desk.setPreviewPage} />
      </>}
    </>
  );
}
