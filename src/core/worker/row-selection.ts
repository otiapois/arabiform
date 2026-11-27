export type RowSelection = 'all-ready' | readonly number[];

export interface ExportScope {
  exportScope: 'all-ready' | 'selected-subset';
  selectedRowNumbers: number[];
}

export function resolveRowSelection(
  rows: readonly { status: 'pass' | 'flagged' }[], rowSelection: RowSelection = 'all-ready',
): ExportScope {
  const requested = rowSelection === 'all-ready' ? undefined : new Set(rowSelection);
  const selectedRowNumbers: number[] = [];
  for (const [index, { status }] of rows.entries()) {
    const rowNumber = index + 1;
    if (status === 'pass' && (!requested || requested.has(rowNumber))) selectedRowNumbers.push(rowNumber);
  }
  return { exportScope: requested ? 'selected-subset' : 'all-ready', selectedRowNumbers };
}
