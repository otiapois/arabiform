import { PDFArray, PDFDict, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import type { FieldChoice } from './choice-match';
import type { WidgetTarget } from './template';

const key = PDFName.of;
type TextString = PDFString | PDFHexString;
export type DropdownChoice = FieldChoice & { exportString: TextString };

function isTextString(item: unknown): item is TextString {
  return item instanceof PDFString || item instanceof PDFHexString;
}

export function dropdownChoices(canonical: PDFDict): DropdownChoice[] {
  const options = canonical.lookup(key('Opt'));
  if (!(options instanceof PDFArray)) return [];
  const choices: DropdownChoice[] = [];
  for (let index = 0; index < options.size(); index++) {
    const option = options.lookup(index);
    if (option instanceof PDFArray && option.size() !== 2) return [];
    const exportString = option instanceof PDFArray ? option.lookup(0) : option;
    const label = option instanceof PDFArray ? option.lookup(1) : option;
    if (!isTextString(exportString) || !isTextString(label)) return [];
    choices.push({ value: exportString.decodeText(), label: label.decodeText(), exportString });
  }
  return choices;
}

export function buttonNormal(widget: PDFDict): PDFDict | undefined {
  const appearance = widget.lookup(key('AP'));
  const normal = appearance instanceof PDFDict ? appearance.lookup(key('N')) : undefined;
  return normal instanceof PDFDict ? normal : undefined;
}

export function buttonOnState(normal: PDFDict | undefined): PDFName | undefined {
  const states = normal?.keys().filter((state) => state !== key('Off'));
  return states?.length === 1 ? states[0] : undefined;
}

export function radioChoices(widgets: WidgetTarget[], options: unknown): FieldChoice[] {
  const choices: FieldChoice[] = [];
  if (options !== undefined && (!(options instanceof PDFArray) || options.size() !== widgets.length)) return choices;
  for (const [index, { widget }] of widgets.entries()) {
    const item = options instanceof PDFArray ? options.lookup(index) : buttonOnState(buttonNormal(widget.dict));
    if (!isTextString(item) && !(options === undefined && item instanceof PDFName)) return [];
    const value = item.decodeText();
    choices.push({ value, label: value });
  }
  return choices;
}
