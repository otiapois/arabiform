import { decodeBase64 } from './bundled-assets';

export async function loadPacketDemo(): Promise<{
  templates: { file: File; title: string; mapping: Record<string, string> }[];
  roster: File;
}> {
  const [hr, consent] = await Promise.all([
    import('virtual:arabiform/sample-hr'),
    import('virtual:arabiform/sample-clinic'),
  ]);
  return {
    templates: [
      {
        file: new File([decodeBase64(hr.template)], 'multi-page-hr-choices.pdf', { type: 'application/pdf' }),
        title: 'HR onboarding',
        mapping: { Employee: 'Name' },
      },
      {
        file: new File([decodeBase64(consent.template)], 'clinic-consent-mixed.pdf', { type: 'application/pdf' }),
        title: 'Clinic consent',
        mapping: { Name: 'Name', ID: 'ID', Consent: 'Consent' },
      },
    ],
    roster: new File([decodeBase64(consent.roster)], 'clinic-consent-roster.csv', { type: 'text/csv' }),
  };
}
