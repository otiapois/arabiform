import { isAlignOverride, type AlignOverride } from '../pdf/alignment';
import type { PdfIntakeCode, RectangleBounds } from '../pdf/template';
import type { DesignerPage, PdfRect } from './geometry';

export interface FieldDraftSpec {
  name: string;
  kind: 'text' | 'checkbox' | 'dropdown' | 'radio';
  pageIndex: number;
  rectPdf: PdfRect;
  alignment?: AlignOverride;
  multiline?: boolean;
  maxLen?: number;
  fontSize?: number;
  options?: string[];
  exportValue?: string;
}

export type DesignerErrorCode = Exclude<PdfIntakeCode, 'flat-scanned-no-fields'> |
  'existing-form-fields' | 'invalid-page-geometry' | 'no-fields' | 'invalid-field-name' |
  'duplicate-field-name' | 'field-name-conflict' | 'invalid-field-page' | 'invalid-field-rect' |
  'field-out-of-bounds' | 'field-too-small' | 'invalid-field-options' | 'invalid-layout' | 'layout-source-mismatch';

export class DesignerError extends Error {
  readonly fieldIndex?: number;
  readonly rectPdf?: PdfRect;
  readonly bounds?: RectangleBounds;

  constructor(readonly code: DesignerErrorCode, details: {
    fieldIndex?: number; rectPdf?: PdfRect; bounds?: RectangleBounds; cause?: unknown;
  } = {}) {
    super(code, { cause: details.cause });
    this.name = 'DesignerError';
    this.fieldIndex = details.fieldIndex;
    this.rectPdf = details.rectPdf;
    this.bounds = details.bounds;
  }
}

export function validateFieldRect(rectPdf: PdfRect, page: DesignerPage, kind: FieldDraftSpec['kind'], fieldIndex?: number): PdfRect {
  const { visibleBox: box, rotation, userUnit } = page;
  const bounds: RectangleBounds = [box.x, box.y, box.x + box.width, box.y + box.height];
  const details = { fieldIndex, rectPdf, bounds };
  const [x, y, width, height] = rectPdf;
  const right = x + width;
  const top = y + height;
  if (![x, y, width, height, right, top].every(Number.isFinite) || right <= x || top <= y) {
    throw new DesignerError('invalid-field-rect', details);
  }
  // Permit only arithmetic roundoff from projecting the full visible box into PDF coordinates.
  const epsilon = Math.max(1, ...bounds.map(Math.abs), box.width, box.height) * Number.EPSILON * 4;
  if (x < bounds[0] - epsilon || y < bounds[1] - epsilon || right > bounds[2] + epsilon || top > bounds[3] + epsilon) {
    throw new DesignerError('field-out-of-bounds', details);
  }
  const left = Math.max(x, bounds[0]);
  const bottom = Math.max(y, bounds[1]);
  const w = left === x && right <= bounds[2] ? width : Math.min(right, bounds[2]) - left;
  const h = bottom === y && top <= bounds[3] ? height : Math.min(top, bounds[3]) - bottom;
  const quarterTurn = rotation % 180 !== 0;
  const [minWidth, minHeight] = kind === 'text' || kind === 'dropdown' ? [12, 10] : [8, 8];
  if (((quarterTurn ? h : w) + epsilon) * userUnit < minWidth || ((quarterTurn ? w : h) + epsilon) * userUnit < minHeight) {
    throw new DesignerError('field-too-small', details);
  }
  return [left, bottom, w, h];
}

const specKeys = new Set(['name', 'kind', 'pageIndex', 'rectPdf', 'alignment', 'multiline', 'maxLen', 'fontSize', 'options', 'exportValue']);
const invalidNameCharacters = /[\p{Cc}\p{Cf}\p{Cs}]/u;

function isChoiceValue(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
}

