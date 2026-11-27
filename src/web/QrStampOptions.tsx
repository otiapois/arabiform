import { useMemo } from 'react';
import { encodeQr, resolveQrPayload } from '../core/pdf/qr-encoder';
import { DEFAULT_QR_SIZE_PT, DEFAULT_QR_STAMP, type QrStampSettings } from '../core/pdf/qr-settings';
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
  const { qrStamp, selected, changeQrStamp, qrSettingsBlocked } = desk;
  const values = desk.rows[selected]?.values;
  const date = desk.roster?.localDate;
  const pattern = qrStamp.placement === 'none' ? undefined : qrStamp.pattern;
  const rowNumber = selected + 1;
  const preview = useMemo(() => {
    if (pattern === undefined || !values || !date || qrSettingsBlocked) return;
    try {
      const matrix = encodeQr(resolveQrPayload(pattern, values, rowNumber, date));
      const quietZone = 4;
      const path = matrix.modules.flatMap((row, y) => row.flatMap((dark, x) =>
        dark ? [`M${x + quietZone} ${y + quietZone}h1v1h-1z`] : [])).join('');
      return { path, side: matrix.size + 2 * quietZone };
    } catch (error) {
      return { error: errorCode(error, 'qr-stamp-invalid-payload') };
    }
  }, [pattern, values, date, rowNumber, qrSettingsBlocked]);
  const issue = qrSettingsBlocked ? 'qr-stamp-invalid-settings' : preview?.error;
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
      {qrStamp.placement !== 'none' && (
        <>
          <label className="full-control">
            {arabic ? 'نمط رمز QR' : 'QR pattern'}
            <textarea rows={1} dir="auto" className="pattern-input" data-testid="qr-stamp-pattern" value={qrStamp.pattern}
              aria-invalid={Boolean(issue) || undefined} aria-describedby={issue ? 'qr-stamp-error' : 'qr-pattern-help'}
              onChange={(event) => changeQrStamp({ ...qrStamp, pattern: event.currentTarget.value })} />
            <small id="qr-pattern-help">
              {arabic ? 'أدرج اسم العمود مثل' : 'Use a column token such as'}{' '}<bdi dir="ltr"><code>{'{{ID}}'}</code></bdi>
              {arabic ? ' أو قيمة محسوبة مثل ' : ' or a computed token such as '}<bdi dir="ltr"><code>{'[[@PADDED_ROW_001]]'}</code></bdi>.
            </small>
          </label>
          <label className="full-control">
            <span className="range-label">
              <span>{arabic ? 'حجم رمز QR' : 'QR size'}</span>
              <output htmlFor="qr-stamp-size"><bdi dir="ltr">{qrStamp.sizePt} pt</bdi></output>
            </span>
            <input type="range" id="qr-stamp-size" data-testid="qr-stamp-size" min={36} max={72} step="any" value={qrStamp.sizePt}
              aria-label={arabic ? 'حجم رمز QR' : 'QR size'} onChange={(event) => changeQrStamp({ ...qrStamp, sizePt: event.currentTarget.valueAsNumber })} />
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
            ) : <p className="quiet">{arabic ? 'اختر صفًا من الجدول لمعاينة الرمز.' : 'Select a roster row to preview its QR code.'}</p>}
          <p className="quiet qr-scope">{arabic
            ? 'يُطبع على صفحات السجلات في ملف PDF المدمج وفي نسخ ZIP المسطّحة.'
            : 'Printed on record pages in the merged PDF and flattened ZIP copies.'}</p>
        </>
      )}
    </fieldset>
  );
}
