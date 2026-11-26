import type { TemplateCapacityReport } from '../core/pdf/capacity-inspector';
import type { translator } from './labels';

const en = ['Field', 'Type', 'Page', 'Widget', 'Rotation', 'W × H (pt)', '/MaxLen', 'Arabic characters', 'Latin characters'];
const ar = ['الحقل', 'النوع', 'الصفحة', 'العنصر', 'الدوران', 'العرض × الارتفاع (نقطة)', '/MaxLen', 'الأحرف العربية', 'الأحرف اللاتينية'];

export default function CapacityTable({ report, arabic, labels }: {
  report: TemplateCapacityReport;
  arabic: boolean;
  labels: ReturnType<typeof translator>['labels'];
}) {
  const kinds = { text: labels.kindText, checkbox: labels.kindCheckbox, radio: labels.kindRadio, dropdown: labels.kindDropdown };
  const heading = arabic ? 'سعة حقول القالب' : 'Template field capacities';

  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={heading}>
      <table data-testid="capacity-table">
        <caption>{heading} · <bdi dir="ltr">{report.minFontSize} {labels.points}</bdi></caption>
        <thead><tr>{(arabic ? ar : en).map((item) => <th scope="col" key={item}>{item}</th>)}</tr></thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={JSON.stringify([row.fieldName, row.widgetNumber])} data-testid="capacity-row">
              <th scope="row"><bdi dir="auto">{row.fieldName}</bdi></th>
              <td>{kinds[row.kind]}</td>
              <td>{row.pageNumber ?? '—'}</td>
              <td>{row.widgetNumber ?? '—'}</td>
              <td>{row.widgetRotation === null ? '—' : <bdi dir="ltr">{row.widgetRotation}°</bdi>}</td>
              <td>{row.innerWidth === null || row.innerHeight === null ? '—' : <bdi dir="ltr">{row.innerWidth} × {row.innerHeight}</bdi>}</td>
              <td>{row.maxLength ?? '—'}</td>
              <td>{row.arabicCharacters ?? '—'}</td>
              <td>{row.latinCharacters ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
