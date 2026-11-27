import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { autoMap, inspectRosterWorkbook, makeFilenames, planFilenames, readRoster } from '../../src/core/roster';

describe('roster ingest', () => {
  it('selects the first visible worksheet, preserves exact names and cached values, and skips hidden sheets and charts', async () => {
    const bytes = await readFile('fixtures/m13/multi-sheet-roster.xlsx');
    const workbook = inspectRosterWorkbook(bytes);
    expect(workbook.sheetNames).toEqual(['Summary', 'Roster_AR']);
    expect(workbook.readSheet()).toEqual({
      name: 'Summary', headers: ['Topic', 'Value'], rows: [
        { values: { Topic: 'Synthetic Sample', Value: 'Open Roster_AR for the print rows' }, warnings: [] },
      ],
    });
    const roster = workbook.readSheet('Roster_AR');
    expect(roster.rows.map(({ values }) => [values.Name, values.ID, values.Notes])).toEqual([
      ['ليلى حسن', '00123', 'Synthetic Sample'], ['أحمد سالم', '00007', 'Synthetic Sample'], ['بَنِي يَمَن', '00042', 'Approved'],
    ]);
    expect(roster.rows.map(({ warnings }) => warnings)).toEqual([[], [], [
      { column: 'Notes', source: { row: 4, column: 'D' }, code: 'excel-formula-warning', formulaHasCachedValue: true },
    ]]);
    for (const hidden of ['Internal', 'Private notes', 'Results chart', 'roster_ar']) {
      expect(() => workbook.readSheet(hidden)).toThrow('invalid-xlsx');
    }
    expect((await readRoster(bytes, 'input.XLSX')).sheets.map(({ name }) => name)).toEqual(workbook.sheetNames);
    expect(await readRoster(bytes, 'input.xlsx', { sheetName: 'Roster_AR' })).toEqual({ sheets: [roster] });
  });

  it('lets a valid worksheet be recovered after invalid headers or XML in a sibling tab', async () => {
    const bytes = await readFile('fixtures/m13/multi-sheet-roster.xlsx');
    const files = unzipSync(bytes);
    const summary = 'xl/worksheets/sheet2.xml';
    const duplicate = strFromU8(files[summary]!).replace('>Value<', '>Topic<');
    files[summary] = strToU8(duplicate);
    const invalidHeaders = inspectRosterWorkbook(zipSync(files));
    expect(invalidHeaders.sheetNames).toEqual(['Summary', 'Roster_AR']);
    expect(() => invalidHeaders.readSheet()).toThrow('invalid-roster-headers');
    expect(invalidHeaders.readSheet('Roster_AR').rows).toHaveLength(3);
    files[summary] = new Uint8Array([0xff, 0xff, 0xff]);
    const invalidXml = inspectRosterWorkbook(zipSync(files));
    expect(() => invalidXml.readSheet()).toThrow('invalid-xlsx');
    expect(invalidXml.readSheet('Roster_AR').rows[1]?.values.ID).toBe('00007');
    files[summary] = strToU8('<worksheet><sheetData/></worksheet>');
    expect(inspectRosterWorkbook(zipSync(files)).readSheet()).toEqual({ name: 'Summary', headers: [], rows: [] });
    const path = 'xl/workbook.xml';
    files[path] = strToU8(strFromU8(files[path]!).replace('state="visible"', 'state="hidden"').replace('name="Roster_AR"', 'name="Roster_AR" state="veryHidden"'));
    expect(() => inspectRosterWorkbook(zipSync(files))).toThrow('invalid-xlsx');
  });

  it('keeps every cell as text, including Arabic marks, leading zeros and line breaks', async () => {
    const csv = '\uFEFFName,ID,Notes\r\nبَنِي يَمَن,00123,"first\r\nsecond"\r\nيُسْرَى مُؤْمِن,00007,\r\n';
    const { sheets: [sheet] } = await readRoster(strToU8(csv), 'roster.CSV');
    expect(sheet!.headers).toEqual(['Name', 'ID', 'Notes']);
    expect(sheet!.rows.map((row) => row.values)).toEqual([
      { Name: 'بَنِي يَمَن', ID: '00123', Notes: 'first\r\nsecond' },
      { Name: 'يُسْرَى مُؤْمِن', ID: '00007', Notes: '' },
    ]);
  });

  it('decodes Windows-1252 and UTF-16LE, and rejects ambiguous duplicate headers', async () => {
    const latin = Uint8Array.from([...strToU8('ID,Name\n00123,Jos'), 233]);
    const wide = Uint8Array.from([255, 254, ...[...'ID,Name\n00007,ليلى'].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])]);
    expect((await readRoster(latin, 'x.csv')).sheets[0]!.rows[0]!.values.Name).toBe('José');
    expect((await readRoster(wide, 'x.csv')).sheets[0]!.rows[0]!.values).toEqual({ ID: '00007', Name: 'ليلى' });
    await expect(readRoster(strToU8('ID,ID\n00123,00007'), 'x.csv')).rejects.toThrow('invalid-roster-headers');
  });

  it('reads OOXML rich strings, pads explicit zero styles and warns about numeric identifier loss', async () => {
    const parts = {
      'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Names" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/custom.xml" Type="urn:/worksheet"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>ID</t></si><si><r><t>بَنِي</t></r><r><t xml:space="preserve"> يَمَن&#10;&amp;#10;</t></r></si></sst>',
      'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
      'xl/worksheets/custom.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Name</t></is></c></row><row><c r="A2" s="1"><v>7</v></c><c r="B2" t="s"><v>1</v></c></row><row><c r="A3"><v>123</v></c></row><row><c r="A4"><v>1.23457E+11</v></c></row></sheetData></worksheet>',
    };
    const xlsx = zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
    const { sheets: [sheet] } = await readRoster(xlsx, 'roster.xlsx');
    expect(sheet!.rows).toEqual([
      { values: { ID: '00007', Name: 'بَنِي يَمَن\n&#10;' }, warnings: [] },
      { values: { ID: '123', Name: '' }, warnings: [{ column: 'ID', source: { row: 3, column: 'A' }, code: 'excel-numeric-identifier-warning' }] },
      { values: { ID: '1.23457E+11', Name: '' }, warnings: [{ column: 'ID', source: { row: 4, column: 'A' }, code: 'excel-scientific-notation-warning' }] },
    ]);
  });

  it('keeps cached formula values as source data and independently warns at exact source coordinates', async () => {
    const parts = {
      'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Consent" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/custom.xml" Type="urn:/worksheet"/></Relationships>',
      'xl/worksheets/custom.xml': '<worksheet><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>ID</t></is></c><c r="B3" t="inlineStr"><is><t>Approval</t></is></c></row><row r="8"><c r="A8"><f>7^40</f><v>1.23457E+11</v></c><c r="B8" t="b"><f>1=1</f><v>0</v></c></row><row r="12"><c r="B12"><f t="shared" si="0"/></c></row></sheetData></worksheet>',
    };
    const xlsx = zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])));
    const { sheets: [sheet] } = await readRoster(xlsx, 'consent.xlsx');
    expect(sheet!.rows).toEqual([
      { values: { ID: '1.23457E+11', Approval: '0' }, warnings: [
        { column: 'ID', source: { row: 8, column: 'A' }, code: 'excel-scientific-notation-warning' },
        { column: 'ID', source: { row: 8, column: 'A' }, code: 'excel-formula-warning', formulaHasCachedValue: true },
        { column: 'Approval', source: { row: 8, column: 'B' }, code: 'excel-formula-warning', formulaHasCachedValue: true },
      ] },
      { values: { ID: '', Approval: '' }, warnings: [
        { column: 'Approval', source: { row: 12, column: 'B' }, code: 'excel-formula-warning', formulaHasCachedValue: false },
      ] },
    ]);
  });
});

