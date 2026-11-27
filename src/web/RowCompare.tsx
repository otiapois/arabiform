import { useEffect, useState } from 'react';
import type { BoundaryRowSpotlight } from '../core/preflight/spotlight';
import { Diagnostics } from './Diagnostics';
import PdfPreview from './PdfPreview';
import type { FillTemplate } from './fill-template-source';
import { fillLabel, type translator } from './labels';
import type { BatchWorker } from './useBatch';
import type { RowResult } from './useWorkbench';

const en = {
  heading: 'Row comparison',
  a: 'Row A',
  b: 'Row B',
  row: 'Row {row}',
  canvas: 'Rendered PDF of row {row}',
  original: 'Original template for row {row}',
  ready: 'Ready',
  flagged: 'Flagged · original template',
  textSize: 'Smallest rendered text size',
  clearance: 'Minimum ink clearance from field edge',
  unavailable: 'Unavailable',
  points: 'pt',
};

const ar: typeof en = {
  heading: 'مقارنة الصفوف',
  a: 'الصف أ',
  b: 'الصف ب',
  row: 'الصف {row}',
  canvas: 'معاينة صف {row} بعد التعبئة',
  original: 'القالب الأصلي للصف {row}',
  ready: 'جاهز',
  flagged: 'يحتاج مراجعة · القالب الأصلي',
  textSize: 'أصغر حجم للنص المعروض',
  clearance: 'أقل مسافة بين آثار الحبر وحافة الحقل',
  unavailable: 'غير متاح',
  points: 'نقطة',
};

type PreviewContext = {
  results: readonly RowResult[];
  worker: BatchWorker;
  template: FillTemplate;
  minSize: number;
  language: ReturnType<typeof translator>;
};

const metricFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4, useGrouping: false });

export default function RowCompare({ selected, spotlight, ...context }: PreviewContext & { selected: number; spotlight: BoundaryRowSpotlight }) {
  const copy = context.language.arabic ? ar : en;
  const firstRow = selected + 1;
  const otherRow = [spotlight.longestMappedTextRow, spotlight.shortestMappedTextRow, 1, 2]
    .find((row) => row !== undefined && row !== firstRow)!;
  return (
    <section className="row-compare" data-testid="row-compare" aria-label={copy.heading}>
      <ComparePane {...context} side="a" initialRow={firstRow} />
      <ComparePane {...context} side="b" initialRow={otherRow} />
    </section>
  );
}

function ComparePane({ results, worker, template, minSize, language, side, initialRow }: PreviewContext & {
  side: 'a' | 'b'; initialRow: number;
}) {
  const copy = language.arabic ? ar : en;
  const [row, setRow] = useState(initialRow);
  const result = results[row - 1]!;
  const options = results.map((_, index) => (
    <option key={index} value={index + 1}>{fillLabel(copy.row, { row: index + 1 })}</option>
  ));
  return (
    <div className="compare-pane" data-testid={`compare-pane-${side}`} data-row={row}>
      <label className="full-control compare-select">
        <span>{copy[side]}</span>
        <select value={row} data-testid={`compare-row-${side}`} onChange={(event) => setRow(Number(event.currentTarget.value))}>
          {options}
        </select>
      </label>
      <ComparedRow key={row} worker={worker} template={template} minSize={minSize} language={language} row={row} result={result} />
    </div>
  );
}

function ComparedRow({ worker, template, minSize, language, row, result }: Omit<PreviewContext, 'results'> & { row: number; result: RowResult }) {
  const copy = language.arabic ? ar : en;
  const ready = result.status === 'pass';
  const [page, setPage] = useState(result.pageNumbers[0] ?? 1);
  const [preview, setPreview] = useState<{ bytes?: Uint8Array }>();

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void worker.preview(row - 1).then((bytes) => {
      if (active) setPreview({ bytes });
    }, () => {
      if (active) setPreview({});
    });
    return () => { active = false; };
  }, [ready, row, worker]);

  return (
    <>
      <div className="compare-summary" aria-live="polite">
        <p className={`tag tag-${result.status}`} data-testid="compare-status" data-status={result.status}>
          {ready ? copy.ready : copy.flagged}
        </p>
        <dl className="compare-metrics">
          {([
            [copy.textSize, result.smallestInkFontSizePt, 'compare-font-size'],
            [copy.clearance, result.inkClearancePt, 'compare-ink-clearance'],
          ] as const).map(([label, value, id]) => (
            <div key={id}>
              <dt>{label}</dt>
              <dd data-testid={id} data-points={value}>
                {value === undefined ? copy.unavailable : <><bdi dir="ltr">{metricFormat.format(value)}</bdi> {copy.points}</>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {!ready && result.diagnostics.length > 0 && (
        <div className="preview-diagnostics compare-diagnostics">
          <Diagnostics issues={result.diagnostics} minSize={minSize} language={language} testId="compare-diagnostics" />
        </div>
      )}
      <PdfPreview compact bytes={ready ? preview?.bytes : template.bytes} fields={template.info.fields} overlays={template.overlays}
        diagnostics={result.diagnostics} minSize={minSize} unavailable={Boolean(preview && !preview.bytes)} language={language}
        requestedPage={page} onPageChange={setPage} canvasLabel={fillLabel(ready ? copy.canvas : copy.original, { row })} />
    </>
  );
}
