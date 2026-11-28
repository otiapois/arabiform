import { describe, expect, it } from 'vitest';
import { makeDraftSettings, makeMappingPreset, parseMappingPreset, presetMismatches } from '../../src/web/presets';

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

  it('stores an active watermark in v5 and preserves legacy versions when omitted', () => {
    const args = [preset.mapping, preset.filenamePattern, preset.minFontSize, 'arabic'] as const;
    const watermark = { kind: 'custom', text: 'DRAFT / \u0645\u0633\u0648\u062f\u0629', opacity: 0.30, angle: -45 } as const;
    expect(makeMappingPreset(...args)).toEqual(preset);
    expect(makeMappingPreset(...args, true).version).toBe(2);
    expect(makeMappingPreset(...args, false, true).version).toBe(3);
    expect(makeMappingPreset(...args, true, false, { Name: 'rtl' }, { kind: 'none' }).version).toBe(4);
    expect(makeDraftSettings(...args).version).toBe(4);
    const v5 = makeMappingPreset(...args, true, true, { Name: 'rtl' }, watermark);
    expect(v5).toEqual(makeDraftSettings(...args, true, true, { Name: 'rtl' }, watermark));
    expect(parseMappingPreset(JSON.stringify(v5))).toEqual({ ...v5, version: 5, watermark });
    for (const invalid of [undefined, {}, { ...watermark, opacity: 0.07 }, { ...watermark, opacity: '0.14' },
      { ...watermark, angle: 22 }, { ...watermark, text: 'A'.repeat(33) }, { ...watermark, text: 'A\nB' },
      { ...watermark, text: 'A\u202eB' }, { ...watermark, text: ' ' }, { ...watermark, text: '\uD800' },
      { ...watermark, bytes: [1] }, { ...watermark, kind: 'draft' }, { kind: 'none', opacity: 0.14 },
    ]) {
      expect(() => parseMappingPreset(JSON.stringify({ ...v5, watermark: invalid }))).toThrow('invalid-mapping-preset');
    }
  });

  it('reports current missing fields, mapped columns and filename tokens once', () => {
    expect(presetMismatches(preset.mapping, '{{ Badge }}-{{Missing}}.pdf', ['Name', 'ID', 'Consent'], ['الاسم'])).toEqual({
      missingFields: ['Sentinel'], missingColumns: ['Badge', 'موافقة', 'Missing'],
    });
    expect(presetMismatches(preset.mapping, preset.filenamePattern)).toEqual({ missingFields: [], missingColumns: [] });
  });

  it('uses v6 for virtual-only mappings or filename tokens and preserves literal physical headers', () => {
    const virtual = { Serial: { column: 'PADDED_ROW_001', template: 'CERT-{{PADDED_ROW_001}}' } } as const;
    const aligned = makeMappingPreset({}, 'serial.pdf', 8, 'auto', false, false, { Serial: 'center' }, undefined, virtual);
    expect(aligned).toEqual({
      version: 6, mapping: {}, filenamePattern: 'serial.pdf', minFontSize: 8, font: 'auto',
      flattenZip: false, includeCoverSheet: false, alignOverrides: { Serial: 'center' }, watermark: { kind: 'none' }, virtualMappings: virtual,
    });
    expect(parseMappingPreset(JSON.stringify(aligned))).toEqual(aligned);
    expect(makeDraftSettings({}, 'serial.pdf', 8, 'auto', false, false, { Serial: 'center' }, undefined, virtual)).toEqual(aligned);
    expect(makeMappingPreset({}, '[[@PADDED_ROW_001]].pdf', 8, 'auto').version).toBe(6);
    expect(makeMappingPreset({}, '{{[[@PADDED_ROW_001]]}}.pdf', 8, 'auto').version).toBe(1);
    expect(presetMismatches({}, '[[@PADDED_ROW_001]]-{{Name}}.pdf', ['Serial'], [], virtual, [])).toEqual({
      missingFields: ['Serial'], missingColumns: ['Name'],
    });
  });

  it('writes v7 whenever QR or a cover language is set, in presets and draft settings', () => {
    const args = [preset.mapping, preset.filenamePattern, preset.minFontSize, 'arabic', false, true, {}, undefined, {}] as const;
    const off = { placement: 'none' } as const;
    const stamp = { placement: 'bottom-right', pattern: 'CERT-{{ID}}', sizePt: 48.5 } as const;
    expect(makeMappingPreset(...args, off, 'auto').version).toBe(3);
    expect(makeDraftSettings(...args, off, 'auto').version).toBe(4);
    for (const [qrStamp, coverLanguage] of [[stamp, 'auto'], [off, 'ar'], [stamp, 'bilingual']] as const) {
      const settings = makeMappingPreset(...args, qrStamp, coverLanguage);
      expect(settings).toMatchObject({ version: 7, qrStamp, coverLanguage, virtualMappings: {}, watermark: { kind: 'none' } });
      expect(makeDraftSettings(...args, qrStamp, coverLanguage)).toEqual(settings);
      expect(parseMappingPreset(JSON.stringify(settings))).toEqual(settings);
    }
  });

  it('writes v8 for 2-up and keeps the legacy wire format for 1-up', () => {
    const args = [preset.mapping, preset.filenamePattern, preset.minFontSize, 'arabic', false, false, {}, undefined, {},
      { placement: 'none' }, 'auto'] as const;
    expect(makeMappingPreset(...args, '1-up')).toEqual(preset);
    expect(makeDraftSettings(...args, '1-up')).toEqual(makeDraftSettings(...args));
    const settings = makeMappingPreset(...args, '2-up');
    expect(settings).toEqual({
      ...preset, version: 8, flattenZip: false, includeCoverSheet: false, alignOverrides: {},
      watermark: { kind: 'none' }, virtualMappings: {}, qrStamp: { placement: 'none' }, coverLanguage: 'auto', imposition: '2-up',
    });
    expect(makeDraftSettings(...args, '2-up')).toEqual(settings);
    for (const imposition of ['1-up', '2-up']) {
      const v8 = { ...settings, imposition };
      expect(parseMappingPreset(JSON.stringify(v8))).toEqual(v8);
    }
  });

  it('writes ordered conditional rules in v11 preset and draft settings without promoting empty rules', () => {
    const args = [preset.mapping, preset.filenamePattern, preset.minFontSize, 'arabic', false, false, {}, undefined, {},
      { placement: 'none' }, 'auto', '1-up', null, {}, null] as const;
    const rules = [
      { field: 'Name', column: 'Role', operator: 'equals' as const, operand: 'VIP',
        action: { type: 'set-text' as const, value: 'ضيف / {{Badge}}' } },
      { field: 'Consent', column: 'Role', operator: 'is-blank' as const, action: { type: 'set-checkbox' as const, checked: false } },
    ];
    const settings = makeMappingPreset(...args, rules);
    expect(settings).toMatchObject({ version: 11, conditionalRules: rules });
    expect(parseMappingPreset(JSON.stringify(settings))).toEqual(settings);
    expect(makeDraftSettings(...args, rules)).toEqual(settings);
    expect(makeMappingPreset(...args, [])).toEqual(preset);
    expect(makeDraftSettings(...args, [])).toEqual(makeDraftSettings(...args));
    expect(presetMismatches({}, 'batch.pdf', ['Name'], ['Role'], {}, ['Name'], {}, rules)).toEqual({
      missingFields: ['Consent'], missingColumns: ['Badge'],
    });
  });

  it('keeps four-up options and v11 settings in v12 mapping presets and batch drafts', () => {
    const args = [preset.mapping, preset.filenamePattern, preset.minFontSize, 'arabic', false, true, {}, undefined, {},
      { placement: 'none' }, 'bilingual'] as const;
    const rules = [{ field: 'Name', column: 'Role', operator: 'equals' as const, operand: 'VIP', action: { type: 'set-text' as const, value: 'ضيف' } }];
    const options = { fourUpOrder: 'cut-and-stack', centerCutGuides: true } as const;
    for (const imposition of ['4-up', '1-up'] as const) {
      const suffix = [imposition, 'Role', {}, null, rules, options] as const;
      const settings = makeMappingPreset(...args, ...suffix);
      expect(settings).toMatchObject({ version: 12, imposition, ...options, groupByColumn: 'Role', conditionalRules: rules });
      expect(makeDraftSettings(...args, ...suffix)).toEqual(settings);
      expect(parseMappingPreset(JSON.stringify(settings))).toEqual(settings);
    }
    expect(makeMappingPreset(...args, '4-up')).toMatchObject({ version: 12, fourUpOrder: 'sequential', centerCutGuides: false });
  });
});
