export type FontMode = 'auto' | 'arabic' | 'latin';

export type MappingPreset = {
  version: 1;
  mapping: Record<string, string>;
  filenamePattern: string;
  minFontSize: number;
  font: FontMode;
};

const presetKeys = ['version', 'mapping', 'filenamePattern', 'minFontSize', 'font'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMappingPreset(text: string): MappingPreset {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || Object.keys(data).length !== presetKeys.length
    || !presetKeys.every((key) => Object.hasOwn(data, key)) || data.version !== 1
    || typeof data.filenamePattern !== 'string'
    || typeof data.minFontSize !== 'number' || !Number.isFinite(data.minFontSize)
    || data.minFontSize < 6 || data.minFontSize > 10
    || (data.font !== 'auto' && data.font !== 'arabic' && data.font !== 'latin')
    || !isRecord(data.mapping)) {
    throw new Error('invalid-mapping-preset');
  }

  const mapping: [string, string][] = [];
  for (const [field, column] of Object.entries(data.mapping)) {
    if (!field.trim() || typeof column !== 'string' || (column && !column.trim())) {
      throw new Error('invalid-mapping-preset');
    }
    mapping.push([field, column]);
  }
  return {
    version: 1, mapping: Object.fromEntries(mapping), filenamePattern: data.filenamePattern,
    minFontSize: data.minFontSize, font: data.font,
  };
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
