import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseCustodyManifest, verifyCustodyPdf } from '../../src/core/custody/verify';
import { createDispatchPack, prepareDispatchRows, previewDispatch } from '../../src/core/dispatch/eml-pack';
import { planGroupedOutput } from '../../src/core/export/grouping';
import { preflightRow } from '../../src/core/pdf';
import { resolveVirtualMapping } from '../../src/core/roster/virtual-columns';
import { reviewFilenamePattern, reviewSourceColumns } from '../../src/core/shaping/redaction';
import { createBatchProcessor } from '../../src/core/worker/batch';

const settings = { recipientColumn: 'Email', ccColumn: 'Copy', subjectTemplate: 'مراجعة {{Name}}', bodyTemplate: '{{Note}}' };
const assets = async () => {
  const [template, arabic, latin] = await Promise.all([
    readFile('fixtures/golden/template.pdf'), readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), readFile('public/fonts/NotoSans-Regular.ttf'),
  ]);
  return { template, fonts: { arabic, latin } };
};
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const decode = (data: Uint8Array | undefined) => new TextDecoder().decode(data);
const attachment = (eml: string) => Buffer.from(eml.split(/\r\n\r\n/).at(-1)!.split('\r\n--')[0]!.replace(/\r\n/g, ''), 'base64');

