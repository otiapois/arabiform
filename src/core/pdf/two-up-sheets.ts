export const RECORDS_PER_TWO_UP_SHEET = 2;

export function twoUpSheetCount(recordCount: number): number {
  return Math.ceil(recordCount / RECORDS_PER_TWO_UP_SHEET);
}
