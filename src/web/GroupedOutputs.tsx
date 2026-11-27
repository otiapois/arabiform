import { fillLabel } from './labels';
import type { useWorkbench } from './useWorkbench';
import './grouped-outputs.css';

type Desk = ReturnType<typeof useWorkbench>;

const en = {
  label: 'Group files by column',
  none: 'None (single folder)',
  missing: 'This column is missing from the active roster. Choose an available column or None to enable ZIP export and audits.',
  summary: '{rows} ready rows in {groups} groups. The Clean PDFs ZIP puts each group in its own folder.',
  details: 'Group folders and row counts',
  blank: 'Ready rows with a blank group value go into',
  split: 'Download Split Merged PDFs by Group (.zip)',
};

const ar: typeof en = {
  label: 'تجميع الملفات حسب العمود',
  none: 'بلا تجميع (مجلد واحد)',
  missing: 'هذا العمود غير موجود في الجدول الحالي. اختر عمودًا متاحًا أو «بلا تجميع» لتتمكن من تنزيل ملف ZIP وتقارير الفحص.',
  summary: 'الصفوف الجاهزة: {rows}، المجموعات: {groups}. يضع ملف ZIP كل مجموعة في مجلد مستقل.',
  details: 'مجلدات المجموعات وعدد صفوفها',
  blank: 'تُحفظ الصفوف الجاهزة التي لا تحمل قيمة للمجموعة في مجلد',
  split: 'تنزيل ملفات PDF المدمجة لكل مجموعة (.zip)',
};

export function GroupingControl({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  const copy = arabic ? ar : en;
  return (
    <>
      <label className="full-control">
        {copy.label}
        <select data-testid="group-by-column" value={desk.groupByColumn ?? ''} disabled={desk.exporting}
          aria-invalid={desk.groupingBlocked || undefined}
          aria-describedby={desk.groupingBlocked ? 'grouping-column-missing' : undefined}
          onChange={(event) => desk.changeGrouping(event.currentTarget.value || null)}>
          <option value="">{copy.none}</option>
          {desk.groupingBlocked && <option value={desk.groupByColumn!} dir="auto" disabled>{desk.groupByColumn}</option>}
          {desk.sheet?.headers.map((header) => <option key={header} value={header} dir="auto">{header}</option>)}
        </select>
      </label>
      {desk.groupingBlocked && <p role="alert" className="alert" id="grouping-column-missing" data-testid="grouping-column-missing">{copy.missing}</p>}
    </>
  );
}

export function GroupedSummary({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  const copy = arabic ? ar : en;
  const scope = new Set(desk.exportScope.selectedRowNumbers);
  const groups = desk.grouping!.groups.flatMap((group) => {
    const count = group.rowNumbers.filter((row) => scope.has(row)).length;
    return count ? [{ ...group, count }] : [];
  });
  const blank = groups.find(({ groupValue }) => groupValue === null);
  return (
    <div className="grouped-summary" data-testid="grouped-export-summary">
      <p role="status">{fillLabel(copy.summary, { rows: scope.size, groups: groups.length })}</p>
      {blank && <p>{copy.blank}{' '}<bdi dir="ltr">{blank.folder}</bdi>.</p>}
      {groups.length > 0 && (
        <details>
          <summary>{copy.details}</summary>
          <ul>
            {groups.map(({ folder, groupValue, count }) => (
              <li key={folder}>
                {groupValue !== null && <><bdi dir="auto">{groupValue}</bdi>{' → '}</>}
                <bdi dir="auto">{folder}</bdi>{' · '}{count}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function SplitDownload({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  return (
    <button type="button" className="button secondary split-download" data-testid="download-split"
      disabled={!desk.exportCount || desk.exporting || desk.printSettingsBlocked} onClick={() => desk.download('split')}>
      {(arabic ? ar : en).split}
    </button>
  );
}
