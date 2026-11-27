import { useEffect, useMemo, useState } from 'react';
import type { CustodySources } from '../core/audit/custody';
import { createCustodyQrRecords } from '../core/custody/records';
import { encodeQr, resolveQrPayload } from '../core/pdf/qr-encoder';
import { DEFAULT_QR_SIZE_PT, DEFAULT_QR_STAMP, validateQrStampSettings, type QrStampSettings } from '../core/pdf/qr-settings';
import { printProblem } from './ExportError';
import { errorCode } from './resources';
import type { useWorkbench } from './useWorkbench';

const placements = {
  none: ['None', 'بلا رمز'],
  'top-right': ['Top-right', 'أعلى اليمين'],
  'top-left': ['Top-left', 'أعلى اليسار'],
  'bottom-right': ['Bottom-right', 'أسفل اليمين'],
  'bottom-left': ['Bottom-left', 'أسفل اليسار'],
} satisfies Record<QrStampSettings['placement'], readonly [string, string]>;

export default function QrStampOptions({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const { qrStamp, selected, qrSettingsBlocked, custody } = desk;
  const changeQrStamp = (value: QrStampSettings) => desk.changeQrStamp(value, Boolean(validateQrStampSettings(value)));
  const values = desk.rows[selected]?.values;
  const date = desk.roster?.localDate;
  const options = qrStamp.placement === 'none' ? undefined : qrStamp;
  const custodyMode = options?.custodyRecord === true;
  const pattern = custodyMode ? undefined : options?.pattern;
  const rowNumber = selected + 1;
  const [receiptPreview, setReceiptPreview] = useState<{ custody: CustodySources; rowNumber: number; payload?: string }>();
  const currentReceipt = custodyMode && receiptPreview?.custody === custody && receiptPreview?.rowNumber === rowNumber
    ? receiptPreview : undefined;
  const receiptPayload = currentReceipt?.payload;

  useEffect(() => {
    if (!custodyMode || !custody || !values || qrSettingsBlocked) return;
    let active = true;
    void createCustodyQrRecords(custody, [rowNumber]).then(([record]) => {
      if (active) setReceiptPreview({ custody, rowNumber, payload: record!.payload });
    }, () => {
      if (active) setReceiptPreview({ custody, rowNumber });
    });
    return () => { active = false; };
  }, [custody, custodyMode, qrSettingsBlocked, rowNumber, values]);

  const preview = useMemo(() => {
    if (!values || !date || qrSettingsBlocked) return;
    try {
      const payload = pattern === undefined ? receiptPayload : resolveQrPayload(pattern, values, rowNumber, date);
      if (!payload) return;
      const matrix = encodeQr(payload);
      const quietZone = 4;
      const path = matrix.modules.flatMap((row, y) => row.flatMap((dark, x) =>
        dark ? [`M${x + quietZone} ${y + quietZone}h1v1h-1z`] : [])).join('');
      return { path, side: matrix.size + 2 * quietZone };
    } catch (error) {
      return { error: errorCode(error, 'qr-stamp-invalid-payload') };
    }
  }, [pattern, receiptPayload, values, date, rowNumber, qrSettingsBlocked]);
  const issue = qrSettingsBlocked ? 'qr-stamp-invalid-settings'
    : currentReceipt && !receiptPayload ? 'qr-stamp-invalid-payload' : preview?.error;
  const caption = arabic ? `معاينة رمز QR للصف ${rowNumber}` : `QR preview for row ${rowNumber}`;

  function changePlacement(placement: QrStampSettings['placement']) {
    if (placement === 'none') changeQrStamp(DEFAULT_QR_STAMP);
    else changeQrStamp(qrStamp.placement === 'none'
      ? { placement, sizePt: DEFAULT_QR_SIZE_PT, pattern: '{{ID}}' }
      : { ...qrStamp, placement });
  }

  return (
    <fieldset className="qr-options" disabled={desk.exporting} aria-label={arabic ? 'إعدادات رمز QR' : 'QR stamp settings'}>
      <label className="full-control">
        {arabic ? 'موضع رمز QR' : 'QR placement'}
        <select data-testid="qr-stamp-placement" value={qrStamp.placement}
          onChange={(event) => changePlacement(event.currentTarget.value as QrStampSettings['placement'])}>
          {Object.entries(placements).map(([value, names]) => <option key={value} value={value}>{names[arabic ? 1 : 0]}</option>)}
        </select>
      </label>
      {options && (
        <>
          <label className="output-mode">
            <input type="checkbox" data-testid="qr-custody-record" checked={custodyMode} aria-describedby="qr-custody-help"
              onChange={(event) => {
                const { placement, sizePt, pattern } = options;
                changeQrStamp(event.currentTarget.checked
                  ? { placement, sizePt, pattern: pattern.trim() ? pattern : '{{ID}}', custodyRecord: true }
                  : { placement, sizePt, pattern });
              }} />
            <span>{arabic ? 'استخدم سجل الحيازة في رمز QR' : 'Use custody QR record'}</span>
          </label>
          <p className="quiet" id="qr-custody-help">{arabic
            ? 'يربط كل رمز مطبوع بصف السجل في بيان الحيازة. نزّل البيان بعد التصدير.'
            : 'Links each printed QR to its roster row in the custody manifest. Download the manifest after export.'}</p>
          {!custodyMode && <label className="full-control">
            {arabic ? 'نمط رمز QR' : 'QR pattern'}
            <textarea rows={1} dir="auto" className="pattern-input" data-testid="qr-stamp-pattern" value={options.pattern}
              aria-invalid={Boolean(issue) || undefined} aria-describedby={issue ? 'qr-stamp-error' : 'qr-pattern-help'}
              onChange={(event) => changeQrStamp({ ...options, pattern: event.currentTarget.value })} />
            <small id="qr-pattern-help">
              {arabic ? 'أدرج اسم العمود مثل' : 'Use a column token such as'}{' '}<bdi dir="ltr"><code>{'{{ID}}'}</code></bdi>
              {arabic ? ' أو قيمة محسوبة مثل ' : ' or a computed token such as '}<bdi dir="ltr"><code>{'[[@PADDED_ROW_001]]'}</code></bdi>.
            </small>
          </label>}
          <label className="full-control">
            <span className="range-label">
              <span>{arabic ? 'حجم رمز QR' : 'QR size'}</span>
              <output htmlFor="qr-stamp-size"><bdi dir="ltr">{options.sizePt} pt</bdi></output>
            </span>
            <input type="range" id="qr-stamp-size" data-testid="qr-stamp-size" min={36} max={72} step="any" value={options.sizePt}
              aria-label={arabic ? 'حجم رمز QR' : 'QR size'} onChange={(event) => changeQrStamp({ ...options, sizePt: event.currentTarget.valueAsNumber })} />
          </label>
          {issue ? <p className="alert" id="qr-stamp-error" role="status">{printProblem(issue, arabic)}</p>
            : preview ? (
              <figure className="qr-miniature">
                <svg role="img" aria-label={caption} data-testid="qr-stamp-preview" viewBox={`0 0 ${preview.side} ${preview.side}`} shapeRendering="crispEdges">
                  <rect width={preview.side} height={preview.side} fill="white" />
                  <path d={preview.path} fill="black" />
                </svg>
                <figcaption>{caption}</figcaption>
              </figure>
            ) : <p className="quiet" role="status">{custodyMode
              ? arabic ? 'تظهر معاينة رمز الحيازة بعد فحص الصفوف.' : 'The custody QR preview appears after batch preflight.'
              : arabic ? 'اختر صفًا من الجدول لمعاينة الرمز.' : 'Select a roster row to preview its QR code.'}</p>}
          <p className="quiet qr-scope">{arabic
            ? 'يُطبع على صفحات السجلات في ملف PDF المدمج وفي نسخ ZIP المسطّحة.'
            : 'Printed on record pages in the merged PDF and flattened ZIP copies.'}</p>
        </>
      )}
    </fieldset>
  );
}
