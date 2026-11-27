import { MAX_WATERMARK_CHARACTERS, validateWatermarkSettings, type WatermarkSettings } from '../core/pdf/watermark-settings';

type Stamp = Exclude<WatermarkSettings, { kind: 'none' }>;

export default function WatermarkOptions({ settings, change: setSettings, disabled, invalid, arabic }: {
  settings: Stamp;
  change: (settings: Stamp, valid: boolean) => void;
  disabled: boolean;
  invalid: boolean;
  arabic: boolean;
}) {
  const opacity = Number((settings.opacity * 100).toPrecision(15));
  const change = (value: Stamp) => setSettings(value, Boolean(validateWatermarkSettings(value)));

  return (
    <fieldset className="watermark-options" disabled={disabled}
      aria-label={arabic ? 'خيارات العلامة المائية' : 'Watermark options'}>
      {settings.kind === 'custom' && (
        <label className="full-control">
          {arabic ? 'نص العلامة المائية' : 'Watermark text'}
          <input type="text" dir="auto" value={settings.text} maxLength={MAX_WATERMARK_CHARACTERS * 2} data-testid="watermark-text"
            aria-invalid={invalid || undefined} aria-describedby={invalid ? 'watermark-required' : undefined}
            onChange={(event) => change({ ...settings, text: event.currentTarget.value })} />
          {invalid && <small className="watermark-required" id="watermark-required">{arabic
            ? `أدخل من 1 إلى ${MAX_WATERMARK_CHARACTERS} محرفًا في سطر واحد لحفظ الإعدادات أو تنزيل ملفات الطباعة.`
            : `Enter 1–${MAX_WATERMARK_CHARACTERS} characters on one line to save these settings or download print files.`}</small>}
        </label>
      )}
      <label className="full-control">
        <span className="range-label">
          <span>{arabic ? 'عتامة العلامة المائية' : 'Watermark opacity'}</span>
          <output htmlFor="watermark-opacity" data-testid="watermark-opacity-value"><bdi dir="ltr">{opacity}%</bdi></output>
        </span>
        <input id="watermark-opacity" data-testid="watermark-opacity" type="range" min={10} max={25} value={Math.min(25, Math.max(10, opacity))}
          aria-label={arabic ? 'عتامة العلامة المائية' : 'Watermark opacity'}
          onChange={(event) => change({ ...settings, opacity: Number(event.currentTarget.value) / 100 })} />
        {(opacity < 10 || opacity > 25) && <small>{arabic
          ? 'تُستخدم القيمة المحمّلة إلى أن تحرّك شريط العتامة.'
          : 'The loaded value stays in use until you move the slider.'}</small>}
      </label>
      <label className="full-control">
        {arabic ? 'زاوية العلامة المائية' : 'Watermark angle'}
        <select dir="ltr" data-testid="watermark-angle" value={settings.angle}
          onChange={(event) => change({ ...settings, angle: Number(event.currentTarget.value) as Stamp['angle'] })}>
          <option value={-45}>−45°</option>
          <option value={0}>0°</option>
          <option value={45}>45°</option>
        </select>
      </label>
      <p className="quiet">{arabic
        ? 'تظهر على صفحات السجلات في ملف PDF المدمج وعلى نسخ ZIP المسطّحة.'
        : 'Applied to record pages in the merged PDF and flattened ZIP copies.'}</p>
    </fieldset>
  );
}
