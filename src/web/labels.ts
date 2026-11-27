import translations from './workbench-labels.json';

const labelsByLanguage: Record<'en' | 'ar', typeof translations.en> = translations;

export function translator(arabic: boolean) {
  return {
    arabic,
    labels: labelsByLanguage[arabic ? 'ar' : 'en'],
  };
}

export function fillLabel(label: string, values: Record<string, number>) {
  return label.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
}
