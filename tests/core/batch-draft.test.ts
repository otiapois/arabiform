import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashBatchDraftInput, parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';

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

  it('requires exact source bytes, field and column order, selected sheet and row count', () => {
    for (const change of [
      { templateSha256: '9'.repeat(64) }, { rosterSha256: '9'.repeat(64) }, { sheetName: 'Different sheet' },
      { columns: [...draft.source.columns].reverse() }, { fields: [...draft.source.fields].reverse() }, { rowCount: 3 },
    ]) {
      expect(() => parseBatchDraft(serializeBatchDraft(draft), { ...draft.source, ...change })).toThrow('batch-draft-source-mismatch');
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
