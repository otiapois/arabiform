import { useEffect, useRef, useState } from 'react';
import { Filename } from './Filename';
import { decodeBase64, loadFonts } from './bundled-assets';
import { saveDownload } from './resources';
import { batchDiffCopy } from './compare-batches-labels';
import type { ComparisonFailure, ComparisonRequest, ComparisonResponse, ComparisonResult, ComparisonSide } from './compare-batches.worker';
import './compare-batches.css';

const sides = ['previous', 'next'] as const;
const statuses = ['unchanged', 'modified', 'added', 'removed'] as const;
const downloads = [
  ['zip', 'zip', 'deltaZip', 'delta-reprint-pdfs.zip', 'application/zip'],
  ['csv', 'audit', 'auditCsv', 'batch-diff-audit.csv', 'text/csv;charset=utf-8'],
  ['json', 'audit', 'auditJson', 'batch-diff-audit.json', 'application/json'],
  ['pdf', 'summary', 'summary', 'delta-reprint-summary.pdf', 'application/pdf'],
] as const;

type Copy = typeof batchDiffCopy.en;
type Source = { file: File; synthetic?: true };
type Sources = Partial<Record<ComparisonSide, Source>>;
type SourcePair = Record<ComparisonSide, Source>;
type Filter = 'all' | typeof statuses[number];
type State =
  | { phase: 'busy' }
  | { phase: 'ready'; result: ComparisonResult }
  | { phase: 'error'; failure?: ComparisonFailure; multiple?: ComparisonSide };

function ArchiveName({ name }: { name: string }) {
  return /.(zip|pdf|csv)$/i.test(name) ? <Filename name={name} /> : <bdi dir="auto">{name}</bdi>;
}

function FieldValue({ value, copy }: { value: string | string[] | null; copy: Copy }) {
  if (value === null) return <span className="quiet">{copy.missingValue}</span>;
  if (typeof value === 'string') return value.length
    ? <bdi className="batch-diff-value" dir="auto">{value}</bdi>
    : <span className="quiet">{copy.emptyValue}</span>;
  return value.length
    ? <ol className="batch-diff-choices">{value.map((choice, index) => <li key={index}><FieldValue value={choice} copy={copy} /></li>)}</ol>
    : <span className="quiet">{copy.emptyList}</span>;
}

