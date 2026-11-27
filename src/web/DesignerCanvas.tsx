import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { sourceToDisplay, type DesignerPage, type NormalizedRect } from '../core/designer/geometry';
import type { FieldDraftSpec } from '../core/designer/spec';
import type { DesignerCopy } from './designer-labels';
import { openPreviewDocument } from './pdf-preview-document';

export type DesignField = { id: number; spec: FieldDraftSpec };
type Point = readonly [x: number, y: number];
type Stroke = { pointer: number; start: Point; startPx: Point };
const arrowDirection: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function pointInStage(event: PointerEvent<HTMLDivElement>): Point {
  const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (event.clientX - left) / width)), Math.min(1, Math.max(0, (event.clientY - top) / height))];
}

function drawnRect([startX, startY]: Point, [endX, endY]: Point): NormalizedRect {
  return [Math.min(startX, endX), Math.min(startY, endY), Math.abs(startX - endX), Math.abs(startY - endY)];
}

function position([left, top, width, height]: NormalizedRect) {
  return { left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` };
}

function displayedPageSize({ visibleBox, rotation, userUnit }: DesignerPage): Point {
  return rotation === 90 || rotation === 270
    ? [visibleBox.height * userUnit, visibleBox.width * userUnit]
    : [visibleBox.width * userUnit, visibleBox.height * userUnit];
}

export default function DesignerCanvas({ bytes, page, pageIndex, fields, selectedId, copy, disabled, onPlace, onSelect,
  onNudge, onDelete, onUndo, canUndo, focusId }: {
  bytes: Uint8Array;
  page: DesignerPage;
  pageIndex: number;
  fields: DesignField[];
  selectedId?: number;
  copy: DesignerCopy;
  disabled: boolean;
  onPlace: (rect: NormalizedRect | Point) => void;
  onSelect: (id: number) => void;
  onNudge: (id: number, x: number, y: number) => void;
  onDelete: (id: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  focusId?: number;
}) {
  const target = useRef<HTMLCanvasElement>(null);
  const focusField = useRef<HTMLButtonElement>(null);
  const stroke = useRef<Stroke | undefined>(undefined);
  const [draftRect, setDraftRect] = useState<NormalizedRect>();
  const [document, setDocument] = useState<PDFDocumentProxy | null>();
  const [render, setRender] = useState<{ document: PDFDocumentProxy; pageIndex: number; ok: boolean }>();
  const status = render?.document === document && render?.pageIndex === pageIndex ? render : undefined;
  const failed = document === null || status?.ok === false;
  const [pageWidth, pageHeight] = displayedPageSize(page);
  const stageWidth = Math.min(680, 1040 * pageWidth / pageHeight);

  useEffect(() => {
    if (status?.ok && focusId !== undefined) focusField.current?.focus({ preventScroll: true });
  }, [focusId, status]);

  useEffect(() => {
    const loading = openPreviewDocument(bytes);
    let active = true;
    loading.promise.then((pdf) => {
      if (active) setDocument(pdf);
    }, () => {
      if (active) setDocument(null);
    });
    return () => {
      active = false;
      void loading.destroy().catch(() => undefined);
    };
  }, [bytes]);

  useEffect(() => {
    const canvas = target.current;
    if (!document || !canvas) return;
    let task: RenderTask | undefined;
    let active = true;
    async function draw(pdf: PDFDocumentProxy, element: HTMLCanvasElement) {
      const pdfPage = await pdf.getPage(pageIndex + 1);
      if (!active) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: stageWidth / base.width });
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1), 4096 / Math.max(viewport.width, viewport.height));
      element.width = Math.max(1, Math.ceil(viewport.width * scale));
      element.height = Math.max(1, Math.ceil(viewport.height * scale));
      task = pdfPage.render({ canvas: element, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      await task.promise;
      if (active) setRender({ document: pdf, pageIndex, ok: true });
    }
    void draw(document, canvas).catch(() => {
      if (active) setRender({ document, pageIndex, ok: false });
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [document, pageIndex, stageWidth]);

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !status?.ok || event.target !== event.currentTarget || !event.isPrimary || event.button !== 0) return;
    const start = pointInStage(event);
    stroke.current = { pointer: event.pointerId, start, startPx: [event.clientX, event.clientY] };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftRect(drawnRect(start, start));
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (stroke.current?.pointer === event.pointerId) setDraftRect(drawnRect(stroke.current.start, pointInStage(event)));
  }

  function cancel(event: PointerEvent<HTMLDivElement>) {
    if (stroke.current?.pointer !== event.pointerId) return;
    stroke.current = undefined;
    setDraftRect(undefined);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const drawn = stroke.current;
    if (drawn?.pointer !== event.pointerId) return;
    cancel(event);
    if (disabled) return;
    const end = pointInStage(event);
    const moved = Math.hypot(event.clientX - drawn.startPx[0], event.clientY - drawn.startPx[1]);
    onPlace(moved < 4 ? end : drawnRect(drawn.start, end));
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (disabled || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && canUndo) {
      event.preventDefault();
      onUndo();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    const direction = arrowDirection[event.key];
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      onNudge(id, direction[0] * step, direction[1] * step);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(id);
    }
  }

  return (
    <div className="designer-page-bed">
      {failed && <p className="alert" role="alert">{copy.previewError}</p>}
      {!failed && !status && <p className="quiet" role="status">{copy.previewLoading}</p>}
      <div className="designer-stage" key={pageIndex} hidden={!status?.ok} data-testid="designer-stage"
        style={{ width: stageWidth, aspectRatio: pageWidth / pageHeight }}
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
        <canvas ref={target} role="img" aria-label={copy.pageImage} data-testid="designer-canvas" data-rendered={status?.ok ? 'true' : undefined} />
        {status?.ok && fields.map(({ id, spec }) => (
          <button type="button" className="designer-field" key={id} data-testid="designer-field" data-field={spec.name}
            aria-pressed={id === selectedId} aria-label={spec.name || copy[spec.kind]} title={spec.name || copy[spec.kind]}
            style={position(sourceToDisplay(spec.rectPdf, page))}
            ref={id === focusId ? focusField : undefined}
            disabled={disabled} onClick={() => onSelect(id)} onKeyDown={(event) => keyboard(event, id)} />
        ))}
        {status?.ok && draftRect && <span className="designer-draw-rect" aria-hidden="true" style={position(draftRect)} />}
      </div>
    </div>
  );
}
