import type { FieldDraftSpec } from '../core/designer/spec';
import type { DesignerCopy } from './designer-labels';

export const designerKinds = ['text', 'checkbox', 'dropdown', 'radio'] as const;

export function draftField(
  kind: FieldDraftSpec['kind'],
  geometry: Pick<FieldDraftSpec, 'pageIndex' | 'rectPdf' | 'name'>,
  fields: readonly FieldDraftSpec[],
  copy: DesignerCopy,
): FieldDraftSpec {
  const field = { ...geometry, kind };
  if (kind === 'dropdown') return { ...field, options: [`${copy.option} 1`, `${copy.option} 2`] };
  if (kind === 'radio') {
    const used = new Set(fields.filter((other) => other.kind === 'radio' && other.name === field.name).map(({ exportValue }) => exportValue));
    let index = 1;
    while (used.has(`${copy.option} ${index}`)) index++;
    return { ...field, exportValue: `${copy.option} ${index}` };
  }
  return field;
}

export function fieldCaption(field: FieldDraftSpec) {
  return field.kind === 'radio' ? `${field.name} — ${field.exportValue}` : field.name;
}
