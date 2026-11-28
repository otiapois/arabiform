import { decimalNumber, decimalParts, distanceInPoints } from './decimal-points';
import type { TemplateMetadata } from './template';

const edges = ['left', 'top', 'right', 'bottom'] as const;
export const PRINT_MARGIN_THRESHOLD_PT = 9;

export interface PrintMarginAdvisory {
  code: 'margin-near-edge';
  field: string;
  pageNumber: number;
  widgetIndex: number;
  edge: typeof edges[number];
  clearancePt: number;
}

export function inspectPrintMargins(template: TemplateMetadata, mappedFieldNames: readonly string[]): PrintMarginAdvisory[] {
  const mapped = new Set(mappedFieldNames);
  const advisories: PrintMarginAdvisory[] = [];
  for (const { name, widgets } of template.fields) {
    if (!mapped.has(name)) continue;
    for (const [widgetIndex, { pageIndex, printBounds }] of widgets.entries()) {
      const page = template.pages[pageIndex];
      if (!page || !printBounds || page.rotation % 90 !== 0 || ![...page.printBounds, ...printBounds].every(Number.isFinite)) continue;
      const [pageLeft, pageBottom, pageRight, pageTop] = page.printBounds;
      const [left, bottom, right, top] = printBounds;
      const unit = decimalParts(page.userUnit);
      const clearances = [
        distanceInPoints(pageLeft, left, unit), distanceInPoints(top, pageTop, unit),
        distanceInPoints(right, pageRight, unit), distanceInPoints(pageBottom, bottom, unit),
      ].map(decimalNumber);
      const clearancePt = Math.min(...clearances);
      if (!Number.isFinite(clearancePt) || clearancePt >= PRINT_MARGIN_THRESHOLD_PT) continue;
      const edge = edges[(clearances.indexOf(clearancePt) + page.rotation / 90) % edges.length]!;
      advisories.push({ code: 'margin-near-edge', field: name, pageNumber: pageIndex + 1, widgetIndex, edge, clearancePt });
    }
  }
  return advisories;
}
