import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { RosterSheet, RosterWarningCode } from './index';

interface XmlRelationship { '@_Id': string; '@_Target': string; '@_Type': string; '@_TargetMode'?: string }
interface XmlSheet { '@_name': string; '@_id': string; '@_state'?: string }
interface XmlText { '#text'?: string }
interface XmlString { t?: string | XmlText; r?: { t?: string | XmlText }[] }
interface XmlCell {
  '@_r'?: string;
  '@_t'?: string;
  '@_s'?: string;
  v?: string;
  is?: XmlString;
  f?: unknown;
}
interface XmlSpreadsheet {
  workbook?: { sheets?: { sheet: XmlSheet[] } };
  Relationships?: { Relationship?: XmlRelationship[] };
  sst?: { si?: XmlString[] };
  styleSheet?: {
    numFmts?: { numFmt: { '@_numFmtId': string; '@_formatCode': string }[] };
    cellXfs?: { xf: { '@_numFmtId': string }[] };
  };
  worksheet?: { sheetData?: { row?: { '@_r'?: string; c?: XmlCell[] }[] } };
}

const arrayTags = new Set(['sheet', 'Relationship', 'si', 'r', 'numFmt', 'xf', 'row', 'c']);
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  // The parser gates numeric XML character references behind this option.
  htmlEntities: true,
  isArray: (tag) => arrayTags.has(tag),
});

const scientific = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;
const sheetLimit = 16_384;
const archiveLimit = 64 * 1024 * 1024;

