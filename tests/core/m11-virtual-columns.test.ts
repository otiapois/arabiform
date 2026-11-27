import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';
import { validateMappingPreset, type MappingPresetV6 } from '../../src/core/draft/mapping-preset';
import { createAudit, preflightRow } from '../../src/core/pdf';
import { hasVirtualFilenameToken, planFilenames, readRoster } from '../../src/core/roster';
import { localVirtualDate, resolveVirtualColumn, resolveVirtualMapping, validateVirtualTemplate, VIRTUAL_COLUMNS, virtualFilenameToken } from '../../src/core/roster/virtual-columns';
import { createBatchProcessor } from '../../src/core/worker/batch';

const localDate = '2026-11-27';
const virtualMappings = { Serial: { column: 'PADDED_ROW_001', template: 'CERT-{{PADDED_ROW_001}}' } } as const;
const filenamePattern = '[[@PADDED_ROW_001]]-[[@TODAY_AR]].pdf';
const base = { mapping: { Name: 'ROW_INDEX', ID: '[[@PADDED_ROW_001]]' }, filenamePattern: '{{ROW_INDEX}}.pdf', minFontSize: 8, font: 'auto' } as const;
const v2 = { ...base, version: 2, flattenZip: false } as const;
const v3 = { ...v2, version: 3, includeCoverSheet: true } as const;
const v4 = { ...v3, version: 4, alignOverrides: { Name: 'center' } } as const;
const v5 = { ...v4, version: 5, watermark: { kind: 'none' } } as const;
const v6: MappingPresetV6 = { ...v5, version: 6, virtualMappings, filenamePattern, alignOverrides: { Name: 'center', Serial: 'rtl' } };

describe('virtual computed columns', () => {
  it('uses a local Gregorian snapshot, preserves four-digit minimum padding, and validates literal affixes', () => {
    expect(localVirtualDate(new Date(2026, 10, 27, 0, 1))).toBe(localDate);
    expect(VIRTUAL_COLUMNS.map((id) => resolveVirtualColumn(id, 1, localDate))).toEqual(['1', '0001', localDate, '٢٠٢٦-١١-٢٧']);
    expect(resolveVirtualColumn('PADDED_ROW_001', 10_000, localDate)).toBe('10000');
    expect(resolveVirtualMapping({ column: 'PADDED_ROW_001', template: 'CERT-{x}-{{PADDED_ROW_001}}-$&' }, 500, localDate)).toBe('CERT-{x}-0500-$&');
    for (const malformed of ['', 'ROW_INDEX', '{{ ROW_INDEX }}', '{{ROW_INDEX}}{{ROW_INDEX}}', '{{{ROW_INDEX}}}',
      '{{TODAY_ISO}}-{{ROW_INDEX}}', '{{ROW_INDEX}}-{{', '}}-{{ROW_INDEX}}', '{{ROW_INDEX}}-{{unknown}}']) {
      expect(validateVirtualTemplate('ROW_INDEX', malformed), malformed).toBe(false);
    }
    expect(validateVirtualTemplate('ROW_INDEX', '{prefix}{{ROW_INDEX}}{suffix}')).toBe(true);
  });

  it('keeps physical headers in their own namespace and interpolates filename tokens once', async () => {
    const marker = virtualFilenameToken('PADDED_ROW_001');
    expect(marker).toBe('[[@PADDED_ROW_001]]');
    const dataset = new TextEncoder().encode(`ROW_INDEX,${marker},Name,Lights\nnative,raw,${marker},{{PADDED_ROW_001}}\n`);
    const { rows } = (await readRoster(dataset, 'columns.csv')).sheets[0]!;
    const pattern = `{{ROW_INDEX}}-{{${marker}}}-{{Name}}-{{Lights}}-${marker}.pdf`;
    expect(planFilenames(rows, pattern, { localDate })[0]?.filename).toBe(`native-raw-${marker}-{{PADDED_ROW_001}}-0001.pdf`);
    expect(planFilenames([{ PADDED_ROW_001: 'raw-bare', [marker]: 'raw-bracketed' }],
      `{{PADDED_ROW_001}}-{{${marker}}}-${marker}.pdf`, { localDate })[0]?.filename).toBe('raw-bare-raw-bracketed-0001.pdf');
    expect(planFilenames(rows, marker)[0]?.filename).toBe(`${marker}.pdf`);
    expect(hasVirtualFilenameToken(pattern)).toBe(true);
    expect(hasVirtualFilenameToken(`{{${marker}}}-{{PADDED_ROW_001}}.pdf`)).toBe(false);
  });

  it('preserves original roster positions through worker subset ZIP, audit and PDF readback', async () => {
    const doc = await PDFDocument.create();
    const form = doc.getForm();
    const page = doc.addPage([300, 200]);
    form.createTextField('Serial').addToPage(page, { x: 20, y: 120, width: 150, height: 25 });
    form.createTextField('Arabic date').addToPage(page, { x: 20, y: 70, width: 150, height: 25 });
    const template = await doc.save();
    const roster = new TextEncoder().encode('Name\nUno\n\nDos\nTres\n');
    const [sheet] = (await readRoster(roster, 'rows.csv')).sheets;
    const rows = sheet!.rows.map((_, index) => ({ Serial: resolveVirtualMapping(virtualMappings.Serial, index + 1, localDate),
      'Arabic date': resolveVirtualColumn('TODAY_AR', index + 1, localDate) }));
    const filenames = planFilenames(sheet!.rows, filenamePattern, { localDate }).map(({ filename }) => filename);
    const fonts = { arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), latin: await readFile('public/fonts/NotoSans-Regular.ttf') };
    const batch = createBatchProcessor();
    const notify = () => {};
    await batch({ phase: 'preflight', input: { template, roster, rows, options: { fonts } } }, notify);
    const zip = await batch({ phase: 'zip', filenames, rowSelection: [3, 2] }, notify);
    if (!zip || zip instanceof Uint8Array || !('entries' in zip)) throw new Error('Expected a ZIP export');
    const members = Object.entries(unzipSync(zip.bytes));
    expect(members.map(([name]) => name)).toEqual(['0002-٢٠٢٦-١١-٢٧.pdf', '0003-٢٠٢٦-١١-٢٧.pdf']);
    for (const [index, [, bytes]] of members.entries()) {
      const exported = (await PDFDocument.load(bytes)).getForm();
      expect(exported.getTextField('Serial').getText()).toBe(`CERT-000${index + 2}`);
      expect(exported.getTextField('Arabic date').getText()).toBe('٢٠٢٦-١١-٢٧');
    }
    const audit = createAudit(filenames.map((filename, index) => ({ rowNumber: index + 1, filename, status: 'pass', diagnostics: [], fontSizes: {} })),
      { exportScope: 'selected-subset', selectedRowNumbers: [2, 3] });
    expect(JSON.parse(audit.json).map(({ rowNumber, filename }: { rowNumber: number; filename: string }) => [rowNumber, filename]))
      .toEqual([[2, '0002-٢٠٢٦-١١-٢٧.pdf'], [3, '0003-٢٠٢٦-١١-٢٧.pdf']]);
    expect(audit.csv).toContain('0002-٢٠٢٦-١١-٢٧.pdf');

    const limited = form.createTextField('Limited');
    limited.addToPage(page, { x: 20, y: 25, width: 130, height: 20 });
    limited.setMaxLength(4);
    const overflow = await preflightRow(await doc.save(), { Limited: rows[0]!.Serial }, { fonts });
    expect(overflow).toMatchObject({ status: 'flagged', diagnostics: [{ field: 'Limited', code: 'exceeds-maxlen', maxLengthExcess: 5 }] });
    expect(overflow.pdfBytes).toBeUndefined();
  });
});

