import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { suggestBatchFontSize } from '../core/pdf/batch-font-suggestion';
import { matchChoice } from '../core/pdf/choice-match';
import { choiceText, editableChoices } from './Choices';
import { Diagnostics, diagnosticProblem, diagnosticText, safeRowMinSize } from './Diagnostics';
import { Filename } from './Filename';
import { fillLabel, type translator } from './labels';
import type { RowFilter, TemplateInfo, useWorkbench } from './useWorkbench';

const en = {
  openPreview: 'View PDF preview',
  waiting: 'Awaiting preflight',
  filter: 'Filter rows',
  all: 'All',
  queueSearch: 'Search rows',
  queueSearchHint: 'Row number, filename or cell value',
  queuePage: '{first}–{last} of {total} matching rows',
  queuePrev: 'Previous rows',
  queueNext: 'Next rows',
  filterEmpty: 'No rows match this filter.',
  row: 'Row',
  queueTable: 'Roster rows',
  showRow: 'Select row {row}',
  includeRow: 'Include row {row} in export',
  selectFilteredReady: 'Select filtered ready',
  clearSelection: 'Clear selection',
  useAllReady: 'Use all ready',
  selection: 'Export row selection',
  editRow: 'Edit row {row}',
  filename: 'Filename',
  filenameAdjusted: 'Filename adjusted',
  filenameSanitized: 'The name was cleaned up to make a valid filename.',
  filenameReserved: 'The name was changed because Windows reserves it.',
  filenameCollision: 'A number was added because another row uses this name.',
  status: 'Status',
  issues: 'Review',
  noIssues: '—',
  done: 'Done editing',
  cleanRow: 'The mapped values fit the PDF fields.',
  unresolved: 'Edits are being checked.',
  fixSize: 'Set min font to {size} pt',
  fixBatchOne: 'Set min font to {size} pt to fix 1 row',
  fixBatchMany: 'Set min font to {size} pt to fix {count} rows',
  warningHelp: 'Excel may have changed this data before import. Compare the value with the original record and edit it here if needed.',
  formulaCached: 'Excel stored a result for this formula. Verify that it is current.',
  formulaUncached: 'This Excel formula has no stored result. Enter a verified value if needed.',
};

const ar: typeof en = {
  openPreview: 'عرض معاينة PDF',
  waiting: 'بانتظار الفحص',
  filter: 'تصفية الصفوف',
  all: 'الكل',
  queueSearch: 'ابحث في الصفوف',
  queueSearchHint: 'رقم الصف أو اسم الملف أو قيمة الخلية',
  queuePage: 'الصفوف المطابقة من {first} إلى {last} من أصل {total}',
  queuePrev: 'الصفوف السابقة',
  queueNext: 'الصفوف التالية',
  filterEmpty: 'لا توجد صفوف تطابق هذه التصفية.',
  row: 'الصف',
  queueTable: 'صفوف جدول البيانات',
  showRow: 'اختر الصف {row}',
  includeRow: 'أدرج الصف {row} في التصدير',
  selectFilteredReady: 'حدّد الصفوف الجاهزة المطابقة',
  clearSelection: 'امسح التحديد',
  useAllReady: 'استخدم كل الصفوف الجاهزة',
  selection: 'تحديد الصفوف للتصدير',
  editRow: 'عدّل الصف {row}',
  filename: 'اسم الملف',
  filenameAdjusted: 'تم تعديل اسم الملف',
  filenameSanitized: 'نُقّح الاسم ليصلح للاستخدام كاسم ملف.',
  filenameReserved: 'تغيّر الاسم لأنه من الأسماء المحجوزة في Windows.',
  filenameCollision: 'أُضيف رقم لأن صفًا آخر يستخدم الاسم نفسه.',
  status: 'الحالة',
  issues: 'المراجعة',
  noIssues: '—',
  done: 'تمّ التعديل',
  cleanRow: 'تتسع حقول PDF للقيم المرتبطة بها.',
  unresolved: 'جارٍ فحص التعديلات.',
  fixSize: 'اضبط الحد الأدنى للخط على {size} نقطة',
  fixBatchOne: 'اضبط الحد الأدنى للخط على {size} نقطة لإصلاح صف واحد',
  fixBatchMany: 'اضبط الحد الأدنى للخط على {size} نقطة لإصلاح {count} من الصفوف',
  warningHelp: 'ربما غيّر Excel هذه البيانات قبل استيرادها. قارن القيمة بالسجل الأصلي وعدّلها هنا عند الحاجة.',
  formulaCached: 'حفظ Excel نتيجة لهذه الصيغة. تحقّق من أنها محدثة.',
  formulaUncached: 'لا توجد نتيجة محفوظة لهذه الصيغة في Excel. أدخل قيمة موثوقة عند الحاجة.',
};

