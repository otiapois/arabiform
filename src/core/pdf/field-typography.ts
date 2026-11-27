export interface FieldTypography {
  numeralPolicy?: 'preserve' | 'eastern-arabic' | 'western-ascii';
  lineHeightScale?: 1 | 1.15 | 1.3;
  paddingPt?: 2 | 4 | 6;
}

export type FieldTypographyMap = Record<string, FieldTypography>;
