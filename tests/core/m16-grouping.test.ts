import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { expect, it } from 'vitest';
import { createCustodyManifest } from '../../src/core/audit/custody';
import { isSafeGroupedPdfPath, planGroupedOutput } from '../../src/core/export/grouping';
import { createAudit, createZip } from '../../src/core/pdf';
import { planFilenames } from '../../src/core/roster/filenames';
import { virtualFilenameToken } from '../../src/core/roster/virtual-columns';
import { createBatchProcessor } from '../../src/core/worker/batch';

const key = PDFName.of;
const decode = new TextDecoder();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('keeps raw groups distinct across canonical collisions, reserves the blank folder and retains original row indexes', () => {
  const rows = ['_Ungrouped', ' ', '../الرياض', 'الرياض', 'A', 'Ａ', 'a', 'CON ', 'LPT².txt', 'x\u202E/y', 'A']
    .map((Clinic) => ({ Clinic, ID: '00123' }));
  const grouped = planGroupedOutput(rows, 'Clinic', '{{ID}}.pdf');
  expect(grouped.groups.map(({ groupValue, folder }) => [groupValue, folder])).toEqual([
    ['_Ungrouped', '_Ungrouped-2'], [null, '_Ungrouped'], ['../الرياض', 'الرياض'], ['الرياض', 'الرياض-2'],
    ['A', 'A'], ['Ａ', 'Ａ-2'], ['a', 'a-3'], ['CON ', '_CON'], ['LPT².txt', '_LPT².txt'], ['x\u202E/y', 'xy'],
  ]);
  expect(grouped.rows[4]?.zipPath).toBe('A/00123.pdf');
  expect(grouped.rows[10]?.zipPath).toBe('A/00123-2.pdf');
  expect(grouped.rows.every(({ zipPath }) => isSafeGroupedPdfPath(zipPath))).toBe(true);
  const serial = planGroupedOutput(rows, 'Clinic', 'row-' + virtualFilenameToken('PADDED_ROW_001') + '.pdf', { localDate: '2026-11-27' });
  expect(serial.rows[10]?.zipPath).toBe('A/row-0011.pdf');
  const formula = planGroupedOutput([{ Clinic: '../=value', ID: '00123' }, { Clinic: '＝value', ID: '00123' }], 'Clinic', '{{ID}}.pdf');
  expect(formula.rows.map(({ zipPath }) => zipPath)).toEqual(['_=value/00123.pdf', '_＝value-2/00123.pdf']);
  expect(createAudit(formula.rows.map(({ filename, zipPath }, index) => ({
    rowNumber: index + 1, status: 'pass', filename, zipPath, diagnostics: [], fontSizes: {},
  }))).csv.split('\r\n').slice(1, 3).map((line) => line.split(',').at(-1))).toEqual(formula.rows.map(({ zipPath }) => zipPath));
  expect(() => planGroupedOutput(rows, 'clinic')).toThrow('invalid-grouping-column');
  for (const path of ['../x.pdf', '/x.pdf', 'CON/x.pdf', 'x/a/b.pdf', 'x/../y.pdf', 'x./x.pdf', 'x/ＣＯＮ.pdf', 'x／a/b.pdf', 'C:x/x.pdf']) {
    expect(isSafeGroupedPdfPath(path)).toBe(false);
  }
  expect(() => createZip([{ filename: 'A/00123.pdf', pdfBytes: new Uint8Array() }])).toThrow('invalid-export-filename');
});

function pageProgram(page: PDFPage) {
  return page.node.lookup(key('Contents'), PDFArray).asArray().map((ref) => {
    const stream = page.doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('Missing page appearance stream');
    return decode.decode(decodePDFRawStream(stream).decode());
  }).join('\n');
}

function coverText(page: PDFPage) {
  return [...pageProgram(page).matchAll(/\/ActualText <([0-9A-F]+)>/g)].map((match) => PDFHexString.of(match[1]!).decodeText());
}

