import { useState, type ReactNode } from 'react';
import { createCustodyManifest, CUSTODY_PREFIX_LENGTH, type CustodySources } from '../core/audit/custody';
import type { ExportScope } from '../core/worker/row-selection';
import type { CustodyOutputs } from './useBatch';
import { saveDownload } from './resources';

type CustodyPanelProps = {
  sources: CustodySources;
  outputs?: CustodyOutputs;
  scope: ExportScope;
  disabled: boolean;
  label: ReactNode;
  arabic: boolean;
};

const en = {
  template: 'Template SHA-256',
  roster: 'Roster SHA-256',
  copy: 'Copy full fingerprint',
  copied: 'Fingerprint copied.',
  copyFailed: 'Select the full fingerprint and copy it manually.',
  sources: 'Export a ZIP or merged PDF to add its PDF checksums to the manifest.',
  zip: 'Manifest includes checksums for the exported ZIP members.',
  merged: 'Manifest includes the checksum for the exported merged PDF.',
  both: 'Manifest includes checksums for the exported ZIP members and merged PDF.',
  split: 'Manifest includes checksums for the exported per-group merged PDFs.',
  qr: 'Manifest includes the printed custody QR records.',
};

const ar: typeof en = {
  template: 'للقالب',
  roster: 'لملف السجلات',
  copy: 'انسخ البصمة الكاملة',
  copied: 'تم نسخ البصمة.',
  copyFailed: 'حدّد البصمة الكاملة وانسخها يدويًا.',
  sources: 'صدّر ملف ZIP أو ملف PDF مدمجًا لإضافة بصمات ملفات PDF إلى البيان.',
  zip: 'يشمل البيان بصمات ملفات PDF داخل ملف ZIP الذي صدّرته.',
  merged: 'يشمل البيان بصمة ملف PDF المدمج الذي صدّرته.',
  both: 'يشمل البيان بصمات ملفات PDF داخل ملف ZIP وبصمة ملف PDF المدمج.',
  split: 'يشمل البيان بصمات ملفات PDF المدمجة لكل مجموعة.',
  qr: 'يشمل البيان سجلات رموز QR للحيازة التي طُبعت.',
};

export default function CustodyPanel({ sources, outputs, scope, disabled, label, arabic }: CustodyPanelProps) {
  const copy = arabic ? ar : en;
  const [copyStatus, setCopyStatus] = useState<'copied' | 'copyFailed'>();
  const coverage = outputs?.entries ? outputs.mergedPdfSha256 ? copy.both : copy.zip
    : outputs?.mergedPdfSha256 ? copy.merged : outputs?.groups ? undefined : copy.sources;

  async function copyFingerprint(digest: string) {
    setCopyStatus(undefined);
    try {
      await navigator.clipboard.writeText(digest);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('copyFailed');
    }
  }

  return (
    <>
      <button type="button" className="button secondary" data-testid="custody-download" disabled={disabled}
        onClick={() => saveDownload(createCustodyManifest(sources, outputs, scope), 'arabiform-custody-manifest.json', 'application/json')}>{label}</button>
      <p className="quiet" role="status" data-testid="custody-coverage">{coverage}{coverage && outputs?.groups && ' '}{outputs?.groups && copy.split}</p>
      {!!outputs?.qrRecords?.length && <p className="quiet" role="status">{copy.qr}</p>}
      <dl className="custody-fingerprints">
        {([['template', sources.templateSha256], ['roster', sources.rosterSha256]] as const).map(([source, digest]) => (
          <div key={source}>
            <dt id={`custody-label-${source}`}>{arabic ? <><bdi dir="ltr">SHA-256</bdi> {copy[source]}</> : copy[source]}</dt>
            <dd>
              <details>
                <summary aria-labelledby={`custody-label-${source} custody-prefix-${source}`}>
                  <bdi dir="ltr" id={`custody-prefix-${source}`} data-testid={`custody-${source}-prefix`}>{digest.slice(0, CUSTODY_PREFIX_LENGTH)}…</bdi>
                </summary>
                <code className="custody-digest" dir="ltr" data-testid={`custody-${source}-sha256`}>{digest}</code>
                <button type="button" className="text-button" data-testid={`custody-copy-${source}`}
                  aria-labelledby={`custody-copy-label-${source} custody-label-${source}`} onClick={() => void copyFingerprint(digest)}>
                  <span id={`custody-copy-label-${source}`}>{copy.copy}</span>
                </button>
              </details>
            </dd>
          </div>
        ))}
      </dl>
      <p className="quiet" role="status">{copyStatus ? copy[copyStatus] : undefined}</p>
    </>
  );
}
