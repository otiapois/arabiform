import fontkit, { type Font, type GlyphRun } from '@pdf-lib/fontkit';
import createBidi from 'bidi-js';

export type FontKey = 'arabic' | 'latin';
export type FontBytes = Record<FontKey, Uint8Array>;
type Direction = 'rtl' | 'ltr';

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
interface Glyph { id: number; font: FontKey; x: number; y: number }
interface Line { text: string; direction: Direction; bounds: Bounds; painted: boolean; glyphs: Glyph[] }
export interface PlacedLine { line: Line; origin: number; baseline: number }
export interface Placement { size: number; lines: PlacedLine[] }

const faceCache = new WeakMap<FontBytes, Record<FontKey, Font>>();
const bidi = createBidi();
const arabic = /\p{Script_Extensions=Arabic}/u;
const format = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const joinControl = /[\u200c\u200d]/u;
const paragraphBreak = /\r\n|[\r\n\u2028\u2029]/;

interface DirectionalRun { chunks: string[]; font: FontKey; level: number }

export function createShaper(bytes: FontBytes, preferred: FontKey | 'auto') {
  let faces = faceCache.get(bytes);
  if (!faces) {
    faces = { arabic: fontkit.create(bytes.arabic), latin: fontkit.create(bytes.latin) };
    faceCache.set(bytes, faces);
  }
  const fonts = faces;
  const cache = new Map<string, Line | undefined>();

  function line(text: string, base?: Direction): Line | undefined {
    const key = `${base ?? ''}\0${text}`;
    if (cache.has(key)) return cache.get(key);
    const { levels, paragraphs } = bidi.getEmbeddingLevels(text, base);
    const direction = (paragraphs[0]?.level ?? (base === 'rtl' ? 1 : 0)) % 2 ? 'rtl' : 'ltr';
    const runs: DirectionalRun[] = [];
    let index = 0;
    for (const character of text) {
      const level = levels[index] ?? 0;
      index += character.length;
      if (format.test(character)) continue;
      const last = runs.at(-1);
      const mirrored = level % 2 ? bidi.getMirroredCharacter(character) ?? character : character;
      const codepoint = mirrored.codePointAt(0)!;
      const suggested = arabic.test(mirrored) || joinControl.test(mirrored) ? 'arabic' : 'latin';
      const compatible = arabic.test(mirrored) || joinControl.test(mirrored) || preferred === 'auto' ? suggested : preferred;
      const alternate = compatible === 'arabic' ? 'latin' : 'arabic';
      const font = fonts[compatible].hasGlyphForCodePoint(codepoint) || joinControl.test(mirrored) ? compatible : alternate;
      if (!joinControl.test(mirrored) && !fonts[font].hasGlyphForCodePoint(codepoint)) {
        cache.set(key, undefined);
        return undefined;
      }
      if (last?.level === level && last.font === font) last.chunks.push(mirrored);
      else runs.push({ chunks: [mirrored], font, level });
    }

    // UAX #9 L2 reverses contiguous sequences, from highest embedding level to the lowest odd level.
    const highest = runs.reduce((maximum, run) => Math.max(maximum, run.level), 0);
    const lowestOdd = runs.reduce((minimum, run) => run.level % 2 ? Math.min(minimum, run.level) : minimum, Infinity);
    for (let level = highest; level >= lowestOdd; level--) {
      for (let start = 0; start < runs.length;) {
        let end = start;
        while (end < runs.length && runs[end]!.level >= level) end++;
        if (end > start) runs.splice(start, end - start, ...runs.slice(start, end).reverse());
        start = Math.max(start + 1, end);
      }
    }

    const glyphs: Glyph[] = [];
    const bounds = { minX: 0, maxX: 0, minY: Infinity, maxY: -Infinity };
    let pen = 0;
    for (const run of runs) {
      const face = fonts[run.font];
      // fontkit 1.1.1 implements script/language/direction as extra layout arguments.
      const layout = face.layout as (text: string, features: [], script: string | null, language: null, direction: Direction) => GlyphRun;
      const logical = run.chunks.join('');
      const { glyphs: shaped, positions } = layout.call(face, logical, [], arabic.test(logical) ? 'arab' : null, null, run.level % 2 ? 'rtl' : 'ltr');
      for (const [positionIndex, glyph] of shaped.entries()) {
        if (glyph.id === 0) {
          cache.set(key, undefined);
          return undefined;
        }
        const offset = positions[positionIndex]!;
        const x = pen + offset.xOffset / face.unitsPerEm;
        const y = offset.yOffset / face.unitsPerEm;
        const { minX, maxX, minY, maxY } = glyph.bbox;
        if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
          bounds.minX = Math.min(bounds.minX, x + minX / face.unitsPerEm);
          bounds.maxX = Math.max(bounds.maxX, x + maxX / face.unitsPerEm);
          bounds.minY = Math.min(bounds.minY, y + minY / face.unitsPerEm);
          bounds.maxY = Math.max(bounds.maxY, y + maxY / face.unitsPerEm);
          glyphs.push({ id: glyph.id, font: run.font, x, y });
        }
        pen += offset.xAdvance / face.unitsPerEm;
      }
    }
    bounds.maxX = Math.max(bounds.maxX, pen);
    if (!glyphs.length) bounds.minY = bounds.maxY = 0;
    const shaped: Line = { text, direction, bounds, painted: glyphs.length > 0, glyphs };
    cache.set(key, shaped);
    return shaped;
  }

  return { line };
}

