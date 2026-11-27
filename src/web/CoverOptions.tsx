import type { CoverLanguage } from '../core/pdf/qr-settings';
import type { useWorkbench } from './useWorkbench';

export default function CoverOptions({ desk, arabic }: { desk: ReturnType<typeof useWorkbench>; arabic: boolean }) {
  return (
    <div className="cover-options">
      <label className="full-control">
        {arabic ? 'لغة صفحة الغلاف' : 'Cover sheet language'}
        <select data-testid="cover-language" value={desk.coverLanguage} disabled={desk.exporting}
          onChange={(event) => desk.changeCoverLanguage(event.currentTarget.value as CoverLanguage)}>
          <option value="auto">{arabic ? 'لغة واجهة التطبيق' : 'Match page'}</option>
          <option value="en" lang="en">English</option>
          <option value="ar" lang="ar">العربية</option>
          <option value="bilingual">{arabic ? 'ثنائي اللغة (العربية والإنجليزية)' : 'Bilingual (EN + AR)'}</option>
        </select>
      </label>
      <label className="output-mode">
        <input type="checkbox" data-testid="custody-cover-footer" checked={desk.includeCustody} disabled={desk.exporting}
          onChange={(event) => desk.changeIncludeCustody(event.currentTarget.checked)} />
        <span>{arabic ? 'أدرج بصمات الملفات المصدرية على صفحة الغلاف' : 'Include source fingerprints on cover sheet'}</span>
      </label>
    </div>
  );
}
