import { useId, type FocusEvent } from 'react';
import type { FieldDraftSpec } from '../core/designer/spec';
import type { PdfRect } from '../core/designer/geometry';
import type { DesignField } from './DesignerCanvas';
import type { DesignerCopy } from './designer-labels';

const axes = ['X', 'Y', 'W', 'H'] as const;

function numberText(value: number | undefined) {
  return value === undefined ? '' : String(Number(value.toFixed(4)));
}

function NumericInput({ id, label, value, fallback, min, max, step = 'any', onApply }: {
  id: string;
  label: string;
  value?: number;
  fallback?: string;
  min?: number;
  max?: number;
  step?: 'any' | number;
  onApply: (value: number | undefined) => boolean;
}) {
  const initial = numberText(value);
  function apply(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (input.value === initial && !input.validity.badInput) return;
    const next = input.value !== '' || input.validity.badInput ? input.valueAsNumber : undefined;
    if (!onApply(next) || (next === undefined && !fallback)) input.value = initial;
  }
  return (
    <label>
      {label}
      <input key={initial} type="number" dir="ltr" data-testid={id} defaultValue={initial} placeholder={fallback} step={step} min={min} max={max}
        onBlur={apply} onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }} />
    </label>
  );
}

export default function DesignerInspector({ copy, fields, selected, disabled, onSelect, onChange, onDelete }: {
  copy: DesignerCopy;
  fields: DesignField[];
  selected?: DesignField;
  disabled: boolean;
  onSelect: (id: number) => void;
  onChange: (spec: FieldDraftSpec) => boolean;
  onDelete: (id: number) => void;
}) {
  const unitsId = useId();
  const field = selected?.spec;
  return (
    <aside className="designer-inspector" aria-labelledby="designer-inspector-title">
      <h3 id="designer-inspector-title">{copy.inspector}</h3>
      <label>
        {copy.fieldsOnPage}
        <select data-testid="designer-field-select" disabled={disabled || fields.length === 0} value={selected?.id ?? ''}
          onChange={(event) => onSelect(Number(event.currentTarget.value))}>
          <option value="" disabled>{copy.selectField}</option>
          {fields.map(({ id, spec }) => <option value={id} key={id} dir="auto">{spec.name || copy[spec.kind]}</option>)}
        </select>
      </label>
      {field && selected && (
        <fieldset key={selected.id} disabled={disabled} className="designer-properties" aria-label={copy.inspector}>
          <label>
            {copy.fieldName}
            <input key={field.name} type="text" dir="auto" defaultValue={field.name} data-testid="designer-field-name"
              onBlur={(event) => {
                const input = event.currentTarget;
                if (input.value !== field.name && !onChange({ ...field, name: input.value })) input.value = field.name;
              }} onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }} />
          </label>
          <label>
            {copy.kind}
            <select data-testid="designer-kind" value={field.kind} onChange={(event) => {
              const kind = event.currentTarget.value as FieldDraftSpec['kind'];
              onChange({ name: field.name, pageIndex: field.pageIndex, rectPdf: field.rectPdf, kind });
            }}>
              <option value="text">{copy.text}</option>
              <option value="checkbox">{copy.checkbox}</option>
            </select>
          </label>
          {field.kind === 'text' && (
            <>
              <label>
                {copy.alignment}
                <select data-testid="designer-alignment" value={field.alignment ?? 'auto'}
                  onChange={(event) => onChange({ ...field, alignment: event.currentTarget.value as FieldDraftSpec['alignment'] })}>
                  <option value="auto">{copy.auto}</option>
                  <option value="rtl">{copy.rtl}</option>
                  <option value="ltr">{copy.ltr}</option>
                  <option value="center">{copy.center}</option>
                </select>
              </label>
              <label className="designer-multiline">
                <input type="checkbox" data-testid="designer-multiline" checked={field.multiline ?? false}
                  onChange={(event) => onChange({ ...field, multiline: event.currentTarget.checked })} />
                {copy.multiline}
              </label>
              <NumericInput id="designer-max-length" label={copy.maxLength} value={field.maxLen} fallback={copy.optional}
                step={1} min={1} max={2147483647} onApply={(maxLen) => onChange({ ...field, maxLen })} />
              <NumericInput id="designer-font-size" label={copy.fontSize} value={field.fontSize ?? 12}
                min={6} max={72} onApply={(fontSize) => onChange({ ...field, fontSize })} />
            </>
          )}
          <div role="group" aria-label={copy.position} aria-describedby={unitsId} className="designer-axes">
            {axes.map((axis, index) => (
              <NumericInput key={axis} id={`designer-${axis.toLowerCase()}`} label={axis} value={field.rectPdf[index]} onApply={(value) => {
                const rectPdf: [...PdfRect] = [...field.rectPdf];
                rectPdf[index] = value ?? Number.NaN;
                return onChange({ ...field, rectPdf });
              }} />
            ))}
          </div>
          <small id={unitsId} className="quiet">{copy.units}</small>
          <button type="button" className="button secondary" data-testid="designer-delete" onClick={() => onDelete(selected.id)}>{copy.remove}</button>
        </fieldset>
      )}
    </aside>
  );
}
