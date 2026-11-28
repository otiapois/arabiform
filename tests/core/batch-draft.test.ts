import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashBatchDraftInput, parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';
import { validateMappingPreset, type MappingPresetV7, type MappingPresetV8, type MappingPresetV11 } from '../../src/core/draft/mapping-preset';

const draft: BatchDraft = {
  kind: 'arabiform-batch-draft', version: 1,
  source: { templateSha256: 'a'.repeat(64), rosterSha256: 'b'.repeat(64), fields: ['Name', 'ID'], sheetName: 'Original',
    columns: ['الاسم', 'Badge', '__proto__'], rowCount: 2 },
  edits: { 0: { الاسم: ' \u200bأحمد\u200c\u200d', Badge: '00123', ['__proto__']: ' exact \n' }, 1: { Badge: '00007' } },
  hygiene: [{ operation: { columns: [0], normalizeSpaces: true, normalizeAlef: true }, affectedRows: 2, affectedCells: 2 }],
  settings: { version: 4, mapping: { Name: 'الاسم', ID: 'Badge' }, alignOverrides: { Name: 'center' }, filenamePattern: '{{Badge}}.pdf',
    minFontSize: 7.65, font: 'arabic', flattenZip: true, includeCoverSheet: true },
  customFontSha256: null,
};

