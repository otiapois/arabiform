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
    for (const [widgetIndex, { pageIndex, x, y, width, height }] of widgets.entries()) {
      const page = template.pages[pageIndex];
      if (!page || page.rotation % 90 !== 0) continue;
      const { visibleBox: box, userUnit, rotation } = page;
      const clearances = [x - box.x, box.y + box.height - (y + height), box.x + box.width - (x + width), y - box.y];
      const clearance = Math.min(...clearances);
      const clearancePt = clearance * userUnit;
      if (!Number.isFinite(clearancePt) || clearancePt >= PRINT_MARGIN_THRESHOLD_PT) continue;
      const edge = edges[(clearances.indexOf(clearance) + rotation / 90) % edges.length]!;
      advisories.push({ code: 'margin-near-edge', field: name, pageNumber: pageIndex + 1, widgetIndex, edge, clearancePt });
    }
  }
  return advisories;
}
