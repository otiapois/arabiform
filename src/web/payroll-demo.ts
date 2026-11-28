import pdf from '../../fixtures/m26/gcc-payroll.pdf?inline';
import csv from '../../fixtures/m26/gcc-payroll.csv?raw';
import settings from '../../fixtures/m26/gcc-payroll-preset-v13.json?raw';
import { inspectFillTemplate } from './fill-template-source';
import { parseMappingPreset } from './presets';
import { decodeBase64 } from './resources';
import { loadRosterSource } from './roster-source';

export async function loadPayrollDemo(openedAt: Date, locale: 'en' | 'ar') {
  const bytes = decodeBase64(pdf.slice(pdf.indexOf(',') + 1));
  const file = new File([csv], 'synthetic-gcc-payroll.csv', { type: 'text/csv' });
  const [template, roster] = await Promise.all([
    inspectFillTemplate('synthetic-gcc-payroll.pdf', bytes), loadRosterSource(file, openedAt),
  ]);
  return {
    template,
    roster,
    preset: parseMappingPreset(settings),
    notice: locale === 'ar'
      ? 'بيانات رواتب اصطناعية. راجع رقم الحساب الدولي في الصف الثاني والتاريخ في الصف الثالث.'
      : 'Synthetic payroll data. Review the IBAN in row 2 and the date in row 3.',
  };
}
