export function escapeSpreadsheetCell(value: string): string {
  return /^[\t\r\n]|^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value.normalize('NFKC')) ? `'${value}` : value;
}
