import type { QrStampSettings } from '../core/pdf/qr-settings';
import { physicalFilenameColumns } from '../core/roster/filenames';
import { reviewFilenamePattern, reviewSourceColumns, type MaskPolicy } from '../core/shaping/redaction';
import type { useWorkbench } from './useWorkbench';

const en = {
  label: 'Mask for review',
  none: 'None',
  last: 'Keep last 4',
  full: 'Full mask',
  unavailable: 'Map a text field to configure masking.',
  help: 'Masks apply to PDF preview and downloads for this session. Source cells and other PDF fields keep their original values.',
  active: 'Review masking is enabled for the selected fields.',
  filenames: 'Review copies use row numbers because the filename pattern uses a protected column.',
};

const ar: typeof en = {
  label: 'حجب القيمة للمراجعة',
  none: 'بلا حجب',
  last: 'أبقِ آخر 4 محارف',
  full: 'احجب القيمة كاملة',
  unavailable: 'اربط حقلًا نصيًا لتتمكن من ضبط الحجب.',
  help: 'يطبّق الحجب على معاينة ملفات PDF وتنزيلها في هذه الجلسة. تحتفظ خلايا المصدر وحقول PDF الأخرى بقيمها الأصلية.',
  active: 'الحجب مفعّل للحقول المحددة.',
  filenames: 'تستخدم نسخ المراجعة أرقام الصفوف لأن نمط التسمية يتضمن عمودًا محميًا.',
};

export function planReviewOutput(columns: ReadonlySet<string>, pattern: string, grouping: string | null, qr: QrStampSettings) {
  return {
    pattern: reviewFilenamePattern(pattern, columns),
    groupProtected: grouping !== null && columns.has(grouping),
    qrProtected: qr.placement !== 'none' && !qr.custodyRecord && physicalFilenameColumns(qr.pattern).some((column) => columns.has(column)),
  };
}

export default function RedactedReview({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const mapped = desk.fields.filter(({ kind, name }) => kind === 'text'
    && (desk.mapping[name] || Object.hasOwn(desk.virtualMappings, name)));

  return <div className="review-dispatch-content">
    {mapped.length ? <>
      <p className="quiet">{copy.help}</p>
      {mapped.map(({ name }) => (
        <label className="full-control review-policy" key={name}>
          <span>{copy.label}{' · '}<bdi dir="auto">{name}</bdi></span>
          <select data-mask-field={name} value={desk.maskPolicies && Object.hasOwn(desk.maskPolicies, name) ? desk.maskPolicies[name] : 'none'}
            disabled={desk.exporting} onChange={(event) => desk.changeMaskPolicy(name, event.currentTarget.value as MaskPolicy,
              reviewSourceColumns, planReviewOutput)}>
            <option value="none">{copy.none}</option>
            <option value="keep-last-4">{copy.last}</option>
            <option value="full-mask">{copy.full}</option>
          </select>
        </label>
      ))}
      <div aria-live="polite" data-testid="redacted-review-status">
        {desk.maskPolicies && <p className="quiet">{copy.active}</p>}
        {desk.reviewFilenameFallback && <p className="quiet">{copy.filenames}</p>}
      </div>
    </> : <p className="quiet">{copy.unavailable}</p>}
  </div>;
}
