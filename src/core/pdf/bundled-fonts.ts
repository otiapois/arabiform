import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFObjectCopier, type PDFRef } from 'pdf-lib';
import type { FontBytes } from './shaping';

type FontEntry = Promise<{ source: PDFDocument; ref: PDFRef }>;
const resources = new WeakMap<FontBytes, Partial<Record<keyof FontBytes, FontEntry>>>();

async function embedFontResource(bytes: Uint8Array, name: string) {
  const source = await PDFDocument.create();
  source.registerFontkit(fontkit);
  const font = await source.embedFont(bytes, { subset: false, customName: name });
  await source.flush();
  return { source, ref: font.ref };
}

export async function copyBundledFont(doc: PDFDocument, fonts: FontBytes, family: keyof FontBytes, name: string): Promise<PDFRef> {
  const bank = resources.get(fonts) ?? {};
  resources.set(fonts, bank);
  // Only the fully embedded font resource is cached. The row-local copier
  // installs its own references and never mutates the immutable source.
  const { source, ref } = await (bank[family] ??= embedFontResource(fonts[family], name));
  return PDFObjectCopier.for(source.context, doc.context).copy(ref);
}
