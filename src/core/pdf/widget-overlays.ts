import type { RectangleBounds, TemplateMetadata } from './template';
import { sourceToDisplay } from './page-geometry';

export interface WidgetOverlay {
  pageNumber: number;
  fieldName: string;
  widgetIndex: number;
  rect: readonly [x: number, y: number, width: number, height: number];
}

function projectWidget(widget: RectangleBounds, page: TemplateMetadata['pages'][number]): WidgetOverlay['rect'] | undefined {
  const [pageLeft, pageBottom, pageRight, pageTop] = page.printBounds;
  const [left, bottom, right, top] = widget;
  const x1 = Math.max(left, pageLeft);
  const x2 = Math.min(right, pageRight);
  const y1 = Math.max(bottom, pageBottom);
  const y2 = Math.min(top, pageTop);
  const width = pageRight - pageLeft;
  const height = pageTop - pageBottom;
  if (!(x2 > x1 && y2 > y1) || ![x1, x2, y1, y2, width, height].every(Number.isFinite)) return undefined;

  return sourceToDisplay([x1, y1, x2 - x1, y2 - y1], page);
}

export function getWidgetOverlays(template: TemplateMetadata): WidgetOverlay[] {
  const overlays: WidgetOverlay[] = [];
  for (const { name, widgets } of template.fields) {
    for (const [index, { pageIndex, visibleInPreview, printBounds }] of widgets.entries()) {
      const page = template.pages[pageIndex];
      if (!page || !visibleInPreview || !printBounds) continue;
      const rect = projectWidget(printBounds, page);
      if (rect) overlays.push({ pageNumber: pageIndex + 1, fieldName: name, widgetIndex: index + 1, rect });
    }
  }
  return overlays;
}
