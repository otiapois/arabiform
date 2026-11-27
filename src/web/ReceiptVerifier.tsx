import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PdfCustodyVerdict, QrCustodyVerdict } from '../core/custody/verify';
import './receipt-verifier.css';

const en = {
  heading: 'Verify receipt',
  description: 'Check delivered PDFs or a pasted QR payload against the batch custody manifest on this device.',
  fileTrust: 'Use the manifest supplied by the issuer as your reference.',
  manifest: 'Batch custody manifest',
  chooseManifest: 'Choose custody manifest',
  manifestHint: 'Choose or drop one receipt',
  pdfs: 'Delivered PDFs',
  choosePdfs: 'Choose delivered PDFs',
  pdfHint: 'Choose or drop one or more PDFs',
  clearPdfs: 'Clear delivered PDFs',
  qr: 'Scanned QR payload',
  qrHint: 'Paste the text from a scanned ArabiForm custody QR. You can also check PDF files in the same run.',
  run: 'Verify',
  checking: 'Checking against the custody manifest…',
  exact: 'Verified · Exact file match',
  mismatch: 'Tampered · File bytes differ',
  unknown: 'Unknown · PDF absent from this receipt',
  qrMatch: 'Verified · QR record found',
  qrUnknown: 'Unknown · QR record absent from this receipt',
  received: 'Delivered file SHA-256',
  expected: 'Receipt SHA-256',
  absent: 'No matching filename in the receipt.',
  qrMembership: 'This checks the QR record in the receipt. To check the delivered file bytes, add the PDF.',
  row: 'Roster row',
  batchPrefix: 'Batch digest prefix',
  invalidManifest: 'This file could not be read as a valid ArabiForm batch custody manifest. Choose the original JSON receipt.',
  chooseOne: 'Choose or drop exactly one batch custody manifest.',
  verifyFailed: 'Verification could not finish. Try again with the original custody manifest.',
  pdfError: 'This PDF could not be read. Choose the file again.',
  results: 'Verification results',
};

const ar: typeof en = {
  heading: 'التحقق من بيان الحيازة',
  description: 'قارن ملفات PDF المستلمة أو نص رمز QR ببيان حيازة الدفعة على هذا الجهاز.',
  fileTrust: 'استخدم البيان الذي أرسلته الجهة المصدرة مرجعًا للتحقق.',
  manifest: 'بيان حيازة الدفعة',
  chooseManifest: 'اختر بيان الحيازة',
  manifestHint: 'اختر ملف بيان واحدًا أو أفلته هنا',
  pdfs: 'ملفات PDF المستلمة',
  choosePdfs: 'اختر ملفات PDF المستلمة',
  pdfHint: 'اختر ملف PDF واحدًا أو أكثر أو أفلت الملفات هنا',
  clearPdfs: 'أزل ملفات PDF المختارة',
  qr: 'نص رمز QR الممسوح',
  qrHint: 'الصق نص رمز حيازة ArabiForm بعد مسحه. يمكنك أيضًا التحقق من ملفات PDF في العملية نفسها.',
  run: 'تحقّق',
  checking: 'جارٍ التحقق من بيان الحيازة…',
  exact: 'تم التحقق · الملف مطابق تمامًا',
  mismatch: 'تغيّر الملف · البيانات غير مطابقة',
  unknown: 'غير معروف · ملف PDF غير موجود في البيان',
  qrMatch: 'تم التحقق · سجل رمز QR موجود',
  qrUnknown: 'غير معروف · سجل رمز QR غير موجود في البيان',
  received: 'بصمة الملف المستلم',
  expected: 'البصمة المسجلة في البيان',
  absent: 'لا يوجد اسم ملف مطابق في البيان.',
  qrMembership: 'يؤكد هذا الفحص وجود سجل الرمز في البيان. للتحقق من بيانات الملف المستلم، أضف ملف PDF.',
  row: 'صف السجل',
  batchPrefix: 'بداية بصمة الدفعة',
  invalidManifest: 'تعذّرت قراءة الملف كبيان حيازة دفعة صالح من ArabiForm. اختر ملف JSON الأصلي.',
  chooseOne: 'اختر ملف بيان حيازة واحدًا فقط أو أفلته هنا.',
  verifyFailed: 'تعذّر إكمال التحقق. حاول مرة أخرى باستخدام بيان الحيازة الأصلي.',
  pdfError: 'تعذّرت قراءة ملف PDF. اختره مجددًا.',
  results: 'نتائج التحقق',
};

