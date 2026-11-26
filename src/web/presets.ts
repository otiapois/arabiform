export type FontMode = 'auto' | 'arabic' | 'latin';

type PresetSettings = {
  mapping: Record<string, string>;
  filenamePattern: string;
  minFontSize: number;
  font: FontMode;
};

export type MappingPreset = PresetSettings & (
  | { version: 1 }
  | { version: 2; flattenZip: boolean }
);

const presetKeys = ['version', 'mapping', 'filenamePattern', 'minFontSize', 'font'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseMappingPreset(text: string): MappingPreset {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data) || (data.version !== 1 && data.version !== 2)
    || Object.keys(data).length !== presetKeys.length + (data.version === 2 ? 1 : 0)
    || !presetKeys.every((key) => Object.hasOwn(data, key))
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
  const settings: PresetSettings = {
    mapping: Object.fromEntries(mapping), filenamePattern: data.filenamePattern,
    minFontSize: data.minFontSize, font: data.font,
  };
  if (data.version === 1) return { version: 1, ...settings };
  const flattenZip = data.flattenZip;
  if (!Object.hasOwn(data, 'flattenZip') || typeof flattenZip !== 'boolean') {
    throw new Error('invalid-mapping-preset');
  }
  return { version: 2, ...settings, flattenZip };
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
