import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { diagnosticText } from './Diagnostics';
import { fillLabel, type translator } from './labels';
import type { RowResult, TemplateInfo } from './useWorkbench';

GlobalWorkerOptions.workerSrc = workerUrl;

type PreviewProps = {
  bytes?: Uint8Array;
  fields: TemplateInfo['fields'];
  diagnostics?: RowResult['diagnostics'];
  minSize: number;
  unavailable: boolean;
  language: ReturnType<typeof translator>;
  requestedPage: number;
  onPageChange: (page: number) => void;
};

type Position = {
  key: string;
  field: string;
  issues: RowResult['diagnostics'];
  left: string;
  top: string;
  width: string;
  height: string;
};

export default function PdfPreview({
  bytes, fields, diagnostics, minSize, unavailable, language, requestedPage, onPageChange,
}: PreviewProps) {
  const { labels } = language;
  const [loaded, setLoaded] = useState<{ bytes: Uint8Array; pdf?: PDFDocumentProxy }>();
  const [rendered, setRendered] = useState<{
    pdf: PDFDocumentProxy;
    page: number;
    size: number | string;
    width?: number;
    diagnostics?: RowResult['diagnostics'];
    complete: boolean;
    ratio?: number;
    positions?: Position[];
  }>();
  const [zoom, setZoom] = useState('fit');
  const [frameWidth, setFrameWidth] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const pageRail = useRef<HTMLDivElement>(null);
  const activePill = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = loaded && loaded.bytes === bytes ? loaded.pdf : undefined;
  const page = Math.min(requestedPage, pdf?.numPages ?? requestedPage);
  const pageCount = pdf?.numPages ?? 0;
  const size = zoom === 'fit' ? frameWidth && Math.min(470, Math.max(120, frameWidth - 32)) : zoom;
  const raster = rendered && rendered.pdf === pdf && rendered.page === page && rendered.size === size
    && rendered.diagnostics === diagnostics ? rendered : undefined;
  const failed = unavailable || (bytes && loaded?.bytes === bytes && !pdf) || (raster && !raster.complete);
  const issuePages = new Map<number, number>();
  for (const issue of diagnostics ?? []) {
    for (const pageNumber of issue.pageNumbers) {
      issuePages.set(pageNumber, (issuePages.get(pageNumber) ?? 0) + 1);
    }
  }

  useEffect(() => {
    frame.current?.scrollTo(0, 0);
    const rail = pageRail.current;
    const pill = activePill.current;
    if (!rail || !pill) return;
    const railBox = rail.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const left = pillBox.left - railBox.left - 8;
    const right = pillBox.right - railBox.right + 8;
    if (left < 0 || right > 0) rail.scrollBy({ left: left < 0 ? left : right });
  }, [page, pageCount]);

  useEffect(() => {
    const host = frame.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrameWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!bytes) {
      setLoaded(undefined);
      return;
    }
    const task = getDocument({
      data: Uint8Array.from(bytes),
      useSystemFonts: true,
      useWorkerFetch: false,
      useWasm: false,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
    });
    let active = true;
    task.promise.then((pdf) => {
      if (active) setLoaded({ bytes, pdf });
    }, () => {
      if (active) setLoaded({ bytes });
    });
    return () => {
      active = false;
      void task.destroy().catch(() => undefined);
    };
  }, [bytes]);

  useEffect(() => {
    const target = canvas.current;
    if (!pdf || !target || size === 0) return;
    let active = true;
    let task: RenderTask | undefined;

    async function draw(document: PDFDocumentProxy, element: HTMLCanvasElement) {
      const docPage = await document.getPage(page);
      if (!active) return;
      const base = docPage.getViewport({ scale: 1 });
      const viewport = docPage.getViewport({ scale: typeof size === 'number' ? size / base.width : Number(size) * 96 / 72 });
      const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1), 4096 / Math.max(viewport.width, viewport.height));
      element.width = Math.ceil(viewport.width * outputScale);
      element.height = Math.ceil(viewport.height * outputScale);

      task = docPage.render({
        canvas: element,
        viewport,
        transform: [outputScale, 0, 0, outputScale, 0, 0],
      });
      await task.promise;
      if (!active) return;

      const positions: Position[] = [];
      for (const field of fields) {
        field.widgets.forEach((widget, index) => {
          if (widget.pageIndex !== page - 1) return;
          const issues = diagnostics?.filter((issue) => issue.field === field.name
            && issue.pageNumbers.includes(page) && (issue.widgetIndex === undefined || issue.widgetIndex === index));
          if (!issues?.length) return;
          const [x1, y1] = viewport.convertToViewportPoint(widget.x, widget.y);
          const [x2, y2] = viewport.convertToViewportPoint(widget.x + widget.width, widget.y + widget.height);
          positions.push({
            key: `${field.name}-${index}`,
            field: field.name,
            issues,
            left: `${100 * Math.min(x1, x2) / viewport.width}%`,
            top: `${100 * Math.min(y1, y2) / viewport.height}%`,
            width: `${100 * Math.abs(x2 - x1) / viewport.width}%`,
            height: `${100 * Math.abs(y2 - y1) / viewport.height}%`,
          });
        });
      }
      setRendered({ pdf: document, page, size, width: viewport.width, diagnostics, complete: true, ratio: viewport.width / viewport.height, positions });
    }

    void draw(pdf, target).catch(() => {
      if (active) setRendered({ pdf, page, size, diagnostics, complete: false });
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page, size, fields, diagnostics]);

  return (
    <>
      <div className="preview-toolbar">
        <div className="page-controls" aria-label={labels.preview}>
          <button type="button" className="icon-button" aria-label={labels.previousPage} disabled={page <= 1 || !pdf} onClick={() => onPageChange(page - 1)}>
            <span aria-hidden="true" className="chevron previous" />
          </button>
          <span className="page-counter">{fillLabel(labels.pageCount, { page: pdf ? page : 0, total: pageCount })}</span>
          <button type="button" className="icon-button" aria-label={labels.nextPage} disabled={!pdf || page >= pdf.numPages} onClick={() => onPageChange(page + 1)}>
            <span aria-hidden="true" className="chevron next" />
          </button>
        </div>
        <select aria-label={labels.zoom} value={zoom} onChange={(event) => setZoom(event.currentTarget.value)}>
          <option value="fit">{labels.fit}</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select>
      </div>
      {pageCount > 0 && (
        <div className="preview-page-rail" ref={pageRail} role="group" aria-label={labels.previewPages} data-testid="preview-pages">
          {Array.from({ length: pageCount }, (_, index) => {
            const pageNumber = index + 1;
            const count = issuePages.get(pageNumber);
            const active = pageNumber === page;
            return (
              <button type="button" className={count ? 'page-pill issue-page' : 'page-pill'} ref={active ? activePill : undefined}
                data-testid={count ? 'issue-page' : undefined} data-page={pageNumber} key={pageNumber}
                aria-current={active ? 'page' : undefined} onClick={() => onPageChange(pageNumber)}>
                {count && <span className="page-issue-dot" aria-hidden="true" />}
                {count
                  ? fillLabel(count === 1 ? labels.issuePageOne : labels.issuePageMany, { page: pageNumber, count })
                  : fillLabel(labels.pageNumber, { page: pageNumber })}
              </button>
            );
          })}
        </div>
      )}
      <div className="preview-bed" ref={frame}>
        {failed && <p className="alert" role="alert">{labels.previewError}</p>}
        {!failed && !raster && <p className="preview-message" role="status">{labels.previewBusy}</p>}
        <div className="canvas-paper" style={{ width: raster?.width, aspectRatio: raster?.ratio }} hidden={!raster?.complete}>
          <canvas
            aria-label={labels.previewCanvas}
            role="img"
            data-testid="pdf-canvas"
            data-rendered={raster?.complete ? 'true' : undefined}
            ref={canvas}
          />
          {raster?.positions?.map(({ key, field, issues, ...style }) => (
            <span
              key={key}
              className="widget-overlay"
              data-testid="flagged-widget"
              data-field={field}
              title={issues.map((issue) => diagnosticText(issue, minSize, language)).join(' · ')}
              style={style}
            />
          ))}
        </div>
      </div>
    </>
  );
}
