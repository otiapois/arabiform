import { isAlignOverride, type AlignOverride } from '../pdf/alignment';

export type FontMode = 'auto' | 'arabic' | 'latin';

type PresetSettings = {
  mapping: Record<string, string>;
  filenamePattern: string;
  minFontSize: number;
  font: FontMode;
};

export type MappingPresetV4 = PresetSettings & {
  version: 4;
  flattenZip: boolean;
  includeCoverSheet: boolean;
  alignOverrides: Record<string, AlignOverride>;
};

export type MappingPreset = (PresetSettings & (
  | { version: 1 }
  | { version: 2; flattenZip: boolean }
  | { version: 3; flattenZip: boolean; includeCoverSheet: boolean }
)) | MappingPresetV4;

const presetKeys = ['version', 'mapping', 'filenamePattern', 'minFontSize', 'font'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateMappingPreset(data: unknown): MappingPreset | undefined {
  if (!isRecord(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4)
    || Object.keys(data).length !== presetKeys.length + data.version - 1
    || !presetKeys.every((key) => Object.hasOwn(data, key))
    || typeof data.filenamePattern !== 'string'
    || typeof data.minFontSize !== 'number' || !Number.isFinite(data.minFontSize)
    || data.minFontSize < 6 || data.minFontSize > 10
    || (data.font !== 'auto' && data.font !== 'arabic' && data.font !== 'latin')
    || !isRecord(data.mapping)) return undefined;

  const mapping: [string, string][] = [];
  for (const [field, column] of Object.entries(data.mapping)) {
    if (!field.trim() || typeof column !== 'string' || (column && !column.trim())) return undefined;
    mapping.push([field, column]);
  }
  const settings: PresetSettings = {
    mapping: Object.fromEntries(mapping), filenamePattern: data.filenamePattern,
    minFontSize: data.minFontSize, font: data.font,
  };
  if (data.version === 1) return { version: 1, ...settings };
  const flattenZip = data.flattenZip;
  if (!Object.hasOwn(data, 'flattenZip') || typeof flattenZip !== 'boolean') return undefined;
  if (data.version === 2) return { version: 2, ...settings, flattenZip };
  const includeCoverSheet = data.includeCoverSheet;
  if (!Object.hasOwn(data, 'includeCoverSheet') || typeof includeCoverSheet !== 'boolean') return undefined;
  if (data.version === 3) return { version: 3, ...settings, flattenZip, includeCoverSheet };
  if (!Object.hasOwn(data, 'alignOverrides') || !isRecord(data.alignOverrides)) return undefined;
  const alignOverrides: [string, AlignOverride][] = [];
  for (const [field, mode] of Object.entries(data.alignOverrides)) {
    if (!isAlignOverride(mode) || !Object.hasOwn(settings.mapping, field) || !settings.mapping[field]) return undefined;
    alignOverrides.push([field, mode]);
  }
  return { version: 4, ...settings, flattenZip, includeCoverSheet, alignOverrides: Object.fromEntries(alignOverrides) };
}
