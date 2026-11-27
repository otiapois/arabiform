import { useState } from 'react';
import type { ApprovalSealSettings } from '../core/pdf/approval-seal-settings';
import { printProblem } from './ExportError';
import type { useWorkbench } from './useWorkbench';
import './print-formatting.css';

const en = {
  title: 'Official approval seal (optional)', enable: 'Add official approval seal', clear: 'Clear seal',
  labelEn: 'English label', labelAr: 'Arabic label', issueDate: 'Issue date', corner: 'Corner',
  scope: 'Appears in the record preview, printable PDFs and flattened ZIP copies.',
  invalid: 'Enter both labels (up to 32 characters each) and a valid issue date to save settings or print.',
  waiting: 'The seal will appear after a ready row is available.',
  checking: 'Checking the seal on the current PDF…',
  other: 'The printed preview is unavailable. Review the print settings.',
  field: 'Field', page: 'Page',
};

const ar: typeof en = {
  title: 'ختم الاعتماد الرسمي (اختياري)', enable: 'إضافة ختم الاعتماد الرسمي', clear: 'مسح الختم',
  labelEn: 'الاسم بالإنجليزية', labelAr: 'الاسم بالعربية', issueDate: 'تاريخ الإصدار', corner: 'الزاوية',
  scope: 'يظهر الختم في معاينة السجل وملفات PDF المخصصة للطباعة ونسخ ZIP المسطّحة.',
  invalid: 'أدخل الاسمين، حتى ٣٢ حرفًا لكل اسم، وتاريخ إصدار صالحًا لحفظ الإعدادات أو الطباعة.',
  waiting: 'سيظهر الختم حين يصبح أحد الصفوف جاهزًا.',
  checking: 'جارٍ فحص موضع الختم في ملف PDF الحالي…',
  other: 'معاينة الطباعة غير متاحة. راجع إعدادات الطباعة.',
  field: 'الحقل', page: 'الصفحة',
};

const corners = {
  'top-left': ['Top left', 'أعلى اليسار'],
  'top-right': ['Top right', 'أعلى اليمين'],
  'bottom-left': ['Bottom left', 'أسفل اليسار'],
  'bottom-right': ['Bottom right', 'أسفل اليمين'],
} satisfies Record<ApprovalSealSettings['placement'], readonly [string, string]>;

export default function ApprovalSealControl({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  const { approvalSeal, changeApprovalSeal, sealSettingsBlocked, qrSettingsBlocked, sealCheckPending, sealProblem, exportCount, exporting } = desk;
  const [opened, setOpened] = useState<boolean>();
  const copy = arabic ? ar : en;
  const code = sealProblem?.code ?? (qrSettingsBlocked ? 'qr-stamp-invalid-settings' : undefined);
  const message = !approvalSeal ? undefined : sealSettingsBlocked ? copy.invalid : code ? printProblem(code, arabic) ?? copy.other
    : sealCheckPending ? copy.checking : !exportCount ? copy.waiting : undefined;

  return (
    <div>
      <details className="approval-seal" open={opened ?? Boolean(approvalSeal)} onToggle={(event) => setOpened(event.currentTarget.open)}>
        <summary data-testid="approval-seal-toggle">{copy.title}</summary>
        {(opened ?? Boolean(approvalSeal)) && <fieldset className="approval-seal-options" disabled={exporting}
          aria-label={copy.title} aria-describedby={message ? 'approval-seal-status' : undefined}>
          <label className="output-mode">
            <input type="checkbox" data-testid="approval-seal-enabled" checked={Boolean(approvalSeal)}
              onChange={(event) => changeApprovalSeal(event.currentTarget.checked
                ? { placement: 'bottom-right', labelEn: '', labelAr: '', issueDate: '' } : null)} />
            <span>{copy.enable}</span>
          </label>
          <p className="quiet">{copy.scope}</p>
          {approvalSeal && <>
            <label className="full-control">
              {copy.labelEn}
              <input dir="ltr" lang="en" required type="text" data-testid="approval-seal-label-en" value={approvalSeal.labelEn}
                onChange={(event) => changeApprovalSeal({ ...approvalSeal, labelEn: event.currentTarget.value })} />
            </label>
            <label className="full-control">
              {copy.labelAr}
              <input dir="rtl" lang="ar" required type="text" data-testid="approval-seal-label-ar" value={approvalSeal.labelAr}
                onChange={(event) => changeApprovalSeal({ ...approvalSeal, labelAr: event.currentTarget.value })} />
            </label>
            <label className="full-control">
              {copy.issueDate}
              <input dir="ltr" required type="date" data-testid="approval-seal-issue-date" value={approvalSeal.issueDate}
                onChange={(event) => changeApprovalSeal({ ...approvalSeal, issueDate: event.currentTarget.value })} />
            </label>
            <label className="full-control">
              {copy.corner}
              <select data-testid="approval-seal-corner" value={approvalSeal.placement}
                onChange={(event) => changeApprovalSeal({ ...approvalSeal, placement: event.currentTarget.value as ApprovalSealSettings['placement'] })}>
                {Object.entries(corners).map(([value, names]) => <option key={value} value={value}>{names[arabic ? 1 : 0]}</option>)}
              </select>
            </label>
          </>}
          <button type="button" className="text-button" data-testid="approval-seal-clear" disabled={!approvalSeal}
            onClick={() => changeApprovalSeal(null)}>{copy.clear}</button>
        </fieldset>}
      </details>
      <p id="approval-seal-status" data-testid="approval-seal-status" role="status"
        data-code={approvalSeal ? sealSettingsBlocked ? 'approval-seal-invalid-settings' : code : undefined}
        className={`approval-seal-status ${message && (sealSettingsBlocked || code) ? 'alert' : 'quiet'}`}>
        {message}
        {message && sealProblem?.fieldName && <> {copy.field} <bdi>{sealProblem.fieldName}</bdi>.</>}
        {message && sealProblem?.pageNumber && <> {copy.page} <bdi dir="ltr">{sealProblem.pageNumber}</bdi>.</>}
      </p>
    </div>
  );
}
