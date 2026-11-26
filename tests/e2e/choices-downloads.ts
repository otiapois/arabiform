import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream } from 'pdf-lib';
import { expect } from './browser';
import { download } from './downloads';

export const choicesFixture = (ext: 'csv' | 'xlsx' | 'pdf') => resolve('fixtures/m4', 'multi-page-hr-choices.' + ext);
export const riyadh = 'عِيَادَةُ الرِّيَاضِ';
const key = PDFName.of;
const rows = [
  { employee: 'سَلْمَى بِنْتُ يَاسِين', clinic: 'RIY', label: riyadh, contact: 'CALL', checkbox: 'Yes' },
  { employee: 'مُحَمَّد 00123', clinic: 'RIY', label: riyadh, contact: 'MAIL', checkbox: 'Off' },
  { employee: 'Layla 00007', clinic: 'JED', label: 'Jeddah Clinic', contact: 'CALL', checkbox: 'Yes' },
] as const;

// Compare both reference syntax and contents; equal indirect references alone miss a rewritten stream.
function preservedControls(pdf: PDFDocument) {
  return ['PreservedClinic', 'PreservedContact', 'Sentinel'].map(name => {
    const field = pdf.getForm().getField(name).acroField;
    return {
      value: field.dict.get(key('V'))?.toString(),
      widgets: field.getWidgets().map(({ dict }) => {
        const ap = dict.lookup(key('AP'), PDFDict);
        const normal = ap.lookup(key('N'));
        const streams = normal instanceof PDFDict ? normal.keys().map(state => normal.lookup(state)) : [normal];
        return {
          value: dict.get(key('V'))?.toString(), state: dict.get(key('AS'))?.toString(),
          appearance: dict.get(key('AP'))?.toString(), dictionary: ap.toString(), states: normal instanceof PDFDict ? normal.toString() : undefined,
          streams: streams.map(stream => {
            if (!(stream instanceof PDFRawStream)) throw new Error(name + ' lacks a normal appearance stream');
            return [stream.dict.toString(), createHash('sha256').update(stream.getContents()).digest('hex')];
          }),
        };
      }),
    };
  });
}

export async function verifyChoiceDownloads(page: Page, dir: string, buttonName: string) {
  const toggle = page.getByTestId('flatten-zip');
  await expect(toggle).not.toBeChecked();
  const editable = await download(page, buttonName, join(dir, 'editable'), 'arabiform-clean.zip');
  await toggle.check();
  await expect(toggle).toBeChecked();
  await download(page, buttonName, join(dir, 'flattened'), 'arabiform-clean.zip');
  const members = unzipSync(await readFile(editable));
  const filenames = rows.map(row => row.employee.normalize('NFC') + '.pdf');
  expect(Object.keys(members)).toEqual(filenames);
  const source = choicesFixture('pdf');
  await copyFile(source, join(dir, 'before.pdf'));
  const original = await PDFDocument.load(await readFile(source));
  const untouched = preservedControls(original);
  const cases = [];
  for (const [i, row] of rows.entries()) {
    const filename = filenames[i]!;
    const bytes = members[filename]!;
    await writeFile(join(dir, filename), bytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    const form = pdf.getForm();
    expect(form.getFields().map(field => field.getName())).toEqual(original.getForm().getFields().map(field => field.getName()));
    expect(form.getTextField('Employee').getText()).toBe(row.employee);
    expect(form.getCheckBox('Acknowledged').isChecked()).toBe(row.checkbox === 'Yes');
    expect(preservedControls(pdf)).toEqual(untouched);
    const clinic = form.getDropdown('Clinic');
    expect(clinic.getSelected()).toEqual([row.clinic]);
    const widget = clinic.acroField.getWidgets()[0]!;
    const normal = widget.dict.lookup(key('AP'), PDFDict).lookup(key('N'));
    if (!(normal instanceof PDFRawStream)) throw new Error('Clinic lacks its normal appearance stream');
    const commands = Buffer.from(decodePDFRawStream(normal).decode()).toString('ascii');
    expect(commands).toContain('/ActualText ' + PDFHexString.fromText(row.label).toString());
    const radio = form.getRadioGroup('Contact');
    expect(radio.getSelected()).toBe(row.contact);
    const state = row.contact === 'CALL' ? '0' : '1';
    const widgets = row.contact === 'CALL' ? ['0', 'Off'] : ['Off', '1'];
    expect(radio.acroField.dict.get(key('V'))?.toString()).toBe('/' + state);
    expect(radio.acroField.getWidgets().map(w => w.dict.get(key('AS'))?.toString())).toEqual(widgets.map(v => '/' + v));
    cases.push({
      before: 'before.pdf', after: filename, values: { Employee: row.employee, Acknowledged: row.checkbox, Clinic: row.clinic, Contact: row.contact },
      checkboxes: { Acknowledged: row.checkbox }, dropdowns: { Clinic: { label: row.label } }, radios: { Contact: { state, widgets } },
    });
  }
  const manifest = join(dir, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases, choiceZip: {
    editable: 'editable/arabiform-clean.zip', flattened: 'flattened/arabiform-clean.zip', rows: filenames,
  } }, null, 2));
  const output = execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  expect(output).toContain('6 identical flattened ZIP pages');
}
