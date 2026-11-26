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

function decimalParts(value: number): readonly [coefficient: bigint, exponent: number] {
  const [mantissa, power = '0'] = String(value).split('e');
  const [integer, fraction = ''] = mantissa!.split('.');
  return [BigInt(integer! + fraction), Number(power) - fraction.length];
}

function clearanceInPoints(from: number, to: number, userUnit: ReturnType<typeof decimalParts>): number {
  const [fromCoefficient, fromExponent] = decimalParts(from);
  const [toCoefficient, toExponent] = decimalParts(to);
  const exponent = Math.min(fromExponent, toExponent);
  // Compare the page coordinates as decimals so 16.08 - 7.08 is exactly 9 pt.
  const distance = toCoefficient * 10n ** BigInt(toExponent - exponent) - fromCoefficient * 10n ** BigInt(fromExponent - exponent);
  return Number(`${distance * userUnit[0]}e${exponent + userUnit[1]}`);
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
      const clearances = [clearanceInPoints(pageLeft, left, unit), clearanceInPoints(top, pageTop, unit),
        clearanceInPoints(right, pageRight, unit), clearanceInPoints(pageBottom, bottom, unit)];
      const clearancePt = Math.min(...clearances);
      if (!Number.isFinite(clearancePt) || clearancePt >= PRINT_MARGIN_THRESHOLD_PT) continue;
      const edge = edges[(clearances.indexOf(clearancePt) + page.rotation / 90) % edges.length]!;
      advisories.push({ code: 'margin-near-edge', field: name, pageNumber: pageIndex + 1, widgetIndex, edge, clearancePt });
    }
  }
  return advisories;
}
