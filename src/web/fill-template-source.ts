import type { FlatPdfMetadata } from '../core/designer/source';
import type { TemplateMetadata, getWidgetOverlays } from '../core/pdf';
import { errorCode } from './resources';

export type FillTemplate = {
  name: string;
  bytes: Uint8Array;
  info: TemplateMetadata;
  overlays: ReturnType<typeof getWidgetOverlays>;
};
export type FlatSource = { name: string; bytes: Uint8Array; info: FlatPdfMetadata };
type Result = { template: FillTemplate; code?: never; flatSource?: never } | {
  template?: never; code: string; flatSource?: FlatSource;
};

export async function inspectFillSource(file: File): Promise<Result> {
  let bytes: Uint8Array | undefined;
  try {
    const [engine, buffer] = await Promise.all([import('../core/pdf'), file.arrayBuffer()]);
    bytes = new Uint8Array(buffer);
    const info = await engine.inspectTemplate(bytes);
    return { template: { name: file.name, bytes, info, overlays: engine.getWidgetOverlays(info) } };
  } catch (problem) {
    const code = errorCode(problem, 'loadError');
    if (code === 'flat-scanned-no-fields' && bytes) {
      try {
        const { inspectFlatPdf } = await import('../core/designer/source');
        const info = await inspectFlatPdf(bytes);
        return { code, flatSource: { name: file.name, bytes, info } };
      } catch {
        // Keep the Fill rejection visible if the source is unsuitable for design.
      }
    }
    return { code };
  }
}
