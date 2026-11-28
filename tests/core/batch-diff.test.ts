import { readFile } from 'node:fs/promises';
import { Zip, ZipPassThrough, unzipSync, zipSync } from 'fflate';
import Papa from 'papaparse';
import { PDFDocument, PDFHexString, PDFName, PDFNull } from 'pdf-lib';
import { expect, it } from 'vitest';
import { sha256 } from '../../src/core/audit/custody';
import { compareBatches } from '../../src/core/diff/batch-diff';
import { createGeneratedZip } from '../../src/core/pdf/exports';

const fixture = (path: string) => readFile(new URL('../../fixtures/' + path, import.meta.url));
const zip = (files: Record<string, Uint8Array> = {}, level: 0 | 1 = 0) => zipSync(files, { level, mtime: new Date(2000, 0, 1, 12) });
const key = PDFName.of;
const utf8 = new TextDecoder();

async function pdf(pages: number, edit?: (doc: PDFDocument) => void) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let index = 0; index < pages; index++) doc.addPage();
  edit?.(doc);
  return doc.save({ updateFieldAppearances: false });
}

it('audits the actual demo, exact custody hashes and unchanged delta member bytes', async () => {
  const previous = await fixture('m27/previous-batch.zip');
  const next = await fixture('m27/next-batch.zip');
  const result = await compareBatches(previous, next);
  expect(result.counts).toEqual({ unchanged: 1, modified: 1, added: 0, removed: 0 });
  expect(result.reprint).toEqual({ fullPages: 2, deltaPages: 1, savedPages: 1, savingsPercent: 50, sheetsPerPage: 1 });
  const member = 'certificates/record-002.pdf';
  const nextPdf = unzipSync(next)[member]!;
  expect(result.entries.find(({ path }) => path === member)).toMatchObject({
    status: 'modified', reason: 'field-value-change', previousPath: member, nextPath: member,
    fieldChanges: [{ field: 'NameAr', oldValue: 'سارة أحمد', newValue: 'سارة محمد' },
      { field: 'Verified', oldValue: 'Off', newValue: 'Yes' }], nextSha256: await sha256(nextPdf),
  });
  expect(Object.keys(unzipSync(result.deltaZip))).toEqual([member]);
  expect(Buffer.from(unzipSync(result.deltaZip)[member]!).equals(Buffer.from(nextPdf))).toBe(true);
  expect(result.hashes).toEqual({ previousSha256: await sha256(previous), nextSha256: await sha256(next), deltaSha256: await sha256(result.deltaZip) });
  expect(JSON.parse(utf8.decode(result.auditJson))).toMatchObject({ counts: result.counts, entries: result.entries, hashes: result.hashes });
});

it('saves physical pages, keeps raw nested Unicode path and accounts for a case-only rename', async () => {
  const kept = await pdf(2);
  const original = await pdf(1, (doc) => doc.setTitle('Previous'));
  const revised = await pdf(1, (doc) => doc.setTitle('Next'));
  const addition = await pdf(2, (doc) => doc.setTitle('Added'));
  const oldPath = 'القسم/sub/Café.pdf';
  const newPath = oldPath.normalize('NFD');
  const previous = zip({ 'Stable.pdf': kept, [oldPath]: original, 'Upper.PDF': addition, 'Removed.pdf': addition });
  const next = zip({ 'Stable.pdf': kept, 'القسم/': new Uint8Array(), [newPath]: revised, 'upper.pdf': addition }, 1);
  const result = await compareBatches(previous, next);
  expect(result.reprint).toEqual({ fullPages: 5, deltaPages: 3, savedPages: 2, savingsPercent: 40, sheetsPerPage: 1 });
  expect(result.counts).toEqual({ unchanged: 1, modified: 1, added: 1, removed: 2 });
  expect(result.entries.find(({ path }) => path === newPath)).toMatchObject({
    previousPath: oldPath, nextPath: newPath, reason: 'visual-or-flattened-change', fieldChanges: [],
  });
  const unpacked = unzipSync(result.deltaZip);
  expect(Object.keys(unpacked).sort()).toEqual([newPath, 'upper.pdf'].sort());
  expect(Buffer.from(unpacked[newPath]!).equals(Buffer.from(revised))).toBe(true);
});

