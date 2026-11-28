import type { Imposition } from '../core/pdf/exports';
import type { translator } from './labels';
import { sourceProblem } from './source-problems';
import type { useWorkbench } from './useWorkbench';

type Desk = ReturnType<typeof useWorkbench>;

export function WorksheetPicker({ desk, language }: { desk: Desk; language: ReturnType<typeof translator> }) {
  const { workbook, sheetName, sheetError } = desk.roster!;
  const { arabic } = language;
  return (
    <>
      <label className="full-control">
        {arabic ? 'ورقة العمل' : 'Worksheet'}
        <select dir="auto" data-testid="worksheet" value={sheetName}
          aria-describedby={sheetError ? 'worksheet-error' : undefined}
          onChange={(event) => desk.changeSheet(event.currentTarget.value)}>
          {workbook!.sheetNames.map((name) => <option dir="auto" key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {sheetError && <p className="alert" role="alert" id="worksheet-error" data-testid="worksheet-error">
        {sheetError === 'invalid-roster-headers' ? sourceProblem(sheetError, arabic)
          : arabic ? 'تعذّرت قراءة ورقة العمل هذه. اختر ورقة أخرى أو تحقّق منها في Excel.'
            : 'This worksheet could not be read. Choose another worksheet or check this sheet in Excel.'}
      </p>}
    </>
  );
}

export function PrintLayout({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  const { twoUpUnavailableReason, fourUpUnavailableReason } = desk.template!.impositionCompatibility;
  const unavailable = Boolean(twoUpUnavailableReason && fourUpUnavailableReason);
  const message = twoUpUnavailableReason === 'imposition-requires-single-page'
    ? arabic ? 'يتاح وضع السجلين للقوالب ذات الصفحة الواحدة. يستخدم هذا القالب التخطيط القياسي.'
      : '2-up is available for single-page templates. This template uses 1-up.'
    : unavailable
      ? arabic ? 'يستخدم هذا القالب التخطيط القياسي بسبب أبعاد الصفحة أو تدويرها أو وجود تعليق قابل للطباعة.'
        : 'This template uses 1-up because of its page size, rotation, or a printable annotation.'
      : arabic ? 'شبكة الأربعة غير متاحة لأبعاد هذه الصفحة.' : 'The 4-up grid is unavailable for this page size.';
  const disabled = desk.exporting;
  const fourUp = desk.fourUp ?? { fourUpOrder: 'sequential', centerCutGuides: false };
  return (
    <>
      <label className="full-control">
        {arabic ? 'تخطيط الأوراق في ملف PDF المدمج' : 'Merged PDF sheet layout'}
        <select className="imposition-select" data-testid="imposition" value={desk.printLayout} disabled={unavailable || disabled}
          aria-describedby={fourUpUnavailableReason ? 'imposition-unavailable' : undefined}
          onChange={(event) => desk.changeImposition(event.currentTarget.value as Imposition)}>
          <option value="1-up">{arabic ? 'سجل واحد لكل ورقة (قياسي)' : '1-up (standard)'}</option>
          <option value="2-up" disabled={Boolean(twoUpUnavailableReason)}>{arabic ? 'سجلان لكل ورقة مع علامات القص' : '2-up (2 records per sheet with cut marks)'}</option>
          <option value="4-up" disabled={Boolean(fourUpUnavailableReason)}>{arabic ? 'شبكة A4 لأربعة سجلات (توفير يصل إلى 75٪)' : '4-Up A4 Grid (up to 75% savings)'}</option>
        </select>
      </label>
      {fourUpUnavailableReason && <p className="quiet" id="imposition-unavailable" data-testid="imposition-unavailable">{message}</p>}
      {desk.printLayout === '4-up' && <>
        <label className="output-mode">
          <input type="checkbox" data-testid="imposition-four-up-order" checked={fourUp.fourUpOrder === 'cut-and-stack'} disabled={disabled}
            onChange={(event) => desk.changeFourUp({ ...fourUp, fourUpOrder: event.currentTarget.checked ? 'cut-and-stack' : 'sequential' })} />
          <span>{arabic ? 'ترتيب القص والتكديس' : 'Cut-and-stack order'}</span>
        </label>
        <label className="output-mode">
          <input type="checkbox" data-testid="imposition-center-cut-guides" checked={fourUp.centerCutGuides} disabled={disabled}
            onChange={(event) => desk.changeFourUp({ ...fourUp, centerCutGuides: event.currentTarget.checked })} />
          <span>{arabic ? 'خطوط القص في المنتصف' : 'Center cut guides'}</span>
        </label>
      </>}
    </>
  );
}
