import { lazy, Suspense } from 'react';
import type { translator } from './labels';
import type { useWorkbench } from './useWorkbench';

const ActiveQueue = lazy(() => import('./ActiveQueue'));

export function QueuePanel({ desk, language, characterKeys }: {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
  characterKeys: boolean;
}) {
  const { labels } = language;

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
        <div><dt>{labels.ready}</dt><dd className="ink-green" data-testid="ready-count">{desk.results ? desk.ready : '—'}</dd></div>
        <div><dt>{labels.flagged}</dt><dd className="ink-amber" data-testid="flagged-count">{desk.results ? desk.flagged : '—'}</dd></div>
        <div><dt>{labels.sourceWarnings}</dt><dd data-testid="warning-count">{desk.warningRows}</dd></div>
      </dl>
      {desk.rows.length > 0 ? (
        <Suspense fallback={<p className="quiet empty-queue" role="status">{labels.loading}</p>}>
          <ActiveQueue key={desk.sourceRevision} desk={desk} language={language} characterKeys={characterKeys} />
        </Suspense>
      ) : <p className="quiet empty-queue">{desk.sheet ? labels.emptySheet : labels.noRows}</p>}
    </section>
  );
}
