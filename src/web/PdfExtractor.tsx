import { useState } from 'react';
import type { ExtractBatchResult, ExtractFieldKind, ExtractFieldValue, ExtractInput, ExtractStatus } from '../core/extractor/extract';
import { Filename } from './Filename';
import { errorCode, saveDownload } from './resources';
import './pdf-extractor.css';

const copy = {
  en: {
    heading: 'Extract filled PDFs',
    intro: 'Turn completed PDF forms into a spreadsheet. Files are processed in this browser.',
    choose: 'Choose PDF files',
    drop: 'Drop 1–200 filled PDF forms here',
    demo: 'Try Synthetic Arabic Filled-PDFs Demo',
    synthetic: 'Synthetic Sample',
    badSize: 'Choose between 1 and 200 PDF files.',
    badType: 'Choose only PDF files.',
    excelLimit: 'This batch exceeds Excel’s column or cell text limit. Group PDFs by form layout or shorten long values in the source PDFs.',
    failed: 'Extraction could not finish. Choose the files again to retry.',
    processing: 'Extracting PDF forms',
    results: 'Extraction results',
    source: 'Source file',
    state: 'Status',
    digest: 'SHA-256',
    digestDetails: 'Full source SHA-256',
    total: 'PDFs',
    extracted: 'Extracted',
    warnings: 'Schema warnings',
    blocked: 'Blocked',
    missing: 'Missing fields',
    extra: 'Extra fields',
    changed: 'Field type changed',
    native: 'PDF value',
    label: 'Display label',
    checked: 'Checked',
    unchecked: 'Unchecked',
    scroll: 'Scroll across the table to see all fields.',
    previous: 'Previous page',
    next: 'Next page',
    downloads: 'Extraction downloads',
    downloadCsv: 'Download CSV',
    downloadXlsx: 'Download .xlsx',
    downloadAudit: 'Download Custody JSON',
    statuses: {
      extracted: 'Extracted',
      'warning-schema-mismatch': 'Schema mismatch',
      'blocked-invalid': 'Invalid PDF (blocked)',
      'blocked-flat': 'Flat PDF (blocked)',
      'blocked-encrypted': 'Encrypted PDF (blocked)',
      'blocked-xfa': 'XFA PDF (blocked)',
      'blocked-signed': 'Signed PDF (blocked)',
    } satisfies Record<ExtractStatus, string>,
    kinds: { text: 'Text', checkbox: 'Checkbox', dropdown: 'Dropdown', radio: 'Radio', listbox: 'List box' } satisfies Record<ExtractFieldKind, string>,
  },
  ar: {
    heading: 'استخراج بيانات ملفات PDF المعبأة',
    intro: 'حوّل النماذج المعبأة إلى جدول بيانات. تُعالَج الملفات داخل هذا المتصفح.',
    choose: 'اختر ملفات PDF',
    drop: 'أفلت هنا من 1 إلى 200 نموذج PDF معبّأ',
    demo: 'جرّب ملفات PDF عربية مُعبّأة تجريبياً',
    synthetic: 'عينة اصطناعية',
    badSize: 'اختر من 1 إلى 200 ملف PDF.',
    badType: 'اختر ملفات PDF فقط.',
    excelLimit: 'تجاوزت الدفعة حدّ الأعمدة أو طول نص الخلية في Excel. افصل الملفات حسب تصميم النموذج أو اختصر القيم الطويلة في الملفات الأصلية.',
    failed: 'تعذّر إكمال الاستخراج. اختر الملفات مجدداً لإعادة المحاولة.',
    processing: 'جارٍ استخراج بيانات النماذج',
    results: 'نتائج الاستخراج',
    source: 'الملف الأصلي',
    state: 'الحالة',
    digest: 'SHA-256',
    digestDetails: 'بصمة الملف الأصلية كاملة',
    total: 'ملفات PDF',
    extracted: 'اكتمل استخراجها',
    warnings: 'اختلافات في الحقول',
    blocked: 'ملفات مرفوضة',
    missing: 'حقول ناقصة',
    extra: 'حقول إضافية',
    changed: 'تغيّر نوع الحقل',
    native: 'قيمة PDF',
    label: 'التسمية الظاهرة',
    checked: 'محدّد',
    unchecked: 'غير محدّد',
    scroll: 'مرّر الجدول أفقياً لعرض جميع الحقول.',
    previous: 'الصفحة السابقة',
    next: 'الصفحة التالية',
    downloads: 'تنزيل نتائج الاستخراج',
    downloadCsv: <span>نزّل <bdi dir="ltr">CSV</bdi></span>,
    downloadXlsx: <span>نزّل <bdi dir="ltr">.xlsx</bdi></span>,
    downloadAudit: <span>نزّل سجل الحيازة <bdi dir="ltr">JSON</bdi></span>,
    statuses: {
      extracted: 'اكتمل الاستخراج',
      'warning-schema-mismatch': 'اختلاف في الحقول',
      'blocked-invalid': 'ملف غير صالح (مرفوض)',
      'blocked-flat': 'ملف بلا حقول (مرفوض)',
      'blocked-encrypted': 'ملف مشفّر (مرفوض)',
      'blocked-xfa': 'نموذج XFA (مرفوض)',
      'blocked-signed': 'ملف موقّع (مرفوض)',
    } satisfies Record<ExtractStatus, string>,
    kinds: { text: 'نص', checkbox: 'مربع اختيار', dropdown: 'قائمة منسدلة', radio: 'اختيار واحد', listbox: 'قائمة خيارات' } satisfies Record<ExtractFieldKind, string>,
  },
};

