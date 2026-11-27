import { matchChoice, type FieldChoice } from '../pdf/choice-match';

type SpotlightField = { name: string; kind: 'text' | 'dropdown' | 'checkbox' | 'radio'; choices?: readonly FieldChoice[] };
type SpotlightResult = { status: 'pass' | 'flagged'; smallestInkFontSizePt?: number };

export interface BoundaryRowSpotlight {
  longestMappedTextRow?: number;
  smallestFontRow?: number;
  firstFlaggedRow?: number;
  shortestMappedTextRow?: number;
}

/**
 * Use original 1-based row positions. Length is the longest nonblank mapped
 * text value per row, measured in Unicode code points after trimming the edges.
 * Internal separators and combining marks count; ties keep the earliest row.
 * Dropdowns use the matched display label. Buttons do not paint mapped text.
 */
export function selectBoundaryRows(
  mappedRows: readonly Readonly<Record<string, string>>[], results: readonly SpotlightResult[], fields: readonly SpotlightField[],
): BoundaryRowSpotlight {
  const spotlight: BoundaryRowSpotlight = {};
  let longest = 0;
  let shortest = Infinity;
  let smallest = Infinity;
  const textFields = fields.filter(({ kind }) => kind === 'text' || kind === 'dropdown');
  for (const [index, result] of results.entries()) {
    const rowNumber = index + 1;
    const row = mappedRows[index]!;
    let length = 0;
    for (const { name, choices } of textFields) {
      if (!Object.hasOwn(row, name)) continue;
      const value = row[name]!;
      const choice = choices && matchChoice(choices, value);
      const text = choices ? choice === undefined ? '' : choices[choice]!.label : value;
      let count = 0;
      for (const _ of text.trim()) count++;
      length = Math.max(length, count);
    }
    if (length > longest) {
      longest = length;
      spotlight.longestMappedTextRow = rowNumber;
    }
    if (length > 0 && length < shortest) {
      shortest = length;
      spotlight.shortestMappedTextRow = rowNumber;
    }
    if (result.status === 'flagged') {
      spotlight.firstFlaggedRow ??= rowNumber;
    } else if (result.smallestInkFontSizePt !== undefined && result.smallestInkFontSizePt < smallest) {
      smallest = result.smallestInkFontSizePt;
      spotlight.smallestFontRow = rowNumber;
    }
  }
  return spotlight;
}
