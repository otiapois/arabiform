import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { fieldAttributes, key, type WidgetTarget } from './template';

const off = key('Off');

export function parseCheckbox(value: string): boolean | undefined {
  switch (value.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case '1':
    case 'x':
    case 'نعم':
      return true;
    case 'false':
    case 'no':
    case '0':
    case '':
    case 'لا':
      return false;
  }
}

function numericArray(value: unknown, size: number): number[] | undefined {
  if (!(value instanceof PDFArray) || value.size() !== size) return undefined;
  const items = Array.from({ length: size }, (_, index) => value.lookup(index));
  return items.every((item) => item instanceof PDFNumber && Number.isFinite(item.asNumber()))
    ? items.map((item) => (item as PDFNumber).asNumber()) : undefined;
}

function usableAppearance(stream: unknown, checked: boolean): boolean {
  if (!(stream instanceof PDFRawStream) || stream.dict.lookup(key('Subtype')) !== key('Form')) return false;
  const bounds = numericArray(stream.dict.lookup(key('BBox')), 4);
  if (!bounds || !(bounds[2]! > bounds[0]! && bounds[3]! > bounds[1]!)) return false;
  if (stream.dict.has(key('Matrix'))) {
    const matrix = numericArray(stream.dict.lookup(key('Matrix')), 6);
    if (!matrix || !(Math.abs(matrix[0]! * matrix[3]! - matrix[1]! * matrix[2]!) > 0)) return false;
  }
  // Verify a checked state has an actual decodable program. An off-state may be empty.
  const prefix = decodePDFRawStream(stream).getBytes(4096);
  return !checked || prefix.some((byte) => byte > 32);
}

export function planCheckbox(canonical: PDFDict, widgets: WidgetTarget[], checked: boolean) {
  const problems: number[] = [];
  const current = fieldAttributes(canonical, 'V') ?? off;
  let on: PDFName | undefined;
  for (const [widgetIndex, target] of widgets.entries()) {
    const { dict } = target.widget;
    const ap = dict.lookup(key('AP'));
    const normal = ap instanceof PDFDict ? ap.lookup(key('N')) : undefined;
    const states = normal instanceof PDFDict ? normal.keys().filter((state) => state !== off) : [];
    const selected = states[0];
    const localValue = dict === canonical ? current : dict.lookup(key('V')) ?? current;
    const appearanceState = dict.lookup(key('AS'));
    let valid = target.usable && target.meta.width > 0 && target.meta.height > 0 && target.meta.rotation % 90 === 0
      && normal instanceof PDFDict && states.length === 1 && selected !== undefined
      && (!on || on === selected) && (current === off || current === selected)
      && localValue === current && appearanceState === current;
    if (valid && normal instanceof PDFDict && selected) {
      try {
        const unchecked = normal.lookup(off);
        const checked = normal.lookup(selected);
        valid = unchecked !== checked && usableAppearance(unchecked, false) && usableAppearance(checked, true);
      } catch {
        valid = false;
      }
    }
    if (!valid) problems.push(widgetIndex);
    else on = selected;
  }
  return { problems, state: checked ? on : off };
}

export function applyCheckbox(canonical: PDFDict, widgets: WidgetTarget[], state: PDFName) {
  canonical.set(key('V'), state);
  for (const { widget } of widgets) {
    if (widget.dict !== canonical && widget.dict.has(key('V'))) widget.dict.set(key('V'), state);
    widget.setAppearanceState(state);
  }
}
