import { validateMappingPreset, type FontMode, type MappingPreset } from '../core/draft/mapping-preset';
import type { AlignOverride } from '../core/pdf/alignment';
import type { Imposition } from '../core/pdf/exports';
import type { CoverLanguage, QrStampSettings } from '../core/pdf/qr-settings';
import type { WatermarkSettings } from '../core/pdf/watermark-settings';
import { hasVirtualFilenameToken } from '../core/roster/filenames';
import type { VirtualColumnMapping } from '../core/roster/virtual-columns';

export type { FontMode, MappingPreset, MappingPresetV4, MappingPresetV5 } from '../core/draft/mapping-preset';

export function parseMappingPreset(text: string): MappingPreset {
  const preset = validateMappingPreset(JSON.parse(text));
  if (!preset) throw new Error('invalid-mapping-preset');
  return preset;
}

export function makeDraftSettings(
  mapping: Record<string, string>, filenamePattern: string, minFontSize: number, font: FontMode,
  flattenZip = false, includeCoverSheet = false, alignOverrides: Record<string, AlignOverride> = {}, watermark?: WatermarkSettings,
  virtualMappings: Record<string, VirtualColumnMapping> = {},
  qrStamp: QrStampSettings = { placement: 'none' }, coverLanguage: CoverLanguage = 'auto', imposition: Imposition = '1-up',
  groupByColumn: string | null = null,
): Exclude<MappingPreset, { version: 1 | 2 | 3 }> {
  const settings = { mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides };
  if (groupByColumn !== null) {
    return { version: 9, ...settings, watermark: watermark ?? { kind: 'none' }, virtualMappings, qrStamp, coverLanguage, imposition, groupByColumn };
  }
  if (imposition === '2-up' || qrStamp.placement !== 'none' || coverLanguage !== 'auto') {
    const print = { ...settings, watermark: watermark ?? { kind: 'none' }, virtualMappings, qrStamp, coverLanguage } as const;
    return imposition === '2-up' ? { version: 8, ...print, imposition } : { version: 7, ...print };
  }
  if (Object.keys(virtualMappings).length || hasVirtualFilenameToken(filenamePattern)) {
    return { version: 6, ...settings, watermark: watermark ?? { kind: 'none' }, virtualMappings };
  }
  return watermark && watermark.kind !== 'none' ? { version: 5, ...settings, watermark } : { version: 4, ...settings };
}

export function makeMappingPreset(
  mapping: Record<string, string>, filenamePattern: string, minFontSize: number, font: FontMode,
  flattenZip = false, includeCoverSheet = false, alignOverrides: Record<string, AlignOverride> = {}, watermark?: WatermarkSettings,
  virtualMappings: Record<string, VirtualColumnMapping> = {},
  qrStamp: QrStampSettings = { placement: 'none' }, coverLanguage: CoverLanguage = 'auto', imposition: Imposition = '1-up',
  groupByColumn: string | null = null,
): MappingPreset {
  if ((watermark && watermark.kind !== 'none') || Object.keys(alignOverrides).length
    || Object.keys(virtualMappings).length || hasVirtualFilenameToken(filenamePattern) || qrStamp.placement !== 'none' || coverLanguage !== 'auto' || imposition === '2-up' || groupByColumn !== null) {
    return makeDraftSettings(mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides, watermark, virtualMappings, qrStamp, coverLanguage, imposition, groupByColumn);
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
  virtualMappings: Record<string, VirtualColumnMapping> = {},
  textFields = fields,
) {
  const missingFields = [...new Set([
    ...(fields ? Object.keys(mapping).filter((field) => !fields.includes(field)) : []),
    ...(textFields ? Object.keys(virtualMappings).filter((field) => !textFields.includes(field)) : []),
  ])];
  const tokens = Array.from(filenamePattern.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]!);
  const missingColumns = columns
    ? [...new Set([...Object.values(mapping).filter(Boolean), ...tokens])].filter((column) => !columns.includes(column))
    : [];
  return { missingFields, missingColumns };
}
