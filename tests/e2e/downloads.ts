import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { golden } from './browser';

export async function download(page: Page, button: string, directory: string, filename: string) {
  await mkdir(directory, { recursive: true });
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button, exact: true }).click(),
  ]);
  expect(file.suggestedFilename()).toBe(filename);
  const path = join(directory, filename);
  await file.saveAs(path);
  expect(await file.failure()).toBeNull();
  return path;
}

function sentinel(pdf: PDFDocument) {
  const field = pdf.getForm().getTextField('Sentinel');
  const widget = field.acroField.getWidgets()[0]!;
  const ap = widget.dict.lookup(PDFName.of('AP'), PDFDict);
  const normal = ap.lookup(PDFName.of('N'));
  if (!(normal instanceof PDFRawStream)) throw new Error('Sentinel has no normal appearance stream');
  return {
    value: field.getText(),
    rawValue: field.acroField.dict.get(PDFName.of('V'))!.toString(),
    appearance: ap.toString(),
    normalBytes: Buffer.from(normal.getContents()),
  };
}

export async function verifyDownloads(page: Page, directory: string, fixed: boolean) {
  const expectedRows = Papa.parse<Record<string, string>>(await readFile(golden('roster.csv'), 'utf8'), {
    header: true, skipEmptyLines: true,
  }).data;
  expect(expectedRows.map(row => row.ID)).toEqual(['00123', '00007', '00891', 'AR-00042 / ق', '00068']);
  if (fixed) expectedRows[4]!.Name = 'ليلى حسن';

  const json = await download(page, 'Download Preflight Audit (.json)', directory, 'arabiform-preflight.json');
  const audit: { rowNumber: number; filename: string; status: string; diagnostics: unknown[]; fontSizes: Record<string, number[]> }[] =
    JSON.parse(await readFile(json, 'utf8'));
  expect(audit.map(row => row.rowNumber)).toEqual([1, 2, 3, 4, 5]);
  expect(audit.map(row => row.status)).toEqual(['pass', 'pass', 'pass', 'pass', fixed ? 'pass' : 'flagged']);
  if (!fixed) expect(audit[4]!.diagnostics).toContainEqual({ field: 'Name', code: 'too-narrow', widgetIndex: 0 });
  const csv = await download(page, 'Download Preflight Audit (.csv)', directory, 'arabiform-preflight.csv');
  const parsed = Papa.parse<Record<string, string>>(await readFile(csv, 'utf8'), { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data.map(row => ({
    rowNumber: Number(row.rowNumber), filename: row.filename, status: row.status,
    diagnostics: JSON.parse(row.diagnostics!), fontSizes: JSON.parse(row.fontSizes!),
  }))).toEqual(audit);

  const zip = await download(page, 'Download Clean PDFs (.zip)', directory, 'arabiform-clean.zip');
  const members = unzipSync(await readFile(zip));
  const passing = audit.filter(row => row.status === 'pass');
  expect(Object.keys(members)).toEqual(passing.map(row => row.filename));
  const baseline = await readFile(golden('template.pdf'));
  const initial = sentinel(await PDFDocument.load(baseline));
  expect(initial.value).toBe('KEEP 00109');
  expect(initial.normalBytes.length).toBeGreaterThan(0);
  await writeFile(join(directory, 'before.pdf'), baseline);

  const cases = [];
  for (const { rowNumber, filename } of passing) {
    const values = expectedRows[rowNumber - 1]!;
    const bytes = members[filename]!;
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    for (const [name, value] of Object.entries(values)) expect(pdf.getForm().getTextField(name).getText()).toBe(value);
    expect(sentinel(pdf)).toEqual(initial);
    const after = `row-${rowNumber}.pdf`;
    await writeFile(join(directory, after), bytes);
    cases.push({ before: 'before.pdf', after, values, label: 'Browser row ' + rowNumber });
  }
  const merged = await download(page, 'Download Merged Printable PDF', directory, 'arabiform-merged.pdf');
  const printable = await PDFDocument.load(await readFile(merged));
  expect(printable.getPageCount()).toBe(passing.length);
  expect(printable.catalog.has(PDFName.of('AcroForm'))).toBe(false);
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases, merged: { pdf: 'arabiform-merged.pdf', rows: cases.map(item => item.after) } }));
  const measured = execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  expect(measured).toContain(`${passing.length} identical merged pages`);
  return measured.trim();
}
