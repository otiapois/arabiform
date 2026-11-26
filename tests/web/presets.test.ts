import { describe, expect, it } from 'vitest';
import { parseMappingPreset, presetMismatches } from '../../src/web/presets';

const preset = {
  version: 1,
  mapping: { Name: 'الاسم', ID: 'Badge', Sentinel: '' },
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
    ]) expect(() => parseMappingPreset(JSON.stringify(invalid))).toThrow();
    expect(() => parseMappingPreset('{')).toThrow();
  });

  it('reports current missing fields, mapped columns and filename tokens once', () => {
    expect(presetMismatches(preset.mapping, '{{ Badge }}-{{Missing}}.pdf', ['Name', 'ID'], ['الاسم'])).toEqual({
      missingFields: ['Sentinel'], missingColumns: ['Badge', 'Missing'],
    });
    expect(presetMismatches(preset.mapping, preset.filenamePattern)).toEqual({ missingFields: [], missingColumns: [] });
  });
});
