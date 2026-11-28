import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DISPATCH_CSV_FILENAME, DISPATCH_ZIP_FILENAME, previewDispatch, unsafeDispatchFilenameRows,
  type DispatchIssue, type DispatchSettings } from '../core/dispatch/eml-pack';
import { makeQrPrintRequest } from './batch-exports';
import { saveDownload } from './resources';
import type { useWorkbench } from './useWorkbench';

const en = {
  recipient: 'Recipient email column',
  choose: 'Choose a worksheet column',
  subject: 'Subject',
  message: 'Message',
  preview: 'Draft preview',
  to: 'To',
  row: 'Row',
  pack: 'Offline Email Drafts',
  ledger: 'Dispatch Ledger',
  local: 'Creates one local email draft per selected ready row and attaches that row’s PDF. Review the drafts in your email client before sending.',
  tokensBefore: 'Use ',
  tokensAfter: ' with an exact worksheet column name in the subject or message.',
  noRows: 'Check the batch and select at least one ready row.',
  blocked: 'Resolve the current ZIP or print settings before creating drafts.',
  working: 'Creating email drafts locally…',
  ready: 'Draft pack created. The CSV and JSON ledgers are also included in the ZIP.',
  failed: 'The draft pack could not be created. Check the batch and output settings, then try again.',
  fix: 'Correct the draft settings or the affected rows in the queue. You can also remove rows from the export selection.',
  issues: {
    'invalid-recipient': 'Enter one valid recipient address without line breaks.',
    'invalid-cc': 'Enter one valid Cc address without line breaks.',
    'invalid-header': 'Remove line breaks or invalid characters from the subject or the worksheet values it uses.',
    'missing-token': 'Check the subject and message for worksheet column names that do not match.',
    'invalid-attachment': 'Check the filename pattern and source cells it uses for line breaks.',
    'attachment-mismatch': 'The PDF attachment could not be verified. Check the batch and try again.',
    'protected-column': 'Remove protected columns from the recipient, subject or message settings.',
  } satisfies Record<DispatchIssue['code'], string>,
};

const ar: typeof en = {
  recipient: 'عمود بريد المستلم',
  choose: 'اختر عمودًا من ورقة العمل',
  subject: 'الموضوع',
  message: 'الرسالة',
  preview: 'معاينة المسودة',
  to: 'إلى',
  row: 'الصف',
  pack: 'مسودات البريد للعمل دون اتصال',
  ledger: 'سجل التوزيع',
  local: 'ينشئ مسودة بريد محلية لكل صف جاهز ومحدد، ويرفق ملف PDF الخاص به. راجع المسودات في برنامج البريد قبل إرسالها.',
  tokensBefore: 'استخدم ',
  tokensAfter: ' مع اسم العمود كما يظهر في ورقة العمل لإدراج قيمته في الموضوع أو الرسالة.',
  noRows: 'افحص الدفعة وحدّد صفًا جاهزًا واحدًا على الأقل.',
  blocked: 'صحّح إعدادات ملف ZIP أو الطباعة قبل إنشاء المسودات.',
  working: 'جارٍ إنشاء مسودات البريد محليًا…',
  ready: 'أُنشئت حزمة المسودات. يتضمن ملف ZIP أيضًا سجلّي CSV وJSON.',
  failed: 'تعذّر إنشاء حزمة المسودات. راجع الدفعة وإعدادات التصدير وحاول مجددًا.',
  fix: 'صحّح إعدادات المسودات أو الصفوف المعنيّة في قائمة المراجعة. يمكنك أيضًا إزالة الصفوف من تحديد التصدير.',
  issues: {
    'invalid-recipient': 'أدخل عنوان بريد صالحًا واحدًا للمستلم دون فواصل أسطر.',
    'invalid-cc': 'أدخل عنوانًا صالحًا واحدًا للنسخة دون فواصل أسطر.',
    'invalid-header': 'أزل فواصل الأسطر أو المحارف غير الصالحة من الموضوع أو من قيم الأعمدة التي يستخدمها.',
    'missing-token': 'راجع أسماء أعمدة ورقة العمل المُدرجة في الموضوع والرسالة.',
    'invalid-attachment': 'تحقّق من عدم وجود فواصل أسطر في نمط التسمية أو خلايا المصدر التي يستخدمها.',
    'attachment-mismatch': 'تعذّر التحقق من ملف PDF المرفق. راجع الدفعة وحاول مجددًا.',
    'protected-column': 'أزل الأعمدة المحمية من إعدادات المستلم أو الموضوع أو الرسالة.',
  },
};

