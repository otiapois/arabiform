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
  const unavailable = desk.impositionUnavailable;
  return (
    <>
      <label className="full-control">
        {arabic ? 'تخطيط الأوراق في ملف PDF المدمج' : 'Merged PDF sheet layout'}
        <select className="imposition-select" data-testid="imposition" value={desk.printLayout} disabled={unavailable || desk.exporting}
          aria-describedby={unavailable ? 'imposition-unavailable' : undefined}
          onChange={(event) => desk.changeImposition(event.currentTarget.value as Imposition)}>
          <option value="1-up">{arabic ? 'سجل واحد لكل ورقة (قياسي)' : '1-up (standard)'}</option>
          <option value="2-up">{arabic ? 'سجلان لكل ورقة مع علامات القص' : '2-up (2 records per sheet with cut marks)'}</option>
        </select>
      </label>
      {unavailable && <p className="quiet" id="imposition-unavailable" data-testid="imposition-unavailable">
        {arabic ? 'يتاح وضع السجلين للقوالب ذات الصفحة الواحدة. يستخدم هذا القالب التخطيط القياسي.'
          : '2-up is available for single-page templates. This template uses 1-up.'}
      </p>}
    </>
  );
}
