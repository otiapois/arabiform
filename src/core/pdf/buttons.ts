import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { buttonNormal, buttonOnState } from './choices';
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

function usableButton(target: WidgetTarget, normal: PDFDict, on: PDFName): boolean {
  if (!target.meta.usable || !(target.meta.width > 0 && target.meta.height > 0) || target.meta.rotation % 90 !== 0) return false;
  try {
    const unchecked = normal.lookup(off);
    const checked = normal.lookup(on);
    return unchecked !== checked && usableAppearance(unchecked, false) && usableAppearance(checked, true);
  } catch {
    return false;
  }
}

export function planCheckbox(canonical: PDFDict, widgets: WidgetTarget[], checked: boolean) {
  const problems: number[] = [];
  const current = fieldAttributes(canonical, 'V') ?? off;
  let on: PDFName | undefined;
  for (const [widgetIndex, target] of widgets.entries()) {
    const { dict } = target.widget;
    const normal = buttonNormal(dict);
    const selected = buttonOnState(normal);
    const localValue = dict === canonical ? current : dict.lookup(key('V')) ?? current;
    const appearanceState = dict.lookup(key('AS'));
    const valid = normal && selected
      && (!on || on === selected) && (current === off || current === selected)
      && localValue === current && appearanceState === current && usableButton(target, normal, selected);
    if (!valid) problems.push(widgetIndex);
    else on = selected;
  }
  return { problems, state: checked ? on : off };
}

export function planRadio(canonical: PDFDict, widgets: WidgetTarget[]) {
  const current = fieldAttributes(canonical, 'V') ?? off;
  const problems: number[] = [];
  const states = widgets.map((target, index) => {
    const { dict } = target.widget;
    const normal = buttonNormal(dict);
    const on = buttonOnState(normal);
    const localValue = dict === canonical ? current : dict.lookup(key('V')) ?? current;
    const state = dict.lookup(key('AS')) ?? off;
    if (!normal || !on || localValue !== current || state !== (current === on ? on : off) || !usableButton(target, normal, on)) {
      problems.push(index);
    }
    return on;
  });
  // A repeated appearance name cannot identify a unique widget in the group.
  const consistent = new Set(states.filter(Boolean)).size === states.filter(Boolean).length
    && (problems.length > 0 || current === off || states.includes(current as PDFName));
  return { states, problems, consistent };
}

export function applyButton(canonical: PDFDict, widgets: WidgetTarget[], state: PDFName, selectedIndex?: number) {
  canonical.set(key('V'), state);
  for (const [index, { widget }] of widgets.entries()) {
    if (widget.dict !== canonical && widget.dict.has(key('V'))) widget.dict.set(key('V'), state);
    widget.setAppearanceState(selectedIndex === undefined || selectedIndex === index ? state : off);
  }
}
