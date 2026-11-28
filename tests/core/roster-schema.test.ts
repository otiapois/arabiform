import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';
import { validateMappingPreset } from '../../src/core/draft/mapping-preset';
import { createAudit } from '../../src/core/pdf';
import { readRoster } from '../../src/core/roster';
import { applyRosterHygiene } from '../../src/core/roster/hygiene';
import { inspectTemplateDiff, migrateTemplatePreset } from '../../src/core/template/diff-migrator';
import { prepareRosterSchema, readRosterSchemaRules } from '../../src/core/validation/roster-schema';
import { createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchInput, BatchPreflightResult, BatchZipResult } from '../../src/core/worker/protocol';

const iban = prepareRosterSchema([{ column: 'IBAN', kind: 'iban-mod97' }], ['IBAN']);
const noop = () => {};
const fixture = 'fixtures/m26/gcc-payroll';

describe('institutional roster schema rules', () => {
  it('checks literal Unicode allowlists and formulas as text, exact ASCII digits, own physical columns and single mailboxes', () => {
    const rules = readRosterSchemaRules([
      { column: 'Name', kind: 'required' },
      { column: 'ID', kind: 'exact-digits', digits: 5 },
      { column: 'Email', kind: 'email-format' },
      { column: 'Status', kind: 'allowed-values', values: ['Approved', '[a-z]+', '  مَقْبُول  '], match: 'trimmed' },
      { column: '__proto__', kind: 'allowed-values', values: ['', 'Exact '] },
    ])!;
    const check = prepareRosterSchema(rules, rules.map(({ column }) => column));
    const values = { Name: 'مُحَمَّد', ID: '00123', Email: 'signed+payroll@staff.example', Status: '  مَقْبُول ', ['__proto__']: 'Exact ' };
    expect(check(values, 1)).toEqual([]);
    expect(check({ ...values, Status: '[a-z]+', ['__proto__']: '' }, 1)).toEqual([]);
    expect(check({ Name: ' \u00a0\t', ID: '٠٠١٢٣', Email: 'Name <signed@staff.example>\r\n', Status: 'approved', ['__proto__']: 'Exact' }, 7)
      .map(({ column, rule, code, rowNumber, reason }) => [column, rule, code, rowNumber, Boolean(reason.en && reason.ar)]))
      .toEqual(rules.map(({ column, kind }) => [column, kind, 'schema-validation-failed', 7, true]));
    expect(check(Object.create(values), 3).map(({ column }) => column)).toEqual(['Name', 'ID', 'Email', 'Status']);
    expect(prepareRosterSchema(rules, [])(values, 1).map(({ reasonCode }) => reasonCode)).toEqual(Array(5).fill('missing-column'));
    for (const Email of ['a@example.test\n', 'a@example.test, b@example.test', '"a"@example.test', 'a..b@example.test', 'a@-example.test', ' a@example.test']) {
      expect(check({ ...values, Email }, 1).map(({ reasonCode }) => reasonCode)).toEqual(['email-format']);
    }
    expect(values.ID).toBe('00123');
    expect(values.Status).toBe('  مَقْبُول ');
  });

  it.each([
    ['SA58 0000 0000 0000 0001 0000', undefined],
    ['SA5800000000000000010002', 'iban-checksum'],
    ['SA0080000000000000000044', 'iban-checksum'],
    ['SA9780000000000000000044', undefined],
    ['SA9180B10000000000000000', 'iban-ambiguous-transposition'],
    ['SA91801B0000000000000000', 'iban-ambiguous-transposition'],
    ['SA58000000000000000100L0', undefined], // A mixed substitution can retain the valid ISO checksum.
    ['SA580000000000000001000', 'iban-length'],
    ['XX5800000000000000010000', 'iban-country'],
    ['SA58 0000 0000 0000 0001\n0000', 'iban-format'],
    ['SA58 0000 0000 0000 0001\u00a00000', 'iban-format'],
    ['sa58 0000 0000 0000 0001 0000', 'iban-format'],
    ['SA58 0000 0000 0000 0001 000ß', 'iban-format'],
  ])('checks IBAN shape, checksum and collisions for %j', (value, reasonCode) => {
    expect(iban({ IBAN: value }, 4)[0]?.reasonCode).toBe(reasonCode);
  });

  it('holds source-only columns before field layout, rechecks effective hygiene and edits, and excludes held selections', async () => {
    const [template, roster, raw, arabic, latin] = await Promise.all([
      readFile(fixture + '.pdf'), readFile(fixture + '.csv'), readFile(fixture + '-preset-v13.json', 'utf8'),
      readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), readFile('public/fonts/NotoSans-Regular.ttf'),
    ]);
    const preset = validateMappingPreset(JSON.parse(raw));
    if (preset?.version !== 13) throw new Error('invalid-fixture');
    const original = (await readRoster(roster, 'payroll.csv')).sheets[0]!;
    const padded = { ...original, rows: original.rows.map((row, index) => index === 0
      ? { ...row, values: { ...row.values, Department: '  Payroll  ' } } : row) };
    const { sheet } = applyRosterHygiene(padded, { columns: [4], normalizeSpaces: true });
    const physical = sheet.rows.map(({ values }) => values);
    const schema = { rules: [...preset.schemaRules, { column: 'Department', kind: 'allowed-values' as const, values: ['Payroll'] }],
      columns: sheet.headers, rows: physical };
    const mappedRows = physical.map((row) => Object.fromEntries(Object.entries(preset.mapping).map(([field, column]) => [field, row[column]!])));
    const options = { fonts: { arabic, latin } };
    const before: BatchInput = { template, roster, options, schema, rows: [
      mappedRows[0]!, { ...mappedRows[1], 'not a template field': 'would flag after schema' } as Record<string, string>, mappedRows[2]!,
    ] };
    const worker = createBatchProcessor();
    const checked = await worker({ phase: 'preflight', input: before }, noop) as BatchPreflightResult;
    expect(checked.rows.map(({ status }) => status)).toEqual(['pass', 'flagged', 'flagged']);
    expect(checked.rows[1]).toMatchObject({ diagnostics: [], fontSizes: {}, schemaDiagnostics: [
      { column: 'IBAN', rule: 'iban-mod97', rowNumber: 2 }, { column: 'Department', rule: 'allowed-values', rowNumber: 2 },
    ] });
    expect(checked.rows[2]?.schemaDiagnostics?.[0]).toMatchObject({ column: 'Effective Date', rule: 'iso-date', rowNumber: 3 });
    expect(await worker({ phase: 'preview', rowIndex: 1 }, noop)).toBeUndefined();
    const filenames = ['one.pdf', 'two.pdf', 'three.pdf'];
    await expect(worker({ phase: 'zip', filenames, rowSelection: [2, 3] }, noop)).rejects.toThrow('empty-export');
    await expect(worker({ phase: 'merged', rowSelection: [2] }, noop)).rejects.toThrow('empty-export');
    const zip = await worker({ phase: 'zip', filenames, rowSelection: [1, 2, 3] }, noop) as BatchZipResult;
    expect(Object.keys(unzipSync(zip.bytes))).toEqual(['one.pdf']);
    const auditRows = checked.rows.map((row, index) => ({ ...row, rowNumber: index + 1, filename: filenames[index]! }));
    const { csv, json } = createAudit(auditRows);
    expect(JSON.parse(json)[1].schemaDiagnostics).toEqual(checked.rows[1]?.schemaDiagnostics);
    expect(Papa.parse<{ schemaDiagnostics: string }>(csv, { header: true }).data[1]?.schemaDiagnostics)
      .toBe(JSON.stringify(checked.rows[1]?.schemaDiagnostics));
    expect(createAudit(auditRows.map(({ schemaDiagnostics: _, ...row }) => row)).csv.split('\r\n')[0])
      .toBe('rowNumber,filename,status,diagnostics,fontSizes');

    const IBAN = 'SA31 0000 0000 0000 0001 0001';
    const changed = createBatchProcessor();
    const changedResults = await changed({ phase: 'preflight', input: { ...before,
      rows: mappedRows.map((row, index) => index === 1 ? { ...row, IBAN } : row),
      schema: { ...schema, rows: physical.map((row, index) => index === 1 ? { ...row, IBAN, Department: 'Payroll' } : row) },
    } }, noop) as BatchPreflightResult;
    expect(changedResults.rows.map(({ status }) => status)).toEqual(['pass', 'pass', 'flagged']);
    const bytes = await changed({ phase: 'preview', rowIndex: 1 }, noop);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const pdf = await PDFDocument.load(bytes as Uint8Array);
    expect(pdf.getForm().getTextField('IBAN').getText()).toBe(IBAN);
    expect(pdf.getForm().getTextField('EmployeeID').getText()).toBe('0012345679');
    expect(pdf.getForm().getTextField('Name').getText()).toBe('سَلْمَى بِنْت يَاسِين');
    expect(pdf.getForm().getTextField('Sentinel').getText()).toBe('KEEP 00109');
    expect(original.rows[1]?.values.IBAN).toBe('SA31 0000 0000 0000 0001 0002');
  });

  it('preserves source-scoped v13 rules through template migration and batch-draft restore', async () => {
    const template = await readFile(fixture + '.pdf');
    const same = await inspectTemplateDiff(template, template);
    const settings = validateMappingPreset(JSON.parse(await readFile(fixture + '-preset-v13.json', 'utf8')));
    if (settings?.version !== 13) throw new Error('invalid-fixture');
    settings.schemaRules.push({ column: 'Other Sheet Column', kind: 'required' });
    expect(migrateTemplatePreset(same, settings).preset).toEqual(settings);
    const source = { fields: [...Object.keys(settings.mapping), 'Sentinel'], columns: Object.values(settings.mapping), sheetName: 'Roster',
      templateSha256: 'a'.repeat(64), rosterSha256: 'b'.repeat(64), rowCount: 3 };
    const draft: BatchDraft = { kind: 'arabiform-batch-draft', version: 1, source, settings, edits: {}, hygiene: [], customFontSha256: null };
    expect(parseBatchDraft(serializeBatchDraft(draft), source)).toEqual(draft);
  });
});
