import { useMemo, useState } from 'react';
import { Diagnostics, diagnosticText, safeRowMinSize } from './Diagnostics';
import { Filename } from './Filename';
import { fillLabel, type translator } from './labels';
import type { RowFilter, useWorkbench } from './useWorkbench';

type QueueProps = {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
};

const pageSize = 20;
const filters = [
  ['all', 'all'], ['ready', 'ready'], ['flagged', 'flagged'], ['warnings', 'sourceWarnings'],
] as const satisfies readonly (readonly [RowFilter, keyof ReturnType<typeof translator>['labels']])[];

function searchable(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
}

export function Queue({ desk, language }: QueueProps) {
  const { labels, problem } = language;
  const { ready, flagged, warningRows, progress } = desk;
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const row = desk.rows[desk.selected];
  const result = desk.results?.[desk.selected];
  const safeSize = result?.status === 'flagged' ? safeRowMinSize(result.diagnostics, desk.minFontSize) : undefined;
  const searchIndex = useMemo(() => desk.rows.map(({ values }, i) =>
    searchable([desk.filenames[i] ?? '', ...Object.values(values)].join('\0'))), [desk.rows, desk.filenames]);
  const matches = useMemo(() => {
    const query = searchable(search.trim());
    const rowNumber = Number(query.match(/^(?:(?:row|الصف)\s+|#)?([0-9]+)$/u)?.[1]);
    return desk.rows.flatMap((source, i) => {
      const status = desk.results?.[i]?.status;
      const filterMatches = desk.filter === 'all'
        || (desk.filter === 'ready' && status === 'pass')
        || (desk.filter === 'flagged' && status === 'flagged')
        || (desk.filter === 'warnings' && source.warnings.length > 0);
      return filterMatches && (!query || rowNumber === i + 1 || searchIndex[i]!.includes(query)) ? [i] : [];
    });
  }, [desk.rows, desk.results, desk.filter, searchIndex, search]);
  const pageCount = Math.ceil(matches.length / pageSize);
  const page = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const firstMatch = page * pageSize;
  const visibleRows = matches.slice(firstMatch, firstMatch + pageSize);
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
      {desk.rows.length === 0
        ? <p className="quiet empty-queue">{desk.sheet ? labels.emptySheet : labels.noRows}</p>
        : (
          <>
            <div className="queue-controls">
              <label className="queue-search">
                <span className="sr-only">{labels.queueSearch}</span>
                <input type="search" dir="auto" data-testid="queue-search" placeholder={labels.queueSearchHint} value={search}
                  onChange={(event) => { setSearch(event.currentTarget.value); setPageIndex(0); }} />
              </label>
              <div className="filter-chips" role="group" aria-label={labels.filter}>
                {filters.map(([filter, label]) => (
                  <button type="button" className="filter-chip" key={filter} data-testid={`queue-filter-${filter}`}
                    aria-pressed={desk.filter === filter} onClick={() => { desk.setFilter(filter); setPageIndex(0); }}>
                    {labels[label]}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-scroll" tabIndex={0} aria-label={labels.queue}>
              <table>
                <thead><tr><th scope="col">{labels.row}</th><th scope="col">{labels.filename}</th><th scope="col">{labels.status}</th><th scope="col">{labels.issues}</th></tr></thead>
                <tbody>
                  {visibleRows.map((index) => {
                    const source = desk.rows[index]!;
                    const result = desk.results?.[index];
                    const issue = result?.diagnostics[0];
                    return (
                      <tr key={index} data-testid="queue-row" data-row={index + 1} data-selected={desk.selected === index}>
                        <th scope="row">
                          <button
                            type="button"
                            className="row-link"
                            aria-label={fillLabel(labels.showRow, { row: index + 1 })}
                            aria-pressed={desk.selected === index}
                            onClick={() => { desk.setSelected(index); setEditing(false); }}
                          >
                            {String(index + 1).padStart(2, '0')}
                          </button>
                        </th>
                        <td><Filename name={desk.filenames[index]!} /></td>
                        <td><span className={`tag tag-${result?.status ?? 'pending'}`}>{!result ? labels.waiting : result.status === 'pass' ? labels.ready : labels.flagged}</span></td>
                        <td className="review-cell">
                          {issue && (
                            <>
                              <bdi dir="auto">{issue.field}</bdi>{' · '}{diagnosticText(issue, desk.minFontSize, language)}
                            </>
                          )}
                          {!result?.diagnostics.length && source.warnings.length === 0 && labels.noIssues}
                          {source.warnings.length > 0 && <span className="source-marker">{labels.sourceWarnings}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRows.length === 0 && (
                    <tr><td className="quiet" colSpan={4}>{labels.filterEmpty}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {matches.length > pageSize && (
              <div className="queue-pagination">
                <p data-testid="queue-page">{fillLabel(labels.queuePage, {
                  first: firstMatch + 1, last: firstMatch + visibleRows.length, total: matches.length,
                })}</p>
                <div className="actions compact">
                  <button type="button" className="button secondary" data-testid="queue-prev-page" disabled={page === 0}
                    onClick={() => setPageIndex(page - 1)}>{labels.queuePrev}</button>
                  <button type="button" className="button secondary" data-testid="queue-next-page" disabled={page + 1 === pageCount}
                    onClick={() => setPageIndex(page + 1)}>{labels.queueNext}</button>
                </div>
              </div>
            )}
            {row && (
              <section className="row-editor" aria-label={fillLabel(labels.selected, { row: desk.selected + 1 })}>
                <div className="row-editor-head">
                  <div className="row-summary">
                    <h3>{fillLabel(labels.selected, { row: desk.selected + 1 })}</h3>
                    <Filename name={desk.filenames[desk.selected]!} />
                    {result?.status === 'pass' && <p>{labels.cleanRow}</p>}
                    {desk.checking && <p>{labels.unresolved}</p>}
                  </div>
                  <div className="actions compact">
                    {desk.template && <a className="button secondary preview-jump" href="#preview">{labels.openPreview}</a>}
                    {safeSize !== undefined && (
                      <button type="button" className="button secondary" data-testid="apply-min-font" onClick={() => desk.changeSize(safeSize)}>
                        {fillLabel(labels.fixSize, { size: safeSize })}
                      </button>
                    )}
                    <button
                      type="button"
                      className="button secondary"
                      aria-expanded={editing}
                      aria-controls="edit-cells"
                      onClick={() => setEditing((current) => !current)}
                    >
                      {editing ? labels.done : fillLabel(labels.editRow, { row: desk.selected + 1 })}
                    </button>
                  </div>
                </div>
                {!!result?.diagnostics.length && (
                  <Diagnostics issues={result.diagnostics} minSize={desk.minFontSize} language={language} testId="selected-diagnostics" />
                )}
                {row.warnings.length > 0 && (
                  <div className="source-details">
                    <p>{labels.warningHelp}</p>
                    <ul>
                      {row.warnings.map((warning, index) => (
                        <li key={index}>
                          <bdi>{warning.column}</bdi>
                          {warning.source && <> (<bdi dir="ltr">{warning.source.column}{warning.source.row}</bdi>)</>}
                          {' · '}{warning.code === 'excel-formula-warning'
                            ? (warning.formulaHasCachedValue ? labels.formulaCached : labels.formulaUncached)
                            : problem(warning.code) ?? labels.sourceWarnings}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div id="edit-cells" className="edit-cells" hidden={!editing}>
                  {desk.sheet?.headers.map((column) => (
                    <label key={column}>
                      <bdi>{column}</bdi>
                      <textarea
                        dir="auto"
                        rows={2}
                        data-testid="roster-cell"
                        value={row.values[column] ?? ''}
                        onChange={(event) => desk.editCell(desk.selected, column, event.currentTarget.value)}
                      />
                    </label>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
    </section>
  );
}
