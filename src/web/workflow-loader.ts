import { decodeBase64 } from './bundled-assets';
import { rosterViews } from './roster-source';
import type { ConditionalFieldRule } from '../core/rules/conditional-fields';
import type { FillSample, SampleWorkflow } from './useWorkbench';
import { inspectFillTemplate, type FillTemplate } from './fill-template-source';
import type { restorePresetSettings } from './presets';
import type { RosterSource } from './roster-source';

// The sample-* chunks contain individual fixture bytes; this module only selects one of them.
const samples = {
  workshop: { load: () => import('virtual:arabiform/sample'), pdf: 'synthetic-acroform.pdf', roster: 'synthetic-roster.csv' },
  clinic: { load: () => import('virtual:arabiform/sample-clinic'), pdf: 'clinic-consent-mixed.pdf', roster: 'clinic-consent-roster.csv' },
  hr: { load: () => import('virtual:arabiform/sample-hr'), pdf: 'multi-page-hr-choices.pdf', roster: 'multi-page-hr-choices.csv' },
  badge: { load: () => import('virtual:arabiform/sample-badge'), pdf: 'landscape-badge.pdf', roster: 'badge-roster.csv' },
} satisfies Record<SampleWorkflow, { load: () => Promise<{ template: string; roster: string }>; pdf: string; roster: string }>;

const vipRules: ConditionalFieldRule[] = [
  { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-text', value: 'كبار الشخصيات / VIP' } },
  { field: 'Consent', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-checkbox', checked: true } },
];
const vipRoster = 'Name,ID,Consent,Role,Clinic\nVIP Guest,00123,false,VIP,North clinic\nStandard Guest,00007,false,Standard,South clinic\n';

type LoadedSample = {
  template: FillTemplate;
  roster: RosterSource;
  notice: string;
  rules?: ConditionalFieldRule[];
  restoredSettings?: ReturnType<typeof restorePresetSettings>;
};

export async function loadSampleWorkflow(workflow: FillSample, openedAt: Date, locale: 'en' | 'ar'): Promise<LoadedSample> {
  if (workflow === 'payroll') {
    const { loadPayrollDemo } = await import('./payroll-demo');
    return loadPayrollDemo(openedAt, locale);
  }
  const conditional = workflow === 'conditional';
  const sample = samples[conditional ? 'clinic' : workflow];
  const [assets, parser, virtual] = await Promise.all([
    sample.load(), import('../core/roster'), import('../core/roster/virtual-columns'),
  ]);
  const bytes = decodeBase64(assets.template);
  const rosterBytes = conditional ? new TextEncoder().encode(vipRoster) : decodeBase64(assets.roster);
  const rosterName = conditional ? 'synthetic-vip-standard.csv' : sample.roster;
  const [template, data] = await Promise.all([inspectFillTemplate(sample.pdf, bytes), parser.readRoster(rosterBytes, rosterName)]);
  const notice = conditional
    ? locale === 'ar' ? 'بيانات اصطناعية من صفّين. تعرض قاعدة VIP عبارة ثنائية اللغة في حقل الاسم وتحدّد مربّعي الموافقة.'
      : 'Two synthetic rows. The VIP rules set a bilingual banner in Name and check both Consent boxes.'
    : workflow === 'workshop'
    ? locale === 'ar' ? 'الأسماء والأرقام خيالية. في الصف الأخير اسم طويل يتجاوز مساحة الحقل عمدًا.'
      : 'Fictional names and IDs. The final row intentionally contains a name that exceeds its field.'
    : locale === 'ar' ? 'ملفات بأسماء وهمية. راجع الصف المُعلَّم لتجربة هذا المسار.'
      : 'Fictional files. Review the flagged row to try this workflow.';
  return {
    template,
    roster: { name: rosterName, bytes: rosterBytes, sheet: data.sheets[0], engine: parser, virtual, views: rosterViews, localDate: virtual.localVirtualDate(openedAt) },
    rules: conditional ? vipRules : undefined,
    notice,
  };
}
