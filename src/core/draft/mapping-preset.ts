import { isAlignOverride, type AlignOverride } from '../pdf/alignment';
import { isCoverLanguage, validateQrStampSettings, type CoverLanguage, type QrStampSettings } from '../pdf/qr-settings';
import { validateWatermarkSettings, type WatermarkSettings } from '../pdf/watermark-settings';
import { isVirtualColumnId, validateVirtualTemplate, type VirtualColumnMapping } from '../roster/virtual-columns';

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

export type MappingPresetV5 = Omit<MappingPresetV4, 'version'> & { version: 5; watermark: WatermarkSettings };
export type MappingPresetV6 = Omit<MappingPresetV5, 'version'> & { version: 6; virtualMappings: Record<string, VirtualColumnMapping> };

export type MappingPresetV7 = Omit<MappingPresetV6, 'version'> & { version: 7; qrStamp: QrStampSettings; coverLanguage: CoverLanguage };

export type MappingPreset = (PresetSettings & (
  | { version: 1 }
  | { version: 2; flattenZip: boolean }
  | { version: 3; flattenZip: boolean; includeCoverSheet: boolean }
)) | MappingPresetV4 | MappingPresetV5 | MappingPresetV6 | MappingPresetV7;

const presetKeys = ['version', 'mapping', 'filenamePattern', 'minFontSize', 'font'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateVirtualMappings(value: unknown, mapping: PresetSettings['mapping']): MappingPresetV6['virtualMappings'] | undefined {
  if (!isRecord(value)) return undefined;
  const bindings: [string, VirtualColumnMapping][] = [];
  for (const [field, binding] of Object.entries(value)) {
    if (!field.trim() || Object.hasOwn(mapping, field) && mapping[field] || !isRecord(binding)
      || !Object.hasOwn(binding, 'column') || !isVirtualColumnId(binding.column)) return undefined;
    const { column, template } = binding;
    if (Object.hasOwn(binding, 'template')) {
      if (Object.keys(binding).length !== 2 || typeof template !== 'string' || !validateVirtualTemplate(column, template)) return undefined;
      bindings.push([field, { column, template }]);
    } else {
      if (Object.keys(binding).length !== 1) return undefined;
      bindings.push([field, { column }]);
    }
  }
  return Object.fromEntries(bindings);
}

export function validateMappingPreset(data: unknown): MappingPreset | undefined {
  if (!isRecord(data) || (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4 && data.version !== 5 && data.version !== 6 && data.version !== 7)
    || Object.keys(data).length !== presetKeys.length + data.version - 1 + (data.version === 7 ? 1 : 0)
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
  if (data.version >= 6 && !Object.hasOwn(data, 'virtualMappings')) return undefined;
  const virtualMappings = data.version >= 6 ? validateVirtualMappings(data.virtualMappings, settings.mapping) : undefined;
  const alignOverrides: [string, AlignOverride][] = [];
  for (const [field, mode] of Object.entries(data.alignOverrides)) {
    const mapped = Object.hasOwn(settings.mapping, field) && settings.mapping[field]
      || virtualMappings && Object.hasOwn(virtualMappings, field);
    if (!isAlignOverride(mode) || !mapped) return undefined;
    alignOverrides.push([field, mode]);
  }
  const printSettings = { ...settings, flattenZip, includeCoverSheet, alignOverrides: Object.fromEntries(alignOverrides) };
  if (data.version === 4) return { version: 4, ...printSettings };
  const watermark = Object.hasOwn(data, 'watermark') && validateWatermarkSettings(data.watermark);
  if (!watermark) return undefined;
  if (data.version === 5) return { version: 5, ...printSettings, watermark };
  if (!virtualMappings) return undefined;
  if (data.version === 6) return { version: 6, ...printSettings, watermark, virtualMappings };
  const qrStamp = Object.hasOwn(data, 'qrStamp') && validateQrStampSettings(data.qrStamp);
  if (!qrStamp || !Object.hasOwn(data, 'coverLanguage') || !isCoverLanguage(data.coverLanguage)) return undefined;
  return { version: 7, ...printSettings, watermark, virtualMappings, qrStamp, coverLanguage: data.coverLanguage };
}
