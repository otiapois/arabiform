import { lazy, Suspense } from 'react';
import { DEFAULT_WATERMARK, DEFAULT_WATERMARK_ANGLE, DEFAULT_WATERMARK_OPACITY } from '../core/pdf/print-setting-defaults';
import type { WatermarkSettings } from '../core/pdf/watermark-settings';

const WatermarkOptions = lazy(() => import('./WatermarkOptions'));

export function WatermarkControls({ settings, change, disabled, invalid, arabic }: {
  settings: WatermarkSettings;
  change: (settings: WatermarkSettings, valid: boolean) => void;
  disabled: boolean;
  invalid: boolean;
  arabic: boolean;
}) {
  function selectKind(kind: WatermarkSettings['kind']) {
    if (kind === 'none') {
      change(DEFAULT_WATERMARK, true);
      return;
    }
    const opacity = settings.kind === 'none' ? DEFAULT_WATERMARK_OPACITY : settings.opacity;
    const angle = settings.kind === 'none' ? DEFAULT_WATERMARK_ANGLE : settings.angle;
    if (kind === 'custom') change({ kind, opacity, angle, text: '' }, false);
    else change({ kind, opacity, angle }, true);
  }

  return (
    <>
      <label className="full-control">
        {arabic ? 'علامة مائية للطباعة (اختيارية)' : 'Print watermark (optional)'}
        <select dir="auto" data-testid="watermark-kind" value={settings.kind} disabled={disabled}
          onChange={(event) => selectKind(event.currentTarget.value as WatermarkSettings['kind'])}>
          <option value="none">{arabic ? 'بلا علامة' : 'None'}</option>
          <option value="draft" lang="en">DRAFT</option>
          <option value="confidential" lang="en">CONFIDENTIAL</option>
          <option value="draft-ar" lang="ar">مسودة</option>
          <option value="confidential-ar" lang="ar">سري</option>
          <option value="custom">{arabic ? 'نص مخصص…' : 'Custom…'}</option>
        </select>
      </label>
      {settings.kind !== 'none' && (
        <Suspense fallback={<p className="quiet" role="status">{arabic ? 'جارٍ تحميل الإعدادات…' : 'Loading watermark settings…'}</p>}>
          <WatermarkOptions settings={settings} change={change} disabled={disabled} invalid={invalid} arabic={arabic} />
        </Suspense>
      )}
    </>
  );
}