type Shaper = ReturnType<typeof createShaper>;
type FitError = 'too-narrow' | 'too-low' | 'unsupported-glyph' | 'unsupported-line-break';

export function fitText(shaper: Shaper, value: string, multiline: boolean, options: {
  innerWidth: number; innerHeight: number; padding: number; min: number; max: number; alignment?: number;
}): Placement | FitError {
  const { innerWidth, innerHeight, padding, min, max, alignment } = options;
  if (innerWidth <= 0) return 'too-narrow';
  if (innerHeight <= 0 || max < min) return 'too-low';
  if (!multiline && paragraphBreak.test(value)) return 'unsupported-line-break';
  // Tabs have an explicit visual width while the exact source remains in the canonical /V.
  const paragraphs = value.replaceAll('\t', '    ').split(paragraphBreak);
  const shaped = paragraphs.map((paragraph) => shaper.line(paragraph));
  if (shaped.some((line) => !line) || (value.trim() && !shaped.some((line) => line?.painted))) return 'unsupported-glyph';

  function layout(size: number): Placement | FitError {
    const wrapped: Line[] = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      const original = shaped[index]!;
      const fits = (line: Line) => (line.bounds.maxX - line.bounds.minX) * size <= innerWidth;
      if (fits(original)) {
        wrapped.push(original);
        continue;
      }
      if (!multiline) return 'too-narrow';
      let pending = '';
      // Dashes/IDs stay intact. Only break at whitespace; ignore soft wrap separators at line edges.
      for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
        if (!pending || /^\s+$/u.test(token)) {
          pending += token;
          continue;
        }
        const candidate = shaper.line(pending + token, original.direction);
        if (!candidate) return 'unsupported-glyph';
        if (fits(candidate)) pending += token;
        else {
          const complete = shaper.line(pending.trimEnd(), original.direction);
          if (!complete) return 'unsupported-glyph';
          if (!fits(complete)) return 'too-narrow';
          if (complete.text) wrapped.push(complete);
          pending = token;
        }
      }
      const last = shaper.line(pending.trimEnd(), original.direction);
      if (!last) return 'unsupported-glyph';
      if (!fits(last)) return 'too-narrow';
      wrapped.push(last);
    }
    // Use at least one em between baselines, increasing it when marks or descenders need room.
    const baselines = [0];
    for (let index = 1; index < wrapped.length; index++) {
      const previous = wrapped[index - 1]!;
      const next = wrapped[index]!;
      baselines.push(baselines[index - 1]! - Math.max(1, next.bounds.maxY - previous.bounds.minY + 0.18));
    }
    let top = -Infinity;
    let bottom = Infinity;
    for (const [index, line] of wrapped.entries()) {
      top = Math.max(top, baselines[index]! + line.bounds.maxY);
      bottom = Math.min(bottom, baselines[index]! + line.bounds.minY);
    }
    const lineHeight = (top - bottom) * size;
    if (lineHeight > innerHeight) return 'too-low';
    return {
      size,
      lines: wrapped.map((line, index) => {
        const room = innerWidth - (line.bounds.maxX - line.bounds.minX) * size;
        const align = alignment ?? (line.direction === 'rtl' ? 2 : 0);
        const origin = padding + (align === 1 ? room / 2 : align === 2 ? room : 0) - line.bounds.minX * size;
        const baseline = padding + (innerHeight - lineHeight) / 2 + (baselines[index]! - bottom) * size;
        return { line, origin, baseline };
      }),
    };
  }

  const atMin = layout(min);
  if (typeof atMin === 'string') return atMin;
  const atMax = layout(max);
  if (typeof atMax !== 'string') return atMax;
  let best = atMin;
  let low = Math.ceil(min * 100);
  let high = Math.floor(max * 100);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = layout(middle / 100);
    if (typeof attempt === 'string') high = middle - 1;
    else {
      best = attempt;
      low = middle + 1;
    }
  }
  return best;
}
