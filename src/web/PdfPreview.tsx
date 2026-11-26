import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { fillLabel, type translator } from './labels';
import type { RowResult, TemplateInfo } from './useWorkbench';

GlobalWorkerOptions.workerSrc = workerUrl;

type PreviewProps = {
  bytes: Uint8Array;
  fields: TemplateInfo['fields'];
  diagnostics?: RowResult['diagnostics'];
  language: ReturnType<typeof translator>;
};

type Position = {
  key: string;
  field: string;
  left: string;
  top: string;
  width: string;
  height: string;
};

export default function PdfPreview({ bytes, fields, diagnostics, language }: PreviewProps) {
  const { labels, problem } = language;
  const [loaded, setLoaded] = useState<{ bytes: Uint8Array; pdf?: PDFDocumentProxy }>();
  const [rendered, setRendered] = useState<{
    pdf: PDFDocumentProxy;
    page: number;
    width: number;
    complete: boolean;
    ratio?: number;
    positions?: Position[];
  }>();
  const [requestedPage, setRequestedPage] = useState(1);
  const [zoom, setZoom] = useState('fit');
  const [frameWidth, setFrameWidth] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pdf = loaded?.bytes === bytes ? loaded.pdf : undefined;
  const page = Math.min(requestedPage, pdf?.numPages ?? requestedPage);
  const width = zoom === 'fit'
    ? Math.min(470, Math.max(120, frameWidth - 32))
    : Math.round(550 * Number(zoom));
  const raster = rendered?.pdf === pdf && rendered?.page === page && rendered.width === width ? rendered : undefined;
  const failed = (loaded?.bytes === bytes && !pdf) || (raster && !raster.complete);

  useEffect(() => {
    const host = frame.current!;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setFrameWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
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
    if (!pdf || !target || frameWidth === 0) return;
    let active = true;
    let task: RenderTask | undefined;

    async function draw(document: PDFDocumentProxy, element: HTMLCanvasElement) {
      const docPage = await document.getPage(page);
      if (!active) return;
      const base = docPage.getViewport({ scale: 1 });
      const viewport = docPage.getViewport({ scale: width / base.width });
      const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
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
          if (widget.pageIndex !== page - 1 || !diagnostics?.some(
            (issue) => issue.field === field.name && (issue.widgetIndex === undefined || issue.widgetIndex === index),
          )) return;
          const [x1, y1] = viewport.convertToViewportPoint(widget.x, widget.y);
          const [x2, y2] = viewport.convertToViewportPoint(widget.x + widget.width, widget.y + widget.height);
          positions.push({
            key: `${field.name}-${index}`,
            field: field.name,
            left: `${100 * Math.min(x1, x2) / viewport.width}%`,
            top: `${100 * Math.min(y1, y2) / viewport.height}%`,
            width: `${100 * Math.abs(x2 - x1) / viewport.width}%`,
            height: `${100 * Math.abs(y2 - y1) / viewport.height}%`,
          });
        });
      }
      setRendered({ pdf: document, page, width, complete: true, ratio: viewport.width / viewport.height, positions });
    }

    void draw(pdf, target).catch(() => {
      if (active) setRendered({ pdf, page, width, complete: false });
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, page, width, frameWidth, fields, diagnostics]);

  return (
    <>
      <div className="preview-toolbar">
        <div className="page-controls" aria-label={labels.preview}>
          <button type="button" className="icon-button" aria-label={labels.previousPage} disabled={page <= 1 || !pdf} onClick={() => setRequestedPage(page - 1)}>
            <span aria-hidden="true" className="chevron previous" />
          </button>
          <span className="page-counter">{fillLabel(labels.pageCount, { page: pdf ? page : 0, total: pdf?.numPages ?? 0 })}</span>
          <button type="button" className="icon-button" aria-label={labels.nextPage} disabled={!pdf || page >= pdf.numPages} onClick={() => setRequestedPage(page + 1)}>
            <span aria-hidden="true" className="chevron next" />
          </button>
        </div>
        <select aria-label={labels.zoom} value={zoom} onChange={(event) => setZoom(event.currentTarget.value)}>
          <option value="fit">{labels.fit}</option>
          <option value="0.75">75%</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select>
      </div>
      <div className="preview-bed" ref={frame}>
        {failed && <p className="alert" role="alert">{labels.previewError}</p>}
        {!failed && !raster && <p className="preview-message" role="status">{labels.previewBusy}</p>}
        <div className="canvas-paper" style={{ width, aspectRatio: raster?.ratio }} hidden={!raster?.complete}>
          <canvas
            aria-label={labels.previewCanvas}
            role="img"
            data-testid="pdf-canvas"
            data-rendered={raster?.complete ? 'true' : undefined}
            ref={canvas}
          />
          {raster?.positions?.map(({ key, field, ...style }) => (
            <span
              key={key}
              className="widget-overlay"
              data-testid="flagged-widget"
              data-field={field}
              title={diagnostics?.filter((issue) => issue.field === field).map((issue) => problem(issue.code)).join(' · ')}
              style={style}
            />
          ))}
        </div>
      </div>
    </>
  );
}
