import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFTextField } from 'pdf-lib';

const templateDir = process.argv[2] ?? fileURLToPath(new URL('../test-results/public-templates/', import.meta.url));
const templates = [
  {
    file: 'uspto-sb01.pdf',
    source: 'https://www.uspto.gov/sites/default/files/documents/sb0001.pdf',
    sha256: '6df7246633a8585a3eb1af01a121afc11f15c2eabeac2c39794e6fd4f910c16f',
    pages: 3,
    fields: [['First Named Inventor', 1], ['Application Number', 1], ['Name', 1]],
  },
  {
    file: 'uscourts-ao440.pdf',
    source: 'https://www.uscourts.gov/sites/default/files/ao440.pdf',
    sha256: '2df4ff1d30d123b8a3591d158816940712e0da0189b47ca0abf780579895fbae',
    pages: 2,
    fields: [['Civil action number', 2], ['Defendant2', 1], ['Place Served2', 1], ['Plaintiff', 1]],
  },
  {
    file: 'uscis-i9.pdf',
    source: 'https://www.uscis.gov/sites/default/files/document/forms/i-9.pdf',
    sha256: '780f348c34df694bb0b4dbbfaf9f22b99b9757b80d16a37ba89aadf069597281',
    pages: 4,
    fields: [['Last Name (Family Name)', 1], ['ZIP Code', 1], ['Employee Middle Initial (if any)', 1]],
  },
  {
    file: 'irs-w9.pdf',
    source: 'https://www.irs.gov/pub/irs-pdf/fw9.pdf',
    sha256: '2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53',
    pages: 6,
    xfa: true,
  },
];

let verified = 0;
for (const { file, source, sha256, pages, fields, xfa = false } of templates) {
  const bytes = await readFile(join(templateDir, file)).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!bytes) {
    console.log(`Skipped ${file} (absent). Official source: ${source}`);
    continue;
  }

  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `${file} revision differs from the pinned official download`);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.equal(pdf.getPageCount(), pages, `${file} page count`);
  assert.equal(pdf.catalog.getAcroForm()?.dict.has(PDFName.of('XFA')), xfa, `${file} XFA intake`);
  if (!xfa) {
    const form = pdf.getForm();
    for (const [name, widgetCount] of fields) {
      const field = form.getFieldMaybe(name);
      assert(field instanceof PDFTextField, `${file} text field ${name}`);
      assert.equal(field.acroField.getWidgets().length, widgetCount, `${file} widget count for ${name}`);
      assert(!field.getText(), `${file} test field is blank: ${name}`);
    }
  }
  verified += 1;
  console.log(`Verified ${file}: ${pages} pages, ${xfa ? 'XFA present' : `${fields.length} blank AcroForm fields checked`}.`);
}
console.log(`${verified}/${templates.length} public templates verified.`);
