import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFRawStream } from 'pdf-lib';
import { expect } from './browser';
import { download } from './downloads';

export const clinic = (name: string) => resolve('fixtures/m3', name);
export const template = clinic('clinic-consent-mixed.pdf');
export const zipButton = 'Download Clean PDFs (.zip)';
export const mergedButton = 'Download Merged Printable PDF';
const key = PDFName.of;

export type ClinicRow = { Name: string; ID: string; Consent: string };

// Keep both the literal references and their resolved stream bytes; either can change independently.
function appearance(object: PDFObject | undefined): unknown {
  if (object instanceof PDFRawStream) return [object.dict.toString(), createHash('sha256').update(object.getContents()).digest('hex')];
  if (object instanceof PDFDict) return [object.toString(), ...object.entries().map(([key]) => appearance(object.lookup(key)))];
  return object?.toString();
}

function fieldState(pdf: PDFDocument, name: string) {
  const field = pdf.getForm().getField(name).acroField;
  return {
    value: field.dict.get(key('V'))?.toString(),
    widgets: field.getWidgets().map(({ dict }) => ({
      value: dict.get(key('V'))?.toString(), state: dict.get(key('AS'))?.toString(),
      ref: dict.get(key('AP'))?.toString(), appearance: appearance(dict.lookup(key('AP'))),
    })),
  };
}

export async function verifyClinicDownloads(page: Page, directory: string, rows: ClinicRow[], customFont = false) {
  const members = unzipSync(await readFile(await download(page, zipButton, directory, 'arabiform-clean.zip')));
  expect(Object.keys(members)).toEqual(rows.map(row => row.ID + '-' + row.Name + '.pdf'));
  const before = await readFile(template);
  const original = await PDFDocument.load(before);
  const originalForm = original.getForm();
  expect(originalForm.getCheckBox('Verified').isChecked()).toBe(true);
  expect(originalForm.getRadioGroup('Contact').getSelected()).toBe('Phone');
  expect(originalForm.getDropdown('Clinic').getSelected()).toEqual(['North clinic']);
  expect(originalForm.getTextField('Sentinel').getText()).toBe('KEEP 00109');
  const consent = fieldState(original, 'Consent');
  expect(consent.widgets).toHaveLength(2);
  await writeFile(join(directory, 'before.pdf'), before);
  const cases = [];
  for (const [index, values] of rows.entries()) {
    const pdfBytes = members[values.ID + '-' + values.Name + '.pdf']!;
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getForm().getFields().map(field => field.getName())).toEqual(originalForm.getFields().map(field => field.getName()));
    for (const name of ['Verified', 'Contact', 'Clinic', 'Sentinel']) expect(fieldState(doc, name)).toEqual(fieldState(original, name));
    const state = values.Consent === 'نعم' ? 'Yes' : 'Off';
    const mapped = fieldState(doc, 'Consent');
    expect(mapped.value).toBe('/' + state);
    expect(mapped.widgets).toEqual(consent.widgets.map(widget => ({ ...widget, state: '/' + state })));
    for (const field of ['Name', 'ID'] as const) {
      const text = doc.getForm().getTextField(field);
      expect(text.getText()).toBe(values[field]);
      if (!customFont) continue;
      const normal = text.acroField.getWidgets()[0]!.dict.lookup(key('AP'), PDFDict).lookup(key('N'));
      if (!(normal instanceof PDFRawStream)) throw new Error(field + ' lacks its normal appearance stream');
      const fonts = normal.dict.lookup(key('Resources'), PDFDict).lookup(key('Font'), PDFDict);
      expect(fonts.keys()).toHaveLength(1);
      const font = fonts.lookup(fonts.keys()[0]!, PDFDict);
      expect(font.get(key('BaseFont'))?.toString()).toMatch(/ArabiFormCustom/);
      const descriptor = font.lookup(key('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
      const embedded = descriptor.lookup(key('FontFile2'));
      if (!(embedded instanceof PDFRawStream)) throw new Error(field + ' lacks its embedded TrueType stream');
      expect(embedded.getContentsSize()).toBeGreaterThan(0);
    }
    const after = 'browser-row-' + (index + 1) + '.pdf';
    await writeFile(join(directory, after), pdfBytes);
    cases.push({ before: 'before.pdf', after, values, checkboxes: { Consent: state }, customFont });
  }
  const merged = await download(page, mergedButton, directory, 'arabiform-merged.pdf');
  const printable = await PDFDocument.load(await readFile(merged));
  expect(printable.catalog.has(key('AcroForm'))).toBe(false);
  expect(printable.getPageCount()).toBe(rows.length);
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ cases, merged: { pdf: 'arabiform-merged.pdf', rows: cases.map(c => c.after) } }));
  const measured = execFileSync('python', ['scripts/verify-pdf-pixels.py', manifest], { encoding: 'utf8', windowsHide: true });
  expect(measured).toContain(rows.length + ' identical merged pages');
  return measured.trim();
}
