import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { dispatchCli } from '../../src/core/cli/dispatch';
import { parseCliArgs } from '../../src/core/cli/arguments';
import { isSafeGroupedPdfPath } from '../../src/core/export/grouping';
import { PACKET_MANIFEST_FILENAME, PACKET_ZIP_FILENAME, preflightPacket, readPacketRoster,
  type PacketInput, type PacketPreflightResult, type PacketTemplate } from '../../src/core/packet/assembler';

const encode = (text: string) => new TextEncoder().encode(text);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const key = PDFName.of;
const [hr, clinic, code, badge, arabic, latin] = await Promise.all([
  'fixtures/m4/multi-page-hr-choices.pdf', 'fixtures/m3/clinic-consent-mixed.pdf',
  'fixtures/m2/access-code.pdf', 'fixtures/m2/landscape-badge.pdf',
  'public/fonts/NotoNaskhArabic-Regular.ttf', 'public/fonts/NotoSans-Regular.ttf',
].map((path) => readFile(path)));
const sources: (PacketTemplate & { bytes: Buffer; title: string })[] = [
  { name: '01-HR.pdf', bytes: hr!, title: 'HR Onboarding', mapping: { Employee: 'Name' } },
  { name: '02-Consent.pdf', bytes: clinic!, title: 'مُوَافَقَةُ العِيَادَةِ | Clinic Consent', mapping: { Name: 'Name', ID: 'ID', Consent: 'Consent' } },
  { name: '03-Pass.pdf', bytes: code!, title: 'Code', mapping: { 'Printed Code': 'Code' } },
  { name: '04-Badge.pdf', bytes: badge!, title: 'Badge', mapping: { Name: 'Name', 'Badge ID': 'ID' } },
];
const rosterText = 'ID,Name,Consent,Code,Group\n00123,مُحَمَّد سَالِم,نعم,12345,../HR\n00123,Marwan Salem,yes,0007,../HR\n00007,Layla,no,0008,ＨＲ\n';
const roster = { name: 'people.csv', bytes: encode(rosterText) };
const fonts = { arabic: arabic!, latin: latin! };

function expectChecked(result: PacketPreflightResult) {
  if (result.status === 'blocked') throw new Error(JSON.stringify(result.issues));
  return result;
}

