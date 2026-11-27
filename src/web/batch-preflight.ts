import type { BatchSettings } from './useBatch';
import type { BatchInput } from '../core/worker/client';

export { createBatchWorker } from '../core/worker/client';

export function makeBatchInput(batch: BatchSettings, fonts: BatchInput['options']['fonts']): BatchInput {
  const { mapping, virtualMappings, localDate, resolveVirtualMapping } = batch;
  const mapped = Object.entries(mapping).filter(([, column]) => column);
  const virtual = Object.entries(virtualMappings);
  const rows = batch.rows.map(({ values }, index) => Object.fromEntries([
    ...mapped.map(([field, column]) => [field, Object.hasOwn(values, column) ? values[column]! : '']),
    ...virtual.map(([field, binding]) => [field, resolveVirtualMapping(binding, index + 1, localDate)]),
  ]));
  return {
    template: batch.template, roster: batch.roster, sheetName: batch.sheetName, rows,
    options: { fonts, minFontSize: batch.minFontSize, preferredFont: batch.font, customFont: batch.customFont, alignOverrides: batch.alignOverrides,
      fieldTypography: batch.fieldTypography },
  };
}
