import { lazy, Suspense, useEffect, useState } from 'react';
import { CAPACITY_SAMPLE_LIMIT, createCapacityCsv, inspectTemplateCapacities, type TemplateCapacityReport } from '../core/pdf/capacity-inspector';
import type { translator } from './labels';
import { loadFonts, saveDownload } from './resources';
import type { TemplateInfo } from './useWorkbench';

const CapacityTable = lazy(() => import('./CapacityTable'));

export default function CapacityReport({ template, minFontSize, open, arabic, labels }: {
  template: TemplateInfo;
  minFontSize: number;
  open: boolean;
  arabic: boolean;
  labels: ReturnType<typeof translator>['labels'];
}) {
  const [checked, setChecked] = useState<{
    template: TemplateInfo;
    minFontSize: number;
    report?: TemplateCapacityReport;
  }>();
  const current = checked?.template === template && checked.minFontSize === minFontSize ? checked : undefined;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void loadFonts().then((fonts) => active ? inspectTemplateCapacities(template, fonts, minFontSize) : undefined).then((report) => {
        if (active) setChecked({ template, minFontSize, report });
      }, () => {
        if (active) setChecked({ template, minFontSize });
      });
    }, 100);
    return () => { active = false; window.clearTimeout(timer); };
  }, [template, minFontSize]);

  if (!open) return null;
  if (!current) return <p className="quiet" role="status">{labels.loading}</p>;
  const { report } = current;
  if (!report) return <p className="alert" role="alert">{arabic
    ? 'تعذّر تقدير سعة حقول القالب.'
    : 'The template field capacities could not be estimated.'}</p>;

  return (
    <div className="capacity-content">
      <p className="quiet">{arabic
        ? `تُقدّر سعة كل عنصر عند الحجم الأدنى بخطّي نسخ نوتو العربي ونوتو سانس، باستخدام نص نموذجي يتضمن الحركات والمسافات، حتى ${CAPACITY_SAMPLE_LIMIT} محرفًا. تشير الشرطة إلى تقدير غير متاح.`
        : `Per-widget estimates at the current minimum size use Noto Naskh Arabic and Noto Sans with representative text, including spaces and Arabic diacritics, up to ${CAPACITY_SAMPLE_LIMIT} characters. A dash marks unavailable estimates.`}
      </p>
      <div className="actions compact">
        <button type="button" className="button secondary" data-testid="capacity-csv"
          onClick={() => saveDownload(createCapacityCsv(report), 'arabiform-template-capacity.csv', 'text/csv;charset=utf-8')}>
          {arabic ? 'نزّل سعة الحقول بصيغة CSV' : 'Download capacity CSV'}
        </button>
      </div>
      <p className="quiet capacity-scroll-hint">{arabic
        ? 'مرّر الجدول أفقيًا لعرض جميع الأعمدة.'
        : 'Scroll sideways to see every column.'}</p>
      <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
        <CapacityTable report={report} arabic={arabic} labels={labels} />
      </Suspense>
    </div>
  );
}
