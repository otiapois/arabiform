import { useEffect, useMemo, useRef, useState } from 'react';
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
  showRow: 'Select row {row}',
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
  showRow: 'اختر الصف {row}',
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
};

const pageSize = 20;
const filters = [
  ['all', 'all'], ['ready', 'ready'], ['flagged', 'flagged'], ['warnings', 'sourceWarnings'],
] as const satisfies readonly (readonly [RowFilter, 'all' | 'ready' | 'flagged' | 'sourceWarnings'])[];

function searchable(value: string) {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
}

export default function Queue({ desk, language }: QueueProps) {
  const { labels, arabic } = language;
  const copy = arabic ? ar : en;
  const [editSession, setEditSession] = useState<{
    sheet: typeof desk.sheet; row: number; revision: number; original: typeof desk.rowEdit;
  }>();
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    function focusQueueSearch(event: KeyboardEvent) {
      const input = searchInput.current;
      if (!input || event.key !== '/' || event.defaultPrevented || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || document.designMode === 'on') return;
      const target = event.target;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (target instanceof Element && target.closest('form, input, textarea, select, [role="textbox"]')) return;
      event.preventDefault();
      input.focus();
    }
    document.addEventListener('keydown', focusQueueSearch);
    return () => document.removeEventListener('keydown', focusQueueSearch);
  }, []);

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
    .filter(({ code }) => code === 'invalid-choice')
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
          <input ref={searchInput} type="search" dir="auto" data-testid="queue-search" aria-keyshortcuts="/"
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
      <div className="table-scroll" tabIndex={0} aria-label={labels.queue}>
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
              return (
                <tr key={index} data-testid="queue-row" data-row={index + 1} data-selected={desk.selected === index}>
                  <th scope="row">
                    <button
                      type="button"
                      className="row-link"
                      aria-label={fillLabel(copy.showRow, { row: index + 1 })}
                      aria-pressed={desk.selected === index}
                      onClick={() => { desk.selectRow(index); setEditSession(undefined); }}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </button>
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
        <section className="row-editor" aria-label={fillLabel(labels.selected, { row: desk.selected + 1 })}
          onKeyDown={(event) => {
            if (!activeEdit || event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            setEditSession(undefined);
            desk.restoreRowEdit(activeEdit.row, activeEdit.original);
            editButton.current?.focus();
          }}>
          <div className="row-editor-head">
            <div className="row-summary">
              <h3>{fillLabel(labels.selected, { row: desk.selected + 1 })}</h3>
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
                        {!current && <option value={value} disabled>{value || labels.blankChoice}</option>}
                        {options.map(({ choice, input }) => (
                          <option key={input} value={input}>{choiceText(choice, labels.blankChoice)}</option>
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
