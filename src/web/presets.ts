import { validateMappingPreset, type FontMode, type MappingPreset, type MappingPresetV4, type MappingPresetV5 } from '../core/draft/mapping-preset';
import type { AlignOverride } from '../core/pdf/alignment';
import type { WatermarkSettings } from '../core/pdf/watermark-settings';

export type { FontMode, MappingPreset, MappingPresetV4, MappingPresetV5 } from '../core/draft/mapping-preset';

export function parseMappingPreset(text: string): MappingPreset {
  const preset = validateMappingPreset(JSON.parse(text));
  if (!preset) throw new Error('invalid-mapping-preset');
  return preset;
}

export function makeDraftSettings(
  mapping: Record<string, string>, filenamePattern: string, minFontSize: number, font: FontMode,
  flattenZip = false, includeCoverSheet = false, alignOverrides: Record<string, AlignOverride> = {}, watermark?: WatermarkSettings,
): MappingPresetV4 | MappingPresetV5 {
  const settings = { mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides };
  return watermark && watermark.kind !== 'none' ? { version: 5, ...settings, watermark } : { version: 4, ...settings };
}

export function makeMappingPreset(
  mapping: Record<string, string>, filenamePattern: string, minFontSize: number, font: FontMode,
  flattenZip = false, includeCoverSheet = false, alignOverrides: Record<string, AlignOverride> = {}, watermark?: WatermarkSettings,
): MappingPreset {
  if ((watermark && watermark.kind !== 'none') || Object.keys(alignOverrides).length) {
    return makeDraftSettings(mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides, watermark);
  }
  const settings = { mapping, filenamePattern, minFontSize, font };
  if (includeCoverSheet) return { version: 3, ...settings, flattenZip, includeCoverSheet };
  if (flattenZip) return { version: 2, ...settings, flattenZip };
  return { version: 1, ...settings };
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