describe('packet assembler', () => {
  it('holds the complete first recipient for a failure in document 3 and proves exact, ordered, printable ZIP bytes', async () => {
    const progress: { phase: string; completed: number; total: number }[] = [];
    const checked = expectChecked(await preflightPacket({
      templates: sources, roster, fonts, includeCover: true, groupByColumn: 'Group',
    }, { onProgress: (value) => progress.push(value) }));
    expect(checked).toMatchObject({ ready: 2, flagged: 1, rows: [
      { rowNumber: 1, filename: '00123-packet.pdf', status: 'flagged', issues: [
        { templateIndex: 3, templateName: '03-Pass.pdf', fieldName: 'Printed Code', code: 'exceeds-maxlen', maxLengthExcess: 1 },
      ] },
      { rowNumber: 2, filename: '00123-packet-2.pdf', status: 'ready', issues: [] },
      { rowNumber: 3, filename: '00007-packet.pdf', status: 'ready', issues: [] },
    ] });
    expect(progress).toEqual([
      { phase: 'preflight', completed: 0, total: 12 },
      { phase: 'preflight', completed: 4, total: 12 },
      { phase: 'preflight', completed: 12, total: 12 },
    ]);
    const { zipBytes, manifestJson, manifest } = await checked.assemble({ onProgress: (value) => progress.push(value) });
    expect(progress.slice(-3)).toEqual([
      { phase: 'assemble', completed: 0, total: 2 },
      { phase: 'assemble', completed: 1, total: 2 },
      { phase: 'assemble', completed: 2, total: 2 },
    ]);
    expect(JSON.parse(manifestJson)).toEqual(manifest);
    expect(manifest.sources.templates).toEqual(sources.map(({ name, title, bytes }, index) => ({
      templateIndex: index + 1, name, title, bytes: bytes.byteLength, sha256: hash(bytes), pageCount: [2, 1, 1, 1][index],
    })));
    expect(manifest.sources.roster).toEqual({ name: roster.name, bytes: roster.bytes.byteLength, sha256: hash(roster.bytes) });
    const members = unzipSync(zipBytes);
    expect(Object.keys(members)).toEqual(checked.rows.slice(1).map(({ path }) => path));
    expect(Object.keys(members).every(isSafeGroupedPdfPath)).toBe(true);
    for (const [index, entry] of manifest.outputs.entries()) {
      const bytes = members[entry.path]!;
      const pdf = await PDFDocument.load(bytes);
      expect(entry).toMatchObject({ rowNumber: index + 2, bytes: bytes.byteLength, sha256: hash(bytes), pageCount: 6 });
      expect(entry.documents.map(({ title, startPage, pageCount }) => [title, startPage, pageCount])).toEqual(
        sources.map(({ title }, index) => [title, [2, 4, 5, 6][index], [2, 1, 1, 1][index]]),
      );
      expect(pdf.getPageCount()).toBe(6);
      expect(pdf.catalog.has(key('AcroForm'))).toBe(false);
      expect(pdf.getPages().every((page) => !page.node.Annots()?.size())).toBe(true);
      expect(pdf.getPage(5).getRotation().angle).toBe(90);
      const cover = pdf.getPage(0).node.Contents() as PDFArray;
      const text = cover.asArray().map((ref) => {
        const stream = pdf.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw new Error('Expected a serialized cover stream.');
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      }).join('\n');
      expect(text).toContain('ActualText');
    }
  });

  it('preflights every document, including failures that follow the first failure on the same row', async () => {
    const checked = expectChecked(await preflightPacket({ templates: sources, fonts, roster: {
      name: roster.name,
      bytes: encode('ID,Name,Consent,Code\n00007,Marwan,review,99999\n'),
    } }));
    expect(checked.rows[0]?.issues.map(({ templateIndex, fieldName, code }) => [templateIndex, fieldName, code])).toEqual([
      [2, 'Consent', 'invalid-checkbox-value'], [3, 'Printed Code', 'exceeds-maxlen'],
    ]);
    await expect(checked.assemble()).rejects.toThrow('empty-export');
  });

  it('reports an exact bound dropdown and radio choice while ordinary mappings still auto-match', async () => {
    const checked = expectChecked(await preflightPacket({
      templates: [{ ...sources[0]!, mapping: { Employee: 'Name', Clinic: 'Site', Contact: 'Method' } },
        { bytes: clinic!, name: '02-Consent.pdf' }],
      roster: { name: 'visits.csv', bytes: encode('Name,ID,Site,Method\nLayla,00007,No Such Site,WRONG\nMarwan,00123,RIY,CALL\n') },
      fonts,
    }));
    expect(checked.rows.map(({ status }) => status)).toEqual(['flagged', 'ready']);
    expect(checked.rows[0]!.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateIndex: 1, fieldName: 'Clinic', code: 'invalid-choice',
        choices: expect.arrayContaining([expect.objectContaining({ value: 'RIY' })]) }),
      expect.objectContaining({ templateIndex: 1, fieldName: 'Contact', code: 'invalid-choice',
        choices: expect.arrayContaining([expect.objectContaining({ value: 'CALL' })]) }),
    ]));
    expect(Object.keys(unzipSync((await checked.assemble()).zipBytes))).toEqual(['00123-packet.pdf']);
  });

  it.each([
    ['xfa.pdf', 'xfa-unsupported'], ['flat.pdf', 'flat-scanned-no-fields'],
    ['encrypted.pdf', 'encrypted-pdf'], ['signed.pdf', 'signed-pdf-warning'],
  ])('blocks %s before any row or ZIP and identifies document three', async (file, code) => {
    const templateName = `مُسْتَنَد ${file}`;
    const unsupported = { bytes: await readFile('fixtures/golden/' + file), name: templateName };
    const result = await preflightPacket({ templates: [...sources.slice(0, 2), unsupported], roster, fonts });
    expect(result).toMatchObject({ status: 'blocked', issues: [{ templateIndex: 3, templateName, code }] });
    expect(result).not.toHaveProperty('assemble');
  });

  it('retains indexed exact names for invalid bindings, corrupt source bytes, and unsafe titles', async () => {
    expect(await preflightPacket({ templates: [sources[0]!, { ...sources[1]!, title: 'Consent\u202e.pdf' }], roster, fonts })).toMatchObject({
      status: 'blocked', issues: [{ templateIndex: 2, templateName: '02-Consent.pdf', code: 'invalid-template-title' }],
    });
    expect(await preflightPacket({ templates: [sources[0]!, { ...sources[1]!, bytes: encode('corrupt') }], roster, fonts })).toMatchObject({
      status: 'blocked', issues: [{ templateIndex: 2, templateName: '02-Consent.pdf', code: 'invalid-pdf' }],
    });
    expect(await preflightPacket({ templates: [sources[0]!, { ...sources[1]!, mapping: { Name: 'نام column' } }], roster, fonts })).toMatchObject({
      status: 'blocked', issues: [{ templateIndex: 2, templateName: '02-Consent.pdf', fieldName: 'Name', columnName: 'نام column', code: 'packet-mapping-mismatch' }],
    });
  });

  it('flags an unmapped visible widget with a missing printable appearance', async () => {
    const doc = await PDFDocument.load(clinic!);
    doc.getForm().getTextField('Sentinel').acroField.getWidgets()[0]!.dict.delete(key('AP'));
    const bytes = await doc.save({ updateFieldAppearances: false });
    const checked = expectChecked(await preflightPacket({ templates: [sources[0]!, { ...sources[1]!, bytes }], roster, fonts }));
    expect(checked.ready).toBe(0);
    for (const row of checked.rows) expect(row.issues).toContainEqual(expect.objectContaining({
      templateIndex: 2, templateName: '02-Consent.pdf', fieldName: 'Sentinel', code: 'unflattenable-widget', pageNumbers: [1],
    }));
    await expect(checked.assemble()).rejects.toThrow('empty-export');
  });

  it('uses one visible XLSX worksheet and hashes the exact workbook bytes after caller mutation', async () => {
    const workbook = await readFile('fixtures/golden/roster.xlsx');
    const name = 'Roster.xlsx';
    const digest = hash(workbook);
    const template = Uint8Array.from(hr!);
    const templateDigest = hash(template);
    const roster = { name, bytes: workbook, sheetName: 'Numeric IDs' };
    expect((await readPacketRoster(roster)).rows[0]?.values.ID).toBe('00123');
    await expect(readPacketRoster({ ...roster, sheetName: 'numeric ids' })).rejects.toThrow('unknown-sheet');
    const inputs: PacketInput = { templates: [{ ...sources[0]!, bytes: template, mapping: { Employee: 'ID' } },
      { ...sources[1]!, mapping: { ID: 'ID' } }], roster, fonts };
    const preparing = preflightPacket(inputs);
    workbook.fill(0);
    template.fill(0);
    const checked = expectChecked(await preparing);
    expect(checked.rows[0]?.filename).toBe('00123-packet.pdf');
    const { manifest } = await checked.assemble();
    expect(manifest.sources.roster).toEqual({ name, bytes: workbook.byteLength, sha256: digest, sheetName: 'Numeric IDs' });
    expect(manifest.sources.templates[0]?.sha256).toBe(templateDigest);
  });

  it('cancels during the first progress update and uses original row numbers without an ID header', async () => {
    const input: PacketInput = { templates: [sources[0]!, { ...sources[1]!, mapping: { Name: 'Name' } }], fonts,
      roster: { name: 'names.csv', bytes: encode('Name\nLayla\nSalem\n') } };
    const controller = new AbortController();
    await expect(preflightPacket(input, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    const checked = expectChecked(await preflightPacket(input));
    expect(checked.rows.map(({ filename }) => filename)).toEqual(['1-packet.pdf', '2-packet.pdf']);
  });
});

