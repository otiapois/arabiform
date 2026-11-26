import { describe, expect, it } from 'vitest';
import { parseMappingPreset, presetMismatches } from '../../src/web/presets';

const preset = {
  version: 1,
  mapping: { Name: 'الاسم', ID: 'Badge', Consent: 'موافقة', Sentinel: '' },
  filenamePattern: 'AR-{{Badge}}-{{الاسم}}.pdf',
  minFontSize: 7.58,
  font: 'arabic',
};

describe('local mapping preset boundary', () => {
  it('roundtrips Unicode mappings, intentionally empty columns and an exact minimum', () => {
    expect(parseMappingPreset(JSON.stringify(preset))).toEqual(preset);
    const specialFields = parseMappingPreset(JSON.stringify({ ...preset, mapping: { ['__proto__']: 'Badge' } }));
    expect(Object.hasOwn(specialFields.mapping, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(specialFields.mapping)).toBe(Object.prototype);
  });

  it('rejects extra or invalid settings, including roster data', () => {
    for (const invalid of [
      null, [], { ...preset, version: 2 }, { ...preset, rows: [{ Name: 'Synthetic' }] },
      { ...preset, mapping: [] }, { ...preset, mapping: { Name: 123 } },
      { ...preset, mapping: { Name: ' ' } }, { ...preset, filenamePattern: [] },
      { ...preset, minFontSize: '7.58' }, { ...preset, minFontSize: 5.99 },
      { ...preset, minFontSize: 10.01 }, { ...preset, font: 'other' },
      { ...preset, font: 'custom' }, { ...preset, customFont: { family: 'Example', bytes: [0, 1, 0, 0] } },
      { ...preset, flattenZip: true }, { ...preset, version: 2, flattenZip: 'false' },
      { ...preset, version: 2, flattenZip: true, roster: { Clinic: 'RIY' } },
      { ...preset, version: 2, includeCoverSheet: true },
      { ...preset, version: 3, includeCoverSheet: true },
      { ...preset, version: 3, flattenZip: false },
      { ...preset, version: 3, flattenZip: false, includeCoverSheet: 'true' },
      { ...preset, version: 3, flattenZip: 1, includeCoverSheet: true },
      { ...preset, version: 3, flattenZip: false, includeCoverSheet: true, templateName: 'private.pdf' },
    ]) expect(() => parseMappingPreset(JSON.stringify(invalid))).toThrow();
    expect(() => parseMappingPreset('{')).toThrow();
  });

  it('roundtrips choice mappings and an explicit boolean ZIP mode in v2', () => {
    for (const flattenZip of [true, false]) {
      const v2 = { ...preset, version: 2, flattenZip, mapping: { ...preset.mapping, Clinic: 'العيادة', Contact: 'Contact' } };
      expect(parseMappingPreset(JSON.stringify(v2))).toEqual(v2);
    }
  });

  it('roundtrips the independent cover sheet and ZIP options in v3', () => {
    for (const flattenZip of [true, false]) {
      for (const includeCoverSheet of [true, false]) {
        const v3 = { ...preset, version: 3, flattenZip, includeCoverSheet };
        expect(parseMappingPreset(JSON.stringify(v3))).toEqual(v3);
      }
    }
  });

  it('roundtrips v4 alignment on exact mapped keys and rejects invalid overrides', () => {
    const v4 = { ...preset, version: 4, flattenZip: false, includeCoverSheet: true,
      alignOverrides: { Name: 'center', ID: 'ltr', Consent: 'auto' } };
    expect(parseMappingPreset(JSON.stringify(v4))).toEqual(v4);
    for (const alignOverrides of [undefined, null, [], { Name: 'middle' }, { Unknown: 'rtl' }, { Sentinel: 'center' }]) {
      expect(() => parseMappingPreset(JSON.stringify({ ...v4, alignOverrides }))).toThrow('invalid-mapping-preset');
    }
    expect(() => parseMappingPreset(JSON.stringify({ ...v4, version: 3 }))).toThrow('invalid-mapping-preset');
  });

  it('reports current missing fields, mapped columns and filename tokens once', () => {
    expect(presetMismatches(preset.mapping, '{{ Badge }}-{{Missing}}.pdf', ['Name', 'ID', 'Consent'], ['الاسم'])).toEqual({
      missingFields: ['Sentinel'], missingColumns: ['Badge', 'موافقة', 'Missing'],
    });
    expect(presetMismatches(preset.mapping, preset.filenamePattern)).toEqual({ missingFields: [], missingColumns: [] });
  });
});