describe('mapping and filenames', () => {
  it('matches bilingual aliases and avoids ambiguous inference', () => {
    expect(autoMap(['Name', 'الرقم', 'Notes'], ['الاسم الكامل', 'Employee ID', 'ملاحظات'])).toEqual({ Name: 'الاسم الكامل', الرقم: 'Employee ID', Notes: 'ملاحظات' });
    expect(autoMap(['Name'], ['Full Name', 'الاسم'])).toEqual({});
  });

  it('emits root-safe unique Unicode filenames and reserves Windows device names', () => {
    expect(makeFilenames([{ ID: '00123', Name: 'ليلى/حسن' }, { ID: '00123', Name: 'ليلىحسن' }])).toEqual(['00123-ليلىحسن.pdf', '00123-ليلىحسن-2.pdf']);
    expect(makeFilenames([{ ID: 'CON' }, { ID: 'con' }, { ID: '..' }], '{{ID}}.pdf')).toEqual(['_CON.pdf', '_con-2.pdf', 'row-3.pdf']);
  });

  it('reports the action that changed each name without treating the PDF extension as an adjustment', () => {
    const rows = ['Regular', 'Already.PDF', 'C/ON', 'ＣＯＮ', '../ab', 'Ab', 'Cafe\u0301', '..', 'ending.pdf ']
      .map((ID) => ({ values: { ID }, warnings: [] }));
    const pattern = '{{ID}}';
    const expected = [
      { filename: 'Regular.pdf', filenameAdjusted: false },
      { filename: 'Already.pdf', filenameAdjusted: false },
      { filename: '_CON.pdf', filenameAdjusted: true, filenameAdjustReason: 'reserved-name' },
      { filename: '_ＣＯＮ-2.pdf', filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
      { filename: 'ab.pdf', filenameAdjusted: true, filenameAdjustReason: 'sanitized' },
      { filename: 'Ab-2.pdf', filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
      { filename: 'Café.pdf', filenameAdjusted: true, filenameAdjustReason: 'sanitized' },
      { filename: 'row-8.pdf', filenameAdjusted: true, filenameAdjustReason: 'sanitized' },
      { filename: 'ending.pdf', filenameAdjusted: true, filenameAdjustReason: 'sanitized' },
    ];
    expect(planFilenames(rows, pattern)).toEqual(expected);
    expect(makeFilenames(rows, pattern)).toEqual(expected.map(({ filename }) => filename));
  });
});