describe('packet CLI boundary', () => {
  const flags = ['--mode', 'packet', '--template', 'a.pdf', '--template', './b.pdf', '--roster', 'shared.xlsx', '--out-dir', 'output'];

  it('parses ordered repeated template flags and rejects other mode flags and unsafe paths', () => {
    expect(parseCliArgs([...flags, '--mappings', 'mappings.json', '--sheet', 'Data', '--group-by', 'Group', '--cover']))
      .toMatchObject({ mode: 'packet', templates: ['a.pdf', './b.pdf'], mappings: 'mappings.json', sheet: 'Data', groupBy: 'Group', cover: true });
    expect(() => parseCliArgs([...flags, '--template', '../c.pdf'])).toThrow('Unsafe local path');
    expect(() => parseCliArgs([...flags, '--strict'])).toThrow('unavailable');
    expect(() => parseCliArgs([...flags, '--template', 'c.pdf', '--template', 'd.pdf', '--template', 'e.pdf'])).toThrow('2 to 4 ordered');
    expect(() => parseCliArgs(flags.map((arg) => arg === 'packet' ? 'fill' : arg))).toThrow('Duplicate option --template');
  });

  it('returns 2 with only complete packets, 2 without exports when all hold, and 1 for malformed mapping JSON', async () => {
    const input = { templates: sources.slice(0, 3), roster, fonts };
    const partial = await dispatchCli({ mode: 'packet', input });
    expect(partial).toMatchObject({ exitCode: 2, report: { status: 'flagged', ready: 2, flagged: 1 },
      artifacts: [{ name: PACKET_ZIP_FILENAME }, { name: PACKET_MANIFEST_FILENAME }] });
    expect(Object.keys(unzipSync(partial.artifacts[0]!.data as Uint8Array))).toEqual(['00123-packet-2.pdf', '00007-packet.pdf']);
    const allHeld = await dispatchCli({ mode: 'packet', input: { ...input, roster: { name: 'held.csv',
      bytes: encode('ID,Name,Consent,Code\n00123,Layla,no,99999\n') } } });
    expect(allHeld).toMatchObject({ exitCode: 2, diagnostic: true, report: { status: 'flagged', ready: 0, flagged: 1 }, artifacts: [] });
    expect(await dispatchCli({ mode: 'packet', input, mappingsJson: '[{},null,{"Printed Code":17}]' }))
      .toMatchObject({ exitCode: 1, diagnostic: true, report: { status: 'usage-error' }, artifacts: [] });
  });
});
