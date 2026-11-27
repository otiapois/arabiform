const corners = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type QrCorner = typeof corners[number];
export type QrStampSettings = { placement: 'none' } | { placement: QrCorner; sizePt: number; pattern: string; custodyRecord?: true };
export type QrPrintRequest = { placement: QrCorner; sizePt: number; payloads: readonly (string | null)[] };
export type BatchQrPrintRequest = QrPrintRequest | { placement: QrCorner; sizePt: number; custodyRecord: true };
export type CoverLanguage = 'auto' | 'en' | 'ar' | 'bilingual';

export const DEFAULT_QR_STAMP: QrStampSettings = { placement: 'none' };
export const DEFAULT_QR_SIZE_PT = 48;

function isRecord(data: unknown): data is Record<string, unknown> {
  if (typeof data !== 'object' || data === null) return false;
  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null;
}

function isCorner(value: unknown): value is QrCorner {
  return corners.some((corner) => value === corner);
}

function isPrintSize(value: unknown): value is number {
  return typeof value === 'number' && value >= 36 && value <= 72;
}

export function isCoverLanguage(value: unknown): value is CoverLanguage {
  return value === 'auto' || value === 'en' || value === 'ar' || value === 'bilingual';
}

export function validateQrStampSettings(data: unknown): QrStampSettings | undefined {
  if (!isRecord(data) || !Object.hasOwn(data, 'placement')) return undefined;
  const { placement, sizePt, pattern, custodyRecord } = data;
  const keyCount = Object.keys(data).length;
  if (placement === 'none') return keyCount === 1 ? DEFAULT_QR_STAMP : undefined;
  const standard = keyCount === 3 && !Object.hasOwn(data, 'custodyRecord');
  const custody = keyCount === 4 && Object.hasOwn(data, 'custodyRecord') && custodyRecord === true;
  if ((standard || custody) && isCorner(placement) && Object.hasOwn(data, 'sizePt') && isPrintSize(sizePt)
    && Object.hasOwn(data, 'pattern') && typeof pattern === 'string' && pattern.trim() && !/[\uD800-\uDFFF]/u.test(pattern)) {
    return { placement, sizePt, pattern, ...(custody && { custodyRecord: true }) };
  }
}

export function validateBatchQrPrintRequest(data: unknown, rowCount: number): BatchQrPrintRequest {
  if (isRecord(data) && Object.hasOwn(data, 'custodyRecord') && data.custodyRecord === true && Object.keys(data).length === 3
    && Object.hasOwn(data, 'placement') && isCorner(data.placement) && Object.hasOwn(data, 'sizePt') && isPrintSize(data.sizePt)) {
    return { placement: data.placement, sizePt: data.sizePt, custodyRecord: true };
  }
  return validateQrPrintRequest(data, rowCount);
}

export function validateQrPrintRequest(data: unknown, rowCount: number): QrPrintRequest {
  if (!isRecord(data) || Object.keys(data).length !== 3
    || !Object.hasOwn(data, 'placement') || !isCorner(data.placement) || !Object.hasOwn(data, 'sizePt') || !isPrintSize(data.sizePt)
    || !Object.hasOwn(data, 'payloads') || !Array.isArray(data.payloads) || data.payloads.length !== rowCount
    || Array.from(data.payloads).some((payload) => typeof payload !== 'string' && payload !== null)) {
    throw new Error('qr-stamp-invalid-settings');
  }
  return { placement: data.placement, sizePt: data.sizePt, payloads: data.payloads };
}