const verdicts = {
  VERIFIED_EXACT_MATCH: 'exact',
  TAMPERED_BYTE_MISMATCH: 'mismatch',
  UNMATCHED_UNKNOWN: 'unknown',
} as const satisfies Record<PdfCustodyVerdict['status'], keyof typeof en>;

type PdfCheck = { filename: string; verdict?: PdfCustodyVerdict };
type Verification = { pdfs: PdfCheck[]; qr?: QrCustodyVerdict };

function VerifyFilePicker({ id, title, action, accept, multiple, hint, choose, children }: {
  id: string;
  title: string;
  action: ReactNode;
  accept: string;
  multiple?: boolean;
  hint: ReactNode;
  choose: (files: File[]) => void;
  children?: ReactNode;
}) {
  return (
    <div className="verify-picker">
      <label className="field-label" htmlFor={id}>{title}</label>
      <div className="file-box" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length) choose(files);
      }}>
        <span className="quiet" id={id + '-hint'}>{hint}</span>
        <label className="button secondary preset-picker">
          <span id={id + '-action'}>{action}</span>
          <input type="file" id={id} data-testid={id} accept={accept} multiple={multiple}
            aria-labelledby={id + '-action'} aria-describedby={id + '-hint'} onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (files.length) choose(files);
            }} />
        </label>
      </div>
      {children}
    </div>
  );
}

