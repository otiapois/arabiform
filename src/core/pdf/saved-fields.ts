import { AcroButtonFlags, AcroChoiceFlags, PDFArray, PDFDict, type PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber,
  PDFString, pdfDocEncodingDecode, type PDFObject } from 'pdf-lib';
import { buttonNormal, buttonOnState } from './choices';
import { collectPageWidgets, inspectAcroFormCatalog, key, assertUnsignedAcroForm, PdfIntakeError } from './template';

const utf16be = new TextDecoder('utf-16be', { fatal: true });
const utf16le = new TextDecoder('utf-16le', { fatal: true });
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function invalidPdf(): never {
  throw new PdfIntakeError('invalid-pdf');
}

function lookupSavedObject(dict: PDFDict, name: string, preserveNull = false): PDFObject | undefined {
  const entry = dict.get(key(name), preserveNull);
  if (entry === undefined) return;
  const resolved = dict.context.lookup(entry);
  if (resolved === undefined) invalidPdf();
  return resolved === PDFNull && !preserveNull ? undefined : resolved;
}

export function decodeText(value: unknown): string {
  let bytes: Uint8Array;
  if (value instanceof PDFHexString) {
    const hex = value.asString().replace(/[\0\t\n\f\r ]/g, '');
    if (/[^0-9a-f]/i.test(hex)) invalidPdf();
    bytes = PDFHexString.of(hex).asBytes();
  } else if (value instanceof PDFString) {
    // Literal PDF strings normalize physical line breaks and omit escaped continuations.
    const literal = value.asString().replace(/\\(?:\r\n|\r|\n)|\\[\s\S]|\r\n|\r|\n/g, (part) =>
      part[0] !== '\\' ? '\n' : /[\r\n]/.test(part) ? '' : part);
    bytes = PDFString.of(literal).asBytes();
  } else {
    return invalidPdf();
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return utf16be.decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return utf16le.decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return utf8.decode(bytes);
  // Decode in bounded blocks because pdf-lib spreads all decoded code points in a call.
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    const part = bytes.subarray(offset, offset + 8192);
    if (part.some((byte) => byte === 0x7f || byte === 0x9f || byte === 0xad)) invalidPdf();
    text += pdfDocEncodingDecode(part);
  }
  return text;
}

export function optionLabels(options: PDFObject | undefined) {
  if (options === undefined) return [];
  if (!(options instanceof PDFArray)) return invalidPdf();
  return Array.from({ length: options.size() }, (_, index) => {
    const option = options.lookup(index);
    if (!(option instanceof PDFArray)) {
      const value = decodeText(option);
      return { value, label: value };
    }
    if (option.size() !== 2) return invalidPdf();
    return { value: decodeText(option.lookup(0)), label: decodeText(option.lookup(1)) };
  });
}

export function radioOption(state: PDFName, options: PDFObject, widgets: readonly PDFDict[]) {
  const nativeValue = state.decodeText();
  const choices = optionLabels(options);
  const matchingWidgets = widgets.flatMap((widget, index) => buttonOnState(buttonNormal(widget)) === state ? [index] : []);
  const selectedWidgets = matchingWidgets.filter((index) => lookupSavedObject(widgets[index]!, 'AS') === state);
  const indices = selectedWidgets.length ? selectedWidgets : matchingWidgets;
  const indexed = /^(0|[1-9]\d*)$/.test(nativeValue) ? choices[Number(nativeValue)] : undefined;
  const candidates = indices.length
    ? indices.map((index) => choices[index] ?? invalidPdf())
    : indexed ? [indexed] : choices.filter(({ value }) => value === nativeValue);
  const option = candidates[0];
  if (!option || candidates.some(({ value, label }) => value !== option.value || label !== option.label)) return invalidPdf();
  return option;
}

interface FieldNode {
  dict: PDFDict;
  parent?: PDFDict;
  name?: string;
  type?: PDFObject;
  flags?: PDFObject;
  value?: PDFObject;
  options?: PDFObject;
}

export interface SavedField {
  name: string;
  kind: 'text' | 'dropdown' | 'listbox' | 'checkbox' | 'radio';
  value?: PDFObject;
  options?: PDFObject;
  indices?: PDFObject;
  widgets: readonly PDFDict[];
}

export function readSavedFields(doc: PDFDocument, preserveNull = false): SavedField[] {
  const acroForm = inspectAcroFormCatalog(doc);
  const widgets = collectPageWidgets(doc.getPages());
  const roots = assertUnsignedAcroForm(doc, acroForm, widgets.keys());
  if (!roots?.size()) return [];

  const stack: FieldNode[] = [];
  for (let index = roots.size() - 1; index >= 0; index--) stack.push({ dict: roots.lookup(index, PDFDict) });
  const seen = new Set<PDFDict>();
  const names = new Set<string>();
  const fields: SavedField[] = [];
  while (stack.length) {
    const inherited = stack.pop()!;
    const { dict } = inherited;
    const parent = lookupSavedObject(dict, 'Parent');
    if (seen.has(dict) || parent !== undefined && parent !== inherited.parent) invalidPdf();
    seen.add(dict);
    const partial = lookupSavedObject(dict, 'T');
    const name = partial === undefined ? inherited.name
      : inherited.name === undefined ? decodeText(partial) : inherited.name + '.' + decodeText(partial);
    const type = lookupSavedObject(dict, 'FT') ?? inherited.type;
    const flags = lookupSavedObject(dict, 'Ff') ?? inherited.flags;
    const value = lookupSavedObject(dict, 'V', preserveNull) ?? inherited.value;
    const options = lookupSavedObject(dict, 'Opt') ?? inherited.options;
    const kids = lookupSavedObject(dict, 'Kids');
    if (kids !== undefined && !(kids instanceof PDFArray)) invalidPdf();
    const childFields: PDFDict[] = [];
    const childWidgets: PDFDict[] = [];
    for (let index = 0; kids && index < kids.size(); index++) {
      const child = kids.lookup(index, PDFDict);
      if (lookupSavedObject(child, 'Subtype') === key('Widget') && !child.has(key('T')) && !child.has(key('FT'))) {
        const widgetParent = lookupSavedObject(child, 'Parent');
        if (seen.has(child) || widgetParent !== undefined && widgetParent !== dict || child.has(key('Kids'))) invalidPdf();
        seen.add(child);
        childWidgets.push(child);
      } else {
        childFields.push(child);
      }
    }
    if (childFields.length) {
      if (childWidgets.length) invalidPdf();
      for (const child of childFields.reverse()) stack.push({ dict: child, parent: dict, name, type, flags, value, options });
      continue;
    }

    if (flags !== undefined && (!(flags instanceof PDFNumber) || !Number.isSafeInteger(flags.asNumber()))) invalidPdf();
    const bits = flags?.asNumber() ?? 0;
    if (type === key('Btn') && bits & AcroButtonFlags.PushButton) continue;
    if (!name || names.has(name)) invalidPdf();
    names.add(name);
    const kind = type === key('Tx') ? 'text' : type === key('Ch') ? (bits & AcroChoiceFlags.Combo ? 'dropdown' : 'listbox')
      : type === key('Btn') ? (bits & AcroButtonFlags.Radio ? 'radio' : 'checkbox') : invalidPdf();
    fields.push({ name, kind, value, options, indices: kind === 'dropdown' || kind === 'listbox' ? lookupSavedObject(dict, 'I') : undefined,
      widgets: childWidgets.length ? childWidgets : [dict] });
  }
  return fields;
}
