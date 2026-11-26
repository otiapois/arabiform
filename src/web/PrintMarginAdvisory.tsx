import { useMemo } from 'react';
import { inspectPrintMargins } from '../core/pdf/margin-preflight';
import type { TemplateMetadata } from '../core/pdf/template';

const en = {
  heading: 'Print-margin advisory',
  help: 'These widgets sit less than 9 pt from the page edge. Review them before printing. You can still export ready rows.',
  page: 'Page',
  top: 'top edge',
  bottom: 'bottom edge',
  left: 'left edge',
  right: 'right edge',
  points: 'pt',
};

const ar: typeof en = {
  heading: 'تنبيه هامش الطباعة',
  help: 'تبعد هذه الحقول أقل من 9 نقاط عن حافة الصفحة. راجعها قبل الطباعة. يمكنك تنزيل الصفوف الجاهزة.',
  page: 'الصفحة',
  top: 'الحافة العلوية',
  bottom: 'الحافة السفلية',
  left: 'الحافة اليسرى',
  right: 'الحافة اليمنى',
  points: 'نقطة',
};

export default function PrintMarginAdvisory({ template, mapping, arabic }: {
  template: TemplateMetadata;
  mapping: Readonly<Record<string, string>>;
  arabic: boolean;
}) {
  const copy = arabic ? ar : en;
  const warnings = useMemo(() => inspectPrintMargins(template,
    Object.keys(mapping).filter((name) => Boolean(mapping[name]))), [template, mapping]);
  if (!warnings.length) return null;

  return (
    <section className="print-margin-advisory" aria-labelledby="margin-advisory-heading" data-testid="margin-advisory">
      <h3 id="margin-advisory-heading">{copy.heading}</h3>
      <p>{copy.help}</p>
      <ul>
        {warnings.map(({ field, pageNumber, widgetIndex, edge, clearancePt }) => (
          <li key={JSON.stringify([field, widgetIndex])} data-testid="margin-advisory-item" data-field={field}
            data-page={pageNumber} data-widget={widgetIndex + 1} data-edge={edge} data-clearance-pt={clearancePt}>
            <strong><bdi dir="auto">{field}</bdi></strong>
            {' · '}{copy.page} <bdi dir="ltr">{pageNumber}</bdi>
            {' · '}{copy[edge]}{' · '}{arabic ? <><bdi dir="ltr">{clearancePt}</bdi> {copy.points}</> : `${clearancePt} ${copy.points}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