export default function ReceiptVerifier({ arabic }: { arabic: boolean }) {
  const copy = arabic ? ar : en;
  const revision = useRef(0);
  const [manifest, setManifest] = useState<File>();
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [payload, setPayload] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<'chooseOne' | 'invalidManifest' | 'verifyFailed'>();
  const [result, setResult] = useState<Verification>();

  useEffect(() => () => { revision.current++; }, []);

  function clearResults() {
    revision.current++;
    setError(undefined);
    setResult(undefined);
    setPending(false);
  }

  function chooseManifest(files: File[]) {
    clearResults();
    setManifest(files.length === 1 ? files[0] : undefined);
    if (files.length !== 1) setError('chooseOne');
  }

  function choosePdfs(files: File[]) {
    clearResults();
    setPdfs(files);
  }

  async function verify() {
    const scan = payload.trim();
    if (!manifest || (!pdfs.length && !scan) || pending) return;
    const operation = ++revision.current;
    setError(undefined);
    setResult(undefined);
    setPending(true);
    try {
      const { parseCustodyManifest, verifyCustodyPdf, verifyCustodyQr } = await import('../core/custody/verify');
      let receipt: Awaited<ReturnType<typeof parseCustodyManifest>>;
      try {
        receipt = await parseCustodyManifest(await manifest.text());
      } catch {
        if (revision.current === operation) setError('invalidManifest');
        return;
      }
      const checks: PdfCheck[] = [];
      for (const file of pdfs) {
        if (revision.current !== operation) return;
        try {
          const verdict = await verifyCustodyPdf(receipt, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
          checks.push({ filename: file.name, verdict });
        } catch {
          checks.push({ filename: file.name });
        }
      }
      if (revision.current === operation) {
        setResult({ pdfs: checks, qr: scan ? verifyCustodyQr(receipt, scan) : undefined });
      }
    } catch {
      if (revision.current === operation) setError('verifyFailed');
    } finally {
      if (revision.current === operation) setPending(false);
    }
  }

  return (
    <section className="panel receipt-verifier" aria-labelledby="receipt-heading">
      <header><h2 id="receipt-heading">{copy.heading}</h2><p>{copy.description}</p></header>
      <div className="panel-body verify-body">
        <p className="quiet">{copy.fileTrust}</p>
        <div className="verify-pickers">
          <VerifyFilePicker id="verify-manifest" title={copy.manifest}
            action={<>{copy.chooseManifest} <bdi dir="ltr">(.json)</bdi></>}
            accept=".json,application/json" hint={copy.manifestHint} choose={chooseManifest}>
            <div aria-live="polite">{manifest && <bdi className="loaded-filename" dir="auto">{manifest.name}</bdi>}</div>
          </VerifyFilePicker>
          <VerifyFilePicker id="verify-pdfs" title={copy.pdfs} action={copy.choosePdfs}
            accept=".pdf,application/pdf" multiple hint={copy.pdfHint} choose={choosePdfs}>
            {!!pdfs.length && <>
              <ul aria-label={copy.pdfs} className="verify-filenames">
                {pdfs.map((file, index) => <li key={index}><bdi className="loaded-filename" dir="auto">{file.name}</bdi></li>)}
              </ul>
              <button type="button" className="text-button" onClick={() => choosePdfs([])}>{copy.clearPdfs}</button>
            </>}
          </VerifyFilePicker>
        </div>
        <div className="full-control verify-payload">
          <label htmlFor="verify-qr">{copy.qr}</label>
          <textarea id="verify-qr" rows={3} dir="ltr" value={payload} aria-describedby="verify-qr-hint" data-testid="verify-qr"
            onChange={(event) => { clearResults(); setPayload(event.currentTarget.value); }} />
          <small id="verify-qr-hint">{copy.qrHint}</small>
        </div>
        <div className="actions">
          <button type="button" className="button primary" data-testid="verify-run" onClick={() => void verify()}
            disabled={!manifest || (!pdfs.length && !payload.trim()) || pending}>{copy.run}</button>
        </div>
        {pending && <p className="quiet" role="status">{copy.checking}</p>}
        {error && <p className="alert" role="alert" data-testid="verify-error">{copy[error]}</p>}
        {result && <section className="verify-results" aria-labelledby="verify-results-heading" aria-live="polite">
          <h3 id="verify-results-heading">{copy.results}</h3>
          {result.pdfs.map(({ filename, verdict }, index) => (
            <article key={index} className="verify-card" data-testid="verify-result" data-status={verdict?.status ?? 'READ_ERROR'}>
              <h4><bdi dir="auto">{filename}</bdi></h4>
              <p className="verify-verdict">{verdict ? copy[verdicts[verdict.status]] : copy.pdfError}</p>
              {verdict && <dl className="verify-hashes">
                <div>
                  <dt>{copy.received}{arabic && <> <bdi dir="ltr">SHA-256</bdi></>}</dt>
                  <dd><code dir="ltr" data-testid="verify-received-sha256">{verdict.sha256}</code></dd>
                </div>
                <div>
                  <dt>{copy.expected}{arabic && <> <bdi dir="ltr">SHA-256</bdi></>}</dt>
                  <dd>{verdict.expectedSha256.length ? verdict.expectedSha256.map((digest) => (
                    <code dir="ltr" key={digest} data-testid="verify-expected-sha256">{digest}</code>
                  )) : copy.absent}</dd>
                </div>
              </dl>}
            </article>
          ))}
          {result.qr && <article className="verify-card" data-testid="verify-result" data-status={result.qr.status}>
            <h4>{copy.qr}</h4>
            <p className="verify-verdict">{result.qr.status === 'VERIFIED_QR_RECORD' ? copy.qrMatch : copy.qrUnknown}</p>
            {result.qr.status === 'VERIFIED_QR_RECORD' && (
              <dl className="verify-hashes">
                <div><dt>{copy.row}</dt><dd>{result.qr.rowNumber}</dd></div>
                <div><dt>{copy.batchPrefix}</dt><dd><code dir="ltr">{result.qr.batchDigestPrefix}</code></dd></div>
              </dl>
            )}
            <p className="quiet">{copy.qrMembership}</p>
          </article>}
        </section>}
      </div>
    </section>
  );
}
