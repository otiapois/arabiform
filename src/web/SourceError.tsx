import { sourceProblem } from './source-problems';

export default function SourceError({ code, arabic, onDesign }: { code: string; arabic: boolean; onDesign?: () => void }) {
  return (
    <div className="alert" role="alert">
      <p>{sourceProblem(code, arabic) ?? (arabic ? 'تعذّرت قراءة هذا الملف.' : 'This file could not be read.')}</p>
      {onDesign && <button type="button" className="button secondary flat-designer-cta" data-testid="open-flat-designer" onClick={onDesign}>
        {arabic ? 'افتح مصمّم حقول النماذج' : 'Open in Visual Field Designer'}
      </button>}
    </div>
  );
}
