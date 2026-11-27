import { decodeBase64 } from './resources';
import type { SampleWorkflow } from './useWorkbench';

// The sample-* chunks contain individual fixture bytes; this module only selects one of them.
const samples = {
  workshop: { load: () => import('virtual:arabiform/sample'), pdf: 'synthetic-acroform.pdf', roster: 'synthetic-roster.csv' },
  clinic: { load: () => import('virtual:arabiform/sample-clinic'), pdf: 'clinic-consent-mixed.pdf', roster: 'clinic-consent-roster.csv' },
  hr: { load: () => import('virtual:arabiform/sample-hr'), pdf: 'multi-page-hr-choices.pdf', roster: 'multi-page-hr-choices.csv' },
  badge: { load: () => import('virtual:arabiform/sample-badge'), pdf: 'landscape-badge.pdf', roster: 'badge-roster.csv' },
} satisfies Record<SampleWorkflow, { load: () => Promise<{ template: string; roster: string }>; pdf: string; roster: string }>;

export async function loadSampleWorkflow(workflow: SampleWorkflow, openedAt: Date) {
  const sample = samples[workflow];
  const [assets, engine, parser, virtual] = await Promise.all([
    sample.load(), import('../core/pdf'), import('../core/roster'), import('../core/roster/virtual-columns'),
  ]);
  const bytes = decodeBase64(assets.template);
  const rosterBytes = decodeBase64(assets.roster);
  const [info, data] = await Promise.all([engine.inspectTemplate(bytes), parser.readRoster(rosterBytes, sample.roster)]);
  return {
    template: { name: sample.pdf, bytes, info, overlays: engine.getWidgetOverlays(info) },
    roster: { name: sample.roster, bytes: rosterBytes, sheet: data.sheets[0], engine: parser, virtual, localDate: virtual.localVirtualDate(openedAt) },
  };
}
