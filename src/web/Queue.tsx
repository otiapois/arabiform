import { useState } from 'react';
import { fillLabel, type translator } from './labels';
import type { RowFilter, useWorkbench } from './useWorkbench';

type QueueProps = {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
  ready: number;
  flagged: number;
  warningRows: number;
};

export function Queue({ desk, language, ready, flagged, warningRows }: QueueProps) {
  const { labels, problem } = language;
  const [editing, setEditing] = useState(false);
  const row = desk.rows[desk.selected];
  const result = desk.results?.[desk.selected];
  const visibleRows = desk.rows.map((source, index) => ({ source, index, result: desk.results?.[index] }))
    .filter(({ source, result }) => desk.filter === 'all'
      || (desk.filter === 'ready' && result?.status === 'pass')
      || (desk.filter === 'flagged' && result?.status === 'flagged')
      || (desk.filter === 'warnings' && source.warnings.length > 0));

  return (
    <section className="panel queue" aria-labelledby="queue-heading">
      <header className="wide-heading">
        <div>
          <h2 id="queue-heading">{labels.queue}</h2>
          <p>{labels.queueHelp}</p>
        </div>
        {desk.rows.length > 0 && (
          <label className="filter-control">
            {labels.filter}
            <select aria-label={labels.filter} value={desk.filter} onChange={(event) => desk.setFilter(event.currentTarget.value as RowFilter)}>
              <option value="all">{labels.all}</option>
              <option value="ready">{labels.ready}</option>
              <option value="flagged">{labels.flagged}</option>
              <option value="warnings">{labels.sourceWarnings}</option>
            </select>
          </label>
        )}
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
      {desk.checking && <p role="status" className="queue-note">{labels.checking}</p>}
      {desk.template && desk.rows.length > 0 && !desk.hasMapping && <p className="queue-note">{labels.addMapping}</p>}
      {desk.rows.length === 0
        ? <p className="quiet empty-queue">{desk.sheet ? labels.emptySheet : labels.noRows}</p>
        : (
          <>
            <div className="table-scroll" tabIndex={0} aria-label={labels.queue}>
              <table>
                <thead><tr><th scope="col">{labels.row}</th><th scope="col">{labels.filename}</th><th scope="col">{labels.status}</th><th scope="col">{labels.issues}</th></tr></thead>
                <tbody>
                  {visibleRows.map(({ source, index, result }) => (
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
                      <td><bdi dir="ltr" className="filename" title={desk.filenames[index]}>{desk.filenames[index]}</bdi></td>
                      <td><span className={`tag tag-${result?.status ?? 'pending'}`}>{!result ? labels.waiting : result.status === 'pass' ? labels.ready : labels.flagged}</span></td>
                      <td className="review-cell">
                        {result?.diagnostics[0] && (
                          <>
                            <bdi>{result.diagnostics[0].field}</bdi>{' · '}{problem(result.diagnostics[0].code) ?? labels.pdfError}
                          </>
                        )}
                        {!result?.diagnostics.length && source.warnings.length === 0 && labels.noIssues}
                        {source.warnings.length > 0 && <span className="source-marker">{labels.sourceWarnings}</span>}
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr><td className="quiet" colSpan={4}>{labels.filterEmpty}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {row && (
              <section className="row-editor" aria-label={fillLabel(labels.selected, { row: desk.selected + 1 })}>
                <div className="row-editor-head">
                  <div>
                    <h3>{fillLabel(labels.selected, { row: desk.selected + 1 })}</h3>
                    {result?.status === 'pass' && <p>{labels.cleanRow}</p>}
                    {desk.checking && <p>{labels.unresolved}</p>}
                  </div>
                  <div className="actions compact">
                    {desk.template && <a className="button secondary preview-jump" href="#preview">{labels.openPreview}</a>}
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
                  <ul className="diagnostics" aria-label={labels.diagnostics}>
                    {result.diagnostics.map((issue, index) => (
                      <li key={index}><bdi>{issue.field}</bdi>{' · '}{problem(issue.code) ?? labels.pdfError}</li>
                    ))}
                  </ul>
                )}
                {row.warnings.length > 0 && (
                  <div className="source-details">
                    <p>{labels.warningHelp}</p>
                    <ul>
                      {row.warnings.map((warning, index) => (
                        <li key={index}><bdi>{warning.column}</bdi>{' · '}{problem(warning.code) ?? labels.sourceWarnings}</li>
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