describe('M25 local email drafts and review PDFs', () => {
  it('keeps exact physical source rows and grouped flattened members through duplicate names and reordered selection', async () => {
    const { template, fonts } = await assets();
    const batch = createBatchProcessor();
    const rows = [
      { Name: 'First', ID: '5298160042', Email: '+first@example.invalid', Copy: '', Group: 'Zulu', Note: '{{ID}}' },
      { Name: 'Unselected', ID: '1234567890', Email: 'bad mailbox', Copy: '', Group: 'Zulu', Note: 'Hidden' },
      { Name: 'Flagged', ID: 'x'.repeat(200), Email: 'flagged@example.invalid', Copy: '', Group: 'Alpha', Note: 'Hidden' },
      { Name: 'Fourth', ID: '9786540008', Email: 'fourth@example.invalid', Copy: 'copy@example.invalid', Group: 'Zulu', Note: '' },
      { Name: 'Fifth', ID: '123456', Email: 'fifth@example.invalid', Copy: '', Group: 'Alpha', Note: '' },
    ];
    const idle = () => {};
    await batch({ phase: 'preflight', input: { template, roster: new TextEncoder().encode('synthetic'),
      rows: rows.map(({ Name, ID }) => ({ Name, ID })),
      options: { fonts, maskPolicies: { ID: 'keep-last-4' } },
    } }, idle);
    const grouping = planGroupedOutput(rows, 'Group', '=1+2.pdf');
    const filenames = grouping.rows.map(({ filename }) => filename);
    const zipOptions = { filenames, grouping, flattenZip: true, rowSelection: [5, 4, 3, 1] };
    const expected = await batch({ phase: 'zip', ...zipOptions }, idle);
    const result = await batch({ phase: 'dispatch', ...zipOptions, settings, rows, protectedColumns: ['ID'] }, idle);
    if (!expected || !('bytes' in expected) || !('entries' in expected) || !result || !('ledgerEntries' in result)) {
      throw new Error('Dispatch unexpectedly held');
    }
    const pdfs = unzipSync(expected.bytes);
    const drafts = unzipSync(result.bytes);
    const members = result.ledgerEntries;
    expect(members.map(({ rowNumber, recipient, pdfZipPath }) => [rowNumber, recipient, pdfZipPath])).toEqual([
      [1, '+first@example.invalid', 'Zulu/=1+2.pdf'],
      [4, 'fourth@example.invalid', 'Zulu/=1+2-3.pdf'],
      [5, 'fifth@example.invalid', 'Alpha/=1+2-2.pdf'],
    ]);
    expect(result.redactedFields).toEqual(['ID']);
    const receipt = await parseCustodyManifest(decode(drafts['custody-manifest.json']));
    expect(receipt.redactedFields).toEqual(['ID']);
    for (const { pdfZipPath, emlFilename, emlSha256, pdfSha256 } of members) {
      const eml = drafts[emlFilename]!;
      const parsed = attachment(decode(eml));
      expect(parsed).toEqual(Buffer.from(pdfs[pdfZipPath]!));
      expect(hash(parsed)).toBe(pdfSha256);
      expect(hash(eml)).toBe(emlSha256);
      expect(await verifyCustodyPdf(receipt, { filename: pdfZipPath, bytes: parsed, variant: 'flattened' })).toMatchObject({
        status: 'VERIFIED_EXACT_MATCH', variant: 'flattened',
      });
    }
    const csv = Papa.parse<string[]>(result.ledgerCsv, { skipEmptyLines: true }).data;
    expect(csv[1]!.slice(0, 5)).toEqual(['1', "'+first@example.invalid", '', "'=1+2.pdf", 'Zulu/=1+2.pdf']);
    expect(JSON.parse(result.ledgerJson)).toMatchObject({ entries: members, redactedReview: true, redactedFields: ['ID'] });
  }, 180_000);

  it('blocks invalid recipients, protected tokens and changed attachment receipts without exposing source cells', async () => {
    const values = { Email: 'first@example.invalid', Copy: '', Name: 'Sample', Note: 'token {{Name}}' };
    expect(previewDispatch(settings, values, 5)).toMatchObject({ status: 'ready', body: 'token {{Name}}' });
    expect(previewDispatch({ ...settings, subjectTemplate: '{{Absent}}' }, values, 5)).toEqual({
      status: 'blocked', issue: { rowNumber: 5, field: 'subject', code: 'missing-token' },
    });
    expect(previewDispatch(settings, values, 5, new Set(['Note']))).toEqual({
      status: 'blocked', issue: { rowNumber: 5, field: 'body', code: 'protected-column' },
    });
    for (const Email of ['bad..dots@example.invalid', 'José@example.invalid', 'good@missing', 'good@-invalid.test',
      '"quoted"@example.invalid', 'Name <good@example.invalid>', 'outside@example.invalid,second@example.invalid',
      'first@example.invalid ', 'first@example.invalid\r\n']) {
      expect(previewDispatch(settings, { ...values, Email }, 17)).toEqual({
        status: 'blocked', issue: { rowNumber: 17, field: 'to', code: 'invalid-recipient' },
      });
    }
    const { template } = await assets();
    const filename = 'attachment.pdf';
    const prepared = prepareDispatchRows(settings, [{ rowNumber: 13, values, filename }]);
    expect(await createDispatchPack(prepared, { bytes: zipSync({ [filename]: template }),
      entries: [{ filename, bytes: template.length, sha256: '0'.repeat(64) }] })).toEqual({
      status: 'blocked', issues: [{ rowNumber: 13, field: 'attachment', code: 'attachment-mismatch' }],
    });
  });

  it('masks after conditional and virtual evaluation, declines overflow, and reports only exported masked fields', async () => {
    const { template, fonts } = await assets();
    const run = createBatchProcessor();
    const rules = [{ field: 'ID', column: 'Switch', operator: 'equals', operand: 'yes', action: { type: 'set-text', value: '{{Source}}' } }] as const;
    const protectedColumns = reviewSourceColumns({ ID: 'keep-last-4' }, [['ID', 'Badge']], rules);
    expect([...protectedColumns]).toEqual(['Badge', 'Source']);
    expect(reviewFilenamePattern('{{Source}}.pdf', protectedColumns)).toBe('row-[[@PADDED_ROW_001]].pdf');
    const idle = () => {};
    const checked = await run({ phase: 'preflight', input: { template, roster: new Uint8Array(1),
      rows: [{ ID: 'VIRTUAL-0007' }, { ID: '', Name: 'Sample' },
        { ID: resolveVirtualMapping({ column: 'PADDED_ROW_001', template: 'Badge-{{PADDED_ROW_001}}' }, 3, '2026-11-28') }],
      conditional: { rules, columns: ['Switch', 'Source'], rows: [{ Switch: 'yes', Source: '5298160042' },
        { Switch: 'no', Source: 'not used' }, { Switch: 'no', Source: 'not used' }] },
      options: { fonts, maskPolicies: { ID: 'keep-last-4' }, fieldTypography: { ID: { numeralPolicy: 'eastern-arabic' } } },
    } }, idle);
    if (!checked || !('rows' in checked)) throw new Error('Expected preflight');
    expect(checked.rows.map(({ redactedFields }) => redactedFields)).toEqual([['ID'], undefined, ['ID']]);
    const first = await run({ phase: 'preview', rowIndex: 0 }, idle);
    if (!(first instanceof Uint8Array)) throw new Error('Expected masked preview');
    const pdf = await PDFDocument.load(first);
    expect(pdf.getForm().getTextField('ID').getText()).toBe('******٠٠٤٢');
    expect(pdf.getForm().getTextField('Sentinel').getText()).toBe('KEEP 00109');
    const virtual = await run({ phase: 'preview', rowIndex: 2 }, idle);
    if (!(virtual instanceof Uint8Array)) throw new Error('Expected virtual preview');
    expect((await PDFDocument.load(virtual)).getForm().getTextField('ID').getText()).toBe('******٠٠٠٣');
    const blank = await run({ phase: 'zip', rowSelection: [2], filenames: ['first.pdf', 'second.pdf', 'third.pdf'] }, idle);
    expect(blank).not.toHaveProperty('redactedFields');
    const narrow = await PDFDocument.load(template);
    narrow.getForm().getTextField('ID').setMaxLength(5);
    const flagged = await preflightRow(await narrow.save(), { ID: '1234567890' }, { fonts, maskPolicies: { ID: 'full-mask' } });
    expect(flagged).toMatchObject({ status: 'flagged', diagnostics: [{ code: 'exceeds-maxlen', field: 'ID', maxLengthExcess: 5 }] });
    expect(flagged).not.toHaveProperty('pdfBytes');
  }, 180_000);

  it('runs the real CLI with editable attachment byte parity and no files on recipient validation failure', async () => {
    const tmp = tmpdir();
    if (process.platform === 'win32') expect(tmp).toMatch(/^D:\\/i);
    const directory = await mkdtemp(join(tmp, 'arabiform-m25-'));
    try {
      const roster = join(directory, 'synthetic-clinic.csv');
      const out = join(directory, 'review');
      const preset = join(directory, 'mapping.json');
      await writeFile(preset, JSON.stringify({ version: 1, mapping: { Name: 'Name', ID: 'ID' }, filenamePattern: '{{Name}}.pdf',
        minFontSize: 8, font: 'auto' }));
      const header = 'Name,ID,Email,CopyEmail,Group\r\n';
      const good = 'سَلْمَى,5298160042,first@example.invalid,copy@example.invalid,Zulu\r\n';
      await writeFile(roster, header + good + 'عُمَر,4318920007,second@example.invalid,,Alpha\r\n');
      const run = (destination: string) => new Promise<{ code: number; stdout: string; stderr: string }>((resolveRun, reject) => {
        execFile(process.execPath, ['--import', 'tsx', 'scripts/arabiform-cli.ts', '--mode', 'fill',
          '--template', resolve('fixtures/m3/clinic-consent-mixed.pdf'), '--roster', roster, '--preset', preset, '--out-dir', destination,
          '--group-by', 'Group', '--redact-field', 'ID=keep-last-4', '--dispatch-eml', 'Email', '--dispatch-cc', 'CopyEmail',
          '--dispatch-subject', 'إفادة {{Name}} ' + 'مُرَاجَعَة 🧪 '.repeat(12), '--dispatch-body', 'مرحبًا {{Name}}\nReview copy',
        ], { timeout: 60_000, encoding: 'utf8' }, (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') reject(error);
          else resolveRun({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
        });
      });
      const success = await run(out);
      expect(success.stderr).toBe('');
      expect(success.code).toBe(0);
      const ledgerJson = await readFile(join(out, 'dispatch-ledger.json'), 'utf8');
      const drafts = unzipSync(await readFile(join(out, 'arabiform-email-drafts.zip')));
      const pdfs = unzipSync(await readFile(join(out, 'arabiform-editable.zip')));
      expect(decode(drafts['dispatch-ledger.json'])).toBe(ledgerJson);
      expect(decode(drafts['dispatch-ledger.csv'])).toBe(await readFile(join(out, 'dispatch-ledger.csv'), 'utf8'));
      const ledger = JSON.parse(ledgerJson);
      expect(ledger).toMatchObject({ redactedReview: true, redactedFields: ['ID'] });
      expect(ledger.entries.map(({ rowNumber, recipient }: { rowNumber: number; recipient: string }) => [rowNumber, recipient])).toEqual([
        [1, 'first@example.invalid'], [2, 'second@example.invalid'],
      ]);
      for (const { emlFilename, pdfZipPath, pdfSha256, emlSha256 } of ledger.entries) {
        const eml = drafts[emlFilename]!;
        const pdf = attachment(decode(eml));
        expect(pdf).toEqual(Buffer.from(pdfs[pdfZipPath]!));
        expect(hash(eml)).toBe(emlSha256);
        expect(hash(pdf)).toBe(pdfSha256);
        expect(decode(eml)).toContain('X-Unsent: 1\r\n');
      }
      const first = await PDFDocument.load(pdfs[ledger.entries[0].pdfZipPath]!);
      expect(first.getForm().getTextField('ID').getText()).toBe('******0042');

      for (const [index, invalid] of ['bad..recipient@example.invalid', '"second@example.invalid\r\nBcc: hidden@example.invalid"'].entries()) {
        const destination = join(directory, 'blocked-' + index);
        await writeFile(roster, header + good + 'عُمَر,4318920007,' + invalid + ',,Alpha\r\n');
        const blocked = await run(destination);
        expect(blocked).toMatchObject({ code: 2, stdout: '' });
        expect(JSON.parse(blocked.stderr)).toEqual({ status: 'blocked', issues: [{ rowNumber: 2, code: 'invalid-recipient', field: 'to' }] });
        expect(blocked.stderr).not.toContain('hidden@example.invalid');
        await expect(stat(destination)).rejects.toHaveProperty('code', 'ENOENT');
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 180_000);
});
