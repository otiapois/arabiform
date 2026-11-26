import fontkit, { type Font } from '@pdf-lib/fontkit';
import { decodePDFRawStream, PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, type PDFDocument } from 'pdf-lib';

export const MAX_CUSTOM_FONT_BYTES = 16 * 1024 * 1024;
const minimumTables = { cmap: 4, head: 54, hhea: 36, hmtx: 4, maxp: 6, name: 6 };

interface CustomFont {
  bytes: Uint8Array;
  face: Font;
  family: string;
  cff: boolean;
}

const parsed = new WeakMap<Uint8Array, CustomFont>();

export function loadCustomFont(bytes: Uint8Array): CustomFont {
  const cached = parsed.get(bytes);
  if (cached) return cached;
  try {
    if (bytes.length < 12 || bytes.length > MAX_CUSTOM_FONT_BYTES) throw new Error('font-size');
    const sfnt = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const signature = sfnt.getUint32(0);
    const cff = signature === 0x4f54544f;
    if (!cff && signature !== 0x00010000 && signature !== 0x74727565) throw new Error('sfnt-signature');

    const tableCount = sfnt.getUint16(4);
    const directoryEnd = 12 + tableCount * 16;
    if (!tableCount || directoryEnd > bytes.length) throw new Error('sfnt-directory');
    const tables = new Map<string, { start: number; end: number }>();
    for (let index = 12; index < directoryEnd; index += 16) {
      const tag = String.fromCharCode(...bytes.subarray(index, index + 4));
      const start = sfnt.getUint32(index + 8);
      const end = start + sfnt.getUint32(index + 12);
      if (tables.has(tag) || start < directoryEnd || start % 4 || end > bytes.length) throw new Error('sfnt-table');
      tables.set(tag, { start, end });
    }
    const occupied = [...tables.values()].filter(({ start, end }) => end > start).sort((a, b) => a.start - b.start);
    if (occupied.some(({ start }, index) => index > 0 && start < occupied[index - 1]!.end)) throw new Error('sfnt-overlap');
    const required = cff ? { ...minimumTables, 'CFF ': 4 } : { ...minimumTables, glyf: 1, loca: 4 };
    for (const [tag, length] of Object.entries(required)) {
      const table = tables.get(tag);
      if (!table || table.end - table.start < length) throw new Error('sfnt-required-table');
    }

    const face = fontkit.create(bytes);
    if (cff) {
      const directory = (face as Font & { 'CFF '?: { isCIDFont: boolean; topDict: { FDArray?: unknown[] } } })['CFF '];
      // The installed subsetter cannot safely retain the per-glyph FD mapping
      // when a CID-keyed CFF source uses multiple font dictionaries.
      if (!directory || (directory.isCIDFont && directory.topDict.FDArray?.length !== 1)) throw new Error('cff-dictionary');
    }
    const family = face.familyName?.trim() || face.fullName?.trim() || face.postscriptName?.trim();
    const { minX, minY, maxX, maxY } = face.bbox;
    const { unitsPerEm, numGlyphs, characterSet } = face;
    if (!family || unitsPerEm < 16 || unitsPerEm > 16_384 || !numGlyphs || !characterSet.length
      || ![minX, minY, maxX, maxY, face.ascent, face.descent].every(Number.isFinite)) throw new Error('font-metrics');
    // Fontkit reads glyph and layout tables lazily. Probe a printable mapped glyph before accepting the file.
    const probe = characterSet.find((code) => code > 32 && code < 0xd800 && face.hasGlyphForCodePoint(code));
    if (probe !== undefined) {
      const { glyphs, positions } = face.layout(String.fromCodePoint(probe));
      if (!glyphs.length || glyphs.length !== positions.length) throw new Error('font-layout');
      for (const glyph of glyphs) {
        const { minX, minY, maxX, maxY } = glyph.bbox;
        if (!glyph.id || !Number.isFinite(glyph.advanceWidth) || [minX, maxX, minY, maxY].some(Number.isNaN)) throw new Error('font-glyph');
      }
    }
    const font = { bytes, face, family, cff };
    parsed.set(bytes, font);
    return font;
  } catch (cause) {
    throw new Error('invalid-custom-font', { cause });
  }
}

export function inspectCustomFont(bytes: Uint8Array): { family: string } {
  return { family: loadCustomFont(bytes).family };
}

export async function embedCustomFont(doc: PDFDocument, custom: CustomFont, name: string, ids: Set<number>) {
  const { bytes, face } = custom;
  const glyphs = [...ids].map((id) => face.getGlyph(id));
  // pdf-lib's subset encoder consumes shaped glyphs from layout(). Feed it the
  // existing glyph sequence so ligatures, marks and positions use the same CIDs.
  const adapter = new Proxy(face, {
    get(target, property) {
      if (property === 'layout') return () => ({ glyphs });
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  doc.registerFontkit({ create: () => adapter });
  const font = await doc.embedFont(bytes, { subset: true, customName: name });
  const codes = font.encodeText('').asBytes();
  if (codes.length !== glyphs.length * 2) throw new Error('invalid-custom-font');
  const cids = new Map(glyphs.map(({ id }, index) => [id, codes[index * 2]! * 256 + codes[index * 2 + 1]!]));
  await doc.flush();
  if (custom.cff) {
    const key = PDFName.of;
    const descriptor = doc.context.lookup(font.ref, PDFDict).lookup(key('DescendantFonts'), PDFArray)
      .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
    const ref = descriptor.get(key('FontFile3'));
    if (!(ref instanceof PDFRef)) throw new Error('cff-stream');
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('cff-stream');
    const data = decodePDFRawStream(stream).decode();
    if (data.length < 4 || data[0] !== 1 || data[2]! < 4 || data[2]! >= data.length) throw new Error('cff-header');
    if (data[3] === 0 || data[3]! > 4) {
      // Fontkit 1.1.1 can write an invalid CFF v1 header offSize. INDEX entries
      // carry their own offset widths. Set the header's standard four-byte width.
      data[3] = 4;
      doc.context.assign(ref, doc.context.flateStream(data, { Subtype: 'CIDFontType0C' }));
    }
  }
  return { name, ref: font.ref, cids };
}
