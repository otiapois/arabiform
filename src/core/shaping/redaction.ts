import { DEFAULT_FILENAME_PATTERN, physicalFilenameColumns } from '../roster/filenames';
import type { ConditionalFieldRule } from '../rules/conditional-fields';

export type MaskPolicy = 'none' | 'keep-last-4' | 'full-mask';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function maskText(value: string, policy: MaskPolicy = 'none'): string {
  if (policy === 'none') return value;
  const parts = Array.from(graphemes.segment(value), ({ segment }) => segment);
  return policy === 'keep-last-4' && parts.length > 4
    ? '*'.repeat(parts.length - 4) + parts.slice(-4).join('')
    : '*'.repeat(parts.length);
}

export function reviewSourceColumns(
  maskPolicies: Readonly<Record<string, MaskPolicy>>,
  actualMappings: readonly (readonly [string, string])[],
  rules: readonly ConditionalFieldRule[] = [],
): Set<string> {
  const maskedFields = new Set(Object.keys(maskPolicies).filter((field) => maskPolicies[field] !== 'none'));
  const columns = new Set(actualMappings.flatMap(([field, column]) => maskedFields.has(field) ? [column] : []));
  for (const { field, action } of rules) {
    if (!maskedFields.has(field) || action.type !== 'set-text') continue;
    for (const match of action.value.matchAll(/\{\{([^{}]+)\}\}/g)) columns.add(match[1]!);
  }
  return columns;
}

export function reviewFilenamePattern(pattern: string | undefined, protectedColumns: ReadonlySet<string>): string | undefined {
  return physicalFilenameColumns(pattern ?? DEFAULT_FILENAME_PATTERN).some((column) => protectedColumns.has(column))
    ? 'row-[[@PADDED_ROW_001]].pdf' : pattern;
}