export default function CompareBatches({ arabic }: { arabic: boolean }) {
  const copy = batchDiffCopy[arabic ? 'ar' : 'en'];
  const [sources, setSources] = useState<Sources>({});
  const [state, setState] = useState<State>();
  const [filter, setFilter] = useState<Filter>('all');
  const operation = useRef<AbortController>(null);

  useEffect(() => () => operation.current?.abort(), []);

  function choose(side: ComparisonSide, files: FileList | null) {
    if (!files?.length) return;
    const file = files.length === 1 ? files[0] : undefined;
    operation.current?.abort();
    operation.current = null;
    setSources((current) => ({ ...current, [side]: file ? { file } : undefined }));
    setState(file ? undefined : { phase: 'error', multiple: side });
  }

  async function compare(pair?: SourcePair) {
    operation.current?.abort();
    const task = new AbortController();
    operation.current = task;
    setState({ phase: 'busy' });
    setFilter('all');
    if (!pair) setSources({});
    try {
      const [fonts, files] = await Promise.all([
        loadFonts(),
        pair ?? import('virtual:arabiform/batch-diff-demo').then((demo): SourcePair => ({
          previous: { file: new File([decodeBase64(demo.previous)], 'synthetic-monday.zip', { type: 'application/zip' }), synthetic: true },
          next: { file: new File([decodeBase64(demo.next)], 'synthetic-tuesday.zip', { type: 'application/zip' }), synthetic: true },
        })),
      ]);
      if (task.signal.aborted) return;
      if (!pair) setSources(files);
      const request: ComparisonRequest = { previous: files.previous.file, next: files.next.file, fonts };
      const worker = new Worker(new URL('./compare-batches.worker.ts', import.meta.url), { type: 'module' });
      const stop = () => worker.terminate();
      task.signal.addEventListener('abort', stop, { once: true });
      function finish(next: State) {
        stop();
        task.signal.removeEventListener('abort', stop);
        if (operation.current !== task) return;
        operation.current = null;
        setState(next);
      }
      worker.onmessage = ({ data }: MessageEvent<ComparisonResponse>) => finish(data.ok
        ? { phase: 'ready', result: data.output }
        : { phase: 'error', failure: data.failure });
      worker.onerror = (event) => {
        event.preventDefault();
        finish({ phase: 'error' });
      };
      worker.onmessageerror = () => finish({ phase: 'error' });
      worker.postMessage(request);
    } catch {
      if (operation.current !== task) return;
      task.abort();
      operation.current = null;
      setState({ phase: 'error' });
    }
  }

  const result = state?.phase === 'ready' ? state.result : undefined;
  const failure = state?.phase === 'error' ? state.failure : undefined;
  const problemSide = state?.phase === 'error' ? failure?.batch ?? state.multiple : undefined;
  const entries = result && (filter === 'all' ? result.entries : result.entries.filter(({ status }) => status === filter));
  const { previous, next } = sources;
  const bothSynthetic = previous?.synthetic && next?.synthetic;

  return (
    <section className="panel batch-diff" aria-labelledby="batch-diff-heading">
      <header><h2 id="batch-diff-heading">{copy.title}</h2><p>{copy.intro}</p></header>
      <div className="panel-body batch-diff-body">
        <div className="batch-diff-sources">
          {sides.map((side) => {
            const id = 'batch-diff-' + side;
            const source = sources[side];
            return <label key={side} className="batch-diff-dropzone" onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }} onDrop={(event) => {
              event.preventDefault();
              choose(side, event.dataTransfer.files);
            }}>
              <span id={id + '-label'} className="batch-diff-source-label">{copy[side]}{' '}<bdi dir="ltr">(.zip)</bdi></span>
              <span id={id + '-detail'} className="quiet batch-diff-source-detail">{source
                ? <><ArchiveName name={source.file.name} /> {source.synthetic && !bothSynthetic && <span className="tag tag-pass">{copy.synthetic}</span>}</>
                : copy.drop}</span>
              <span className="button secondary">{copy.choose}</span>
              <input type="file" accept=".zip,application/zip,application/x-zip-compressed" data-testid={id}
                aria-labelledby={id + '-label'}
                aria-describedby={id + '-detail' + (problemSide === side ? ' batch-diff-error' : '')}
                aria-invalid={problemSide === side || undefined}
                onChange={(event) => {
                  choose(side, event.currentTarget.files);
                  event.currentTarget.value = '';
                }} />
            </label>;
          })}
        </div>
        <div className="actions">
          <button type="button" className="button primary" data-testid="batch-diff-run" disabled={!previous || !next || state?.phase === 'busy'}
            onClick={() => previous && next && void compare({ previous, next })}>{copy.compare}</button>
          <button type="button" className="button secondary" data-testid="batch-diff-demo" disabled={state?.phase === 'busy'}
            onClick={() => void compare()}>{copy.demo}</button>
          {bothSynthetic && <span className="tag tag-pass">{copy.synthetic}</span>}
        </div>
        <p className="quiet batch-diff-progress" role="status" aria-atomic="true">
          {state?.phase === 'busy' ? copy.busy : result ? copy.ready : undefined}
        </p>
        {state?.phase === 'error' && <p className="alert" id="batch-diff-error" role="alert">
          {problemSide && <strong>{copy[problemSide]}{' '}<bdi dir="ltr">(.zip)</bdi>{' · '}</strong>}
          {state.multiple ? copy.oneFile : failure ? copy.errors[failure.code] : copy.failed}
          {failure?.path && <>{' '}<ArchiveName name={failure.path} /></>}
        </p>}
        {result && <section className="batch-diff-results" aria-labelledby="batch-diff-results-heading">
          <h3 id="batch-diff-results-heading">{copy.results}</h3>
          <dl className="batch-diff-counts">
            {statuses.map((status) => <div key={status} data-status={status}>
              <dt>{copy[status]}</dt><dd data-testid={'batch-diff-count-' + status}>{result.counts[status]}</dd>
            </div>)}
            <div className="batch-diff-savings">
              <dt>{copy.savings}</dt><dd data-testid="batch-diff-count-savings">
                {result.reprint.savingsPercent === null ? '—' : <bdi dir="ltr">{Number(result.reprint.savingsPercent.toFixed(2))}%</bdi>}
              </dd>
              <dd className="quiet">{result.reprint.savingsPercent === null
                ? copy.savingsUnavailable : copy.pageCounts(result.reprint.deltaPages, result.reprint.fullPages)}</dd>
            </div>
          </dl>
          <div className="actions" role="group" aria-label={copy.downloads}>
            {downloads.map(([extension, label, key, name, type], index) =>
              <button key={key} type="button" className={'button ' + (index ? 'secondary' : 'primary')}
                data-testid={'batch-diff-download-' + extension} onClick={() => saveDownload(result[key], name, type)}>
                <span>{copy[label]}{' '}<bdi dir="ltr">(.{extension})</bdi></span>
              </button>)}
          </div>
          <label className="full-control batch-diff-filter">
            {copy.filter}
            <select data-testid="batch-diff-filter" value={filter}
              onChange={(event) => setFilter(event.currentTarget.value as Filter)}>
              {(['all', ...statuses] as const).map((status) => <option key={status} value={status}>{copy[status]}</option>)}
            </select>
          </label>
          {entries?.length ? <table className="batch-diff-table" data-testid="batch-diff-table" aria-label={copy.table}>
            <thead><tr><th scope="col">{copy.file}</th><th scope="col">{copy.status}</th></tr></thead>
            {entries.map((entry) => <tbody className="batch-diff-file" key={entry.path} data-status={entry.status}>
              <tr>
                <th scope="row"><Filename name={entry.path} /></th>
                <td><span className={'tag ' + (entry.status === 'modified' ? 'tag-flagged' : entry.status === 'removed' ? 'tag-pending' : 'tag-pass')}>
                  {copy[entry.status]}
                </span></td>
              </tr>
              {entry.fieldChanges.length > 0 && <tr><td colSpan={2}>
                <table className="batch-diff-fields" aria-label={copy.changes + ' · ' + entry.path}>
                  <thead><tr><th scope="col">{copy.field}</th><th scope="col">{copy.oldValue}</th><th scope="col">{copy.newValue}</th></tr></thead>
                  <tbody>{entry.fieldChanges.map(({ field, oldValue, newValue, oldNativeValue, newNativeValue }) => <tr key={field}>
                    <th scope="row"><bdi dir="auto">{field}</bdi></th>
                    {[[oldValue, oldNativeValue], [newValue, newNativeValue]].map(([value, native], index) =>
                      <td key={index}><FieldValue value={value ?? null} copy={copy} />
                        {typeof native === 'string' && <p className="quiet">{copy.nativeValue}{' · '}<FieldValue value={native} copy={copy} /></p>}
                      </td>)}
                  </tr>)}</tbody>
                </table>
              </td></tr>}
              {entry.reason === 'visual-or-flattened-change' && <tr><td colSpan={2}><p className="quiet">{copy.visual}</p></td></tr>}
            </tbody>)}
          </table> : <p className="quiet" role="status">{copy.noMatches}</p>}
        </section>}
      </div>
    </section>
  );
}
