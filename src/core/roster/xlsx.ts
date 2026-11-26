import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { RosterSheet, RosterWarningCode } from './index';

interface XmlRelationship { '@_Id': string; '@_Target': string; '@_Type': string; '@_TargetMode'?: string }
interface XmlSheet { '@_name': string; '@_id': string }
interface XmlText { '#text'?: string }
interface XmlString { t?: string | XmlText; r?: { t?: string | XmlText }[] }
interface XmlCell {
  '@_r': string;
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
  worksheet?: { sheetData?: { row?: { c?: XmlCell[] }[] } };
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

export function readWorkbook(
  bytes: Uint8Array,
  validateHeaders: (cells: readonly (string | undefined)[]) => string[],
  aliasGroups: string[][],
  normalize: (text: string) => string,
): RosterSheet[] {
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
    const links = xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship ?? [];
    const strings = (xml('xl/sharedStrings.xml').sst?.si ?? []).map(spreadsheetText);
    const styles = xml('xl/styles.xml').styleSheet;
    const formats = new Map(styles?.numFmts?.numFmt?.map((format) => [format['@_numFmtId'], format['@_formatCode']]));
    const styleFormats = styles?.cellXfs?.xf?.map((style) => style['@_numFmtId']) ?? [];

    const parseCell = (cell: XmlCell, header = ''): { value: string; warning?: RosterWarningCode } => {
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
      if (!warning && cell.f !== undefined) warning = 'excel-formula-warning';
      return { value, warning };
    };

    const result: RosterSheet[] = [];
    for (const sheet of sheets) {
      const link = links.find((relation) => relation['@_Id'] === sheet['@_id']);
      if (!link || link['@_TargetMode'] === 'External') throw new Error('invalid-xlsx');
      if (!link['@_Type'].endsWith('/worksheet')) continue;
      const file = xml(archivePath(link['@_Target'])).worksheet;
      if (!file) throw new Error('invalid-xlsx');
      const data = (file.sheetData?.row ?? []).map((row) => {
        const cells: (XmlCell | undefined)[] = [];
        for (const cell of row.c ?? []) {
          const label = /^([A-Z]{1,3})[1-9]\d*$/.exec(cell['@_r'])?.[1];
          const column = label ? [...label].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
          if (column >= sheetLimit || cells[column]) throw new Error('invalid-xlsx');
          cells[column] = cell;
        }
        return cells;
      }).filter((row) => row.some((cell) => cell && (cell.v || cell.is || cell.f !== undefined)));
      const [headerRow, ...rows] = data;
      if (!headerRow) {
        result.push({ name: sheet['@_name'], headers: [], rows: [] });
        continue;
      }
      const headers = validateHeaders(headerRow.map((cell) => cell ? parseCell(cell).value : undefined));
      result.push({ name: sheet['@_name'], headers, rows: rows.map((cells) => {
        if (cells.slice(headers.length).some((cell) => cell && (cell.v || cell.is || cell.f !== undefined))) throw new Error('invalid-xlsx');
        const warnings: RosterSheet['rows'][number]['warnings'] = [];
        const values = Object.fromEntries(headers.map((column, index) => {
          const cell = cells[index];
          const { value, warning } = cell ? parseCell(cell, column) : { value: '', warning: undefined };
          if (warning) warnings.push({ column, code: warning });
          return [column, value];
        }));
        return { values, warnings };
      }) });
    }
    if (!result.length) throw new Error('invalid-xlsx');
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid-roster-headers') throw error;
    throw new Error('invalid-xlsx', { cause: error });
  }
}
