import { useEffect, useId, useMemo, useState } from 'react';
import { mergeCoverRequest } from './merge-cover-request';
import type { BatchWorker, OutputSettings } from './useBatch';
import './print-estimate.css';

const en = {
  heading: 'Print sheet estimate',
  combined: 'Combined PDF',
  split: 'Split PDFs by group',
  groupDetails: 'Sheet counts by group',
  active: 'Sheets at current layout',
  alternative: 'Sheets with 1-up instead',
  oneUp: '1-up sheets',
  twoUp: '2-up sheets',
  fourUp: '4-up sheets',
  cover: 'Cover pages',
  saves: '2-up saves',
  fourUpSaves: '4-up saves',
  fourUpUnavailable: 'The 4-up grid is unavailable for this page size.',
  sheet: 'sheet',
  sheets: 'sheets',
  'imposition-requires-single-page': '2-up requires a single-page template.',
  'imposition-invalid-page-geometry': '2-up is unavailable for this page size or rotation.',
  'imposition-unsupported-print-annotation': '2-up is unavailable because this template has a printable annotation.',
  loading: 'Calculating sheets…',
  error: 'Sheet counts are unavailable.',
};

const ar: typeof en = {
  heading: 'تقدير أوراق الطباعة',
  combined: 'ملف PDF مدمج',
  split: 'ملفات PDF مقسّمة حسب المجموعة',
  groupDetails: 'عدد الأوراق لكل مجموعة',
  active: 'الأوراق بالتخطيط الحالي',
  alternative: 'عدد الأوراق في التخطيط البديل (صفحة واحدة لكل ورقة)',
  oneUp: 'الأوراق لصفحة واحدة في الورقة',
  twoUp: 'الأوراق لصفحتين في الورقة',
  fourUp: 'عدد الأوراق عند طباعة أربعة سجلات لكل ورقة',
  cover: 'صفحات الغلاف',
  saves: 'الأوراق التي يوفرها تخطيط الصفحتين',
  fourUpSaves: 'الأوراق التي يوفرها تخطيط السجلات الأربعة',
  fourUpUnavailable: 'شبكة الأربعة غير متاحة لأبعاد هذه الصفحة.',
  sheet: '',
  sheets: '',
  'imposition-requires-single-page': 'طباعة صفحتين في الورقة تتطلب قالبًا من صفحة واحدة.',
  'imposition-invalid-page-geometry': 'طباعة صفحتين في الورقة غير متاحة بسبب حجم الصفحة أو زاوية تدويرها.',
  'imposition-unsupported-print-annotation': 'طباعة صفحتين في الورقة غير متاحة لوجود تعليق توضيحي قابل للطباعة في القالب.',
  loading: 'جارٍ حساب الأوراق…',
  error: 'تعذّر حساب عدد الأوراق.',
};

type Estimate = Awaited<ReturnType<BatchWorker['estimate']>>;
type EstimateRequest = Parameters<BatchWorker['estimate']>[0];
type Counts = Pick<Estimate, 'totalRecords' | 'coverPages' | 'activePhysicalSheets' | 'oneUpPhysicalSheets'
  | 'twoUpPhysicalSheets' | 'sheetsSavedByTwoUp' | 'percentPaperSaved'
  | 'fourUpPhysicalSheets' | 'sheetsSavedByFourUp' | 'percentPaperSavedByFourUp'>;

const arabicPercent = new Intl.NumberFormat('ar', { style: 'percent', maximumFractionDigits: 2 });

