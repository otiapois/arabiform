import type { FlatPdfMetadata } from './source';
import { DesignerError, validateFieldSpecs, type FieldDraftSpec } from './spec';

export type { FieldDraftSpec } from './spec';

const digestPattern = /^[0-9a-f]{64}$/;

export async function saveFieldLayout(source: FlatPdfMetadata, fields: readonly FieldDraftSpec[]): Promise<string> {
  const { sourceSha256, pages } = source;
  if (!digestPattern.test(sourceSha256)) throw new DesignerError('invalid-layout');
  return JSON.stringify({ version: 1, sourceSha256, fields: validateFieldSpecs(fields, pages) }, null, 2) + '\n';
}

export async function loadFieldLayout(json: string, source: FlatPdfMetadata): Promise<FieldDraftSpec[]> {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (cause) {
    throw new DesignerError('invalid-layout', { cause });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new DesignerError('invalid-layout');
  const { version, sourceSha256, fields } = payload as Record<string, unknown>;
  if (Object.keys(payload).length !== 3 || version !== 1 || typeof sourceSha256 !== 'string' ||
    !digestPattern.test(sourceSha256) || !Array.isArray(fields)) {
    throw new DesignerError('invalid-layout');
  }
  if (sourceSha256 !== source.sourceSha256) throw new DesignerError('layout-source-mismatch');
  return validateFieldSpecs(fields, source.pages);
}
