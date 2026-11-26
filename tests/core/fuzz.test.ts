import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix, resolve, win32 } from 'node:path';
import fontkit, { type Font } from '@pdf-lib/fontkit';
import fc, { type IAsyncProperty } from 'fast-check';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { createCustodyManifest, hashCustodySources, sha256 } from '../../src/core/audit/custody';
import { parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';
import { createAudit, createFlattenedZip, createZip, inspectCustomFont, inspectTemplate, matchChoice, preflightRow, type AlignOverride } from '../../src/core/pdf';
import { suggestBatchFontSize } from '../../src/core/pdf/batch-font-suggestion';
import { CAPACITY_SAMPLE_LIMIT, inspectTemplateCapacities } from '../../src/core/pdf/capacity-inspector';
import { createGeneratedZip } from '../../src/core/pdf/exports';
import { inspectPrintMargins } from '../../src/core/pdf/margin-preflight';
import { paginateCoverRows } from '../../src/core/pdf/merge-cover';
import { createShaper, fitText } from '../../src/core/pdf/shaping';
import { watermarkLayout } from '../../src/core/pdf/watermark';
import { createBatchProcessor } from '../../src/core/worker/batch';
import { makeFilenames, planFilenames, readRoster, type RosterSheet } from '../../src/core/roster';
import { applyRosterHygiene, previewRosterHygiene } from '../../src/core/roster/hygiene';

const seed = 0x4a216d32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const key = PDFName.of;
let acceptedCases = 0;
let discardedCases = 0;
let failedProperties = 0;

const mixedText = fc.oneof(
  fc.array(fc.constantFrom('ن', 'ى', 'م', 'ي', 'ق', 'ب', 'أ', 'ـ', 'َ', 'ِ', 'ُ', 'ْ', 'ّ', 'ً', '١', '٢', '٠',
    'Name', ' ', '00123', '(A)', '#00123', '+966 50 012 3456', 'ع\u200dر', 'ع\u200cر', '🙂', '𐍈',
    '\u200e', '\u200f', '\u061c', '\u2066', '\u2067', '\u2069', '\u202e', '\u2028', '\x00', '\x1f', '\r\n', '\t', '\uD800'), { minLength: 1, maxLength: 22 }).map((chunks) => chunks.join('')),
  fc.constantFrom('مُحَمَّد سَالِم', 'بَنِي يَمَن', 'اَلْعَرَبِيَّةُ', 'الطلب #00123 - Riyadh 2026', '(أحمد - 0045)',
    '+966 50 012 3456', '١٢٣٤٥٦', '00123', '00007', 'ع\u200dر', 'ع\u200cر', 'نَ\u0651\u0652\u064E', 'مُحَـمَّد'),
  fc.constantFrom('ب', 'مُ', 'A', '🙂', '0', 'A نَ ').map((piece) => piece.repeat(500)),
  fc.string({ minLength: 1, maxLength: 28 }),
);

async function verify<T extends unknown[]>(property: IAsyncProperty<T>, numRuns: number) {
  const details = await fc.check(property, { seed, numRuns });
  discardedCases += details.numSkips;
  if (details.failed) failedProperties++;
  if (details.failed) throw new Error(`Replay seed ${details.seed}, path ${details.counterexamplePath}: ${JSON.stringify(details.counterexample)}`, { cause: details.errorInstance });
  expect(details.numRuns).toBe(numRuns);
  expect(details.numSkips).toBe(0);
  acceptedCases += details.numRuns;
}

afterAll(() => {
  console.info(`fast-check seed ${seed}: ${acceptedCases} total accepted cases, ${discardedCases} discarded, ${failedProperties} failed properties.`);
  expect(discardedCases).toBe(0);
});

describe('seeded adversarial files and PDF geometry', () => {
  it('roundtrips 320 generated CSV records with exact strings and leading zeros', async () => {
    await verify(fc.asyncProperty(mixedText, fc.integer({ min: 0, max: 99_999 }), fc.boolean(), async (raw, number, bom) => {
      const text = decoder.decode(encoder.encode(raw));
      const id = `00${String(number).padStart(5, '0')}`;
      const csv = `${bom ? '\uFEFF' : ''}${Papa.unparse([['ID', 'Value', 'Literal'], [id, text, '1.23457E+11']])}`;
      const roster = await readRoster(encoder.encode(csv), 'roster.CSV');
      expect(roster.sheets[0]?.rows).toEqual([{ values: { ID: id, Value: text, Literal: '1.23457E+11' }, warnings: [] }]);
    }), 320);
  });

  it('classifies 200 malformed roster attempts without parser crashes', async () => {
    await verify(fc.asyncProperty(fc.uint8Array({ maxLength: 160 }), fc.boolean(), async (bytes, xlsx) => {
      const outcome = await readRoster(bytes, xlsx ? 'bad.xlsx' : 'bad.csv').then(
        (roster) => ({ roster }),
        (error: unknown) => ({ error }),
      );
      if ('error' in outcome) {
        expect(outcome.error).toBeInstanceOf(Error);
        expect((outcome.error as Error).message).toMatch(/^(?:invalid-xlsx|invalid-roster-headers|invalid-csv)$/);
      } else {
        for (const sheet of outcome.roster.sheets) {
          expect(sheet.headers.length).toBeGreaterThan(0);
          expect(sheet.rows.every(({ values }) => Object.values(values).every((value) => typeof value === 'string'))).toBe(true);
        }
      }
    }), 200);
  });

  it('checks 360 filename and audit combinations against traversal, duplicate extraction, and formulas', async () => {
    const hostileName = fc.constantFrom('../x.pdf', 'x\\y.pdf', '/x.pdf', 'C:bad.pdf', 'ＣＯＮ.pdf', 'LPT².draft.pdf',
      'PRN .pdf', 'NUL.pdf', 'AUX.txt.pdf', 'a\u200fb.pdf', '／foo.pdf', 'x\0y.pdf', 'x\n.pdf', `${'ن'.repeat(300)}.pdf`);
    const formula = fc.constantFrom('=', '+', '-', '@', '  =', '\t=', '\r+', '\n', ' ＋', '＠', '\u200e-', '\uFEFF=');
    await verify(fc.asyncProperty(mixedText, hostileName, formula, async (raw, unsafe, prefix) => {
      const filename = prefix + raw;
      const rows = [{ ID: raw }, { ID: unsafe }, { ID: raw.normalize('NFD') }, { ID: raw.normalize('NFC') }, { ID: raw.toUpperCase() }];
      const names = makeFilenames(rows, '../{{ID}}.pdf');
      expect(names).toEqual(makeFilenames(rows, '../{{ID}}.pdf'));
      expect(new Set(names.map((name) => name.normalize('NFKC').toUpperCase())).size).toBe(rows.length);
      for (const name of names) {
        expect(win32.basename(name)).toBe(name);
        expect(posix.basename(name)).toBe(name);
        expect(name).not.toMatch(/^[.\s]|[\p{Cc}\p{Cf}\p{Cs}]/u);
        expect(encoder.encode(name).length).toBeLessThanOrEqual(255);
      }
      const content = Uint8Array.of(37, 80, 68, 70);
      const zip = createZip(names.map((name) => ({ filename: name, pdfBytes: content })));
      expect(Object.keys(unzipSync(zip))).toEqual(names);
      expect(() => createZip([{ filename: unsafe, pdfBytes: content }])).toThrow('invalid-export-filename');
      const report = createAudit([{ rowNumber: 3, filename, status: 'pass', diagnostics: [], fontSizes: {} }]);
      expect(JSON.parse(report.json)[0].filename).toBe(filename);
      expect(Papa.parse<string[]>(report.csv).data[1]?.[1]).toBe(`'${filename}`);
    }), 360);
  });

  it('runs 280 genuine AcroForm fills and proves each serialized glyph stays within its widget', async () => {
    const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
    const fonts = {
      arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
      latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
    };
    const naskh = fontkit.create(fonts.arabic);
    const sans = fontkit.create(fonts.latin);
    let passed = 0;
    let flagged = 0;
    const geometry = fc.record({
      width: fc.integer({ min: 8, max: 160 }), height: fc.integer({ min: 4, max: 90 }),
      pageAngle: fc.constantFrom(0, 90, 180, 270), widgetAngle: fc.constantFrom(0, 90, 180, 270),
      multiline: fc.boolean(), min: fc.integer({ min: 600, max: 1000 }).map((value) => value / 100),
      maxLen: fc.option(fc.integer({ min: 1, max: 45 }), { nil: undefined }),
    });
    await verify(fc.asyncProperty(mixedText, geometry, async (value, geometry) => {
      const template = await PDFDocument.create();
      const page = template.addPage([500, 500]);
      page.setRotation(degrees(geometry.pageAngle));
      const field = template.getForm().createTextField('Name');
      if (geometry.multiline) field.enableMultiline();
      if (geometry.maxLen !== undefined) field.setMaxLength(geometry.maxLen);
      field.addToPage(page, { x: 250, y: 250, width: geometry.width, height: geometry.height, rotate: degrees(geometry.widgetAngle), borderWidth: 0.6 });
      field.setFontSize(12);
      const raw = await template.save();
      const options = { fonts, minFontSize: geometry.min };
      const result = await preflightRow(raw, { Name: value }, options);
      if (result.status === 'flagged') {
        flagged++;
        expect(result.pdfBytes).toBeUndefined();
        expect(result.diagnostics.length).toBeGreaterThan(0);
        const diagnostic = result.diagnostics[0]!;
        if (diagnostic.maxLengthExcess !== undefined) expect(diagnostic.maxLengthExcess).toBe(Array.from(value).length - geometry.maxLen!);
        if (diagnostic.requiredFontSizePt !== undefined) {
          const reported = diagnostic.requiredFontSizePt;
          expect(reported).toBeGreaterThanOrEqual(6);
          expect(reported).toBeLessThan(geometry.min);
          expect((await preflightRow(raw, { Name: value }, { ...options, minFontSize: reported })).status).toBe('pass');
        }
        return;
      }
      passed++;
      expect(result.diagnostics).toEqual([]);
      const filled = await PDFDocument.load(result.pdfBytes!);
      const output = filled.getForm().getTextField('Name');
      expect(output.getText()).toBe(value);
      const widget = output.acroField.getWidgets()[0]!;
      const normal = widget.dict.lookup(key('AP'), PDFDict).lookup(key('N'));
      if (!(normal instanceof PDFRawStream)) throw new Error('Missing normal appearance');
      const bbox = normal.dict.lookup(key('BBox'), PDFArray);
      const quarterTurn = geometry.widgetAngle % 180 !== 0;
      const innerWidth = bbox.lookup(quarterTurn ? 3 : 2, PDFNumber).asNumber();
      const innerHeight = bbox.lookup(quarterTurn ? 2 : 3, PDFNumber).asNumber();
      let ink = 0;
      let face: Font | undefined;
      let size = 0;
      let x = 0;
      let y = 0;
      for (const command of decoder.decode(decodePDFRawStream(normal).decode()).split('\n')) {
        if (command.endsWith(' Tf')) {
          const [fontName, fontSize] = command.split(' ');
          face = fontName?.startsWith('/ArabiFormNaskh') ? naskh : sans;
          size = Number(fontSize);
        } else if (command.endsWith(' Tm')) {
          x = Number(command.split(' ')[4]);
          y = Number(command.split(' ')[5]);
        } else if (command.endsWith(' Tj')) {
          const glyphId = Number.parseInt(command.slice(1, 5), 16);
          const bounds = face!.getGlyph(glyphId).bbox;
          const scale = size / face!.unitsPerEm;
          expect(x + bounds.minX * scale).toBeGreaterThanOrEqual(1.5);
          expect(x + bounds.maxX * scale).toBeLessThanOrEqual(innerWidth - 1.5);
          expect(y + bounds.minY * scale).toBeGreaterThanOrEqual(1.5);
          expect(y + bounds.maxY * scale).toBeLessThanOrEqual(innerHeight - 1.5);
          ink++;
        }
      }
      if (value.trim()) expect(ink).toBeGreaterThan(0);
    }), 280);
    expect(passed).toBeGreaterThan(40);
    expect(flagged).toBeGreaterThan(40);
    console.info(`fast-check: 280 PDF fills (${passed} passed, ${flagged} flagged).`);
  }, 90_000);

  it('rejects 460 malformed custom font containers', async () => {
    const valid = await readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', 'public/fonts/NotoSans-Regular.ttf'));
    await verify(fc.asyncProperty(fc.uint8Array({ maxLength: 400 }), fc.integer({ min: 0, max: valid.length - 4 }), fc.nat(), async (noise, length, corruption) => {
      const bytes = corruption % 3 === 0 ? noise : Uint8Array.from(valid.subarray(0, length));
      if (bytes.length >= 12 && corruption % 3 === 1) new DataView(bytes.buffer).setUint16(4, 0xffff);
      if (bytes.length >= 28 && corruption % 3 === 2) new DataView(bytes.buffer).setUint32(20, 0xfffffff0);
      expect(() => inspectCustomFont(bytes)).toThrow('invalid-custom-font');
    }), 460);
  });

  it('checks 520 mapped checkbox cells with mixed spellings, blank values and unrecognized tokens', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage();
    const field = source.getForm().createCheckBox('Consent');
    for (const x of [30, 80]) field.addToPage(page, { x, y: 50 });
    const template = await source.save();
    const blank = new Uint8Array();
    const fonts = { arabic: blank, latin: blank };
    const tokens = fc.oneof(
      fc.constantFrom('true', 'yes', '1', 'x', 'نعم').map((token) => ({ token, expected: '/Yes' })),
      fc.constantFrom('false', 'no', '0', '', 'لا').map((token) => ({ token, expected: '/Off' })),
      mixedText.map((token) => ({ token: `?${token}`, expected: undefined })),
    );
    await verify(fc.asyncProperty(tokens, fc.boolean(), fc.constantFrom('', ' ', '\t', '\r\n', '\u00a0'), async ({ token, expected }, upper, padding) => {
      // Checkbox-only rows never need to parse or embed bundled text fonts.
      const result = await preflightRow(template, { Consent: padding + (upper ? token.toUpperCase() : token) + padding }, { fonts });
      if (!expected) {
        expect(result.diagnostics).toEqual([{ field: 'Consent', code: 'invalid-checkbox-value', pageNumbers: [1] }]);
        expect(result.pdfBytes).toBeUndefined();
        return;
      }
      expect(result.diagnostics).toEqual([]);
      const document = await PDFDocument.load(result.pdfBytes!);
      const checkbox = document.getForm().getCheckBox('Consent').acroField;
      expect(checkbox.dict.get(key('V'))?.toString()).toBe(expected);
      expect(checkbox.getWidgets().map(({ dict }) => dict.get(key('AS'))?.toString())).toEqual([expected, expected]);
    }), 520);
  }, 60_000);

  it('flags 420 custom Latin font rows containing missing Arabic glyphs', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage();
    source.getForm().createTextField('Name').addToPage(page, { x: 30, y: 50, width: 250, height: 30 });
    const template = await source.save();
    const customFont = await readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', 'public/fonts/NotoSans-Regular.ttf'));
    const fonts = { arabic: customFont, latin: customFont };
    const name = fc.array(fc.constantFrom('نَ', 'ي', 'مُ', 'بَ', 'سّ', 'ى', 'ل', 'ر', 'ا'), { minLength: 1, maxLength: 12 }).map((letters) => letters.join(''));
    await verify(fc.asyncProperty(name, fc.nat({ max: 9999 }), fc.boolean(), async (arabic, id, reversed) => {
      const latin = `#${String(id).padStart(5, '0')} Alex`;
      const value = reversed ? `${latin} (${arabic})` : `${arabic} ${latin}`;
      const result = await preflightRow(template, { Name: value }, { fonts, customFont });
      expect(result.diagnostics).toEqual([{ field: 'Name', code: 'missing-glyphs', widgetIndex: 0, pageNumbers: [1] }]);
      expect(result.pdfBytes).toBeUndefined();
    }), 420);
  }, 60_000);
});

