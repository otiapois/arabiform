import { fillLabel } from './labels';

const copy = {
  en: {
    ready: 'PDF downloads include ready rows ({ready}) and skip flagged rows ({flagged}). The audit includes every checked row.',
    help: 'PDFs, audits and the custody manifest cover the ready rows selected for export.',
    scope: 'Selected only ({count})',
    empty: 'This selection has no ready rows. Select a ready row or choose “Use all ready” to switch back.',
    working: 'Preparing download…',
  },
  ar: {
    ready: 'الصفوف الجاهزة للتنزيل بصيغة PDF: {ready}. الصفوف المستبعدة: {flagged}. يشمل تقرير الفحص كل الصفوف المفحوصة.',
    help: 'تقتصر ملفات PDF وتقارير الفحص وبيان سلسلة الحيازة على الصفوف الجاهزة المحددة للتصدير.',
    scope: 'الصفوف المحددة فقط ({count})',
    empty: 'لا توجد صفوف جاهزة ضمن التحديد. حدّد صفًا جاهزًا أو اختر «استخدم كل الصفوف الجاهزة».',
    working: 'جارٍ تجهيز التنزيل…',
  },
};

export function ExportCounts({ arabic, subset, ready, flagged }: { arabic: boolean; subset: boolean; ready: number; flagged: number }) {
  const locale = arabic ? copy.ar : copy.en;
  return <p data-testid="export-counts">{subset ? locale.help : fillLabel(locale.ready, { ready, flagged })}</p>;
}

export function SelectedExportScope({ arabic, count, showEmpty }: { arabic: boolean; count: number; showEmpty: boolean }) {
  const locale = arabic ? copy.ar : copy.en;
  return (
    <>
      <p role="status" className="tag tag-subset" data-testid="export-scope">{fillLabel(locale.scope, { count })}</p>
      {showEmpty && <p className="alert warning" data-testid="export-subset-empty">{locale.empty}</p>}
    </>
  );
}

export function ExportProgress({ arabic }: { arabic: boolean }) {
  return <p role="status">{(arabic ? copy.ar : copy.en).working}</p>;
}
