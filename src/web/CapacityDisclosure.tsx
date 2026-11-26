import { lazy, Suspense, useState } from 'react';
import { fillLabel, type translator } from './labels';
import type { TemplateInfo } from './useWorkbench';

const CapacityReport = lazy(() => import('./CapacityReport'));

export function CapacityDisclosure({ template, minFontSize, arabic, labels }: {
  template: TemplateInfo;
  minFontSize: number;
  arabic: boolean;
  labels: ReturnType<typeof translator>['labels'];
}) {
  const [open, setOpen] = useState(false);
  const count = template.fields.length;
  const title = arabic ? 'افحص سعة حقول القالب ({count})' : 'Inspect template field capacities ({count} fields)';

  return (
    <details className="capacity-inspector" data-testid="capacity-inspector"
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{fillLabel(title, { count })}</summary>
      <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
        <CapacityReport template={template} minFontSize={minFontSize} open={open} arabic={arabic} labels={labels} />
      </Suspense>
    </details>
  );
}