describe('seeded cover pagination and batch font recommendations', () => {
  it('checks 620 cover indexes with uneven page counts and just-fitting rows', async () => {
    const count = fc.oneof(fc.constantFrom(1, 25, 80), fc.integer({ min: 1, max: 80 }));
    const geometry = count.chain((length) => fc.array(fc.record({
      height: fc.integer({ min: 20, max: 115 }),
      pageCount: fc.integer({ min: 1, max: 12 }),
    }), { minLength: length, maxLength: length }));
    await verify(fc.asyncProperty(geometry, fc.integer({ min: 160, max: 740 }), async (rows, firstTop) => {
      const nextTop = 780;
      const bottom = 40;
      const pages = paginateCoverRows(rows, firstTop, nextTop, bottom);
      let expectedPage = pages.length + 1;
      let index = 0;
      for (const [page, positions] of pages.entries()) {
        expect(positions.length).toBeGreaterThan(0);
        let top = page === 0 ? firstTop : nextTop;
        for (const entry of positions) {
          const row = rows[index]!;
          expect(entry).toEqual({ index, top, startPage: expectedPage, endPage: expectedPage + row.pageCount - 1 });
          expectedPage += row.pageCount;
          top -= row.height;
          expect(top).toBeGreaterThanOrEqual(bottom);
          index++;
        }
        if (page < pages.length - 1) expect(top - rows[index]!.height).toBeLessThan(bottom);
      }
      expect(index).toBe(rows.length);
      expect(expectedPage).toBe(pages.length + rows.reduce((sum, row) => sum + row.pageCount, 1));
    }), 620);
  });

  it('checks 400 optimizer batches around the floor with mixed diagnoses', async () => {
    const mode = fc.constantFrom('pass', 'empty', 'size', 'missing', 'mixed', 'bad-value');
    const options = fc.array(fc.record({
      mode, width: fc.integer({ min: 550, max: 1050 }), height: fc.integer({ min: 550, max: 1050 }),
    }), { minLength: 1, maxLength: 20 });
    await verify(fc.asyncProperty(fc.integer({ min: 600, max: 1000 }), options, async (current, options) => {
      const rows = options.map(({ mode, width, height }) => {
        const narrow = { code: 'too-narrow' as const, requiredFontSizePt: width / 100 };
        const low = { code: 'too-low' as const, requiredFontSizePt: height / 100 };
        const invalid = { code: 'exceeds-maxlen' as const, requiredFontSizePt: 6 };
        const diagnostics = {
          pass: [narrow, low], empty: [], size: [narrow, low], missing: [narrow, { code: 'too-low' as const }],
          mixed: [narrow, invalid], 'bad-value': [{ ...narrow, requiredFontSizePt: NaN }],
        }[mode];
        return { status: mode === 'pass' ? 'pass' as const : 'flagged' as const, diagnostics };
      });
      const floors = options.flatMap(({ mode, width, height }) => {
        const min = Math.min(width, height);
        const max = Math.max(width, height);
        return mode === 'size' && min >= 600 && max < current ? [min] : [];
      });
      expect(suggestBatchFontSize(rows, current / 100)).toEqual(floors.length ? {
        minFontSizePt: Math.min(...floors) / 100, fixableRows: floors.length,
      } : undefined);
    }), 400);
  });
});

