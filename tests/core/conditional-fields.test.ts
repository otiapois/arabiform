import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFName } from 'pdf-lib';
import { expect, it } from 'vitest';
import { parseCliArgs } from '../../src/core/cli/arguments';
import { dispatchCli } from '../../src/core/cli/dispatch';
import type { MappingPresetV11 } from '../../src/core/draft/mapping-preset';
import { createAudit } from '../../src/core/pdf';
import type { ConditionalFieldRule } from '../../src/core/rules/conditional-fields';
import { createBatchProcessor } from '../../src/core/worker/batch';
import type { BatchPreflightResult, BatchZipResult } from '../../src/core/worker/protocol';

const fonts = {
  arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
  latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
};
const clinic = await readFile('fixtures/m3/clinic-consent-mixed.pdf');
const encoder = new TextEncoder();
const idle = () => {};

it('reports missing and incompatible rule inputs by exact target, page and ordinal, even on an unmatched row', async () => {
  const rules: ConditionalFieldRule[] = [
    { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-text', value: '{{code}}' } },
    { field: 'Consent', column: 'ROLE', operator: 'is-blank', action: { type: 'set-checkbox', checked: true } },
    { field: 'Verified', column: 'Role', operator: 'is-blank', action: { type: 'set-text', value: '' } },
    { field: 'Clinic', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-choice', value: 'not in /Opt' } },
    { field: 'Sentinel', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'clear-field' } },
    { field: 'Contact', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'clear-field' } },
  ];
  const run = createBatchProcessor();
  const { rows } = await run({ phase: 'preflight', input: {
    template: clinic, roster: encoder.encode('Role,Code\r\nOrdinary,00123\r\n'), options: { fonts },
    rows: [{ Name: 'Original', Consent: 'false', Verified: 'true', Clinic: 'North clinic', Contact: 'Phone' }],
    conditional: { rules, columns: ['Role', 'Code'], rows: [{ Role: 'Ordinary', Code: '00123' }] },
  } }, idle) as BatchPreflightResult;
  expect(rows[0]).toMatchObject({ status: 'flagged', ruleApplied: [], pageNumbers: [1] });
  expect(rows[0]!.diagnostics.map(({ field, code, ruleIndex, pageNumbers }) => [field, code, ruleIndex, pageNumbers])).toEqual(
    rules.map(({ field }, index) => [field, index === 3 ? 'invalid-choice' : 'invalid-conditional-rule', index + 1, [1]]));
  expect(rows[0]!.diagnostics[3]!.choices).toEqual([
    { label: 'North clinic', value: 'North clinic' }, { label: 'South clinic', value: 'South clinic' },
  ]);
  const audit = createAudit([{ ...rows[0]!, rowNumber: 1, filename: 'sample.pdf' }]);
  expect(JSON.parse(audit.json)[0]).toMatchObject({ ruleApplied: [], diagnostics: [{ field: 'Name', ruleIndex: 1, pageNumbers: [1] },
    ...rows[0]!.diagnostics.slice(1)] });
  const csv = Papa.parse<{ ruleApplied: string; diagnostics: string }>(audit.csv, { header: true, skipEmptyLines: true });
  expect(JSON.parse(csv.data[0]!.ruleApplied)).toEqual([]);
  expect(JSON.parse(csv.data[0]!.diagnostics)).toEqual(rows[0]!.diagnostics);
  expect(await run({ phase: 'preview', rowIndex: 0 }, idle)).toBeUndefined();
  await expect(run({ phase: 'zip', filenames: ['sample.pdf'] }, idle)).rejects.toThrow('empty-export');
});

