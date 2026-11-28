export type Imposition = '1-up' | '2-up' | '4-up';
export type ImpositionUnavailableReason = 'imposition-requires-single-page' | 'imposition-invalid-page-geometry' | 'imposition-unsupported-print-annotation';

export interface FourUpOptions {
  fourUpOrder: 'sequential' | 'cut-and-stack';
  centerCutGuides: boolean;
}

export function validateFourUpOptions({ fourUpOrder, centerCutGuides }: { fourUpOrder?: unknown; centerCutGuides?: unknown }): FourUpOptions | undefined {
  if ((fourUpOrder !== 'sequential' && fourUpOrder !== 'cut-and-stack') || typeof centerCutGuides !== 'boolean') return undefined;
  return { fourUpOrder, centerCutGuides };
}

export function isImposition(value: unknown): value is Imposition {
  return value === '1-up' || value === '2-up' || value === '4-up';
}

export function fourUpOptionsFor(imposition: Imposition, fourUp?: FourUpOptions) {
  if (imposition !== '4-up' || fourUp === undefined) return undefined;
  const options = fourUp && validateFourUpOptions(fourUp);
  if (!options) throw new Error('imposition-invalid-4-up-options');
  return options;
}

export function recordsPerSheet(imposition: Imposition) {
  return imposition === '4-up' ? 4 : imposition === '2-up' ? 2 : 1;
}

export function recordSheetCount(recordCount: number, imposition: Imposition) {
  return Math.ceil(recordCount / recordsPerSheet(imposition));
}

// Sheet and slot indices are zero-based. Piles are lifted in slot order.
export function recordAtSlot(sheet: number, slot: number, sheetCount: number, imposition: Imposition, fourUp?: FourUpOptions) {
  return imposition === '4-up' && fourUp?.fourUpOrder === 'cut-and-stack'
    ? slot * sheetCount + sheet : sheet * recordsPerSheet(imposition) + slot;
}

export function sheetForRecord(index: number, recordCount: number, imposition: Imposition, fourUp?: FourUpOptions) {
  return imposition === '4-up' && fourUp?.fourUpOrder === 'cut-and-stack'
    ? index % recordSheetCount(recordCount, imposition) : Math.floor(index / recordsPerSheet(imposition));
}