describe('v6 mapping presets and portable drafts', () => {
  it('retains the exact physical headers of each older preset and roundtrips v6 virtual-only alignment', () => {
    for (const preset of [{ ...base, version: 1 }, v2, v3, v4, v5, v6, { ...v6, alignOverrides: {}, virtualMappings: {} }]) {
      expect(validateMappingPreset(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
    }
    expect(validateMappingPreset({ ...v6, mapping: { ...v6.mapping, Serial: '' } })).toMatchObject({ version: 6, virtualMappings });
    const draft: BatchDraft = { kind: 'arabiform-batch-draft', version: 1,
      source: { templateSha256: 'a'.repeat(64), rosterSha256: 'b'.repeat(64), fields: ['Name', 'ID', 'Serial'],
        sheetName: 'Roster', columns: [base.mapping.Name, base.mapping.ID], rowCount: 2 },
      edits: {}, hygiene: [], settings: v6, customFontSha256: null };
    for (const settings of [v4, v5, v6]) {
      const saved = { ...draft, settings };
      expect(parseBatchDraft(serializeBatchDraft(saved), draft.source)).toEqual(saved);
    }
    expect(() => parseBatchDraft(JSON.stringify(draft), { ...draft.source, fields: ['ID', 'Name', 'Serial'] })).toThrow('batch-draft-source-mismatch');
    expect(() => serializeBatchDraft({ ...draft, source: { ...draft.source, fields: ['Name', 'ID'] } })).toThrow('invalid-batch-draft');
  });

  it('rejects competing bindings, orphan alignment and unknown or malformed schema keys', () => {
    for (const invalid of [
      { ...v6, version: 5 }, { ...v5, version: 6 }, { ...v6, virtualMappings: [] },
      { ...v6, unexpected: true }, { ...v6, mapping: { ...base.mapping, Serial: 'ROW_INDEX' } },
      { ...v6, virtualMappings: { ' ': { column: 'TODAY_AR' } } },
      { ...v6, virtualMappings: { Serial: { column: 'constructor' } } },
      { ...v6, virtualMappings: { Serial: { column: 'ROW_INDEX', template: '{{TODAY_ISO}}' } } },
      { ...v6, virtualMappings: { Serial: { column: 'ROW_INDEX', template: true } } },
      { ...v6, virtualMappings: { Serial: { column: 'ROW_INDEX', template: undefined } } },
      { ...v6, virtualMappings: { Serial: { column: 'ROW_INDEX', detail: 'unexpected' } } },
      { ...v6, virtualMappings: {}, alignOverrides: { Serial: 'rtl' } },
    ]) expect(validateMappingPreset(invalid)).toBeUndefined();
    const preset = validateMappingPreset({ ...v6, virtualMappings: { ['__proto__']: { column: 'ROW_INDEX' } }, alignOverrides: { ['__proto__']: 'ltr' } });
    expect(preset?.version).toBe(6);
    if (preset?.version !== 6) throw new Error('Expected v6');
    expect(Object.hasOwn(preset.virtualMappings, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(preset.virtualMappings)).toBe(Object.prototype);
  });
});