type Outcome = { status: 'building' | 'failed' } | { status: 'blocked'; issues: readonly DispatchIssue[] }
  | { status: 'ready'; ledger: string };

export default function EmailDrafts({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const [column, setColumn] = useState('');
  const [subjectTemplate, setSubject] = useState('');
  const [bodyTemplate, setBody] = useState('');
  const { checkedWorker, sheet, output, rows, roster, pattern, protectedColumns, exportScope: { selectedRowNumbers } } = desk;
  const recipientColumn = sheet?.headers.includes(column) ? column : '';
  const settings = useMemo<DispatchSettings>(() => ({ recipientColumn, subjectTemplate, bodyTemplate }),
    [recipientColumn, subjectTemplate, bodyTemplate]);
  const outputBlocked = desk.groupingBlocked || (output.flattenZip && desk.printSettingsBlocked);
  const job = useMemo(() => checkedWorker && roster && recipientColumn && selectedRowNumbers.length && !outputBlocked
    ? { worker: checkedWorker, rows, localDate: roster.localDate, output, settings, protectedColumns,
      rowNumbers: selectedRowNumbers, pattern }
    : undefined, [checkedWorker, roster, recipientColumn, selectedRowNumbers, outputBlocked, rows, output, settings, protectedColumns, pattern]);
  const [done, setDone] = useState<{ job: NonNullable<typeof job>; outcome: Outcome }>();
  const current = useRef<typeof job>(undefined);
  const operation = useRef<symbol | undefined>(undefined);
  useLayoutEffect(() => {
    current.current = job;
    setDone(undefined);
    return () => { current.current = undefined; operation.current = undefined; };
  }, [job]);

  const outcome = done?.job === job ? done?.outcome : undefined;
  const previewRow = selectedRowNumbers.includes(desk.selected + 1) ? desk.selected + 1 : selectedRowNumbers[0];
  const preview = recipientColumn && previewRow !== undefined
    ? previewDispatch(settings, rows[previewRow - 1]!.values, previewRow, protectedColumns) : undefined;

  async function download() {
    if (!job || operation.current) return;
    const token = Symbol();
    operation.current = token;
    const isCurrent = () => current.current === job && operation.current === token;
    setDone({ job, outcome: { status: 'building' } });
    try {
      const { worker, rows, output, localDate, protectedColumns } = job;
      const { flattenZip, filenamePlans, watermark, rowSelection, qrStamp, grouping, approvalSeal } = output;
      const qr = flattenZip ? await makeQrPrintRequest({ rows, localDate }, qrStamp, job.rowNumbers, isCurrent) : undefined;
      if (!isCurrent()) return;
      const values = rows.map((row) => row.values);
      const result = await worker.dispatch({
        settings: job.settings, rows: values, filenames: filenamePlans.map(({ filename }) => filename),
        unsafeFilenameRows: unsafeDispatchFilenameRows(values, job.pattern, grouping?.groupByColumn),
        protectedColumns: protectedColumns ? [...protectedColumns] : undefined,
        flattenZip, watermark: flattenZip ? watermark : undefined, rowSelection, qrStamp: qr, grouping,
        approvalSeal: flattenZip ? approvalSeal : undefined,
      });
      if (!isCurrent()) return;
      if (result.status === 'blocked') setDone({ job, outcome: { status: 'blocked', issues: result.issues } });
      else {
        saveDownload(result.bytes, DISPATCH_ZIP_FILENAME, 'application/zip');
        setDone({ job, outcome: { status: 'ready', ledger: result.ledgerCsv } });
      }
    } catch {
      if (isCurrent()) setDone({ job, outcome: { status: 'failed' } });
    } finally {
      if (isCurrent()) operation.current = undefined;
    }
  }

  return <div className="review-dispatch-content">
    <p className="quiet">{copy.local}</p>
    <label className="full-control">
      {copy.recipient}
      <select data-testid="dispatch-recipient-column" dir="auto" value={recipientColumn}
        disabled={!sheet} onChange={(event) => setColumn(event.currentTarget.value)}>
        <option value="">{copy.choose}</option>
        {sheet?.headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select>
    </label>
    <label className="full-control">
      {copy.subject}
      <input type="text" dir="auto" data-testid="dispatch-subject" value={subjectTemplate}
        aria-describedby="dispatch-token-help" onChange={(event) => setSubject(event.currentTarget.value)} />
    </label>
    <label className="full-control">
      {copy.message}
      <textarea dir="auto" rows={3} data-testid="dispatch-message" value={bodyTemplate}
        aria-describedby="dispatch-token-help" onChange={(event) => setBody(event.currentTarget.value)} />
    </label>
    <small id="dispatch-token-help">{copy.tokensBefore}<bdi dir="ltr">{'{{Column}}'}</bdi>{copy.tokensAfter}</small>
    {preview && <section className="dispatch-preview" data-testid="dispatch-preview" aria-labelledby="dispatch-preview-heading">
      <h3 id="dispatch-preview-heading">{copy.preview}{' · '}{copy.row}{' '}{previewRow}</h3>
      {preview.status === 'blocked' ? <p>{copy.issues[preview.issue.code]}</p> : <dl>
        <div><dt>{copy.to}</dt><dd><bdi dir="ltr">{preview.recipient}</bdi></dd></div>
        <div><dt>{copy.subject}</dt><dd dir="auto">{preview.subject}</dd></div>
        <div><dt>{copy.message}</dt><dd dir="auto">{preview.body}</dd></div>
      </dl>}
    </section>}
    <div className="actions compact">
      <button type="button" className="button primary" data-testid="dispatch-download"
        disabled={!job || desk.exporting || outcome?.status === 'building'} onClick={() => void download()}>
        <span>{copy.pack} <bdi dir="ltr">(.zip)</bdi></span>
      </button>
      <button type="button" className="button secondary" data-testid="dispatch-ledger-download"
        disabled={outcome?.status !== 'ready'} onClick={() => {
          if (current.current === job && outcome?.status === 'ready') {
            saveDownload(outcome.ledger, DISPATCH_CSV_FILENAME, 'text/csv;charset=utf-8');
          }
        }}>
        <span>{copy.ledger} <bdi dir="ltr">(.csv)</bdi></span>
      </button>
    </div>
    <div aria-live="polite" data-testid="dispatch-status">
      {!selectedRowNumbers.length && <p className="quiet">{copy.noRows}</p>}
      {selectedRowNumbers.length > 0 && outputBlocked && <p className="alert warning">{copy.blocked}</p>}
      {outcome?.status === 'building' && <p className="quiet">{copy.working}</p>}
      {outcome?.status === 'ready' && <p className="quiet">{copy.ready}</p>}
      {outcome?.status === 'failed' && <p className="alert">{copy.failed}</p>}
      {outcome?.status === 'blocked' && <div className="alert" data-testid="dispatch-issues">
        <p>{copy.fix}</p>
        <ul className="dispatch-issues">
          {outcome.issues.map(({ rowNumber, code, field }) => <li key={`${rowNumber}:${code}:${field}`}>
            {copy.row}{' '}{rowNumber}{' · '}{copy.issues[code]}
          </li>)}
        </ul>
      </div>}
    </div>
  </div>;
}