describe('seeded choice fields and individual print ZIPs', () => {
  const space = fc.constantFrom('', ' ', '\t', '\u00a0', '\u2003');
  const atom = fc.constantFrom('a', 'A', 'été', 'e\u0301te\u0301', 'مَن', 'من', '００１', '001', 'نَ', 'ن', 'Riyadh', '🙂', '');

  it('checks 1000 option tables for collisions across literal exports and labels', async () => {
    const token = fc.tuple(space, atom, space).map((parts) => parts.join(''));
    await verify(fc.asyncProperty(fc.array(fc.record({ value: token, label: token }), { maxLength: 15 }), token, async (choices, input) => {
      const candidates = choices.flatMap(({ value, label }, i) => [{ text: value, index: i }, { text: label, index: i }]);
      const exact = new Set(candidates.filter(({ text }) => text === input).map(({ index }) => index));
      const trimmed = new Set(candidates.filter(({ text }) => text.trim() === input.trim()).map(({ index }) => index));
      const matches = exact.size ? exact : trimmed;
      const expected = matches.size === 1 ? matches.values().next().value : undefined;
      expect(matchChoice(choices, input)).toBe(expected);
    }), 1000);
  });

  it('runs 300 serialized dropdown and radio fills with strict choices, subsetting, and malformed variants', async () => {
    const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
    const fonts = {
      arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
      latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
    };
    const source = await PDFDocument.create();
    const [first, second] = [source.addPage(), source.addPage()];
    const form = source.getForm();
    const contact = form.createRadioGroup('Contact');
    contact.addOptionToPage('CALL', first, { x: 30, y: 50 });
    contact.addOptionToPage('بريد', second, { x: 30, y: 50 });
    contact.select('CALL');
    const clinic = form.createDropdown('Clinic');
    clinic.addOptions(['Default']);
    clinic.addToPage(second, { x: 40, y: 90, width: 220, height: 26 });
    form.updateFieldAppearances();
    const display = 'عِيَادَةُ الرِّيَاضِ';
    clinic.acroField.dict.set(key('Opt'), source.context.obj([[PDFString.of('RIY'), PDFHexString.fromText(display)], PDFString.of('JED')]));
    const input = await source.save({ updateFieldAppearances: false });
    const broken = await PDFDocument.load(input);
    const brokenRadio = broken.getForm().getRadioGroup('Contact');
    brokenRadio.select('بريد');
    brokenRadio.acroField.getWidgets()[1]!.dict.delete(key('AS'));
    broken.getForm().getDropdown('Clinic').enableMultiselect();
    const unsupported = await broken.save({ updateFieldAppearances: false });
    let passed = 0;
    let flagged = 0;
    const cases = fc.constantFrom(
      { field: 'Clinic', token: display, expected: 'RIY' },
      { field: 'Clinic', token: 'RIY', expected: 'RIY' },
      { field: 'Clinic', token: 'JED', expected: 'JED' },
      { field: 'Clinic', token: 'riy', expected: undefined },
      { field: 'Contact', token: 'CALL', expected: '/0' },
      { field: 'Contact', token: 'بريد', expected: '/1' },
      { field: 'Contact', token: 'بَرِيد', expected: undefined },
    );
    await verify(fc.asyncProperty(cases, space, space, fc.boolean(), fc.integer({ min: 0, max: 6 }), async ({ field, token, expected }, left, right, custom, variant) => {
      // Widgets with absent /AS can be legally off. Mark the second on before
      // dropping its /AS to exercise rejection of an inconsistent selection.
      const malformed = variant === 0;
      const result = await preflightRow(malformed ? unsupported : input, { [field]: left + token + right }, {
        fonts, customFont: custom && field === 'Clinic' && expected === 'RIY' ? fonts.arabic : undefined,
      });
      if (malformed || expected === undefined) {
        flagged++;
        expect(result.pdfBytes).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe(!malformed ? 'invalid-choice'
          : field === 'Clinic' ? 'unsupported-field-mode' : 'unsupported-radio-appearance');
        expect(result.pageNumbers).toEqual(field === 'Clinic' || malformed ? [2] : [1, 2]);
        return;
      }
      passed++;
      expect(result.status).toBe('pass');
      const saved = await PDFDocument.load(result.pdfBytes!);
      const mapped = saved.getForm().getField(field).acroField;
      const value = mapped.dict.lookup(key('V'));
      if (field === 'Contact') {
        expect(value?.toString()).toBe(expected);
        expect(mapped.getWidgets().map((widget) => widget.getAppearanceState()?.toString()))
          .toEqual(expected === '/0' ? ['/0', '/Off'] : ['/Off', '/1']);
      } else {
        expect((value as PDFString).decodeText()).toBe(expected);
        const ap = saved.context.lookup(mapped.getWidgets()[0]!.getNormalAppearance());
        expect(ap).toBeInstanceOf(PDFRawStream);
        const stream = decoder.decode(decodePDFRawStream(ap as PDFRawStream).decode());
        expect(stream).toContain(PDFHexString.fromText(expected === 'RIY' ? display : 'JED').toString());
        expect(stream).toContain(custom && expected === 'RIY' ? '/ArabiFormCustom' : '/ArabiForm');
      }
    }), 300);
    expect(passed).toBeGreaterThan(100);
    expect(flagged).toBeGreaterThan(30);
    console.info(`fast-check M4: 300 real choice rows (${passed} passed, ${flagged} flagged).`);
  }, 120_000);

  it('checks 240 print ZIPs against state corruption, legacy appearances, and unsafe or colliding names', async () => {
    const source = await PDFDocument.create();
    const checkbox = source.getForm().createCheckBox('Approval');
    checkbox.addToPage(source.addPage(), { x: 30, y: 80 });
    checkbox.check();
    const editable = await source.save();
    const widget = checkbox.acroField.getWidgets()[0]!.dict;
    widget.delete(key('AS'));
    const noState = await source.save({ updateFieldAppearances: false });
    widget.delete(key('AP'));
    const noAppearance = await source.save({ updateFieldAppearances: false });
    const variants = fc.constantFrom('clean', 'clean', 'no-state', 'no-appearance', 'unsafe', 'collision');
    await verify(fc.asyncProperty(variants, fc.integer({ min: 0, max: 9999 }), fc.boolean(), async (variant, id, arabic) => {
      const first = { filename: `00${id}-${arabic ? 'عقد' : 'Form'}.pdf`, pdfBytes: editable };
      const second = {
        filename: variant === 'unsafe' ? '../bad.pdf' : variant === 'collision' ? first.filename.toUpperCase() : 'second.pdf',
        pdfBytes: variant === 'no-state' ? noState : variant === 'no-appearance' ? noAppearance : editable,
      };
      const rows = [first, second];
      if (variant === 'unsafe' || variant === 'collision') {
        await expect(createFlattenedZip(rows)).rejects.toThrow('invalid-export-filename');
        return;
      }
      expect(unzipSync(createZip(rows))[second.filename]).toEqual(second.pdfBytes);
      const reported: number[] = [];
      const flattened = createFlattenedZip(rows, (completed) => reported.push(completed));
      if (variant !== 'clean') {
        await expect(flattened).rejects.toThrow('unflattenable-widget');
        expect(reported).toEqual([0, 1]);
        return;
      }
      const members = unzipSync(await flattened);
      expect(Object.keys(members)).toEqual(rows.map(({ filename }) => filename));
      expect(reported).toEqual([0, 1, 2]);
      for (const row of rows) {
        const doc = await PDFDocument.load(members[row.filename]!);
        expect(doc.catalog.has(key('AcroForm'))).toBe(false);
        expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
        expect(doc.getPage(0).node.Resources()?.lookup(key('XObject'))).toBeInstanceOf(PDFDict);
      }
    }), 240);
  }, 120_000);
});

