import type { QrStampSettings } from './qr-settings';
import type { WatermarkSettings } from './watermark-settings';

export const DEFAULT_QR_STAMP: QrStampSettings = { placement: 'none' };
export const DEFAULT_QR_SIZE_PT = 48;
export const DEFAULT_WATERMARK: WatermarkSettings = { kind: 'none' };
export const DEFAULT_WATERMARK_OPACITY = 0.14;
export const DEFAULT_WATERMARK_ANGLE = 45;