export function validateFieldSpecs(fields: unknown, pages: readonly DesignerPage[]): FieldDraftSpec[] {
  if (!Array.isArray(fields)) throw new DesignerError('invalid-layout');
  if (!fields.length) throw new DesignerError('no-fields');
  const names = new Map<string, FieldDraftSpec['kind']>();
  const radioValues = new Map<string, Set<string>>();
  const branches = new Set<string>();
  const validated: FieldDraftSpec[] = [];
  for (const [fieldIndex, field] of fields.entries()) {
    const details = { fieldIndex };
    if (!field || typeof field !== 'object' || Array.isArray(field) || Object.keys(field).some((key) => !specKeys.has(key))) {
      throw new DesignerError('invalid-field-options', details);
    }
    const { name, kind, pageIndex, rectPdf, alignment, multiline, maxLen, fontSize, options, exportValue } = field as Record<string, unknown>;
    const parts = typeof name === 'string' && !invalidNameCharacters.test(name) ? name.split('.') : [];
    if (typeof name !== 'string' || !parts.length || parts.length > 128 || parts.some((part) => !part || part !== part.trim())) {
      throw new DesignerError('invalid-field-name', details);
    }
    if (names.has(name) && (kind !== 'radio' || names.get(name) !== 'radio')) throw new DesignerError('duplicate-field-name', details);
    if (branches.has(name)) throw new DesignerError('field-name-conflict', details);
    let prefix = '';
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? prefix + '.' + part : part;
      if (names.has(prefix)) throw new DesignerError('field-name-conflict', details);
      branches.add(prefix);
    }
    if ((kind !== 'text' && kind !== 'checkbox' && kind !== 'dropdown' && kind !== 'radio') ||
      (kind !== 'text' && [alignment, multiline, maxLen, fontSize].some((value) => value !== undefined)) ||
      (alignment !== undefined && !isAlignOverride(alignment)) ||
      (multiline !== undefined && typeof multiline !== 'boolean') ||
      (maxLen !== undefined && (typeof maxLen !== 'number' || !Number.isInteger(maxLen) || maxLen < 1 || maxLen > 0x7fffffff)) ||
      (fontSize !== undefined && (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize < 6 || fontSize > 72))) {
      throw new DesignerError('invalid-field-options', details);
    }
    let dropdownOptions: string[] | undefined;
    let radioValue: string | undefined;
    if (kind === 'dropdown') {
      if (!Array.isArray(options) || !options.length || !Array.from(options).every(isChoiceValue) || new Set(options).size !== options.length) {
        throw new DesignerError('invalid-field-options', details);
      }
      dropdownOptions = Array.from(options);
    } else if (options !== undefined) throw new DesignerError('invalid-field-options', details);
    if (kind === 'radio') {
      if (!isChoiceValue(exportValue)) throw new DesignerError('invalid-field-options', details);
      const values = radioValues.get(name) ?? new Set<string>();
      if (values.has(exportValue)) throw new DesignerError('duplicate-field-name', details);
      values.add(exportValue);
      radioValues.set(name, values);
      radioValue = exportValue;
    } else if (exportValue !== undefined) throw new DesignerError('invalid-field-options', details);
    names.set(name, kind);
    if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || !pages[pageIndex]) {
      throw new DesignerError('invalid-field-page', details);
    }
    if (!Array.isArray(rectPdf) || rectPdf.length !== 4 || [...rectPdf].some((value) => typeof value !== 'number')) {
      throw new DesignerError('invalid-field-rect', details);
    }
    const rect = validateFieldRect(rectPdf as unknown as PdfRect, pages[pageIndex], kind, fieldIndex);
    validated.push({
      name, kind, pageIndex, rectPdf: rect,
      ...(alignment !== undefined && { alignment }), ...(multiline !== undefined && { multiline }),
      ...(maxLen !== undefined && { maxLen }), ...(fontSize !== undefined && { fontSize }),
      ...(dropdownOptions !== undefined && { options: dropdownOptions }), ...(radioValue !== undefined && { exportValue: radioValue }),
    });
  }
  return validated;
}