it('checks required text, post-rule code points, and ink fit before allowing a PDF', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 320]);
  const form = doc.getForm();
  const title = form.createTextField('Title');
  title.enableRequired();
  title.addToPage(page, { x: 50, y: 200, width: 80, height: 30 });
  const id = form.createTextField('Id');
  id.setMaxLength(4);
  id.addToPage(page, { x: 50, y: 150, width: 80, height: 30 });
  form.createTextField('Banner').addToPage(page, { x: 50, y: 100, width: 30, height: 25 });
  const rules: ConditionalFieldRule[] = [
    { field: 'Title', column: 'Role', operator: 'is-not-blank', action: { type: 'clear-field' } },
    { field: 'Id', column: 'Role', operator: 'is-not-blank', action: { type: 'set-text', value: '{{Value}}' } },
    { field: 'Banner', column: 'Role', operator: 'is-not-blank', action: { type: 'set-text', value: 'مُعْتَمَد '.repeat(100) } },
  ];
  const run = createBatchProcessor();
  const { rows } = await run({ phase: 'preflight', input: {
    template: await doc.save(), roster: encoder.encode('Role,Value\r\nVIP,00123\r\n'), options: { fonts },
    rows: [{ Title: 'Original', Id: '1234', Banner: '' }],
    conditional: { rules, columns: ['Role', 'Value'], rows: [{ Role: 'VIP', Value: '00123' }] },
  } }, idle) as BatchPreflightResult;
  expect(rows[0]).toMatchObject({ status: 'flagged', ruleApplied: rules.map(({ field }, index) => ({ field, ruleIndex: index + 1 })),
    diagnostics: [{ field: 'Title', code: 'missing-required', pageNumbers: [1] },
      { field: 'Id', code: 'exceeds-maxlen', maxLengthExcess: 1, pageNumbers: [1] },
      { field: 'Banner', code: 'too-narrow', pageNumbers: [1] }] });
  expect(await run({ phase: 'preview', rowIndex: 0 }, idle)).toBeUndefined();
});

it('shares CLI, worker preview and ZIP values and applies v10 numeral policy after v11 rules', async () => {
  const rules: ConditionalFieldRule[] = [
    { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-text', value: 'مُعْتَمَد / VIP {{ID}}' } },
    { field: 'Consent', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-checkbox', checked: true } },
    { field: 'Consent', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-checkbox', checked: false } },
  ];
  const preset: MappingPresetV11 = {
    version: 11, mapping: { Name: 'Name', Consent: 'Consent' }, filenamePattern: '{{ID}}.pdf', minFontSize: 8, font: 'auto',
    flattenZip: false, includeCoverSheet: false, alignOverrides: {}, watermark: { kind: 'none' }, virtualMappings: {},
    qrStamp: { placement: 'none' }, coverLanguage: 'auto', imposition: '1-up', groupByColumn: null,
    fieldTypography: { Name: { numeralPolicy: 'eastern-arabic' } }, approvalSeal: null, conditionalRules: rules,
  };
  const sourceRows = [{ Name: 'Base VIP', Consent: 'no', Role: 'VIP', ID: '00123' }, { Name: 'Ordinary', Consent: 'no', Role: 'Standard', ID: '00007' }];
  const roster = encoder.encode(Papa.unparse(sourceRows));
  const command = parseCliArgs(['--mode', 'fill', '--template', 'clinic.pdf', '--roster', 'sample.csv', '--preset', 'settings.json', '--strict', '--out-dir', 'new']);
  if (command.mode !== 'fill') throw new Error('missing fill options');
  const result = await dispatchCli({ mode: 'fill', command, sources: {
    template: clinic, roster, rosterName: 'sample.csv', templateName: 'clinic.pdf', date: '2026-11-28', fonts, presetJson: JSON.stringify(preset),
  } });
  expect(result).toMatchObject({ exitCode: 0, report: { ready: 2, rows: [
    { ruleApplied: [{ field: 'Name', ruleIndex: 1 }, { field: 'Consent', ruleIndex: 2 }] }, { ruleApplied: [] },
  ] } });
  const cliZip = unzipSync(result.artifacts[0]!.data as Uint8Array);
  const worker = createBatchProcessor();
  await worker({ phase: 'preflight', input: {
    template: clinic, roster, rows: sourceRows.map(({ Name, Consent }) => ({ Name, Consent })), options: { fonts, fieldTypography: preset.fieldTypography },
    conditional: { rules, columns: Object.keys(sourceRows[0]!), rows: sourceRows },
  } }, idle);
  const workerZip = await worker({ phase: 'zip', filenames: ['00123.pdf', '00007.pdf'] }, idle) as BatchZipResult;
  const members = unzipSync(workerZip.bytes);
  for (const [index, [filename, bytes]] of Object.entries(cliZip).entries()) {
    const preview = await worker({ phase: 'preview', rowIndex: index }, idle);
    expect(Buffer.compare(bytes, preview as Uint8Array)).toBe(0);
    expect(Buffer.compare(bytes, members[filename]!)).toBe(0);
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getTextField('Name').getText()).toBe(index === 0 ? 'مُعْتَمَد / VIP ٠٠١٢٣' : 'Ordinary');
    expect(form.getCheckBox('Consent').acroField.dict.lookup(PDFName.of('V'))?.toString()).toBe(index === 0 ? '/Yes' : '/Off');
    expect(form.getTextField('Sentinel').getText()).toBe('KEEP 00109');
  }
});
