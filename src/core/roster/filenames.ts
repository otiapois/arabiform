import type { RosterRow } from './index';

const illegal = /[\\/:*?"<>|\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/;
const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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

export function makeFilenames(rows: readonly (Record<string, string> | RosterRow)[], pattern = '{{ID}}-{{Name}}.pdf'): string[] {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const values = Array.isArray(row.warnings) ? (row as RosterRow).values : row as Record<string, string>;
    const raw = pattern.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, token: string) => Object.hasOwn(values, token) ? values[token] ?? '' : '')
      .trimEnd().replace(/\.pdf$/i, '');
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
    if (reservedStem(base)) base = `_${base}`;
    if (!isSafePdfFilename(`${base}.pdf`)) base = `row-${index + 1}`;
    let filename = `${base}.pdf`;
    let suffix = 2;
    while (seen.has(filenameKey(filename))) filename = `${base}-${suffix++}.pdf`;
    seen.add(filenameKey(filename));
    return filename;
  });
}
