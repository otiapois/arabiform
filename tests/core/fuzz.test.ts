import { readFile } from 'node:fs/promises';
import { posix, resolve, win32 } from 'node:path';
import fontkit, { type Font } from '@pdf-lib/fontkit';
import fc, { type IAsyncProperty } from 'fast-check';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { createAudit, createFlattenedZip, createZip, inspectCustomFont, matchChoice, preflightRow } from '../../src/core/pdf';
import { suggestBatchFontSize } from '../../src/core/pdf/batch-font-suggestion';
import { paginateCoverRows } from '../../src/core/pdf/merge-cover';
import { makeFilenames, planFilenames, readRoster } from '../../src/core/roster';

const seed = 0x4a216d32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const key = PDFName.of;
let acceptedCases = 0;
let discardedCases = 0;

const mixedText = fc.oneof(
  fc.array(fc.constantFrom('ن', 'ى', 'م', 'ي', 'ق', 'ب', 'أ', 'َ', 'ِ', 'ُ', 'ْ', 'ّ', 'ً', '١', '٢', '٠',
    'Name', ' ', '00123', '(A)', '#00123', '+966 50 012 3456', 'ع\u200dر', 'ع\u200cر', '🙂', '𐍈',
    '\u200e', '\u200f', '\u061c', '\u2066', '\u2067', '\u2069', '\u202e', '\u2028', '\x00', '\x1f', '\r\n', '\t', '\uD800'), { minLength: 1, maxLength: 22 }).map((chunks) => chunks.join('')),
  fc.constantFrom('مُحَمَّد سَالِم', 'بَنِي يَمَن', 'اَلْعَرَبِيَّةُ', 'الطلب #00123 - Riyadh 2026', '(أحمد - 0045)',
    '+966 50 012 3456', '١٢٣٤٥٦', '00123', '00007', 'ع\u200dر', 'ع\u200cر', 'نَ\u0651\u0652\u064E'),
  fc.constantFrom('ب', 'مُ', 'A', '🙂', '0', 'A نَ ').map((piece) => piece.repeat(500)),
  fc.string({ minLength: 1, maxLength: 28 }),
);

async function verify<T extends unknown[]>(property: IAsyncProperty<T>, numRuns: number) {
  const details = await fc.check(property, { seed, numRuns });
  discardedCases += details.numSkips;
  if (details.failed) throw new Error(`Replay seed ${details.seed}, path ${details.counterexamplePath}: ${JSON.stringify(details.counterexample)}`, { cause: details.errorInstance });
  expect(details.numRuns).toBe(numRuns);
  expect(details.numSkips).toBe(0);
  acceptedCases += details.numRuns;
}

afterAll(() => console.info(`fast-check seed ${seed}: ${acceptedCases} total accepted cases, ${discardedCases} discarded.`));

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
