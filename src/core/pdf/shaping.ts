import fontkit, { type Font, type GlyphRun } from '@pdf-lib/fontkit';
import createBidi from 'bidi-js';

type BundledFontKey = 'arabic' | 'latin';
export type FontKey = BundledFontKey | 'custom';
export type FontBytes = Record<BundledFontKey, Uint8Array>;
type Direction = 'rtl' | 'ltr';

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
interface Glyph { id: number; font: FontKey; x: number; y: number }
interface Line { text: string; direction: Direction; bounds: Bounds; painted: boolean; glyphs: Glyph[] }
export interface PlacedLine { line: Line; origin: number; baseline: number }
export interface Placement { size: number; lines: PlacedLine[] }

const faceCache = new WeakMap<FontBytes, Record<BundledFontKey, Font>>();
const bidi = createBidi();
const arabic = /\p{Script_Extensions=Arabic}/u;
const arabicLetter = /(?=\p{L})\p{Script=Arabic}/u;
const joinControl = /[\u200c\u200d]/u;
const paragraphBreak = /\r\n|[\r\n\u2028\u2029]/;
const isolateMarks = /[\u2066\u2067\u2069]/u;
const numberToken = /(?<![\p{L}\p{N}])(?:#[0-9\u0660-\u0669\u06f0-\u06f9]+|\+[0-9\u0660-\u0669\u06f0-\u06f9]+(?:[ .\u00a0\u202f-][0-9\u0660-\u0669\u06f0-\u06f9]+)*)/gu;
const arabicFilenameRun = /\p{Script=Arabic}[\p{Script=Arabic}\p{M}\u200c\u200d]*(?: +\p{Script=Arabic}[\p{Script=Arabic}\p{M}\u200c\u200d]*)*/gu;

export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 10;
export const DEFAULT_MIN_FONT_SIZE = 8;

export function textInputDiagnostic(value: string): 'unsupported-glyph' | 'unsupported-bidi' | undefined {
  const characters = Array.from(value);
  for (const [index, character] of characters.entries()) {
    if (joinControl.test(character)) {
      let before = index - 1;
      let after = index + 1;
      while (/\p{M}/u.test(characters[before] ?? '')) before--;
      while (/\p{M}/u.test(characters[after] ?? '')) after++;
      if (!arabicLetter.test(characters[before] ?? '') || !arabicLetter.test(characters[after] ?? '')) return 'unsupported-bidi';
    } else if (/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(character)) return 'unsupported-bidi';
    else if (/[\p{Cc}\p{Cs}]/u.test(character) && !/[\r\n\t]/u.test(character)) return 'unsupported-glyph';
  }
}

interface DirectionalRun { chunks: string[]; font: FontKey; level: number }

export function createShaper(bytes: FontBytes, preferred: BundledFontKey | 'auto', custom?: Font) {
  let faces = custom ? undefined : faceCache.get(bytes);
  if (!custom && !faces) {
    faces = { arabic: fontkit.create(bytes.arabic), latin: fontkit.create(bytes.latin) };
    faceCache.set(bytes, faces);
  }
  const cache = new Map<string, Line | undefined>();

  function line(text: string, base?: Direction, filename = false): Line | undefined {
    const key = `${filename ? 'filename' : base ?? ''}\0${text}`;
    if (cache.has(key)) return cache.get(key);
    // Give ID prefixes and international phones their own left-to-right direction in RTL text.
    // The isolates are used only by the ordering pass and never written to PDF data or glyphs.
    // Isolate Arabic words in the filename's LTR frame, keeping ASCII IDs and .pdf in filename order.
    const ordered = filename ? text.replace(arabicFilenameRun, '\u2067$&\u2069') : text;
    const directional = ordered.replace(numberToken, '\u2066$&\u2069');
    const { levels, paragraphs } = bidi.getEmbeddingLevels(directional, base);
    const direction = (paragraphs[0]?.level ?? (base === 'rtl' ? 1 : 0)) % 2 ? 'rtl' : 'ltr';
    const runs: DirectionalRun[] = [];
    let index = 0;
    for (const character of directional) {
      const level = levels[index] ?? 0;
      index += character.length;
      if (isolateMarks.test(character)) {
        runs.push({ chunks: [], font: 'latin', level });
        continue;
      }
      const last = runs.at(-1);
      const mirrored = level % 2 ? bidi.getMirroredCharacter(character) ?? character : character;
      const codepoint = mirrored.codePointAt(0)!;
      const suggested = arabic.test(mirrored) || joinControl.test(mirrored) ? 'arabic' : 'latin';
      const compatible = arabic.test(mirrored) || joinControl.test(mirrored) || preferred === 'auto' ? suggested : preferred;
      const alternate = compatible === 'arabic' ? 'latin' : 'arabic';
      const font = custom ? 'custom'
        : faces![compatible].hasGlyphForCodePoint(codepoint) || joinControl.test(mirrored) ? compatible : alternate;
      const face = font === 'custom' ? custom! : faces![font];
      if (!joinControl.test(mirrored) && !face.hasGlyphForCodePoint(codepoint)) {
        cache.set(key, undefined);
        return undefined;
      }
      if (last?.chunks.length && last.level === level && last.font === font) last.chunks.push(mirrored);
      else runs.push({ chunks: [mirrored], font, level });
    }

    // UAX #9 L2 reverses contiguous sequences, from highest embedding level to the lowest odd level.
    const highest = runs.reduce((maximum, run) => Math.max(maximum, run.level), 0);
    const lowestOdd = runs.reduce((minimum, run) => run.level % 2 ? Math.min(minimum, run.level) : minimum, Infinity);
    for (let level = highest; level >= lowestOdd; level--) {
      for (let start = 0; start < runs.length;) {
        let end = start;
        while (end < runs.length && runs[end]!.level >= level) end++;
        for (let left = start, right = end - 1; left < right; left++, right--) {
          [runs[left], runs[right]] = [runs[right]!, runs[left]!];
        }
        start = Math.max(start + 1, end);
      }
    }

    const glyphs: Glyph[] = [];
    const bounds = { minX: 0, maxX: 0, minY: Infinity, maxY: -Infinity };
    let pen = 0;
    for (const run of runs) {
      if (!run.chunks.length) continue;
      const face = run.font === 'custom' ? custom! : faces![run.font];
      // fontkit 1.1.1 implements script/language/direction as extra layout arguments.
      const layout = face.layout as (text: string, features: [], script: string | null, language: null, direction: Direction) => GlyphRun;
      const logical = run.chunks.join('');
      const { glyphs: shaped, positions } = layout.call(face, logical, [], arabic.test(logical) ? 'arab' : null, null, run.level % 2 ? 'rtl' : 'ltr');
      for (const [positionIndex, glyph] of shaped.entries()) {
        const offset = positions[positionIndex]!;
        if (!glyph.id || glyph.id > 0xffff || !offset || ![offset.xOffset, offset.yOffset, offset.xAdvance].every(Number.isFinite)) {
          cache.set(key, undefined);
          return undefined;
        }
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

  return {
    line, filenameLine: (text: string) => line(text, 'ltr', true),
    missingGlyphCode: custom ? 'missing-glyphs' as const : 'unsupported-glyph' as const,
  };
}

type Shaper = ReturnType<typeof createShaper>;
type FitError = 'too-narrow' | 'too-low' | 'unsupported-glyph' | 'missing-glyphs' | 'unsupported-line-break';
interface FitFailure { code: FitError; requiredFontSizePt?: number }

export function fitText(shaper: Shaper, value: string, multiline: boolean, options: {
  innerWidth: number; innerHeight: number; padding: number; min: number; max: number; alignment?: number;
}): Placement | FitFailure {
  const { innerWidth, innerHeight, padding, min, max, alignment } = options;
  if (innerWidth <= 0) return { code: 'too-narrow' };
  if (innerHeight <= 0 || max < MIN_FONT_SIZE) return { code: 'too-low' };
  if (!multiline && paragraphBreak.test(value)) return { code: 'unsupported-line-break' };
  // Tabs have an explicit visual width while the exact source remains in the canonical /V.
  const paragraphs = value.replaceAll('\t', '    ').split(paragraphBreak);
  const shaped = paragraphs.map((paragraph) => shaper.line(paragraph));
  if (shaped.some((line) => !line) || (value.trim() && !shaped.some((line) => line?.painted))) return { code: shaper.missingGlyphCode };

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
        if (!candidate) return shaper.missingGlyphCode;
        if (fits(candidate)) pending += token;
        else {
          const complete = shaper.line(pending.trimEnd(), original.direction);
          if (!complete) return shaper.missingGlyphCode;
          if (!fits(complete)) return 'too-narrow';
          if (complete.text) wrapped.push(complete);
          pending = token;
        }
      }
      const last = shaper.line(pending.trimEnd(), original.direction);
      if (!last) return shaper.missingGlyphCode;
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

  function highestFitting(initial: Placement, ceiling: number): Placement {
    let best = initial;
    let low = Math.ceil(best.size * 100);
    let high = Math.floor(ceiling * 100);
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

  const atMin = max < min ? 'too-low' : layout(min);
  if (typeof atMin === 'string') {
    if (min === MIN_FONT_SIZE || (atMin !== 'too-narrow' && atMin !== 'too-low')) return { code: atMin };
    const atFloor = layout(MIN_FONT_SIZE);
    if (typeof atFloor === 'string') return { code: atMin };
    // Report only a hundredth that was actually laid out and fit, so the UI can apply it verbatim.
    return { code: atMin, requiredFontSizePt: highestFitting(atFloor, Math.min(max, min)).size };
  }
  const atMax = layout(max);
  return typeof atMax === 'string' ? highestFitting(atMin, max) : atMax;
}
