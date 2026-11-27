import type { FieldTypography } from '../core/pdf/field-typography';

const en = { digits: 'Digits', preserve: 'Preserve', lineHeight: 'Line height', padding: 'Inner padding', defaultPadding: 'Template default', pt: 'pt' };
const ar: typeof en = { digits: 'الأرقام', preserve: 'أبقِها كما هي', lineHeight: 'ارتفاع السطر', padding: 'الحاشية الداخلية', defaultPadding: 'الإعداد الافتراضي', pt: 'نقطة' };

export default function FieldFormatting({ arabic, field, value, disabled, onChange }: {
  arabic: boolean;
  field: string;
  value?: FieldTypography;
  disabled: boolean;
  onChange: (value: FieldTypography) => void;
}) {
  const copy = arabic ? ar : en;
  return (
    <fieldset className="field-formatting-options" disabled={disabled}>
      <label className="align-control">
        {copy.digits}
        <select data-testid="digits-policy" aria-label={`${copy.digits} ${field}`} value={value?.numeralPolicy ?? 'preserve'}
          onChange={(event) => {
            const policy = event.currentTarget.value as NonNullable<FieldTypography['numeralPolicy']>;
            onChange({ ...value, numeralPolicy: policy === 'preserve' ? undefined : policy });
          }}>
          <option value="preserve">{copy.preserve}</option>
          <option value="eastern-arabic" dir="ltr">٠١٢٣</option>
          <option value="western-ascii" dir="ltr">0123</option>
        </select>
      </label>
      <label className="align-control">
        {copy.lineHeight}
        <select data-testid="line-height-scale" aria-label={`${copy.lineHeight} ${field}`} value={value?.lineHeightScale ?? 1}
          onChange={(event) => {
            const scale = Number(event.currentTarget.value) as NonNullable<FieldTypography['lineHeightScale']>;
            onChange({ ...value, lineHeightScale: scale === 1 ? undefined : scale });
          }}>
          <option value="1">1</option>
          <option value="1.15">1.15</option>
          <option value="1.3">1.3</option>
        </select>
      </label>
      <label className="align-control field-padding">
        {copy.padding}
        <select data-testid="padding-pt" aria-label={`${copy.padding} ${field}`} value={value?.paddingPt ?? ''}
          onChange={(event) => {
            const option = event.currentTarget.value;
            onChange({ ...value, paddingPt: option ? Number(option) as NonNullable<FieldTypography['paddingPt']> : undefined });
          }}>
          <option value="">{copy.defaultPadding}</option>
          {[2, 4, 6].map((points) => <option key={points} value={points}>{points} {copy.pt}</option>)}
        </select>
      </label>
    </fieldset>
  );
}
