import { validateMappingPreset, type MappingPreset } from '../core/draft/mapping-preset';

export type { FontMode, MappingPreset, MappingPresetV4 } from '../core/draft/mapping-preset';

export function parseMappingPreset(text: string): MappingPreset {
  const preset = validateMappingPreset(JSON.parse(text));
  if (!preset) throw new Error('invalid-mapping-preset');
  return preset;
}

export function presetMismatches(
  mapping: Record<string, string>,
  filenamePattern: string,
  fields?: readonly string[],
  columns?: readonly string[],
) {
  const missingFields = fields ? Object.keys(mapping).filter((field) => !fields.includes(field)) : [];
  const tokens = Array.from(filenamePattern.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]!);
  const missingColumns = columns
    ? [...new Set([...Object.values(mapping).filter(Boolean), ...tokens])].filter((column) => !columns.includes(column))
    : [];
  return { missingFields, missingColumns };
}
