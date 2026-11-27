import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFHexString, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { expect, it } from 'vitest';
import { parseCliArgs } from '../../src/core/cli/arguments';
import { dispatchCli } from '../../src/core/cli/dispatch';
import { extractBatch } from '../../src/core/extractor/extract';
import { generateStudioTemplate } from '../../src/core/studio/templates';

const fonts = {
  arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
  latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
};
const template = await readFile('fixtures/golden/template.pdf');
const date = '2024-02-29';
const encoder = new TextEncoder();
const args = ['--template', 'input.pdf', '--out-dir', 'new'];

it('uses exact XLSX sheet, retains text values and preset virtual date, and rejects a missing active mapping', async () => {
  const command = parseCliArgs(['--mode', 'fill', ...args, '--roster', 'input.xlsx', '--preset', 'p.json',
    '--sheet-base64url', Buffer.from('Roster_AR').toString('base64url'), '--date', date, '--strict']);
  if (command.mode !== 'fill') throw new Error('missing fill options');
  const preset = {
    version: 6, mapping: { Name: 'Name', ID: 'ID' }, filenamePattern: '{{ID}}-[[@TODAY_ISO]].pdf',
    minFontSize: 8, font: 'auto', flattenZip: false, includeCoverSheet: false, alignOverrides: {},
    watermark: { kind: 'none' }, virtualMappings: { Title: { column: 'TODAY_AR' } },
  };
  const sources = {
    template, roster: await readFile('fixtures/m13/multi-sheet-roster.xlsx'), rosterName: 'input.xlsx',
    templateName: 'input.pdf', date: '2026-11-27', fonts, presetJson: JSON.stringify(preset),
  };
  const cli = await dispatchCli({ mode: 'fill', command, sources });
  expect(cli).toMatchObject({ exitCode: 0, report: { sheet: 'Roster_AR', ready: 3 } });
  const entries = unzipSync(cli.artifacts[0]!.data as Uint8Array);
  expect(Object.keys(entries).every((name) => name.endsWith(date + '.pdf'))).toBe(true);
  const readback = await extractBatch(Object.entries(entries).map(([filename, bytes]) => ({ filename, bytes })));
  expect(readback.rows.map(({ fields }) => [fields.ID?.value, fields.Title?.value])).toEqual(
    [['00123', '٢٠٢٤-٠٢-٢٩'], ['00007', '٢٠٢٤-٠٢-٢٩'], ['00042', '٢٠٢٤-٠٢-٢٩']],
  );
  expect(JSON.parse(cli.artifacts[3]!.data as string).sheetName).toBe('Roster_AR');
  const mismatched = { ...sources, presetJson: JSON.stringify({ ...preset, mapping: { ID: 'id' } }) };
  expect(await dispatchCli({ mode: 'fill', command, sources: mismatched })).toMatchObject({
    exitCode: 2, artifacts: [], report: { issues: [{ code: 'preset-source-mismatch' }] },
  });
});

it('keeps grouped ZIP member paths distinct and uses global record names on the combined cover', async () => {
  const command = parseCliArgs(['--mode', 'fill', ...args, '--roster', 'input.csv', '--group-by', 'Division', '--cover']);
  if (command.mode !== 'fill') throw new Error('missing fill options');
  const roster = encoder.encode('ID,Name,Division\r\n00123,Jan,West\r\n00123,Jan,East\r\n');
  const sources = { template, roster, rosterName: 'input.csv', templateName: 'input.pdf', date, fonts };
  const cli = await dispatchCli({ mode: 'fill', command, sources });
  expect(cli.exitCode).toBe(0);
  const manifest = JSON.parse(cli.artifacts[3]!.data as string);
  expect(manifest.entries.map(({ zipPath }: { zipPath: string }) => zipPath)).toEqual(['West/00123-Jan.pdf', 'East/00123-Jan.pdf']);
  const merged = await PDFDocument.load(cli.artifacts[2]!.data as Uint8Array, { updateMetadata: false });
  const first = merged.getPage(0).node.Contents();
  if (!first || !('lookup' in first)) throw new Error('missing cover content');
  const stream = first.lookup(0, PDFRawStream);
  const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  for (const text of [date, '00123-Jan.pdf', '00123-Jan-2.pdf']) {
    expect(operators).toContain('/ActualText ' + PDFHexString.fromText(text).toString());
  }
});

it('automatically maps text and checkboxes while leaving prepared choice fields unmapped', async () => {
  const { pdfBytes, csv } = await generateStudioTemplate('clinic-consent-bilingual', {}, fonts);
  const command = parseCliArgs(['--mode', 'fill', ...args, '--roster', 'input.csv']);
  if (command.mode !== 'fill') throw new Error('missing fill options');
  const cli = await dispatchCli({ mode: 'fill', command, sources: {
    template: pdfBytes, roster: encoder.encode(csv), rosterName: 'input.csv', templateName: 'clinic.pdf', date, fonts,
  } });
  expect(cli.exitCode).toBe(0);
  const zipped = unzipSync(cli.artifacts[0]!.data as Uint8Array);
  const { fields } = (await extractBatch(Object.entries(zipped).map(([filename, bytes]) => ({ filename, bytes })))).rows[0]!;
  expect(fields.PatientName?.value).toBeTruthy();
  expect(fields.ConsentCheck?.value).toBe('checked');
  expect(fields.ClinicBranch?.value).toBe('');
  expect(fields.ContactPreference?.value).toBe('');
});