type QueueProps = {
  desk: ReturnType<typeof useWorkbench>;
  language: ReturnType<typeof translator>;
  characterKeys: boolean;
};

const pageSize = 20;
const filters = [
  ['all', 'all'], ['ready', 'ready'], ['flagged', 'flagged'], ['warnings', 'sourceWarnings'],
] as const satisfies readonly (readonly [RowFilter, 'all' | 'ready' | 'flagged' | 'sourceWarnings'])[];

function searchable(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
}

export default function Queue({ desk, language, characterKeys }: QueueProps) {
  const { labels, arabic } = language;
  const fieldLabels = activeFillLabels(arabic);
  const copy = arabic ? ar : en;
  const [editSession, setEditSession] = useState<{
    sheet: typeof desk.sheet; row: number; revision: number; original: typeof desk.rowEdit;
  }>();
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const tableRegion = useRef<HTMLDivElement>(null);
  const nextFocusRow = useRef<number>(undefined);
  const selectFilteredButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const checkedRows = useMemo(() => new Set(desk.rowSelection === 'all-ready' ? [] : desk.rowSelection), [desk.rowSelection]);
  const activeEdit = editSession?.sheet === desk.sheet && editSession?.row === desk.selected
    && editSession.revision === desk.cellRevision ? editSession : undefined;
  const editing = activeEdit !== undefined;
  const row = desk.rows[desk.selected];
  const result = desk.results?.[desk.selected];
  const adjustmentReasons = {
    sanitized: copy.filenameSanitized,
    'reserved-name': copy.filenameReserved,
    'collision-dedup': copy.filenameCollision,
  };

  function beginEdit() {
    setEditSession({ sheet: desk.sheet, row: desk.selected, revision: desk.cellRevision, original: desk.rowEdit });
  }

  function updateCell(column: string, value: string) {
    if (!editing) beginEdit();
    desk.editCell(desk.selected, column, value);
  }

  const fieldsByColumn = useMemo(() => {
    const fields = new Map<string, TemplateInfo['fields'][number] | undefined>();
    for (const field of desk.fields) {
      const column = desk.mapping[field.name];
      if (column) fields.set(column, fields.has(column) ? undefined : field);
    }
    return fields;
  }, [desk.mapping, desk.fields]);
  const invalidChoiceColumns = new Set(result?.diagnostics
    .filter(({ code, ruleIndex }) => code === 'invalid-choice' && ruleIndex === undefined)
    .map(({ field }) => desk.mapping[field]));
  const safeSize = result?.status === 'flagged' ? safeRowMinSize(result.diagnostics, desk.minFontSize) : undefined;
  const batchSize = useMemo(() => desk.results && suggestBatchFontSize(desk.results, desk.minFontSize),
    [desk.results, desk.minFontSize]);
  const searchIndex = useMemo(() => desk.rows.map(({ values }, i) =>
    searchable([desk.filenamePlans[i]!.filename, ...Object.values(values)].join('\0'))), [desk.rows, desk.filenamePlans]);
  const matches = useMemo(() => {
    const query = searchable(search.trim());
    const rowNumber = Number(query.match(/^(?:(?:row|الصف)\s+|#)?([0-9]+)$/u)?.[1]);
    return desk.rows.flatMap((source, i) => {
      const status = desk.results?.[i]?.status;
      const filterMatches = desk.filter === 'all'
        || (desk.filter === 'ready' && status === 'pass')
        || (desk.filter === 'flagged' && status === 'flagged')
        || (desk.filter === 'warnings' && source.warnings.length > 0);
      return filterMatches && (!query || rowNumber === i + 1 || searchIndex[i]!.includes(query)) ? [i] : [];
    });
  }, [desk.rows, desk.results, desk.filter, searchIndex, search]);
  const pageCount = Math.ceil(matches.length / pageSize);
  const page = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const firstMatch = page * pageSize;
  const visibleRows = matches.slice(firstMatch, firstMatch + pageSize);

  function focusRow(index: number) {
    tableRegion.current?.querySelector<HTMLButtonElement>(`[data-row="${index + 1}"] .row-link`)?.focus();
  }

  useLayoutEffect(() => {
    if (nextFocusRow.current === undefined) return;
    focusRow(nextFocusRow.current);
    nextFocusRow.current = undefined;
  }, [page]);

  function navigateRows(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !visibleRows.length
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const focusedRow = (event.target as Element).closest<HTMLElement>('[data-row]');
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const position = focusedRow ? matches.indexOf(Number(focusedRow.dataset.row) - 1) + direction
      : visibleRows.includes(desk.selected) ? matches.indexOf(desk.selected)
      : direction === 1 ? firstMatch : firstMatch + visibleRows.length - 1;
    event.preventDefault();
    const nextRow = matches[position];
    if (nextRow === undefined) return;
    desk.selectRow(nextRow);
    setEditSession(undefined);
    const nextPage = Math.floor(position / pageSize);
    if (nextPage === page) focusRow(nextRow);
    else {
      nextFocusRow.current = nextRow;
      setPageIndex(nextPage);
    }
  }

  return (
    <>
      {batchSize && (
        <div className="batch-font-suggestion actions compact">
          <button type="button" className="button secondary" data-testid="apply-batch-min-font"
            disabled={desk.exporting} onClick={() => desk.changeSize(batchSize.minFontSizePt)}>
            {fillLabel(batchSize.fixableRows === 1 ? copy.fixBatchOne : copy.fixBatchMany,
              { size: batchSize.minFontSizePt, count: batchSize.fixableRows })}
          </button>
        </div>
      )}
      <div className="queue-controls">
        <label className="queue-search">
          <span className="sr-only">{copy.queueSearch}</span>
          <input id="queue-search" type="search" dir="auto" data-testid="queue-search" aria-keyshortcuts={characterKeys ? '/' : undefined}
            placeholder={copy.queueSearchHint} value={search}
            onChange={(event) => { setSearch(event.currentTarget.value); setPageIndex(0); }} />
        </label>
        <div className="filter-chips" role="group" aria-label={copy.filter}>
          {filters.map(([filter, label]) => (
            <button type="button" className="filter-chip" key={filter} data-testid={`queue-filter-${filter}`}
              aria-pressed={desk.filter === filter} onClick={() => { desk.setFilter(filter); setPageIndex(0); }}>
              {label === 'all' ? copy.all : labels[label]}
            </button>
          ))}
        </div>
      </div>
      <div className="queue-selection actions compact" role="group" aria-label={copy.selection}>
        <button ref={selectFilteredButton} type="button" className="button secondary" data-testid="select-filtered-ready"
          disabled={!desk.results || desk.exporting}
          onClick={() => desk.changeRowSelection(matches.filter((index) => desk.results?.[index]?.status === 'pass').map((index) => index + 1))}>
          {copy.selectFilteredReady}
        </button>
        <button type="button" className="button secondary" data-testid="clear-selection"
          disabled={desk.rowSelection === 'all-ready' || desk.exporting} onClick={() => desk.changeRowSelection([])}>
          {copy.clearSelection}
        </button>
        {desk.rowSelection !== 'all-ready' && (
          <button type="button" className="text-button" data-testid="use-all-ready" disabled={desk.exporting}
            onClick={() => {
              if (selectFilteredButton.current?.disabled) tableRegion.current?.focus();
              else selectFilteredButton.current?.focus();
              desk.changeRowSelection('all-ready');
            }}>{copy.useAllReady}</button>
        )}
      </div>
      <div className="table-scroll" ref={tableRegion} role="region" tabIndex={0} aria-label={copy.queueTable}
        aria-keyshortcuts="ArrowUp ArrowDown" onKeyDown={navigateRows}>
        <table>
          <thead><tr><th scope="col">{copy.row}</th><th scope="col">{copy.filename}</th><th scope="col">{copy.status}</th><th scope="col">{copy.issues}</th></tr></thead>
          <tbody>
            {visibleRows.map((index) => {
              const source = desk.rows[index]!;
              const result = desk.results?.[index];
              const filenamePlan = result ?? desk.filenamePlans[index]!;
              const adjustmentReason = filenamePlan.filenameAdjusted
                ? adjustmentReasons[filenamePlan.filenameAdjustReason] : undefined;
              const issue = result?.diagnostics[0];
              const rowNumber = index + 1;
              const checked = checkedRows.has(rowNumber);
              return (
                <tr key={index} data-testid="queue-row" data-row={rowNumber} data-selected={desk.selected === index}>
                  <th scope="row">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-link"
                        aria-label={fillLabel(copy.showRow, { row: rowNumber })}
                        aria-pressed={desk.selected === index}
                        onClick={() => { desk.selectRow(index); setEditSession(undefined); }}
                      >
                        {String(rowNumber).padStart(2, '0')}
                      </button>
                      <label className="row-export-check">
                        <input type="checkbox" data-testid="queue-row-select" checked={checked}
                          aria-label={fillLabel(copy.includeRow, { row: rowNumber })}
                          disabled={desk.exporting || !desk.results || (!checked && result?.status !== 'pass')}
                          onChange={(event) => desk.changeRowSelection(event.currentTarget.checked
                            ? [...checkedRows, rowNumber] : [...checkedRows].filter((selected) => selected !== rowNumber))} />
                      </label>
                    </div>
                  </th>
                  <td>
                    <Filename name={filenamePlan.filename} />
                    {adjustmentReason && (
                      <details className="filename-adjustment">
                        <summary className="tag" data-testid="filename-adjusted" title={adjustmentReason}>{copy.filenameAdjusted}</summary>
                        <p>{adjustmentReason}</p>
                      </details>
                    )}
                  </td>
                  <td><span className={`tag tag-${result?.status ?? 'pending'}`}>{!result ? copy.waiting : result.status === 'pass' ? labels.ready : labels.flagged}</span></td>
                  <td className="review-cell">
                    {issue && (
                      <>
                        <bdi dir="auto">{issue.field}</bdi>{' · '}{diagnosticText(issue, desk.minFontSize, language)}
                      </>
                    )}
                    {!result?.diagnostics.length && source.warnings.length === 0 && copy.noIssues}
                    {source.warnings.length > 0 && <span className="source-marker">{labels.sourceWarnings}</span>}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td className="quiet" colSpan={4}>{copy.filterEmpty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {matches.length > pageSize && (
        <div className="queue-pagination">
          <p data-testid="queue-page">{fillLabel(copy.queuePage, {
            first: firstMatch + 1, last: firstMatch + visibleRows.length, total: matches.length,
          })}</p>
          <div className="actions compact">
            <button type="button" className="button secondary" data-testid="queue-prev-page" disabled={page === 0}
              onClick={() => setPageIndex(page - 1)}>{copy.queuePrev}</button>
            <button type="button" className="button secondary" data-testid="queue-next-page" disabled={page + 1 === pageCount}
              onClick={() => setPageIndex(page + 1)}>{copy.queueNext}</button>
          </div>
        </div>
      )}
      {row && (
        <section className="row-editor" aria-label={fillLabel(fieldLabels.selected, { row: desk.selected + 1 })}
          onKeyDown={(event) => {
            if (!activeEdit || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            setEditSession(undefined);
            desk.restoreRowEdit(activeEdit.row, activeEdit.original);
            editButton.current?.focus();
          }}>
          <div className="row-editor-head">
            <div className="row-summary">
              <h3>{fillLabel(fieldLabels.selected, { row: desk.selected + 1 })}</h3>
              <Filename name={desk.filenamePlans[desk.selected]!.filename} />
              {result?.status === 'pass' && <p>{copy.cleanRow}</p>}
              {desk.checking && <p>{copy.unresolved}</p>}
            </div>
            <div className="actions compact">
              {desk.template && <a className="button secondary preview-jump" href="#preview">{copy.openPreview}</a>}
              {safeSize !== undefined && (
                <button type="button" className="button secondary" data-testid="apply-min-font" onClick={() => desk.changeSize(safeSize)}>
                  {fillLabel(copy.fixSize, { size: safeSize })}
                </button>
              )}
              <button
                ref={editButton}
                type="button"
                className="button secondary"
                aria-expanded={editing}
                aria-controls="edit-cells"
                aria-keyshortcuts={editing ? 'Escape' : undefined}
                onClick={editing ? () => setEditSession(undefined) : beginEdit}
              >
                {editing ? copy.done : fillLabel(copy.editRow, { row: desk.selected + 1 })}
              </button>
            </div>
          </div>
          {!!result?.diagnostics.length && (
            <Diagnostics issues={result.diagnostics} minSize={desk.minFontSize} language={language} testId="selected-diagnostics" />
          )}
          {row.warnings.length > 0 && (
            <div className="source-details">
              <p>{copy.warningHelp}</p>
              <ul>
                {row.warnings.map((warning, index) => (
                  <li key={index}>
                    <bdi>{warning.column}</bdi>
                    {warning.source && <> (<bdi dir="ltr">{warning.source.column}{warning.source.row}</bdi>)</>}
                    {' · '}{warning.code === 'excel-formula-warning'
                      ? (warning.formulaHasCachedValue ? copy.formulaCached : copy.formulaUncached)
                      : diagnosticProblem(warning.code, language) ?? labels.sourceWarnings}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div id="edit-cells" className="edit-cells" hidden={!editing && invalidChoiceColumns.size === 0}>
            {desk.sheet?.headers.map((column) => {
              const invalid = invalidChoiceColumns.has(column);
              if (!editing && !invalid) return null;
              const value = row.values[column] ?? '';
              const choices = fieldsByColumn.get(column)?.choices ?? [];
              const options = editableChoices(choices);
              const match = matchChoice(choices, value);
              const current = options.find(({ index }) => index === match);
              return (
                <label key={column}>
                  <bdi>{column}</bdi>
                  {options.length
                    ? (
                      <select
                        dir="auto"
                        data-testid="roster-choice"
                        data-roster-column={column}
                        aria-invalid={invalid || undefined}
                        value={current?.input ?? value}
                        onChange={(event) => updateCell(column, event.currentTarget.value)}
                      >
                        {!current && <option value={value} disabled>{value || fieldLabels.blankChoice}</option>}
                        {options.map(({ choice, input }) => (
                          <option key={input} value={input}>{choiceText(choice, fieldLabels.blankChoice)}</option>
                        ))}
                      </select>
                    )
                    : (
                      <textarea
                        dir="auto"
                        rows={2}
                        data-testid="roster-cell"
                        aria-invalid={invalid || undefined}
                        value={value}
                        onChange={(event) => updateCell(column, event.currentTarget.value)}
                      />
                    )}
                </label>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
import { activeFillLabels } from './active-fill-labels';