const maxFiles = 200;
const pageSize = 20;
const downloads = [
  { type: 'csv', label: 'downloadCsv', name: 'arabiform-extracted.csv', mime: 'text/csv;charset=utf-8' },
  { type: 'xlsx', label: 'downloadXlsx', name: 'arabiform-extracted.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { type: 'audit', label: 'downloadAudit', name: 'arabiform-extraction-audit.json', mime: 'application/json' },
] as const;

type Copy = (typeof copy)[keyof typeof copy];
type State =
  | { stage: 'running'; done: number; total: number }
  | { stage: 'error'; error: 'badSize' | 'badType' | 'excelLimit' | 'failed' }
  | { stage: 'complete'; result: ExtractBatchResult; synthetic: boolean };

function ExtractedText({ value }: { value: string }) {
  return <bdi dir={/^(?:[^\p{L}]|\p{Script=Latin})*$/u.test(value) ? 'ltr' : 'auto'}>{value}</bdi>;
}

function ExtractedValue({ field, labels }: { field: ExtractFieldValue | undefined; labels: Copy }) {
  if (!field) return <span aria-hidden="true">—</span>;
  return <>
    {field.kind === 'checkbox' ? labels[field.value === 'checked' ? 'checked' : 'unchecked'] : <ExtractedText value={field.value} />}
    {field.nativeValue !== undefined && <small>{labels.native}{' '}<ExtractedText value={field.nativeValue} /></small>}
    {field.displayLabel !== undefined && field.displayLabel !== field.value && <small>{labels.label}{' '}<ExtractedText value={field.displayLabel} /></small>}
  </>;
}

function ExtractionResults({ result, labels }: { result: ExtractBatchResult; labels: Copy }) {
  const [page, setPage] = useState(0);
  const { rows, columns, artifacts } = result;
  const first = page * pageSize;
  const last = Math.min(first + pageSize, rows.length);
  const extracted = rows.filter(({ status }) => status === 'extracted').length;
  const warnings = rows.filter(({ status }) => status === 'warning-schema-mismatch').length;

  return (
    <section className="panel extract-results" aria-labelledby="extract-results-heading">
      <header className="wide-heading">
        <div>
          <h2 id="extract-results-heading">{labels.results}</h2>
          <p>{labels.scroll}</p>
        </div>
        <div className="actions compact" role="group" aria-label={labels.downloads}>
          {downloads.map(({ type, label, name, mime }) => (
            <button key={type} type="button" className={`button ${type === 'csv' ? 'primary' : 'secondary'}`}
              data-testid={`extract-download-${type}`} onClick={() => saveDownload(artifacts[type], name, mime)}>{labels[label]}</button>
          ))}
        </div>
      </header>
      <dl className="counts">
        {([[labels.total, rows.length], [labels.extracted, extracted], [labels.warnings, warnings], [labels.blocked, rows.length - extracted - warnings]] as const)
          .map(([label, count]) => <div key={label}><dt>{label}</dt><dd><bdi dir="ltr">{count}</bdi></dd></div>)}
      </dl>
      <div className="table-scroll" role="region" aria-labelledby="extract-results-heading" tabIndex={0}>
        <table aria-labelledby="extract-results-heading" data-testid="extract-results">
          <thead><tr>
            <th scope="col">{labels.source}</th>
            <th scope="col">{labels.state}</th>
            <th scope="col"><bdi dir="ltr">{labels.digest}</bdi></th>
            {columns.map(({ name }) => <th scope="col" key={name}><ExtractedText value={name} /></th>)}
          </tr></thead>
          <tbody>{rows.slice(first, last).map((row, index) => (
            <tr key={first + index} data-testid="extract-row" data-extract-status={row.status}>
              <th scope="row"><Filename name={row.filename} /></th>
              <td>
                <span className={`tag ${row.schema ? 'tag-flagged' : row.status === 'extracted' ? 'tag-pass' : 'extract-blocked'}`}>{labels.statuses[row.status]}</span>
                {row.schema && (
                  <dl className="extract-schema">
                    {row.schema.missing.length > 0 && <>
                      <dt>{labels.missing}</dt>
                      <dd>{row.schema.missing.map(name => <div key={name}><ExtractedText value={name} /></div>)}</dd>
                    </>}
                    {row.schema.extra.length > 0 && <>
                      <dt>{labels.extra}</dt>
                      <dd>{row.schema.extra.map(name => <div key={name}><ExtractedText value={name} /></div>)}</dd>
                    </>}
                    {row.schema.typeChanged.length > 0 && <>
                      <dt>{labels.changed}</dt>
                      <dd>{row.schema.typeChanged.map(({ name, expected, actual }) => (
                        <div key={name}><ExtractedText value={name} /> ({labels.kinds[expected]} → {labels.kinds[actual]})</div>
                      ))}</dd>
                    </>}
                  </dl>
                )}
              </td>
              <td>
                <details className="extract-hash" data-testid="extract-source-sha256">
                  <summary title={row.sourceSha256} aria-label={`${labels.digestDetails} · ${row.filename}`}><bdi dir="ltr">{row.sourceSha256.slice(0, 12)}…</bdi></summary>
                  <bdi className="custody-digest" dir="ltr">{row.sourceSha256}</bdi>
                </details>
              </td>
              {columns.map(({ name }) => <td key={name}><ExtractedValue field={row.fields[name]} labels={labels} /></td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="queue-pagination">
          <p role="status"><bdi dir="ltr">{first + 1}–{last} / {rows.length}</bdi></p>
          <div className="actions compact">
            <button className="button secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{labels.previous}</button>
            <button className="button secondary" type="button" disabled={last === rows.length} onClick={() => setPage(page + 1)}>{labels.next}</button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function PdfExtractor({ arabic }: { arabic: boolean }) {
  const labels = copy[arabic ? 'ar' : 'en'];
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<State>();
  const busy = state?.stage === 'running';

  async function run(total: number, synthetic: boolean, readInputs: () => Promise<ExtractInput[]>) {
    setState({ stage: 'running', done: 0, total });
    try {
      const { extractBatch } = await import('../core/extractor/extract');
      const result = await extractBatch(await readInputs(), (done, total) => setState({ stage: 'running', done, total }));
      setState({ stage: 'complete', result, synthetic });
    } catch (error) {
      setState({ stage: 'error', error: errorCode(error, '') === 'extract-spreadsheet-limit' ? 'excelLimit' : 'failed' });
    }
  }

  function choose(files: File[]) {
    if (busy || files.length === 0) return;
    if (files.length > maxFiles) {
      setState({ stage: 'error', error: 'badSize' });
      return;
    }
    if (files.some(({ name }) => !/\.pdf$/i.test(name))) {
      setState({ stage: 'error', error: 'badType' });
      return;
    }
    void run(files.length, false, () => Promise.all(files.map(async file => ({ filename: file.name, bytes: await file.arrayBuffer() }))));
  }

  return (
    <div className="workbench" id="pdf-extractor" data-testid="pdf-extractor" aria-busy={busy}>
      <section className="panel" aria-labelledby="extract-heading">
        <header>
          <h2 id="extract-heading">{labels.heading}</h2>
          <p>{labels.intro}</p>
        </header>
        <div className="panel-body file-stack">
          <div className="extract-drop" data-testid="extract-pdf-dropzone" data-dragging={dragging}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes('Files')) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
              if (!busy) setDragging(true);
            }}
            onDragLeave={event => {
              if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false);
            }}
            onDrop={event => {
              event.preventDefault();
              setDragging(false);
              choose(Array.from(event.dataTransfer.files));
            }}>
            <span className="file-icon" aria-hidden="true" />
            <p className="quiet" id="extract-file-range">{labels.drop}</p>
            <label className="button primary preset-picker">
              {labels.choose}
              <input type="file" multiple accept=".pdf,application/pdf" aria-label={labels.choose} aria-describedby="extract-file-range"
                data-testid="extract-pdf-upload" disabled={busy} onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  choose(files);
                }} />
            </label>
          </div>
          <div className="actions extract-demo">
            <button type="button" className="button secondary" data-testid="extract-demo" disabled={busy} onClick={() =>
              void run(3, true, async () => (await import('./extractor-demo')).createExtractorDemo())
            }>{labels.demo}</button>
            {state?.stage === 'complete' && state.synthetic && <strong className="tag tag-pass" data-testid="extract-synthetic">{labels.synthetic}</strong>}
          </div>
          {state?.stage === 'running' && <div className="batch-meter">
            <div className="batch-meter-caption">
              <span id="extract-progress-label">{labels.processing}</span>
              <bdi dir="ltr">{state.done} / {state.total}</bdi>
            </div>
            <progress value={state.done} max={state.total} aria-labelledby="extract-progress-label" />
          </div>}
          {state?.stage === 'error' && <p className="alert" role="alert">{labels[state.error]}</p>}
          <p className="sr-only" role="status">{state?.stage === 'complete' ? labels.results : ''}</p>
        </div>
      </section>
      {state?.stage === 'complete' && <ExtractionResults result={state.result} labels={labels} />}
    </div>
  );
}
