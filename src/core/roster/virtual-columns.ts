export const VIRTUAL_COLUMNS = ['ROW_INDEX', 'PADDED_ROW_001', 'TODAY_ISO', 'TODAY_AR'] as const;
export type VirtualColumnId = typeof VIRTUAL_COLUMNS[number];
export type VirtualColumnMapping = { column: VirtualColumnId; template?: string };

export function isVirtualColumnId(value: unknown): value is VirtualColumnId {
  return VIRTUAL_COLUMNS.some((column) => column === value);
}

export function virtualFilenameToken(column: VirtualColumnId): string {
  return `[[@${column}]]`;
}

export function localVirtualDate(date: Date): string {
  return [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function resolveVirtualColumn(column: VirtualColumnId, rowNumber: number, localDate: string): string {
  switch (column) {
    case 'ROW_INDEX': return String(rowNumber);
    case 'PADDED_ROW_001': return String(rowNumber).padStart(4, '0');
    case 'TODAY_ISO': return localDate;
    case 'TODAY_AR': return localDate.replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]!);
  }
}

export function resolveVirtualMapping({ column, template }: VirtualColumnMapping, rowNumber: number, localDate: string): string {
  const value = resolveVirtualColumn(column, rowNumber, localDate);
  return template?.replace(`{{${column}}}`, () => value) ?? value;
}

export function validateVirtualTemplate(column: VirtualColumnId, pattern: string): boolean {
  const token = `{{${column}}}`;
  const index = pattern.indexOf(token);
  if (index < 0) return false;
  const prefix = pattern.slice(0, index);
  const suffix = pattern.slice(index + token.length);
  const tokenDelimiters = /\{\{|\}\}/;
  return !prefix.endsWith('{') && !suffix.startsWith('}') && !tokenDelimiters.test(prefix) && !tokenDelimiters.test(suffix);
}
