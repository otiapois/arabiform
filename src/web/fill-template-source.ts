import type { FlatPdfMetadata } from '../core/designer/source';
import type { TemplateMetadata, getWidgetOverlays } from '../core/pdf';
import type { inspectImpositionCompatibility } from '../core/pdf/imposition';
import type { MappingPreset } from './presets';
import { errorCode } from './resources';

export type FillTemplate = {
  name: string;
  bytes: Uint8Array;
  info: TemplateMetadata;
  overlays: ReturnType<typeof getWidgetOverlays>;
  impositionCompatibility: Awaited<ReturnType<typeof inspectImpositionCompatibility>>;
  synthetic?: boolean;
};
export type MigratedTemplate = { preset: MappingPreset; synthetic?: boolean };
export type FlatSource = { name: string; bytes: Uint8Array; info: FlatPdfMetadata };
type Result = { template: FillTemplate; code?: never; flatSource?: never } | {
  template?: never; code: string; flatSource?: FlatSource;
};

export async function inspectFillTemplate(name: string, bytes: Uint8Array): Promise<FillTemplate> {
  const engine = await import('../core/pdf');
  const info = await engine.inspectTemplate(bytes);
  const { inspectImpositionCompatibility } = await import('../core/pdf/imposition');
  const impositionCompatibility = await inspectImpositionCompatibility(bytes);
  return { name, bytes, info, overlays: engine.getWidgetOverlays(info), impositionCompatibility };
}

export async function inspectFillSource(file: File): Promise<Result> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    return { template: await inspectFillTemplate(file.name, bytes) };
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
