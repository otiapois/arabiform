import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { autoMap, makeFilenames, readRoster } from '../../src/core/roster';

describe('roster ingest', () => {
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
});
