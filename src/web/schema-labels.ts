import type { RosterSchemaRule } from '../core/validation/roster-schema';

export const schemaLabels = {
  en: {
    required: 'Required',
    'iban-mod97': 'IBAN (Mod-97)',
    'iso-date': 'ISO Date',
    'exact-digits': 'Exact digits',
    'email-format': 'Email',
    'allowed-values': 'Allowed list',
  },
  ar: {
    required: 'مطلوب',
    'iban-mod97': 'الآيبان (Mod-97)',
    'iso-date': 'تاريخ ISO',
    'exact-digits': 'عدد أرقام محدّد',
    'email-format': 'البريد الإلكتروني',
    'allowed-values': 'قائمة القيم المسموح بها',
  },
} satisfies Record<'en' | 'ar', Record<RosterSchemaRule['kind'], string>>;
