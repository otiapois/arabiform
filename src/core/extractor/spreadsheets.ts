import { zipSync } from 'fflate';
import Papa from 'papaparse';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';
import type { ExtractColumn, ExtractFieldValue, ExtractRow } from './extract';

interface SpreadsheetColumn {
  header: string;
  field?: string;
  detail?: 'value' | 'nativeValue' | 'displayLabel';
}

const custodyHeaders = ['Filename', 'Source SHA-256', 'Status'];
const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationshipsNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const encoder = new TextEncoder();

function headerKey(header: string): string {
  return header.normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function orderedSpreadsheetColumns(columns: readonly ExtractColumn[], rows: readonly ExtractRow[]): SpreadsheetColumn[] {
  const taken = new Set(custodyHeaders.map(headerKey));
  const canonical = new Set(columns.map(({ name }) => headerKey(name)));
  const claim = (name: string) => {
    const normalized = headerKey(name);
    if (normalized && !taken.has(normalized)) {
      taken.add(normalized);
      return name;
    }
    const stem = normalized ? name : 'Field';
    for (let suffix = 2; ; suffix++) {
      const candidate = stem + ' (' + suffix + ')';
      const key = headerKey(candidate);
      if (taken.has(key) || canonical.has(key)) continue;
      taken.add(key);
      return candidate;
    }
  };
  // Claim the primary field headers before allocating the companion headers.
  const headers = columns.map(({ name }) => claim(name));
  return [
    ...custodyHeaders.map((header) => ({ header })),
    ...columns.flatMap(({ name, kind }, index) => {
      const fields = rows.map((row) => row.fields[name]);
      const result: SpreadsheetColumn[] = [{ header: headers[index]!, field: name, detail: 'value' }];
      if (kind === 'checkbox' || fields.some((field) => field?.kind === 'checkbox')) {
        result.push({ header: claim(name + ' (native export)'), field: name, detail: 'nativeValue' });
      }
      if (fields.some((field) => field?.displayLabel !== undefined)) {
        result.push({ header: claim(name + ' (display label)'), field: name, detail: 'displayLabel' });
      }
      return result;
    }),
  ];
}

function columnLabel(index: number): string {
  let label = '';
  for (let remaining = index + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    label = String.fromCharCode(65 + (remaining - 1) % 26) + label;
  }
  return label;
}

function inlineText(value: string): string {
  return value.replace(/_(?=x[0-9a-f]{4}_)|[\0-\x08\x0b-\x1f\ufffe\uffff&<>]/gi, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return '_x' + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '_';
  });
}

function workbook(cells: readonly string[][]): Uint8Array {
  const width = cells[0]!.length;
  if (width > 16_384 || cells.some((row) => row.some((value) => value.length > 32_767))) {
    throw new Error('extract-spreadsheet-limit');
  }
  const labels = Array.from({ length: width }, (_, index) => columnLabel(index));
  const contents = cells.map((row, index) => {
    const number = index + 1;
    const data = row.map((value, column) =>
      '<c r="' + labels[column] + number + '" t="inlineStr"><is><t xml:space="preserve">' + inlineText(value) + '</t></is></c>',
    ).join('');
    return '<row r="' + number + '">' + data + '</row>';
  }).join('');
  const parts = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>',
    '_rels/.rels': '<Relationships xmlns="' + packageRelationshipsNs + '"><Relationship Id="rId1" Type="'
      + relationshipsNs + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="' + spreadsheetNs + '" xmlns:r="' + relationshipsNs
      + '"><sheets><sheet name="Extracted" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + packageRelationshipsNs + '"><Relationship Id="rId1" Type="'
      + relationshipsNs + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + spreadsheetNs + '"><sheetData>' + contents + '</sheetData></worksheet>',
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, encoder.encode(xmlHeader + xml)])),
    { level: 6, mtime: new Date(2000, 0, 1, 12) });
}

export function makeSpreadsheets(columns: readonly ExtractColumn[], rows: readonly ExtractRow[]) {
  const spreadsheetColumns = orderedSpreadsheetColumns(columns, rows);
  const cells = [
    spreadsheetColumns.map(({ header }) => header),
    ...rows.map(({ filename, sourceSha256, status, fields }) => [
      filename, sourceSha256, status,
      ...spreadsheetColumns.slice(custodyHeaders.length).map(({ field, detail }) => {
        const entry: ExtractFieldValue | undefined = fields[field!];
        if (!entry || detail === 'nativeValue' && entry.kind !== 'checkbox') return '';
        return entry[detail!] ?? '';
      }),
    ]),
  ];
  const xlsx = workbook(cells);
  const csv = encoder.encode('\uFEFF' + Papa.unparse(cells.map((row) => row.map(escapeSpreadsheetCell)), { newline: '\r\n' }) + '\r\n');
  return { csv, xlsx, spreadsheetColumns };
}
