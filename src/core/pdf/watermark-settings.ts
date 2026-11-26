export type WatermarkSettings = { kind: 'none' } | (
  { opacity: number; angle: -45 | 0 | 45 } & (
    | { kind: 'draft' | 'confidential' | 'draft-ar' | 'confidential-ar' }
    | { kind: 'custom'; text: string }
  )
);

export const DEFAULT_WATERMARK: WatermarkSettings = { kind: 'none' };
export const DEFAULT_WATERMARK_OPACITY = 0.14;
export const DEFAULT_WATERMARK_ANGLE = 45;
export const MAX_WATERMARK_CHARACTERS = 32;

export function validateWatermarkSettings(data: unknown): WatermarkSettings | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const { kind, opacity, angle, text } = data as Record<string, unknown>;
  const keys = Object.keys(data);
  if (!Object.hasOwn(data, 'kind')) return undefined;
  if (kind === 'none') return keys.length === 1 ? DEFAULT_WATERMARK : undefined;
  if (!Object.hasOwn(data, 'opacity') || typeof opacity !== 'number' || !Number.isFinite(opacity)
    || opacity < 0.08 || opacity > 0.30 || !Object.hasOwn(data, 'angle') || (angle !== -45 && angle !== 0 && angle !== 45)) return undefined;
  if (kind === 'custom') {
    if (keys.length !== 4 || !Object.hasOwn(data, 'text') || typeof text !== 'string'
      || !text.trim() || text.length > MAX_WATERMARK_CHARACTERS * 2 || Array.from(text).length > MAX_WATERMARK_CHARACTERS
      || /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(text)) return undefined;
    return { kind, opacity, angle, text };
  }
  if (keys.length === 3 && (kind === 'draft' || kind === 'confidential' || kind === 'draft-ar' || kind === 'confidential-ar')) {
    return { kind, opacity, angle };
  }
}
