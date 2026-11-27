import { lazy, Suspense } from 'react';
import { fillLabel, type translator } from './labels';
import type { useWorkbench } from './useWorkbench';

const Queue = lazy(() => import('./Queue'));

export function QueuePanel({ desk, language, characterKeys }: {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
  characterKeys: boolean;
}) {
  const { labels, problem } = language;
  const { ready, flagged, warningRows, progress } = desk;
  const phaseLabel = progress && { preflight: labels.progressCheck, zip: labels.progressZip, merged: labels.progressMerge }[progress.phase];

  return (
    <section className="panel queue" aria-labelledby="queue-heading">
      <header className="wide-heading">
        <div>
          <h2 id="queue-heading">{labels.queue}</h2>
          <p>{labels.queueHelp}</p>
        </div>
      </header>
      <dl className="counts" aria-live="polite" aria-atomic="true">
        <div><dt>{labels.total}</dt><dd data-testid="total-count">{desk.rows.length}</dd></div>
        <div><dt>{labels.ready}</dt><dd className="ink-green" data-testid="ready-count">{desk.results ? ready : '—'}</dd></div>
        <div><dt>{labels.flagged}</dt><dd className="ink-amber" data-testid="flagged-count">{desk.results ? flagged : '—'}</dd></div>
        <div><dt>{labels.sourceWarnings}</dt><dd data-testid="warning-count">{warningRows}</dd></div>
      </dl>
      {warningRows > 0 && (
        <p className="alert warning">{fillLabel(labels.sourceWarningCount, { count: warningRows })}</p>
      )}
      {desk.preflightError && <p role="alert" className="alert">{problem(desk.preflightError) ?? labels.pdfError}</p>}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{phaseLabel}</p>
      {progress && (
        <div className="batch-state">
          <div className="batch-meter">
            <div className="batch-meter-caption" data-testid="batch-progress-status">
              <label htmlFor="batch-meter">{phaseLabel}</label>
              <bdi dir="ltr">{fillLabel(labels.progressCount, { completed: progress.completed, total: progress.total })}</bdi>
            </div>
            <progress id="batch-meter" data-testid="batch-progress" data-phase={progress.phase} value={progress.completed} max={progress.total} />
          </div>
          <button type="button" className="button secondary" data-testid="cancel-batch" onClick={desk.cancel}>{labels.cancelBatch}</button>
        </div>
      )}
      {desk.paused && (
        <div className="batch-state">
          <p role="status">{labels.pausedBatch}</p>
          <button type="button" className="button secondary" data-testid="resume-batch" disabled={!desk.hasMapping || desk.fontBlocked} onClick={desk.resume}>
            {labels.resumeBatch}
          </button>
        </div>
      )}
      {desk.template && desk.rows.length > 0 && !desk.hasMapping && <p className="queue-note">{labels.addMapping}</p>}
      {desk.rows.length > 0 ? (
        <Suspense fallback={<p className="quiet empty-queue" role="status">{labels.loading}</p>}>
          <Queue desk={desk} language={language} characterKeys={characterKeys} />
        </Suspense>
      ) : <p className="quiet empty-queue">{desk.sheet ? labels.emptySheet : labels.noRows}</p>}
    </section>
  );
}
