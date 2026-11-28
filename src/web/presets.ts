import { validateMappingPreset, type FontMode, type MappingPreset } from '../core/draft/mapping-preset';
import type { AlignOverride } from '../core/pdf/alignment';
import type { ApprovalSealSettings } from '../core/pdf/approval-seal-settings';
import type { Imposition } from '../core/pdf/exports';
import type { FourUpOptions } from '../core/pdf/imposition-settings';
import type { FieldTypographyMap } from '../core/pdf/field-typography';
import { DEFAULT_QR_STAMP, DEFAULT_WATERMARK } from '../core/pdf/print-setting-defaults';
import type { CoverLanguage, QrStampSettings } from '../core/pdf/qr-settings';
import type { WatermarkSettings } from '../core/pdf/watermark-settings';
import { hasVirtualFilenameToken } from '../core/roster/filenames';
import type { VirtualColumnMapping } from '../core/roster/virtual-columns';
import { conditionalRuleColumns, type ConditionalFieldRule } from '../core/rules/conditional-fields';
import type { RosterSchemaRule } from '../core/validation/roster-schema';

export type { FontMode, MappingPreset, MappingPresetV4, MappingPresetV5 } from '../core/draft/mapping-preset';

export function parseMappingPreset(text: string): MappingPreset {
  const preset = validateMappingPreset(JSON.parse(text));
  if (!preset) throw new Error('invalid-mapping-preset');
  return preset;
}

export function restorePresetSettings(preset: MappingPreset) {
  return {
    mappingSettings: {
      fromPreset: true,
      values: preset.mapping,
      alignment: 'alignOverrides' in preset ? preset.alignOverrides : undefined,
      virtual: 'virtualMappings' in preset ? preset.virtualMappings : undefined,
      typography: 'fieldTypography' in preset ? preset.fieldTypography : undefined,
    },
    conditionalRules: 'conditionalRules' in preset ? preset.conditionalRules : undefined,
    schemaRules: 'schemaRules' in preset ? preset.schemaRules : undefined,
    pattern: preset.filenamePattern,
    minFontSize: preset.minFontSize,
    font: preset.font,
    flattenZip: preset.version !== 1 && preset.flattenZip,
    group: 'groupByColumn' in preset ? preset.groupByColumn : null,
    includeCover: 'includeCoverSheet' in preset && preset.includeCoverSheet,
    watermark: 'watermark' in preset ? preset.watermark : DEFAULT_WATERMARK,
    qrStamp: 'qrStamp' in preset ? preset.qrStamp : DEFAULT_QR_STAMP,
    approvalSeal: 'approvalSeal' in preset ? preset.approvalSeal : null,
    coverLanguage: 'coverLanguage' in preset ? preset.coverLanguage : 'auto' as const,
    imposition: 'imposition' in preset ? preset.imposition : '1-up' as const,
    fourUp: preset.version === 12 || (preset.version === 13 &&
      (preset.imposition === '4-up' || preset.fourUpOrder !== 'sequential' || preset.centerCutGuides))
      ? { fourUpOrder: preset.fourUpOrder, centerCutGuides: preset.centerCutGuides } : undefined,
  };
}

export function makeDraftSettings(
  mapping: Record<string, string>, filenamePattern: string, minFontSize: number, font: FontMode,
  flattenZip = false, includeCoverSheet = false, alignOverrides: Record<string, AlignOverride> = {}, watermark?: WatermarkSettings,
  virtualMappings: Record<string, VirtualColumnMapping> = {},
  qrStamp: QrStampSettings = { placement: 'none' }, coverLanguage: CoverLanguage = 'auto', imposition: Imposition = '1-up',
  groupByColumn: string | null = null,
  fieldTypography: FieldTypographyMap = {}, approvalSeal: ApprovalSealSettings | null = null,
  conditionalRules: ConditionalFieldRule[] = [],
  fourUp?: FourUpOptions,
  schemaRules: RosterSchemaRule[] = [],
): Exclude<MappingPreset, { version: 1 | 2 | 3 }> {
  const settings = { mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides };
  if (imposition === '4-up' || fourUp || schemaRules.length) {
    const print = { ...settings, watermark: watermark ?? { kind: 'none' as const }, virtualMappings, qrStamp, coverLanguage, imposition,
      groupByColumn, fieldTypography, approvalSeal, conditionalRules, fourUpOrder: 'sequential' as const, centerCutGuides: false, ...fourUp };
    return schemaRules.length ? { version: 13, ...print, schemaRules } : { version: 12, ...print };
  }
  if (conditionalRules.length || approvalSeal || Object.keys(fieldTypography).length) {
    const advanced = { ...settings, watermark: watermark ?? { kind: 'none' as const }, virtualMappings, qrStamp, coverLanguage, imposition,
      groupByColumn, fieldTypography, approvalSeal };
    return conditionalRules.length ? { version: 11, ...advanced, conditionalRules } : { version: 10, ...advanced };
  }
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
  fieldTypography: FieldTypographyMap = {}, approvalSeal: ApprovalSealSettings | null = null,
  conditionalRules: ConditionalFieldRule[] = [],
  fourUp?: FourUpOptions,
  schemaRules: RosterSchemaRule[] = [],
): MappingPreset {
  if ((watermark && watermark.kind !== 'none') || Object.keys(alignOverrides).length
    || Object.keys(virtualMappings).length || hasVirtualFilenameToken(filenamePattern) || qrStamp.placement !== 'none'
    || coverLanguage !== 'auto' || imposition !== '1-up' || fourUp || groupByColumn !== null || approvalSeal || Object.keys(fieldTypography).length || conditionalRules.length || schemaRules.length) {
    return makeDraftSettings(mapping, filenamePattern, minFontSize, font, flattenZip, includeCoverSheet, alignOverrides,
      watermark, virtualMappings, qrStamp, coverLanguage, imposition, groupByColumn, fieldTypography, approvalSeal, conditionalRules, fourUp, schemaRules);
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
  fieldTypography: FieldTypographyMap = {},
  conditionalRules: readonly ConditionalFieldRule[] = [],
  schemaRules: readonly RosterSchemaRule[] = [],
) {
  const missingFields = [...new Set([
    ...(fields ? [...Object.keys(mapping), ...conditionalRules.map(({ field }) => field)].filter((field) => !fields.includes(field)) : []),
    ...(textFields ? [...Object.keys(virtualMappings), ...Object.keys(fieldTypography)].filter((field) => !textFields.includes(field)) : []),
  ])];
  const tokens = Array.from(filenamePattern.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]!);
  const missingColumns = columns
    ? [...new Set([...Object.values(mapping), ...tokens, ...conditionalRules.flatMap(conditionalRuleColumns), ...schemaRules.map(({ column }) => column)].filter(Boolean))]
      .filter((column) => !columns.includes(column))
    : [];
  return { missingFields, missingColumns };
}