describe('seeded filename plans and mixed-direction choices', () => {
  it('checks 720 filename batches including suffix gaps, compatibility device names and grapheme truncation', async () => {
    const devices = fc.constantFrom<readonly [string, string]>(
      ['CON', 'ｃｏｎ'], ['PRN', 'prn'], ['AUX', 'ＡＵＸ'], ['NUL', 'nul'], ['ＣＯＮＯＵＴ＄', 'conout$'], ['COM²', 'com2'], ['LPT¹', 'lpt1'],
    );
    const stems = fc.record({
      title: fc.constantFrom('Case', 'Résumé', 'محضر', 'Note'),
      id: fc.integer({ min: 0, max: 9999 }),
      unsafe: fc.constantFrom('../', '／', '\u200f', '\x00', '\u2067'),
      device: devices,
      extension: fc.constantFrom('', '.draft', '.00123', '.con.txt'),
      cluster: fc.constantFrom('é', 'نَ', '🙂', '漢'),
    });
    await verify(fc.asyncProperty(stems, async ({ title, id, unsafe, device: [firstDevice, secondDevice], extension, cluster }) => {
      const stem = `${title}-${String(id).padStart(5, '0')}`;
      const long = cluster.repeat(200);
      const shortened = cluster.repeat(Math.floor(180 / encoder.encode(cluster).length));
      const rows = [stem, `${stem}-2`, `${unsafe}${stem.toUpperCase()}`, stem.normalize('NFD'),
        `${unsafe}${firstDevice}${extension}`, `${secondDevice}${extension}`, long.normalize('NFD'), long].map((ID) => ({ ID }));
      const plan = planFilenames(rows, '{{ID}}');
      expect(plan).toEqual([
        { filename: `${stem}.pdf`, filenameAdjusted: false },
        { filename: `${stem}-2.pdf`, filenameAdjusted: false },
        { filename: `${stem.toUpperCase()}-3.pdf`, filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
        { filename: `${stem}-4.pdf`, filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
        { filename: `_${firstDevice}${extension}.pdf`, filenameAdjusted: true, filenameAdjustReason: 'reserved-name' },
        { filename: `_${secondDevice}${extension}-2.pdf`, filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
        { filename: `${shortened}.pdf`, filenameAdjusted: true, filenameAdjustReason: 'sanitized' },
        { filename: `${shortened}-2.pdf`, filenameAdjusted: true, filenameAdjustReason: 'collision-dedup' },
      ]);
      const content = Uint8Array.of(37, 80, 68, 70);
      const members = unzipSync(createZip(plan.map(({ filename }) => ({ filename, pdfBytes: content }))));
      expect(Object.keys(members)).toEqual(plan.map(({ filename }) => filename));
      expect(Object.values(members)).toEqual(plan.map(() => content));
    }), 720);
  });

  it('runs 240 serialized mixed-direction choices through bundled and loaded custom faces', async () => {
    const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
    const fonts = {
      arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
      latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
    };
    const source = await PDFDocument.create();
    const field = source.getForm().createDropdown('Clinic');
    field.addOptions(['Default']);
    field.addToPage(source.addPage(), { x: 40, y: 90, width: 300, height: 30 });
    source.getForm().updateFieldAppearances();
    const variants = fc.record({
      arabic: fc.constantFrom('عِيَادَةُ', 'الرِّيَاضِ', 'بَنِي يَمَن', 'يُسْرَى مُؤْمِن', 'مُحَمَّد سَالِم'),
      id: fc.integer({ min: 0, max: 9999 }),
      leftToRightFirst: fc.boolean(),
      useLabel: fc.boolean(),
      padding: fc.constantFrom('', ' ', '\t', '\u00a0'),
      font: fc.constantFrom('bundled', 'naskh-with-digits', 'naskh-with-latin', 'sans-with-arabic'),
    });
    const checkedFonts = new Set<string>();
    await verify(fc.asyncProperty(variants, async ({ arabic, id, leftToRightFirst, useLabel, padding, font }) => {
      const digits = String(id).padStart(5, '0');
      const leftToRight = font === 'naskh-with-digits' ? digits : `Clinic (#${digits})`;
      const display = leftToRightFirst ? `${leftToRight} ${arabic}` : `${arabic} ${leftToRight}`;
      const choice = `ID-${digits}`;
      field.acroField.dict.set(key('Opt'), source.context.obj([
        [PDFString.of(choice), PDFHexString.fromText(display)], PDFString.of('Default'),
      ]));
      const template = await source.save({ updateFieldAppearances: false });
      const customFont = font === 'bundled' ? undefined : font === 'sans-with-arabic' ? fonts.latin : fonts.arabic;
      const result = await preflightRow(template, { Clinic: padding + (useLabel ? display : choice) + padding }, { fonts, customFont });
      checkedFonts.add(font);
      if (font === 'naskh-with-latin' || font === 'sans-with-arabic') {
        expect(result.status).toBe('flagged');
        expect(result.diagnostics).toEqual([{ field: 'Clinic', code: 'missing-glyphs', widgetIndex: 0, pageNumbers: [1] }]);
        expect(result.pdfBytes).toBeUndefined();
        return;
      }
      expect(result.status).toBe('pass');
      expect(result.diagnostics).toEqual([]);
      const document = await PDFDocument.load(result.pdfBytes!);
      const dropdown = document.getForm().getDropdown('Clinic').acroField;
      expect(dropdown.dict.lookup(key('V'), PDFString).decodeText()).toBe(choice);
      const normal = document.context.lookup(dropdown.getWidgets()[0]!.getNormalAppearance());
      if (!(normal instanceof PDFRawStream)) throw new Error('Missing dropdown appearance');
      const stream = decoder.decode(decodePDFRawStream(normal).decode());
      expect(stream).toContain(`/ActualText ${PDFHexString.fromText(display).toString()}`);
      expect(stream).toMatch(/<[0-9A-F]{4}> Tj/);
      const faces = normal.dict.lookup(key('Resources'), PDFDict).lookup(key('Font'), PDFDict);
      if (!customFont) {
        expect(faces.keys().map(String)).toEqual(expect.arrayContaining([
          expect.stringMatching(/^\/ArabiFormNaskh-/), expect.stringMatching(/^\/ArabiFormSans-/),
        ]));
        return;
      }
      const keys = faces.keys();
      expect(keys.map(String)).toEqual([expect.stringMatching(/^\/ArabiFormCustom-/)]);
      const descriptor = faces.lookup(keys[0]!, PDFDict).lookup(key('DescendantFonts'), PDFArray)
        .lookup(0, PDFDict).lookup(key('FontDescriptor'), PDFDict);
      const subset = descriptor.lookup(key('FontFile2'));
      if (!(subset instanceof PDFRawStream)) throw new Error('Missing embedded custom TrueType subset');
      expect(decodePDFRawStream(subset).decode().length).toBeLessThan(customFont.length);
    }), 240);
    expect(checkedFonts).toEqual(new Set(['bundled', 'naskh-with-digits', 'naskh-with-latin', 'sans-with-arabic']));
  }, 120_000);
});

describe('seeded roster changes, explicit ink alignment and portable drafts', () => {
  it('checks 500 exact previews and full Undo snapshots for mixed Arabic, ASCII identifiers and literal characters', async () => {
    const flags = fc.record({
      normalizeSpaces: fc.boolean(), normalizeAlef: fc.boolean(), normalizeTaaMarbuta: fc.boolean(),
      normalizeAlefMaqsura: fc.boolean(), stripHarakat: fc.boolean(), matchCase: fc.boolean(),
      selectNotes: fc.boolean(), replaceLiteral: fc.boolean(),
    });
    const samples = fc.array(fc.record({
      alef: fc.constantFrom('أ', 'إ', 'آ'), mark: fc.constantFrom('\u064b', '\u0650', '\u065f', '\u0670'),
      joiner: fc.constantFrom('\u200c', '\u200d'), id: fc.nat({ max: 9999 }),
    }), { minLength: 1, maxLength: 9 });
    await verify(fc.asyncProperty(samples, flags, async (samples, { selectNotes, replaceLiteral, ...flags }) => {
      const operation = { ...flags, columns: selectNotes ? [2, 1, 0] : [1, 0], find: replaceLiteral ? 'a.*' : '', replace: '$&$1' };
      const roster: RosterSheet = {
        name: 'فريق', headers: ['ID', 'Name', 'Notes'],
        rows: samples.map(({ alef, mark, joiner, id }, index) => ({
          values: { ID: `00${String(id).padStart(4, '0')}`, Name: `  \u200B${alef}${mark}${joiner}بةى\u00a0 \tA.* a.*\uFEFF `, Notes: '\u200B 00123 \u00a0' },
          warnings: [{ code: 'excel-formula-warning', column: 'ID', source: { row: index + 2, column: 'A' }, formulaHasCachedValue: true }],
        })),
      };
      const original = JSON.stringify(roster);
      const changes = samples.flatMap(({ alef, mark, joiner }, rowIndex) => {
        const vowels = flags.stripHarakat ? '' : mark;
        const word = (flags.normalizeAlef ? 'ا' : alef) + vowels + joiner + 'ب'
          + (flags.normalizeTaaMarbuta ? 'ه' : 'ة') + (flags.normalizeAlefMaqsura ? 'ي' : 'ى');
        const phrase = replaceLiteral ? (flags.matchCase ? 'A.* $&$1' : '$&$1 $&$1') : 'A.* a.*';
        const after = flags.normalizeSpaces ? `${word} ${phrase}` : `  \u200B${word}\u00a0 \t${phrase}\uFEFF `;
        const { Name, Notes } = roster.rows[rowIndex]!.values;
        return [
          ...(Name !== after ? [{ rowIndex, columnIndex: 1, column: 'Name', before: Name, after }] : []),
          ...(selectNotes && flags.normalizeSpaces ? [{ rowIndex, columnIndex: 2, column: 'Notes', before: Notes, after: '00123' }] : []),
        ];
      });
      const affectedRows = new Set(changes.map(({ rowIndex }) => rowIndex)).size;
      const preview = previewRosterHygiene(roster, operation);
      expect(preview).toEqual({ affectedRows, affectedCells: changes.length, changes, samples: changes.slice(0, 5) });
      const transformed = applyRosterHygiene(roster, operation);
      expect(transformed.summary).toEqual({ operation, affectedRows, affectedCells: changes.length });
      for (const change of changes) expect(transformed.sheet.rows[change.rowIndex]!.values[change.column]).toBe(change.after);
      expect(transformed.undo).toBe(roster);
      expect(JSON.stringify(transformed.undo)).toBe(original);
      expect(transformed.sheet.rows.map(({ values }) => values.ID)).toEqual(roster.rows.map(({ values }) => values.ID));
      expect(transformed.sheet.rows.every(({ warnings }, row) => warnings === roster.rows[row]!.warnings)).toBe(true);
    }), 500);
  });

  it('checks all four anchors against actual glyph ink in 500 mixed-script layouts', async () => {
    const assets = process.env.ARABIFORM_ASSET_ROOT ?? '.';
    const fonts = {
      arabic: await readFile(resolve(assets, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
      latin: await readFile(resolve(assets, 'public/fonts/NotoSans-Regular.ttf')),
    };
    const measuredFaces = { arabic: fontkit.create(fonts.arabic), latin: fontkit.create(fonts.latin) };
    const shaper = createShaper(fonts, 'auto');
    const modes: AlignOverride[] = ['auto', 'rtl', 'ltr', 'center'];
    const geometry = fc.record({
      innerWidth: fc.integer({ min: 18, max: 260 }), innerHeight: fc.integer({ min: 7, max: 80 }),
      padding: fc.integer({ min: 2, max: 7 }), alignment: fc.constantFrom(undefined, 0, 1, 2),
      multiline: fc.boolean(), max: fc.integer({ min: 8, max: 18 }),
    });
    const values = fc.tuple(fc.constantFrom('  ', '', ' ', '  \t'), fc.constantFrom('بَنِي #00123', 'A jQ 00123', 'سَلْمَى Alex', 'إدارة ٠١٢3'),
      fc.constantFrom('', ' ', '    ', '\nرُقَيَّة نَاجِي  ')).map((parts) => parts.join(''));
    const verified: Record<AlignOverride, number> = { auto: 0, rtl: 0, ltr: 0, center: 0 };
    let flagged = 0;
    await verify(fc.asyncProperty(values, geometry, async (value, { multiline, ...geometry }) => {
      const options = { ...geometry, min: 8 };
      const auto = fitText(shaper, value, multiline, options);
      if ('code' in auto) flagged++;
      for (const mode of modes) {
        const output = fitText(shaper, value, multiline, { ...options, alignOverride: mode });
        if ('code' in auto || mode === 'auto') {
          expect(output).toEqual(auto);
          if ('code' in auto) continue;
        }
        if ('code' in output || 'code' in auto) throw new Error('Alignment changed the fit result');
        expect(output.size).toBe(auto.size);
        for (const [{ line, baseline, origin }, old] of output.lines.map((line, index) => [line, auto.lines[index]!] as const)) {
          expect(line.glyphs).toEqual(old.line.glyphs);
          expect(baseline).toBe(old.baseline);
          if (!line.painted) continue;
          let left = Infinity;
          let right = -Infinity;
          for (const glyph of line.glyphs) {
            if (glyph.font === 'custom') throw new Error('Expected a bundled font');
            const face = measuredFaces[glyph.font];
            const bounds = face.getGlyph(glyph.id).bbox;
            const size = output.size;
            const scale = size / face.unitsPerEm;
            left = Math.min(left, origin + glyph.x * size + bounds.minX * scale);
            right = Math.max(right, origin + glyph.x * size + bounds.maxX * scale);
            expect(baseline + glyph.y * size + bounds.minY * scale).toBeGreaterThanOrEqual(options.padding - 1e-8);
            expect(baseline + glyph.y * size + bounds.maxY * scale).toBeLessThanOrEqual(options.padding + options.innerHeight + 1e-8);
          }
          const start = left - options.padding;
          const end = options.padding + options.innerWidth - right;
          expect(start).toBeGreaterThanOrEqual(-1e-8);
          expect(end).toBeGreaterThanOrEqual(-1e-8);
          if (mode === 'ltr') expect(start).toBeCloseTo(0, 8);
          if (mode === 'rtl') expect(end).toBeCloseTo(0, 8);
          if (mode === 'center') expect(start).toBeCloseTo(end, 8);
        }
        verified[mode]++;
      }
    }), 500);
    expect(flagged).toBeGreaterThan(40);
    expect(verified).toEqual(Object.fromEntries(modes.map((mode) => [mode, 500 - flagged])));
    console.info(`fast-check: ${500 - flagged} fitting and ${flagged} flagged layouts in each of the four alignment modes.`);
  }, 30_000);

  it('rejects 500 malformed drafts while roundtripping edits for exact inputs', async () => {
    const corruption = fc.constantFrom('json', 'row', 'column', 'cell', 'mapping', 'alignment', 'unexpected-key', 'summary', 'hash', 'version');
    await verify(fc.asyncProperty(mixedText, corruption, fc.nat({ max: 9999 }), async (text, mode, row) => {
      const source = {
        templateSha256: 'a'.repeat(64), rosterSha256: 'b'.repeat(64), fields: ['Name'],
        sheetName: 'Roster', columns: ['Name', '__proto__'], rowCount: row + 1,
      };
      const draft: BatchDraft = {
        kind: 'arabiform-batch-draft', version: 1, source,
        edits: { [row]: { Name: text, ['__proto__']: '00123' } },
        settings: { version: 4, mapping: { Name: 'Name' }, filenamePattern: '{{Name}}.pdf', minFontSize: 8,
          font: 'auto', flattenZip: false, includeCoverSheet: true, alignOverrides: { Name: 'center' } },
        hygiene: [{ operation: { columns: [0] }, affectedRows: 1, affectedCells: 1 }], customFontSha256: null,
      };
      const saved = serializeBatchDraft(draft);
      expect(parseBatchDraft(saved, source)).toEqual(draft);
      expect(() => parseBatchDraft(saved, { ...source, rosterSha256: 'f'.repeat(64) })).toThrow('batch-draft-source-mismatch');
      const corrupted = {
        json: {},
        row: { edits: { [row + 1]: { Name: text } } },
        column: { edits: { [row]: { constructor: text } } },
        cell: { edits: { [row]: { Name: [text] } } },
        mapping: { settings: { ...draft.settings, mapping: { Name: text + '!' } } },
        alignment: { settings: { ...draft.settings, alignOverrides: { Name: text + '!' } } },
        'unexpected-key': { ['__proto__']: text },
        summary: { hygiene: [{ ...draft.hygiene[0], affectedCells: 2 }] },
        hash: { source: { ...source, templateSha256: text + '!' } },
        version: { version: row + 2 },
      };
      expect(() => parseBatchDraft(mode === 'json' ? '#' + text : JSON.stringify({ ...draft, ...corrupted[mode] }), source))
        .toThrow('invalid-batch-draft');
    }), 500);
  });
});

describe('seeded print stamps, template capacities and chunked batches', () => {
  const asset = (filename: string) => readFile(resolve(process.env.ARABIFORM_ASSET_ROOT ?? '.', filename));
  const bundledFonts = async () => ({
    arabic: await asset('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await asset('public/fonts/NotoSans-Regular.ttf'),
  });

  it('checks 420 shaped stamp bounds for offset portrait, landscape and all page rotations', async () => {
    const shaper = createShaper(await bundledFonts(), 'auto');
    const geometry = fc.record({
      x: fc.integer({ min: -200, max: 200 }), y: fc.integer({ min: -200, max: 200 }),
      width: fc.integer({ min: 90, max: 1000 }), height: fc.integer({ min: 90, max: 1000 }),
      rotation: fc.constantFrom(0, 90, 180, 270), angle: fc.constantFrom(-45 as const, 0 as const, 45 as const),
    });
    const samples = fc.constantFrom('DRAFT', 'CONFIDENTIAL', 'مَسْوَدَّة', 'سِرِّي', 'DRAFT / مَسْوَدَّة', '00123 سَلْمَى');
    await verify(fc.asyncProperty(samples, geometry, async (text, { angle, rotation, ...box }) => {
      const line = shaper.line(text)!;
      const { size, origin, baseline, matrix, margin } = watermarkLayout(line, box, rotation, angle);
      const [a, b, c, d, e, f] = matrix;
      const actual = Math.atan2(b, a) * 180 / Math.PI;
      expect(Math.sin((actual - rotation - angle) * Math.PI / 180)).toBeCloseTo(0, 9);
      expect(Math.cos((actual - rotation - angle) * Math.PI / 180)).toBeCloseTo(1, 9);
      for (const inkX of line.inkX) {
        for (const inkY of [line.bounds.minY, line.bounds.maxY]) {
          const x = origin + size * inkX;
          const y = baseline + size * inkY;
          expect(a * x + c * y + e).toBeGreaterThanOrEqual(box.x + margin - 1e-7);
          expect(a * x + c * y + e).toBeLessThanOrEqual(box.x + box.width - margin + 1e-7);
          expect(b * x + d * y + f).toBeGreaterThanOrEqual(box.y + margin - 1e-7);
          expect(b * x + d * y + f).toBeLessThanOrEqual(box.y + box.height - margin + 1e-7);
        }
      }
    }), 420);
  });

  it('checks 340 per-widget capacity estimates against the same sample ink and Unicode MaxLen', async () => {
    const fonts = await bundledFonts();
    const arabic = createShaper(fonts, 'arabic');
    const latin = createShaper(fonts, 'latin');
    const geometry = fc.record({
      innerWidth: fc.integer({ min: 1, max: 250 }), innerHeight: fc.integer({ min: 1, max: 50 }),
      maxLength: fc.option(fc.integer({ min: 0, max: 80 }), { nil: undefined }),
      multiline: fc.boolean(), min: fc.constantFrom(6, 8, 10),
    });
    await verify(fc.asyncProperty(geometry, async ({ innerWidth, innerHeight, maxLength, multiline, min }) => {
      const widget = { x: 0, y: 0, width: innerWidth + 3.2, height: innerHeight + 3.2,
        rotation: 0, defaultFontSize: 12, usable: true, innerWidth, innerHeight, pageIndex: 0 };
      const report = await inspectTemplateCapacities({
        pages: [{ width: 300, height: 100, rotation: 0, visibleBox: { x: 0, y: 0, width: 300, height: 100 },
          printBounds: [0, 0, 300, 100], userUnit: 1 }],
        fields: [{ name: 'Name', kind: 'text', readOnly: false, required: false, multiline, maxLength,
          defaultFontSize: 12, supportsTextCapacity: true, value: '', widgets: [widget] }],
      }, fonts, min);
      const row = report.rows[0]!;
      for (const [count, shaper, sample] of [[row.arabicCharacters!, arabic, 'مُحَمَّد سَالِم '],
        [row.latinCharacters!, latin, 'Marwan Salem ']] as const) {
        expect(count).toBeGreaterThanOrEqual(0);
        expect(count).toBeLessThanOrEqual(maxLength ?? CAPACITY_SAMPLE_LIMIT);
        if (!count) continue;
        const text = sample.repeat(Math.ceil(count / sample.length)).slice(0, count);
        expect(Array.from(text)).toHaveLength(count);
        expect(fitText(shaper, text, multiline, { innerWidth, innerHeight, padding: 0, min, max: min })).not.toHaveProperty('code');
      }
    }), 340);
  }, 60_000);

  it('checks 180 chunked Worker state sequences with mixed checkbox outcomes around every 25-row boundary', async () => {
    const document = await PDFDocument.create();
    const field = document.getForm().createCheckBox('Consent');
    field.addToPage(document.addPage(), { x: 20, y: 40 });
    const template = await document.save();
    const fonts = { arabic: new Uint8Array(), latin: new Uint8Array() };
    const inputValues = fc.array(fc.constantFrom('true', 'false', 'invalid', 'نعم', 'لا'), { minLength: 1, maxLength: 78 });
    await verify(fc.asyncProperty(inputValues, fc.nat(), async (values, index) => {
      const process = createBatchProcessor();
      const observed: number[] = [];
      const rows = values.map((Consent) => ({ Consent }));
      const rowIndex = index % rows.length;
      const roster = encoder.encode(['Consent', ...values].join('\n'));
      const result = await process({ phase: 'preflight', input: { template, roster, rows, options: { fonts } } },
        ({ completed }) => observed.push(completed));
      expect(observed).toEqual([0, ...Array.from({ length: Math.ceil(rows.length / 25) }, (_, chunk) =>
        Math.min(rows.length, (chunk + 1) * 25))]);
      if (!result || !('rows' in result)) throw new Error('Expected metadata');
      expect(result.rows.map(({ status }) => status)).toEqual(values.map((value) => value === 'invalid' ? 'flagged' : 'pass'));
      expect(result.rows.every((row) => !Object.hasOwn(row, 'pdfBytes'))).toBe(true);
      if (values[rowIndex] === 'invalid' || index % 5 === 0) {
        const bytes = await process({ phase: 'preview', rowIndex }, () => {});
        expect(bytes instanceof Uint8Array).toBe(values[rowIndex] !== 'invalid');
      }
    }), 180);
  }, 60_000);
});

describe('seeded custody receipts and physical print margins', () => {
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  it('checks 800 raw input pairs and subviews against independent SHA-256', async () => {
    expect(await sha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    await verify(fc.asyncProperty(fc.uint8Array({ maxLength: 8192 }), fc.uint8Array({ maxLength: 8192 }),
      fc.integer({ min: 1, max: 23 }), async (template, roster, offset) => {
        const wrapper = new Uint8Array(template.length + offset + 7).fill(0xaf);
        wrapper.set(template, offset);
        const view = wrapper.subarray(offset, offset + template.length);
        const sources = await hashCustodySources(view, Uint8Array.from(roster).buffer);
        expect(sources).toEqual({ templateSha256: digest(template), rosterSha256: digest(roster) });
        const sourceOnly = createCustodyManifest(sources);
        expect(sourceOnly).toBe(createCustodyManifest(await hashCustodySources(template, roster)));
        expect(JSON.parse(sourceOnly)).toEqual({ version: 1, ...sources });
        if (view.length) {
          view[view.length - 1] = view[view.length - 1]! ^ 1;
          const changed = await sha256(view);
          expect(changed).toBe(digest(view));
          expect(changed).not.toBe(sources.templateSha256);
        }
      }), 800);
  });

  it('checks 300 ZIP receipts against extracted PDF bytes and rejects device names and traversal before generation', async () => {
    const templates = await Promise.all([120, 160, 200].map(async (width) => {
      const doc = await PDFDocument.create();
      const field = doc.getForm().createTextField('ID');
      field.addToPage(doc.addPage([width, 80]), { x: 20, y: 24, width: 56, height: 22 });
      field.setText(String(width).padStart(5, '0'));
      return doc.save();
    }));
    const unsafeName = fc.constantFrom('../case.pdf', '..\\case.pdf', 'C:case.pdf', '/case.pdf', 'CON.pdf', 'ＣＯＮ.txt.pdf',
      'LPT².form.pdf', 'COM9.pdf', 'NUL..pdf', 'AUX.txt.pdf', 'ＰＲＮ.pdf', 'x\u202ey.pdf');
    await verify(fc.asyncProperty(fc.array(fc.integer({ min: 0, max: templates.length - 1 }), { minLength: 1, maxLength: 5 }),
      fc.nat({ max: 100_000 }), unsafeName, async (indices, id, unsafe) => {
        const staged: string[] = [];
        const rows = indices.map((pdfIndex, index) => {
          const filename = `${String(id).padStart(5, '0')}-سَالِم ${index + 1}.pdf`;
          return { filename, getPdfBytes: async () => {
            staged.push(filename);
            return templates[pdfIndex]!;
          } };
        });
        await expect(createGeneratedZip([{ ...rows[0]!, filename: unsafe }])).rejects.toThrow('invalid-export-filename');
        expect(staged).toEqual([]);
        const archive = await createGeneratedZip(rows);
        const exact = Object.entries(unzipSync(archive.bytes));
        expect(staged).toEqual(rows.map(({ filename }) => filename));
        expect(exact.map(([filename]) => filename)).toEqual(staged);
        expect(exact.every(([, bytes], index) => Buffer.from(bytes).equals(Buffer.from(templates[indices[index]!]!)))).toBe(true);
        expect(archive.entries).toEqual(exact.map(([filename, bytes]) => ({ filename, sha256: digest(bytes), bytes: bytes.length })));
      }), 300);
  }, 15_000);

  it('checks 450 actual page boxes for exact physical fractional clearances through crop, scale and rotation', async () => {
    const geometry = fc.record({
      x: fc.integer({ min: -400, max: 400 }).map((value) => value / 4),
      y: fc.integer({ min: -400, max: 400 }).map((value) => value / 4),
      crop: fc.constantFrom('none', 'inside', 'partial', 'disjoint'),
      angle: fc.constantFrom(-90, 0, 90, 180, 270, 360, 450),
      userUnit: fc.constantFrom(0.5, 1, 2, 4), indirect: fc.boolean(),
      side: fc.constantFrom('left', 'right', 'bottom', 'top'),
      clearancePt: fc.oneof(fc.constantFrom(-0.25, 0, 8.75, 8.9990234375, 9, 9.0009765625),
        fc.integer({ min: 0, max: 80 }).map((value) => value / 4)),
    });
    const edges = ['top', 'right', 'bottom', 'left'];
    await verify(fc.asyncProperty(geometry, async ({ x, y, angle, crop, clearancePt, userUnit, indirect, side }) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([220, 180]);
      page.setMediaBox(x, y, 220, 180);
      page.setRotation(degrees(angle));
      const unit = PDFNumber.of(userUnit);
      page.node.set(key('UserUnit'), indirect ? doc.context.register(unit) : unit);
      let left = x;
      let bottom = y;
      let right = x + 220;
      let top = y + 180;
      if (crop === 'inside') {
        page.setCropBox(x + 10, y + 13, 180, 130);
        left += 10;
        bottom += 13;
        right = x + 190;
        top = y + 143;
      } else if (crop === 'partial') {
        page.setCropBox(x - 20, y + 13, 280, 130);
        bottom += 13;
        top = y + 143;
      } else if (crop === 'disjoint') page.setCropBox(x + 230, y + 190, 100, 100);
      const gap = clearancePt / userUnit;
      const widgetX = side === 'left' ? left + gap : side === 'right' ? right - gap - 26 : left + 75;
      const widgetY = side === 'bottom' ? bottom + gap : side === 'top' ? top - gap - 16 : bottom + 57;
      const form = doc.getForm();
      form.createTextField('قرب').addToPage(page, { x: widgetX, y: widgetY, width: 26, height: 16, borderWidth: 0 });
      form.createCheckBox('Unmapped').addToPage(page, { x: left + 1, y: bottom + 38, width: 15, height: 15, borderWidth: 0 });
      const metadata = await inspectTemplate(await doc.save());
      const displayedSide = edges[(edges.indexOf(side) + angle / 90 + 4) % edges.length];
      const expected = { code: 'margin-near-edge', field: 'قرب', pageNumber: 1, widgetIndex: 0, edge: displayedSide, clearancePt };
      expect(inspectPrintMargins(metadata, [])).toEqual([]);
      expect(inspectPrintMargins(metadata, ['قرب', 'missing'])).toEqual(clearancePt < 9 ? [expected] : []);
      expect(inspectPrintMargins(metadata, ['Unmapped'])).toHaveLength(1);
    }), 450);
  }, 30_000);

  it('keeps an exact 9 pt gap between decimal PDF coordinates out of the advisory', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([240, 180]);
    page.setCropBox(7.08, 9.67, 200, 150);
    const form = doc.getForm();
    for (const [name, x] of [['Below', 16.07999999], ['At', 16.08], ['Above', 16.08000001]] as const) {
      form.createTextField(name).addToPage(page, { x, y: 50, width: 40, height: 20, borderWidth: 0 });
    }
    const metadata = await inspectTemplate(await doc.save());
    expect(inspectPrintMargins(metadata, ['Below', 'At', 'Above'])).toEqual([
      { code: 'margin-near-edge', field: 'Below', pageNumber: 1, widgetIndex: 0, edge: 'left', clearancePt: 8.99999999 },
    ]);
  });
});