it('retains explicit empty strings, exact choice order and radio exports with native PDF names', async () => {
  const formPdf = (newBatch: boolean) => pdf(1, (doc) => {
    const form = doc.getForm();
    const text = form.createTextField('=Label');
    text.acroField.dict.set(key('V'), newBatch ? PDFHexString.fromText('') : PDFNull);
    const choice = form.createDropdown('Choice');
    choice.acroField.dict.set(key('V'), doc.context.obj(newBatch ? [PDFHexString.fromText('00007'), PDFHexString.fromText('ق')]
      : [PDFHexString.fromText('ق'), PDFHexString.fromText('00007')]));
    const radio = form.createRadioGroup('Radio');
    radio.addOptionToPage('CALL', doc.getPage(0));
    radio.addOptionToPage('MAIL', doc.getPage(0));
    radio.select(newBatch ? 'MAIL' : 'CALL');
    form.createTextField('Name').setText(newBatch ? '  ＋1+1' : '=1+1');
  });
  const path = '=report.pdf';
  const result = await compareBatches(zip({ [path]: await formPdf(false) }), zip({ [path]: await formPdf(true) }));
  expect(result.entries[0]?.fieldChanges).toEqual([
    { field: '=Label', oldValue: null, newValue: '' },
    { field: 'Choice', oldValue: ['ق', '00007'], newValue: ['00007', 'ق'] },
    { field: 'Name', oldValue: '=1+1', newValue: '  ＋1+1' },
    { field: 'Radio', oldValue: 'CALL', newValue: 'MAIL', oldNativeValue: '0', newNativeValue: '1' },
  ]);
  const parsed = Papa.parse<Record<string, string>>(utf8.decode(result.auditCsv), { header: true, skipEmptyLines: true });
  expect(parsed.errors).toEqual([]);
  expect(parsed.data.find(({ field }) => field === "'=Label")).toMatchObject({ path: "'=report.pdf", old_value_type: 'null', new_value_type: 'string', new_value: '' });
  expect(parsed.data.find(({ field }) => field === 'Name')).toMatchObject({ old_value: "'=1+1", new_value: "'  ＋1+1" });
});

it('accepts empty source archives and self-authored grouped ZIP data descriptors', async () => {
  const source = await pdf(1);
  const { bytes: match } = await createGeneratedZip([{ filename: 'record.pdf', getPdfBytes: async () => source }],
    undefined, false, undefined, undefined, ['القسم/record.pdf']);
  expect((await compareBatches(match, match)).reprint.savingsPercent).toBe(100);
  const empty = await compareBatches(match, zip());
  expect(empty.reprint).toEqual({ fullPages: 0, deltaPages: 0, savedPages: 0, savingsPercent: null, sheetsPerPage: 1 });
  expect(Object.keys(unzipSync(empty.deltaZip))).toEqual([]);
  expect(Papa.parse(utf8.decode(empty.auditCsv)).data.length).toBeGreaterThan(1);
  const records: Uint8Array[] = [];
  const stream = new Zip((error, data) => { if (error) throw error; records.push(data); });
  const member = new ZipPassThrough('record.pdf');
  stream.add(member);
  member.push(source, true);
  stream.end();
  const output = Buffer.concat(records);
  // Remove the optional descriptor marker and adjust central directory offset.
  const end = output.length - 22;
  const central = output.readUInt32LE(end + 16);
  expect(output.readUInt32LE(central - 16)).toBe(0x08074b50);
  const unmarked = Buffer.concat([output.subarray(0, central - 16), output.subarray(central - 12)]);
  unmarked.writeUInt32LE(central - 4, unmarked.length - 22 + 16);
  expect((await compareBatches(unmarked, unmarked)).counts.unchanged).toBe(1);
});

it('rejects aliases, traversal, junk, malformed sizes and CRC; verifies PDFs in every position', async () => {
  const data = await pdf(1);
  const known = zip({ 'safe.pdf': data });
  const issueCases = [
    [zip({ 'dir/../safe.pdf': data }), 'unsafe-path'],
    [zip({ '＃/Ａ.pdf': data, '#/a.pdf': data }), 'duplicate-path'],
    [zip({ 'X/café.pdf': data, 'X/cafe\u0301.pdf': data }), 'duplicate-path'],
    [zip({ 'X/one.pdf': data, 'x/two.pdf': data }), 'duplicate-path'],
    [zip({ 'test.pdf': data, 'test.pdf/inner.pdf': data }), 'duplicate-path'],
    [zip({ 'data.zip': data }), 'non-pdf-entry'],
    [known.subarray(0, known.length - 1), 'invalid-zip'],
    [zip({ 'safe.pdf': data.subarray(0, data.length - 12) }), 'invalid-pdf'],
  ] as const;
  for (const [bad, code] of issueCases) {
    await expect(compareBatches(known, bad)).rejects.toMatchObject({ batch: 'next', code });
  }
  const corrupted = known.slice();
  corrupted[43] = corrupted[43]! ^ 1;
  await expect(compareBatches(known, corrupted)).rejects.toMatchObject({ code: 'invalid-zip' });
  const compressed = zip({ 'safe.pdf': data }, 1);
  const view = new DataView(compressed.buffer);
  const central = view.getUint32(compressed.length - 6, true);
  view.setUint32(22, data.length - 1, true);
  view.setUint32(central + 24, data.length - 1, true);
  await expect(compareBatches(known, compressed)).rejects.toMatchObject({ code: 'invalid-zip' });
  for (const [kind, code] of [['encrypted', 'encrypted-pdf'], ['xfa', 'xfa-unsupported'], ['signed', 'signed-pdf-warning']]) {
    const bad = zip({ 'guard.pdf': await fixture('golden/' + kind + '.pdf') });
    for (const [before, after, batch] of [[bad, bad, 'previous'], [bad, known, 'previous'], [known, bad, 'next']] as const) {
      await expect(compareBatches(before, after)).rejects.toMatchObject({ batch, path: 'guard.pdf', code });
    }
  }
});