function archivePath(target: string): string {
  const parts: string[] = target.startsWith('/') ? [] : ['xl'];
  for (const segment of target.split('/')) {
    if (segment === '..') {
      if (!parts.length) throw new Error('invalid-xlsx');
      parts.pop();
    } else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function spreadsheetText(value: XmlString): string {
  const textOf = (node: string | XmlText | undefined) => typeof node === 'string' ? node : node?.['#text'] ?? '';
  const text = value.r ? value.r.map(({ t }) => textOf(t)).join('') : textOf(value.t);
  return text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function columnLabel(index: number): string {
  let label = '';
  for (let remaining = index + 1; remaining > 0; remaining = Math.floor((remaining - 1) / 26)) {
    label = String.fromCharCode(65 + (remaining - 1) % 26) + label;
  }
  return label;
}

export interface RosterWorkbook {
  readonly sheetNames: readonly string[];
  readSheet(sheetName?: string): RosterSheet;
}

function workbookError(error: unknown): never {
  if (error instanceof Error && error.message === 'invalid-roster-headers') throw error;
  throw new Error('invalid-xlsx', { cause: error });
}

export function inspectWorkbook(
  bytes: Uint8Array,
  validateHeaders: (cells: readonly (string | undefined)[]) => string[],
  aliasGroups: string[][],
  normalize: (text: string) => string,
): RosterWorkbook {
  try {
    let uncompressed = 0;
    const archive = unzipSync(bytes, { filter: (file) => {
      if (!/^xl\/.+\.(?:xml|rels)$/.test(file.name)) return false;
      uncompressed += file.originalSize;
      if (uncompressed > archiveLimit) throw new Error('invalid-xlsx');
      return true;
    } });
    const xml = (path: string): XmlSpreadsheet => {
      const data = archive[path];
      if (!data) return {};
      const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
      const source = new TextDecoder(encoding, { fatal: true }).decode(data);
      if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('invalid-xlsx');
      return parser.parse(source) as XmlSpreadsheet;
    };

    const sheets = xml('xl/workbook.xml').workbook?.sheets?.sheet;
    if (!sheets?.length) throw new Error('invalid-xlsx');
    const links = new Map(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship?.map((link) => [link['@_Id'], link]));
    const visible = new Map<string, string>();
    for (const sheet of sheets) {
      if (sheet['@_state'] !== undefined && sheet['@_state'] !== 'visible') continue;
      const link = links.get(sheet['@_id']);
      if (!link) throw new Error('invalid-xlsx');
      if (!link['@_Type'].endsWith('/worksheet')) continue;
      const name = sheet['@_name'];
      if (!name || visible.has(name) || link['@_TargetMode'] === 'External') throw new Error('invalid-xlsx');
      visible.set(name, archivePath(link['@_Target']));
    }
    if (!visible.size) throw new Error('invalid-xlsx');
    const sheetNames = Object.freeze([...visible.keys()]);
    const decoded = new Map<string, RosterSheet>();
    const loadResources = () => {
      const styles = xml('xl/styles.xml').styleSheet;
      return {
        strings: (xml('xl/sharedStrings.xml').sst?.si ?? []).map(spreadsheetText),
        formats: new Map(styles?.numFmts?.numFmt?.map((format) => [format['@_numFmtId'], format['@_formatCode']])),
        styleFormats: styles?.cellXfs?.xf?.map((style) => style['@_numFmtId']) ?? [],
      };
    };
    let resources: ReturnType<typeof loadResources> | undefined;

    const parseCell = (cell: XmlCell, header = ''): { value: string; warning?: RosterWarningCode } => {
      const { strings, formats, styleFormats } = resources ??= loadResources();
      const type = cell['@_t'];
      const raw = cell.v ?? '';
      const styleId = styleFormats[Number(cell['@_s'] ?? '0')];
      const pattern = styleId ? formats.get(styleId) ?? '' : '';
      const identifier = aliasGroups.some((group) => (group.includes('id') || group.includes('phone') || group.includes('zip')) && group.includes(normalize(header)))
        || /(?:\b(?:id|code|identifier|passport|account|zip|postal|phone|mobile|serial|reference|number)\b|رقم|هوية|هاتف|جوال|بريد|معرف|رمز)/iu.test(header);
      let value = raw;
      let warning: RosterWarningCode | undefined;
      if (type === 's') {
        const shared = raw && strings[Number(raw)];
        if (typeof shared !== 'string') throw new Error('invalid-xlsx');
        value = shared;
      } else if (type === 'inlineStr') {
        value = spreadsheetText(cell.is ?? {});
      } else if (type === 'e') {
        warning = 'excel-cell-error-warning';
      } else if (raw && (!type || type === 'n')) {
        if (scientific.test(raw) || styleId === '11' || styleId === '48' || /[eE][+-]0/.test(pattern)) {
          warning = 'excel-scientific-notation-warning';
        } else if (/^0{2,255}$/.test(pattern) && /^-?\d+$/.test(raw)) {
          value = raw.startsWith('-') ? `-${raw.slice(1).padStart(pattern.length, '0')}` : raw.padStart(pattern.length, '0');
        } else if (identifier) {
          warning = 'excel-numeric-identifier-warning';
        } else if (styleId && styleId !== '0' && !(styleId === '1' && /^-?\d+$/.test(raw))) {
          warning = 'excel-number-format-warning';
        }
      }
      if (!warning && identifier && scientific.test(value)) warning = 'excel-scientific-notation-warning';
      return { value, warning };
    };

    const parseSheet = (name: string, path: string): RosterSheet => {
      const file = xml(path).worksheet;
      if (!file) throw new Error('invalid-xlsx');
      let previousRow = 0;
      const data = (file.sheetData?.row ?? []).map((row) => {
        const cells: (XmlCell | undefined)[] = [];
        const sourceRow = Number(row['@_r']) || Number(row.c?.[0]?.['@_r']?.match(/\d+$/)?.[0]) || previousRow + 1;
        previousRow = sourceRow;
        for (const cell of row.c ?? []) {
          const label = /^([A-Z]{1,3})[1-9]\d*$/.exec(cell['@_r'] ?? '')?.[1];
          const column = label ? [...label].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
          if (column >= sheetLimit || cells[column]) throw new Error('invalid-xlsx');
          cells[column] = cell;
        }
        return { cells, sourceRow };
      }).filter(({ cells }) => cells.some((cell) => cell && (cell.v || cell.is || cell.f !== undefined)));
      const [headerRow, ...rows] = data;
      if (!headerRow) return { name, headers: [], rows: [] };
      const headers = validateHeaders(headerRow.cells.map((cell) => cell ? parseCell(cell).value : undefined));
      return { name, headers, rows: rows.map(({ cells, sourceRow }) => {
        if (cells.slice(headers.length).some((cell) => cell && (cell.v || cell.is || cell.f !== undefined))) throw new Error('invalid-xlsx');
        const warnings: RosterSheet['rows'][number]['warnings'] = [];
        const values = Object.fromEntries(headers.map((column, index) => {
          const cell = cells[index];
          const { value, warning } = cell ? parseCell(cell, column) : { value: '', warning: undefined };
          if (cell && (warning || cell.f !== undefined)) {
            const reference = /^([A-Z]{1,3})([1-9]\d*)$/.exec(cell['@_r'] ?? '');
            const source = { row: reference ? Number(reference[2]) : sourceRow, column: reference?.[1] ?? columnLabel(index) };
            if (warning) warnings.push({ column, source, code: warning });
            if (cell.f !== undefined) {
              warnings.push({ column, source, code: 'excel-formula-warning', formulaHasCachedValue: Boolean(cell.v) });
            }
          }
          return [column, value];
        }));
        return { values, warnings };
      }) };
    };
    return {
      sheetNames,
      readSheet(name = sheetNames[0]!) {
        const existing = decoded.get(name);
        if (existing) return existing;
        const path = visible.get(name);
        if (!path) throw new Error('invalid-xlsx');
        try {
          const sheet = parseSheet(name, path);
          decoded.set(name, sheet);
          return sheet;
        } catch (error) {
          return workbookError(error);
        }
      },
    };
  } catch (error) {
    return workbookError(error);
  }
}