describe('portable batch draft boundary', () => {
  it('roundtrips exact edit strings, summaries, alignment and both output flags', async () => {
    const subarray = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    expect(await hashBatchDraftInput(subarray)).toBe(createHash('sha256').update(subarray).digest('hex'));
    const restored = parseBatchDraft(serializeBatchDraft(draft), draft.source, 'c'.repeat(64));
    expect(restored).toEqual(draft);
    expect(Object.hasOwn(restored.edits[0]!, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(restored.edits[0])).toBe(Object.prototype);
    expect(restored.edits[0]?.Badge).toBe('00123');
    expect(restored.edits[1]?.Badge).toBe('00007');
  });

  it('roundtrips an active watermark without changing the portable draft version', () => {
    const saved: BatchDraft = { ...draft, settings: {
      ...draft.settings, version: 5, watermark: { kind: 'confidential-ar', opacity: 0.08, angle: 0 },
    } };
    expect(parseBatchDraft(serializeBatchDraft(saved), draft.source)).toEqual(saved);
    const invalid = { ...saved, settings: { ...saved.settings, watermark: { kind: 'confidential', opacity: 1, angle: 0 } } };
    expect(() => parseBatchDraft(JSON.stringify(invalid), draft.source)).toThrow('invalid-batch-draft');
  });

  it('roundtrips v7 QR and cover options in an outer v1 draft and rejects extra or invalid fields', () => {
    const settings: MappingPresetV7 = {
      ...draft.settings, version: 7, watermark: { kind: 'none' }, virtualMappings: {},
      qrStamp: { placement: 'top-left', sizePt: 37.5, pattern: '  {{Badge}}-[[@PADDED_ROW_001]]' }, coverLanguage: 'bilingual',
    };
    const updated = { ...draft, settings };
    expect(parseBatchDraft(serializeBatchDraft(updated), draft.source)).toEqual(updated);
    expect(validateMappingPreset({ ...settings, qrStamp: { placement: 'none' }, coverLanguage: 'auto' }))
      .toMatchObject({ version: 7, qrStamp: { placement: 'none' }, coverLanguage: 'auto' });
    for (const invalid of [
      { ...settings, coverLanguage: 'rtl' }, { ...settings, coverLanguage: null },
      { ...settings, qrStamp: { placement: 'none', pattern: 'stale', sizePt: 48 } },
      { ...settings, qrStamp: { placement: 'top-left', sizePt: 73, pattern: 'A' } },
      { ...settings, qrStamp: undefined }, { ...settings, coverLanguage: undefined },
      { ...settings, unexpected: true }, { ...settings, version: 6 },
    ]) {
      expect(validateMappingPreset(invalid)).toBeUndefined();
      expect(() => parseBatchDraft(JSON.stringify({ ...updated, settings: invalid }), draft.source)).toThrow('invalid-batch-draft');
    }
  });

  it('requires exact source bytes, field and column order, selected sheet and row count', () => {
    for (const change of [
      { templateSha256: '9'.repeat(64) }, { rosterSha256: '9'.repeat(64) }, { sheetName: 'Different sheet' },
      { columns: [...draft.source.columns].reverse() }, { fields: [...draft.source.fields].reverse() }, { rowCount: 3 },
    ]) {
      expect(() => parseBatchDraft(serializeBatchDraft(draft), { ...draft.source, ...change })).toThrow('batch-draft-source-mismatch');
    }
  });

  it.each(['1-up', '2-up'] as const)('roundtrips v8 %s in an outer v1 draft bound to an exact Excel tab', (imposition) => {
    const settings: MappingPresetV8 = {
      ...draft.settings, version: 8, watermark: { kind: 'none' }, virtualMappings: {},
      qrStamp: { placement: 'none' }, coverLanguage: 'bilingual', imposition,
    };
    const saved = { ...draft, source: { ...draft.source, sheetName: 'Roster_AR' }, settings };
    const text = serializeBatchDraft(saved);
    expect(parseBatchDraft(text, saved.source)).toEqual(saved);
    expect(() => parseBatchDraft(text, { ...saved.source, sheetName: 'Summary' })).toThrow('batch-draft-source-mismatch');
    expect(validateMappingPreset({ ...settings, imposition: 'duplex' })).toBeUndefined();
    expect(validateMappingPreset({ ...settings, version: 7 })).toBeUndefined();
  });

  it('roundtrips ordered v11 rules in an outer v1 draft and rejects mismatched exact source references', () => {
    const settings: MappingPresetV11 = {
      ...draft.settings, version: 11, watermark: { kind: 'none' }, virtualMappings: {},
      qrStamp: { placement: 'none' }, coverLanguage: 'auto', imposition: '1-up', groupByColumn: null,
      fieldTypography: { ID: { numeralPolicy: 'eastern-arabic' } }, approvalSeal: null,
      conditionalRules: [
        { field: 'Name', column: 'Badge', operator: 'gte-number', operand: '00007', action: { type: 'set-text', value: 'مُعْتَمَد {{الاسم}} {{__proto__}}' } },
        { field: 'ID', column: 'الاسم', operator: 'is-blank', action: { type: 'clear-field' } },
      ],
    };
    const saved = { ...draft, settings };
    expect(parseBatchDraft(serializeBatchDraft(saved), draft.source)).toEqual(saved);
    const rule = settings.conditionalRules[0]!;
    for (const invalid of [{ ...rule, field: 'Missing' }, { ...rule, column: 'badge' },
      { ...rule, action: { type: 'set-text', value: '{{missing}}' } }]) {
      expect(() => parseBatchDraft(JSON.stringify({ ...saved, settings: { ...settings, conditionalRules: [invalid] } }), draft.source))
        .toThrow('invalid-batch-draft');
    }
  });

  it('requires active custom font content to match without carrying binary bytes', () => {
    const active = 'c'.repeat(64);
    const withFont = { ...draft, customFontSha256: active };
    const text = serializeBatchDraft(withFont);
    expect(parseBatchDraft(text, draft.source, active)).toEqual(withFont);
    expect(() => parseBatchDraft(text, draft.source)).toThrow('batch-draft-custom-font-mismatch');
    expect(() => parseBatchDraft(text, draft.source, 'd'.repeat(64))).toThrow('batch-draft-custom-font-mismatch');
  });

  it('rejects unknown keys, malformed edit indices and text or nested schema corruption', () => {
    for (const corrupted of [
      null, [], { ...draft, version: 2 }, { ...draft, templateBytes: [1] }, { ...draft, customFontSha256: 'c' },
      { ...draft, edits: [] }, { ...draft, edits: { 2: { Badge: '123' } } }, { ...draft, edits: { '00': { Badge: '123' } } },
      { ...draft, edits: { 0: { Badge: 123 } } }, { ...draft, edits: { 0: { ['constructor']: 'wrong column' } } },
      { ...draft, source: { ...draft.source, columns: ['Badge', 'Badge'] } },
      { ...draft, hygiene: [{ ...draft.hygiene[0], affectedCells: 0 }] },
      { ...draft, hygiene: [{ ...draft.hygiene[0], operation: { columns: [99] } }] },
      { ...draft, hygiene: [{ ...draft.hygiene[0], operation: { columns: [0], replace: 'unpaired' } }] },
      { ...draft, settings: { ...draft.settings, mapping: { Name: 'Unknown' } } },
      { ...draft, settings: { ...draft.settings, mapping: { Unknown: 'Badge' }, alignOverrides: {} } },
      { ...draft, settings: { ...draft.settings, version: 3 } },
      { ...draft, settings: { ...draft.settings, alignOverrides: { Name: 'middle' } } },
    ]) expect(() => parseBatchDraft(JSON.stringify(corrupted), draft.source)).toThrow('invalid-batch-draft');
    expect(() => parseBatchDraft('{', draft.source)).toThrow('invalid-batch-draft');
  });
});