export default function PrintEstimate({ worker, output, arabic }: { worker: BatchWorker; output: OutputSettings; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const id = useId();
  const { cover, filenamePlans, rowSelection, grouping, imposition, fourUp } = output;
  const request = useMemo(() => ({ coverSheet: mergeCoverRequest(cover, filenamePlans), rowSelection, grouping, imposition, ...(fourUp && { fourUp }) }),
    [cover, filenamePlans, rowSelection, grouping, imposition, fourUp]);
  const [calculated, setCalculated] = useState<{ worker: BatchWorker; request: EstimateRequest; estimate?: Estimate }>();
  const current = calculated?.worker === worker && calculated.request === request ? calculated : undefined;

  useEffect(() => {
    let active = true;
    void worker.estimate(request).then(estimate => {
      if (active) setCalculated({ worker, request, estimate });
    }, () => {
      if (active) setCalculated({ worker, request });
    });
    return () => { active = false; };
  }, [worker, request]);

  const estimate = current?.estimate;
  const alternative = Boolean((estimate?.twoUpUnavailableReason && imposition === '2-up')
    || (estimate?.fourUpUnavailableReason && imposition === '4-up'));
  const countLabels = { copy, alternative, fourUp: estimate?.imposition === '4-up' };
  return (
    <section className="print-estimate" data-testid="print-estimate" data-imposition={estimate?.imposition} aria-labelledby={id}>
      <h3 id={id}>{copy.heading}</h3>
      <div aria-live="polite">
        {estimate ? (
          <><div className="print-estimate-grid">
            <div><h4>{copy.combined}</h4><SheetCounts counts={estimate} kind="combined" {...countLabels} /></div>
            {estimate.split && <div><h4>{copy.split}</h4>
              <SheetCounts counts={estimate.split} kind="split" {...countLabels} />
              {estimate.split.groupBreakdowns.length > 0 && <details className="print-estimate-groups">
                <summary>{copy.groupDetails}</summary>
                <ul>
                  {estimate.split.groupBreakdowns.map(group => (
                    <li key={group.folder}>
                      <strong><bdi dir="auto">{group.groupValue ?? group.folder}</bdi></strong>
                      <SheetCounts counts={group} kind="group" {...countLabels} />
                    </li>
                  ))}
                </ul>
              </details>}
            </div>}
          </div>{estimate.twoUpUnavailableReason ? <p className="sheet-estimate-note">{copy[estimate.twoUpUnavailableReason]}</p>
            : estimate.fourUpUnavailableReason && <p className="sheet-estimate-note">{copy.fourUpUnavailable}</p>}</>
        ) : <p className="quiet">{current ? copy.error : copy.loading}</p>}
      </div>
    </section>
  );
}

function SheetCounts({ counts, copy, kind, alternative, fourUp }: {
  counts: Counts; copy: typeof en; kind: 'combined' | 'split' | 'group'; alternative: boolean; fourUp: boolean;
}) {
  const { totalRecords, coverPages, activePhysicalSheets, oneUpPhysicalSheets, twoUpPhysicalSheets, sheetsSavedByTwoUp, percentPaperSaved,
    fourUpPhysicalSheets, sheetsSavedByFourUp, percentPaperSavedByFourUp } = counts;
  const saved = fourUp ? sheetsSavedByFourUp : sheetsSavedByTwoUp;
  const percent = fourUp ? percentPaperSavedByFourUp : percentPaperSaved;
  const savingsUnit = saved === 1 ? copy.sheet : copy.sheets;
  const percentLabel = fourUp && copy === ar && percent !== null ? arabicPercent.format(percent / 100) : `${percent}%`;
  return (
    <>
      <dl className="sheet-counts" data-testid={`print-estimate-${kind}`} data-records={totalRecords} data-cover-pages={coverPages}
        data-sheets={!alternative ? activePhysicalSheets : undefined} data-alternative-sheets={alternative ? activePhysicalSheets : undefined}
        data-one-up={oneUpPhysicalSheets} data-two-up={twoUpPhysicalSheets ?? undefined}
        data-sheets-saved={sheetsSavedByTwoUp ?? undefined} data-percent-saved={percentPaperSaved ?? undefined}
        data-four-up={fourUpPhysicalSheets ?? undefined} data-four-up-sheets-saved={sheetsSavedByFourUp ?? undefined}
        data-four-up-percent-saved={percentPaperSavedByFourUp ?? undefined}>
        <div><dt>{alternative ? copy.alternative : copy.active}</dt><dd><bdi dir="ltr">{activePhysicalSheets}</bdi></dd></div>
        <div><dt>{copy.cover}</dt><dd><bdi dir="ltr">{coverPages}</bdi></dd></div>
        {!alternative && <div><dt>{copy.oneUp}</dt><dd><bdi dir="ltr">{oneUpPhysicalSheets}</bdi></dd></div>}
        {fourUp ? fourUpPhysicalSheets !== null && <div><dt>{copy.fourUp}</dt><dd><bdi dir="ltr">{fourUpPhysicalSheets}</bdi></dd></div>
          : twoUpPhysicalSheets !== null && <div><dt>{copy.twoUp}</dt><dd><bdi dir="ltr">{twoUpPhysicalSheets}</bdi></dd></div>}
      </dl>
      {(kind !== 'group' || fourUp) && saved !== null && <p className="sheet-savings">
        {fourUp ? copy.fourUpSaves : copy.saves} <bdi dir="ltr">{saved}{savingsUnit && ` ${savingsUnit}`} ({percentLabel})</bdi>
      </p>}
    </>
  );
}
