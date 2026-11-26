import Papa from 'papaparse';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';
import { createShaper, DEFAULT_MIN_FONT_SIZE, fitText, MAX_FONT_SIZE, MIN_FONT_SIZE, type FontBytes } from './shaping';
import { openTemplate, type FieldMetadata, type TemplateMetadata } from './template';

export interface FieldCapacityRow {
  fieldName: string;
  kind: FieldMetadata['kind'];
  pageNumber: number | null;
  widgetNumber: number | null;
  widgetRotation: number | null;
  innerWidth: number | null;
  innerHeight: number | null;
  maxLength: number | null;
  arabicCharacters: number | null;
  latinCharacters: number | null;
}

export interface TemplateCapacityReport {
  fieldCount: number;
  minFontSize: number;
  rows: FieldCapacityRow[];
}

// Bound synthetic shaping work for hostile, abnormally large page boxes.
export const CAPACITY_SAMPLE_LIMIT = 2048;
const samples = {
  arabic: 'مُحَمَّد سَالِم ',
  latin: 'Marwan Salem ',
};

function estimate(
  family: keyof FontBytes, shaper: ReturnType<typeof createShaper>, multiline: boolean, maxLength: number | undefined,
  width: number, height: number, size: number,
): number {
  const sample = samples[family];
  const limit = Math.min(maxLength ?? CAPACITY_SAMPLE_LIMIT, CAPACITY_SAMPLE_LIMIT);
  const fits = (count: number) => {
    const text = sample.repeat(Math.ceil(count / sample.length)).slice(0, count);
    const placement = fitText(shaper, text, multiline, { innerWidth: width, innerHeight: height, padding: 0, min: size, max: size });
    return !('code' in placement);
  };
  let low = 0;
  let high = 1;
  while (high <= limit && fits(high)) {
    low = high;
    high *= 2;
  }
  high = Math.min(high - (high <= limit ? 1 : 0), limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

export async function inspectTemplateCapacities(
  template: Uint8Array | ArrayBuffer | TemplateMetadata,
  fonts: FontBytes,
  minFontSize = DEFAULT_MIN_FONT_SIZE,
): Promise<TemplateCapacityReport> {
  if (!Number.isFinite(minFontSize) || minFontSize < MIN_FONT_SIZE || minFontSize > MAX_FONT_SIZE) {
    throw new Error('invalid-min-font-size');
  }
  const fields = 'fields' in template ? template.fields : (await openTemplate(template)).fields.map(({ meta }) => meta);
  const shapers = { arabic: createShaper(fonts, 'arabic'), latin: createShaper(fonts, 'latin') };
  const rows = fields.flatMap((field): FieldCapacityRow[] => {
    const { name: fieldName, kind, maxLength } = field;
    const common = { fieldName, kind, maxLength: maxLength ?? null };
    if (!field.widgets.length) return [{ ...common, pageNumber: null, widgetNumber: null, widgetRotation: null,
      innerWidth: null, innerHeight: null, arabicCharacters: null, latinCharacters: null }];
    return field.widgets.map(({ pageIndex, rotation, defaultFontSize, innerWidth, innerHeight, usable }, index) => {
      const capacity = (family: keyof FontBytes) => {
        if (!field.supportsTextCapacity || !usable || innerWidth === null || innerHeight === null) return null;
        if (innerWidth <= 0 || innerHeight <= 0 || defaultFontSize < minFontSize) return 0;
        return estimate(family, shapers[family], field.multiline, maxLength, innerWidth, innerHeight, minFontSize);
      };
      return { ...common, pageNumber: pageIndex < 0 ? null : pageIndex + 1, widgetNumber: index + 1, widgetRotation: rotation,
        innerWidth, innerHeight, arabicCharacters: capacity('arabic'), latinCharacters: capacity('latin') };
    });
  });
  return { fieldCount: fields.length, minFontSize, rows };
}

export function createCapacityCsv(report: TemplateCapacityReport): string {
  const fields = ['fieldName', 'kind', 'pageNumber', 'widgetNumber', 'widgetRotation', 'innerWidthPt', 'innerHeightPt',
    'maxLength', 'arabicCharacters', 'latinCharacters', 'minFontSizePt'];
  const data = report.rows.map((row) => [escapeSpreadsheetCell(row.fieldName), row.kind, row.pageNumber, row.widgetNumber,
    row.widgetRotation, row.innerWidth, row.innerHeight, row.maxLength, row.arabicCharacters, row.latinCharacters, report.minFontSize]);
  return `${Papa.unparse({ fields, data })}\r\n`;
}
