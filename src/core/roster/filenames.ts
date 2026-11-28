import type { RosterRow } from './index';
import { escapeSpreadsheetCell } from './spreadsheet-csv';
import { resolveVirtualColumn, VIRTUAL_COLUMNS, type VirtualColumnId } from './virtual-columns';

const illegal = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/;
export const DEFAULT_FILENAME_PATTERN = '{{ID}}-{{Name}}.pdf';
const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const physicalTokens = /\{\{\s*([^{}]+?)\s*\}\}/g;
const allTokens = new RegExp(`${physicalTokens.source}|\\[\\[@(${VIRTUAL_COLUMNS.join('|')})\\]\\]`, 'g');

export function physicalFilenameColumns(pattern: string): string[] {
  return Array.from(pattern.matchAll(physicalTokens), (match) => match[1]!);
}

export function hasVirtualFilenameToken(pattern: string): boolean {
  for (const match of pattern.matchAll(allTokens)) if (match[2]) return true;
  return false;
}

export function filenameKey(filename: string): string {
  return filename.normalize('NFKC').toUpperCase().normalize('NFKC');
}

function reservedStem(stem: string) {
  return reserved.test(filenameKey(stem).split('.')[0]!.trimEnd());
}

export function isSafePdfFilename(filename: string): boolean {
  if (!/\.pdf$/i.test(filename) || encoder.encode(filename).length > 255 || illegal.test(filename)) return false;
  const stem = filename.slice(0, -4);
  const comparable = filenameKey(stem);
  return !!comparable && !illegal.test(comparable) && !/^[.\s]|[.\s]$/u.test(comparable) && !reservedStem(comparable);
}

export type FilenamePlan = { filename: string } & (
  | { filenameAdjusted: false; filenameAdjustReason?: never }
  | { filenameAdjusted: true; filenameAdjustReason: 'sanitized' | 'reserved-name' | 'collision-dedup' }
);

export function planFilenames(
  rows: readonly (Record<string, string> | RosterRow)[], pattern = DEFAULT_FILENAME_PATTERN, context?: { localDate: string },
  scope?: { folders?: readonly string[]; spreadsheetSafe?: boolean },
): FilenamePlan[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const values = Array.isArray(row.warnings) ? (row as RosterRow).values : row as Record<string, string>;
    const requested = pattern.replace(allTokens, (token: string, physical: string | undefined, virtual: VirtualColumnId | undefined) => {
      if (virtual) return context ? resolveVirtualColumn(virtual, index + 1, context.localDate) : token;
      return physical !== undefined && Object.hasOwn(values, physical) ? values[physical] ?? '' : '';
    });
    const trimmed = requested.trimEnd();
    const raw = trimmed.replace(/\.pdf$/i, '');
    const characters = Array.from(raw, (character) => illegal.test(character) || illegal.test(character.normalize('NFKC')) ? '' : character);
    const stem = characters.join('').normalize('NFC').replace(/^[.\s-]+|[.\s-]+$/gu, '');
    let base = '';
    let length = 0;
    for (const { segment } of graphemes.segment(stem)) {
      length += encoder.encode(segment).length;
      if (length > 180) break;
      base += segment;
    }
    base = base.replace(/[.\s]+$/u, '');
    const reservedName = reservedStem(base);
    if (reservedName) base = `_${base}`;
    if (scope?.spreadsheetSafe && escapeSpreadsheetCell(base) !== base) base = '_' + base;
    if (!isSafePdfFilename(`${base}.pdf`)) base = `row-${index + 1}`;
    const candidate = `${base}.pdf`;
    let filename = candidate;
    let suffix = 2;
    const folder = scope?.folders ? `${filenameKey(scope.folders[index]!)}\0` : '';
    while (seen.has(folder + filenameKey(filename))) filename = `${base}-${suffix++}.pdf`;
    seen.add(folder + filenameKey(filename));
    if (filename !== candidate) return { filename, filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' };
    if (reservedName) return { filename, filenameAdjusted: true, filenameAdjustReason: 'reserved-name' };
    if (base !== raw || trimmed !== requested) return { filename, filenameAdjusted: true, filenameAdjustReason: 'sanitized' };
    return { filename, filenameAdjusted: false };
  });
}

export function makeFilenames(rows: readonly (Record<string, string> | RosterRow)[], pattern = defaultPattern, context?: { localDate: string }): string[] {
  return planFilenames(rows, pattern, context).map(({ filename }) => filename);
}