it('exports grouped ZIP and split print packs with selected-row custody, independent covers and exact stamped records', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([235, 240]);
  const id = source.getForm().createTextField('ID');
  id.setMaxLength(5);
  id.addToPage(page, { x: 42, y: 100, width: 95, height: 25 });
  const template = await source.save();
  const roster = new TextEncoder().encode('Clinic,ID\nA,00123\nB,00123\nA,123456\nA,00123\nB,00007\n ,00004\nA,00003');
  const values = [
    { Clinic: 'A', ID: '00123' }, { Clinic: 'B', ID: '00123' }, { Clinic: 'A', ID: '123456' },
    { Clinic: 'A', ID: '00123' }, { Clinic: 'B', ID: '00007' }, { Clinic: ' ', ID: '00004' }, { Clinic: 'A', ID: '00003' },
  ];
  const fonts = {
    arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
  };
  const grouping = planGroupedOutput(values, 'Clinic', '{{ID}}.pdf');
  const filenames = planFilenames(values, '{{ID}}.pdf').map(({ filename }) => filename);
  const rowSelection = [7, 4, 3, 2, 4];
  const notify = () => {};
  const worker = createBatchProcessor();
  const checked = await worker({ phase: 'preflight', input: { template, roster, rows: values.map(({ ID }) => ({ ID })), sheetName: 'Roster_AR', options: { fonts } } }, notify);
  if (!checked || !('custody' in checked)) throw new Error('Missing preflight');
  const grouped = await worker({ phase: 'zip', filenames, grouping, rowSelection }, notify);
  if (!grouped || !('bytes' in grouped) || !('entries' in grouped)) throw new Error('Missing ZIP');
  const zipMembers = unzipSync(grouped.bytes);
  expect(Object.keys(zipMembers)).toEqual(['B/00123.pdf', 'A/00123-2.pdf', 'A/00003.pdf']);
  for (const [index, { zipPath, filename, sha256, bytes }] of grouped.entries.entries()) {
    const path = Object.keys(zipMembers)[index]!;
    expect({ zipPath, filename, sha256, bytes }).toEqual({ zipPath: path, filename: path.split('/')[1], sha256: digest(zipMembers[path]!), bytes: zipMembers[path]!.length });
  }
  const scope = { exportScope: 'selected-subset', selectedRowNumbers: [2, 4, 7] } as const;
  const auditRows = checked.rows.map((result, index) => ({ ...result, rowNumber: index + 1, ...grouping.rows[index]! }));
  const audit = createAudit(auditRows, { ...scope, selectedRowNumbers: [...scope.selectedRowNumbers] });
  expect(JSON.parse(audit.json).map(({ zipPath }: { zipPath: string }) => zipPath)).toEqual(Object.keys(zipMembers));
  expect(audit.csv).toContain('rowNumber,filename,status,diagnostics,fontSizes,zipPath\r\n');
  expect(audit.csv).toContain('A/00123-2.pdf');
  expect(createAudit(auditRows.map(({ zipPath, ...row }) => row)).csv).not.toContain('zipPath');
  expect(JSON.parse(createCustodyManifest(checked.custody, grouped)).entries).toEqual(grouped.entries);
  const unsafe = { ...grouping, groups: grouping.groups.map((group) => ({ ...group, rowNumbers: group.rowNumbers.slice() })) };
  unsafe.groups[0]!.rowNumbers.reverse();
  await expect(worker({ phase: 'zip', filenames, grouping: unsafe, rowSelection }, notify)).rejects.toThrow('invalid-grouping-plan');
  const plain = await worker({ phase: 'zip', filenames }, notify);
  if (!plain || !('bytes' in plain) || !('entries' in plain)) throw new Error('Missing flat ZIP');
  expect(plain).not.toHaveProperty('groupByColumn');
  expect(plain.entries.every(({ zipPath }) => zipPath === undefined)).toBe(true);
  expect(plain.bytes).toEqual(createZip(Object.entries(unzipSync(plain.bytes)).map(([filename, pdfBytes]) => ({ filename, pdfBytes }))));

  const coverSheet = { filenames, locale: 'en', coverLanguage: 'bilingual', templateName: 'Template.pdf', includeCustody: true } as const;
  const watermark = { kind: 'draft', angle: 0, opacity: 0.2 } as const;
  const qrStamp = { placement: 'bottom-right', sizePt: 48, payloads: [null, 'B-ROW-0002', null, 'A-ROW-0004', null, null, 'A-ROW-0007'] } as const;
  const progress: number[] = [];
  const split = await worker({ phase: 'split', grouping, rowSelection, coverSheet, watermark, qrStamp, imposition: '2-up' },
    (event) => { expect(event.phase).toBe('split'); expect(event.total).toBe(3); progress.push(event.completed); });
  if (!split || !('groups' in split)) throw new Error('Missing split ZIP');
  expect(progress).toEqual([0, 1, 2, 2, 3]);
  const members = unzipSync(split.bytes);
  expect(Object.keys(members)).toEqual(['A-merged.pdf', 'B-merged.pdf', 'batch-custody.json']);
  expect(JSON.parse(decode.decode(members['batch-custody.json']))).toEqual({
    version: 1, templateSha256: digest(template), rosterSha256: digest(roster), sheetName: 'Roster_AR',
    ...scope, groupByColumn: 'Clinic', groups: split.groups,
  });
  for (const [group, expectedRows, index, stats] of [
    ['A', [4, 7], ['1', '4', '00123-2.pdf', '2', '2', '7', '00003.pdf', '2'], 'Ready: 2   ·   Flagged: 1   ·   Skipped: 2'],
    ['B', [2], ['1', '2', '00123.pdf', '2'], 'Ready: 1   ·   Flagged: 0   ·   Skipped: 1'],
  ] as const) {
    const name = group + '-merged.pdf';
    const packed = members[name]!;
    expect(split.groups.find(({ folder }) => folder === group)).toEqual({
      folder: group, groupValue: group, rowNumbers: expectedRows, zipPath: name, filename: name, sha256: digest(packed), bytes: packed.length,
    });
    const doc = await PDFDocument.load(packed);
    expect(doc.getPageCount()).toBe(2);
    const text = coverText(doc.getPage(0));
    expect(text).toEqual(expect.arrayContaining(['Sheets', 'الأوراق', stats]));
    expect(text.slice(text.indexOf('الأوراق') + 1, -1)).toEqual(index);
    expect(text.at(-1)).toBe('Template SHA-256 ' + digest(template).slice(0, 12) + '   ·   Roster SHA-256 ' + digest(roster).slice(0, 12));
    expect(pageProgram(doc.getPage(0))).not.toMatch(/1 g\n0 0 \d+ \d+ re\nf\n0 g\n/);
    const references = await worker({ phase: 'merged', rowSelection: expectedRows, watermark, qrStamp, imposition: '2-up' }, notify);
    if (!references || !('mergedPdfSha256' in references)) throw new Error('Missing reference');
    const ref = await PDFDocument.load(references.bytes);
    const embeddedPrograms = (input: PDFPage) => {
      const records = input.node.Resources()!.lookup(key('XObject'), PDFDict);
      return records.keys().map((name) => {
        const stream = records.lookup(name);
        if (!(stream instanceof PDFRawStream)) throw new Error('Missing imposed record stream');
        return decode.decode(decodePDFRawStream(stream).decode());
      });
    };
    expect(embeddedPrograms(doc.getPage(1))).toEqual(embeddedPrograms(ref.getPage(0)));
  }
  const oneUp = await worker({ phase: 'split', grouping, coverSheet }, notify);
  if (!oneUp || !('groups' in oneUp)) throw new Error('Missing 1-up ZIP');
  const oneUpMembers = unzipSync(oneUp.bytes);
  expect(Object.keys(oneUpMembers)).toEqual(['A-merged.pdf', 'B-merged.pdf', '_Ungrouped-merged.pdf', 'batch-custody.json']);
  const blank = await PDFDocument.load(oneUpMembers['_Ungrouped-merged.pdf']!);
  expect(blank.getPageCount()).toBe(2);
  expect(coverText(blank.getPage(0)).slice(-5, -1)).toEqual(['1', '6', '00004.pdf', '2']);
  const branchA = await PDFDocument.load(oneUpMembers['A-merged.pdf']!);
  expect(branchA.getPageCount()).toBe(4);
  expect(coverText(branchA.getPage(0)).slice(-13, -1)).toEqual(['1', '1', '00123.pdf', '2', '2', '4', '00123-2.pdf', '3', '3', '7', '00003.pdf', '4']);
}, 60_000);
