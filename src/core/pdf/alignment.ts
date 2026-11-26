const modes = ['auto', 'rtl', 'ltr', 'center'] as const;
export type AlignOverride = typeof modes[number];
export const explicitQuadding = { rtl: 2, ltr: 0, center: 1 } as const;

export function isAlignOverride(value: unknown): value is AlignOverride {
  return modes.some((mode) => mode === value);
}
