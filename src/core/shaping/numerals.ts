import type { FieldTypography } from '../pdf/field-typography';

export function applyNumeralPolicy(value: string, policy: FieldTypography['numeralPolicy'] = 'preserve'): string {
  if (policy === 'preserve') return value;
  const targetZero = policy === 'eastern-arabic' ? 0x0660 : 0x0030;
  return value.replace(/[0-9\u0660-\u0669\u06F0-\u06F9]/gu, (character) => {
    const point = character.charCodeAt(0);
    const sourceZero = point >= 0x06F0 ? 0x06F0 : point >= 0x0660 ? 0x0660 : 0x0030;
    return String.fromCharCode(targetZero + point - sourceZero);
  });
}
