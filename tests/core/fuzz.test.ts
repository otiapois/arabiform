import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix, resolve, win32 } from 'node:path';
import fontkit, { type Font } from '@pdf-lib/fontkit';
import fc, { type IAsyncProperty } from 'fast-check';
import { unzipSync, zipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { createCustodyManifest, hashCustodySources, sha256 } from '../../src/core/audit/custody';
import { createCustodyQrRecords } from '../../src/core/custody/records';
import { parseCustodyManifest, verifyCustodyPdf, verifyCustodyQr } from '../../src/core/custody/verify';
import { extractBatch } from '../../src/core/extractor/extract';
import { makeSpreadsheets } from '../../src/core/extractor/spreadsheets';
import { parseBatchDraft, serializeBatchDraft, type BatchDraft } from '../../src/core/draft/batch-draft';
import { validateMappingPreset } from '../../src/core/draft/mapping-preset';
import { isSafeGroupedPdfPath, planGroupedOutput, validateGroupingPlan } from '../../src/core/export/grouping';
import { authorFlatPdf, inspectFlatPdf, type FieldDraftSpec } from '../../src/core/designer/author';
import { clampDisplayRect, displayToSource, sourceToDisplay, type DesignerPage, type NormalizedRect } from '../../src/core/designer/geometry';
import { loadFieldLayout, saveFieldLayout } from '../../src/core/designer/layout';
import { validateFieldRect } from '../../src/core/designer/spec';
import { createAudit, createFlattenedZip, createZip, getWidgetOverlays, inspectCustomFont, inspectTemplate, matchChoice, preflightRow, prepareRowPreflight, type AlignOverride } from '../../src/core/pdf';
import { suggestBatchFontSize } from '../../src/core/pdf/batch-font-suggestion';
import { CAPACITY_SAMPLE_LIMIT, inspectTemplateCapacities } from '../../src/core/pdf/capacity-inspector';
import { createGeneratedZip } from '../../src/core/pdf/exports';
import { impositionLayout } from '../../src/core/pdf/imposition';
import { inspectPrintMargins } from '../../src/core/pdf/margin-preflight';
import { coverTableLayout, paginateCoverRows } from '../../src/core/pdf/merge-cover';
import { encodeQr, resolveQrPayload } from '../../src/core/pdf/qr-encoder';
import { qrStampLayout } from '../../src/core/pdf/qr-stamp';
import type { RectangleBounds } from '../../src/core/pdf/template';
import { createShaper, fitText } from '../../src/core/pdf/shaping';
import { watermarkLayout } from '../../src/core/pdf/watermark';
import { createBatchProcessor } from '../../src/core/worker/batch';
import { resolveRowSelection } from '../../src/core/worker/row-selection';
import { inspectRosterWorkbook, makeFilenames, planFilenames, readRoster, type RosterSheet } from '../../src/core/roster';
import { filenameKey } from '../../src/core/roster/filenames';
import { applyRosterHygiene, previewRosterHygiene } from '../../src/core/roster/hygiene';
import { localVirtualDate, resolveVirtualColumn, resolveVirtualMapping, VIRTUAL_COLUMNS, virtualFilenameToken } from '../../src/core/roster/virtual-columns';
import { generateStudioTemplate, STUDIO_ACCENT_PALETTES, STUDIO_HEADER_LANGUAGES, STUDIO_TEMPLATE_IDS } from '../../src/core/studio/templates';

import { proveQrMatrix } from './qr-proof';

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
  expect(acceptedCases).toBeGreaterThanOrEqual(30_180);
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

describe('seeded bilingual template studio and issued custody QR records', () => {
  const title = fc.tuple(
    fc.constantFrom('مَرْكَز', 'مَدْرَسَة', 'عِيَادَة', 'مُؤَسَّسَة', 'مُجَمَّع', 'المُسْتَقْبَل'),
    fc.constantFrom('Riyadh', 'Alexandria', 'Cairo', 'Abu Dhabi', 'Learning', 'Clinic', 'Workshop', 'Office'),
    fc.constantFrom(' / ', ' · ', ' - ', ' + ', ' — '),
    fc.integer({ min: 0, max: 99999 }),
    fc.boolean(),
  ).map(([ar, en, separator, serial, reverse]) => {
    const latin = `${en} ${String(serial).padStart(5, '0')}`;
    return reverse ? `${latin}${separator}${ar}` : `${ar}${separator}${latin}`;
  });
  const fonts = async () => ({
    arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
  });

  it.each(STUDIO_TEMPLATE_IDS)('roundtrips 625 real %s AcroForms and rejects actual single-byte and QR tampering', async (id) => {
    const options = { fonts: await fonts() };
    await verify(fc.asyncProperty(
      title, title, fc.constantFrom(...STUDIO_ACCENT_PALETTES), fc.constantFrom(...STUDIO_HEADER_LANGUAGES),
      fc.integer({ min: 1, max: 2 }), fc.nat(), fc.integer({ min: 0, max: 7 }),
      async (organizationName, documentSubtitle, accentPalette, headerLanguage, originalRow, offset, bit) => {
        const studio = await generateStudioTemplate(id, { organizationName, documentSubtitle, accentPalette, headerLanguage }, options.fonts);
        const { fields, pages } = await inspectTemplate(studio.pdfBytes);
        const roster = encoder.encode(studio.csv);
        const sheet = (await readRoster(roster, studio.csvFilename)).sheets[0]!;
        expect(pages).toHaveLength(1);
        expect(fields.map(({ name }) => name)).toEqual(sheet.headers);
        const selected = sheet.rows[originalRow - 1]!.values;
        const { status, diagnostics, pdfBytes } = await preflightRow(studio.pdfBytes, selected, options);
        expect({ status, diagnostics }).toEqual({ status: 'pass', diagnostics: [] });
        if (!pdfBytes) throw new Error('missing filled PDF');
        const filename = 'issued.pdf';
        const extracted = await extractBatch([{ filename, bytes: pdfBytes }]);
        expect(extracted.rows[0]!.status).toBe('extracted');
        expect(Object.fromEntries(fields.map(({ name }) => [name, extracted.rows[0]!.fields[name]!.value]))).toEqual(
          Object.fromEntries(fields.map(({ name, kind }) => [
            name, kind === 'checkbox' ? selected[name] === 'yes' ? 'checked' : 'unchecked' : selected[name],
          ])),
        );
        const rowSelection = [originalRow];
        const sources = await hashCustodySources(studio.pdfBytes, roster);
        const qrRecords = await createCustodyQrRecords(sources, rowSelection);
        const { payload } = qrRecords[0]!;
        const qrStamp = { placement: 'bottom-right', sizePt: 72, payloads: [payload] } as const;
        const result = await createGeneratedZip([{ filename, getPdfBytes: async () => pdfBytes }], undefined, true, undefined, qrStamp);
        const receipt = await parseCustodyManifest(createCustodyManifest(sources, { entries: result.entries, qrRecords }, {
          exportScope: 'selected-subset', selectedRowNumbers: rowSelection,
        }));
        const issued = unzipSync(result.bytes)[filename]!;
        expect((await verifyCustodyPdf(receipt, { filename, bytes: issued })).status).toBe('VERIFIED_EXACT_MATCH');
        const altered = issued.slice();
        const position = offset % altered.length;
        altered[position] = altered[position]! ^ (1 << bit);
        expect((await verifyCustodyPdf(receipt, { filename, bytes: altered })).status).toBe('TAMPERED_BYTE_MISMATCH');
        expect(verifyCustodyQr(receipt, payload)).toMatchObject({ status: 'VERIFIED_QR_RECORD', rowNumber: originalRow });
        expect(verifyCustodyQr(receipt, payload.slice(0, -1) + (3 - originalRow)).status).toBe('UNMATCHED_UNKNOWN');
      },
    ), 625);
  }, 300_000);
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
        rotation: 0, defaultFontSize: 12, usable: true, visibleInPreview: true, innerWidth, innerHeight, pageIndex: 0 };
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
  }, 15_000);

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

describe('seeded subset exports', () => {
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  it('checks 450 selection models across audits and paginated print indexes', async () => {
    const geometry = fc.array(fc.record({ status: fc.constantFrom('pass' as const, 'flagged' as const),
      height: fc.integer({ min: 8, max: 42 }), pageCount: fc.integer({ min: 1, max: 5 }) }), { maxLength: 120 });
    const selection = fc.oneof(fc.constant('all-ready' as const), fc.array(fc.integer({ min: -4, max: 127 }), { maxLength: 140 }));
    await verify(fc.asyncProperty(geometry, selection, async (rows, requested) => {
      const scope = resolveRowSelection(rows, requested);
      const modeled = rows.map((row, index) => ({ ...row, rowNumber: index + 1 }));
      const exported = modeled.filter(({ status, rowNumber }) => status === 'pass'
        && (requested === 'all-ready' || requested.includes(rowNumber)));
      expect(scope).toEqual({ exportScope: requested === 'all-ready' ? 'all-ready' : 'selected-subset',
        selectedRowNumbers: exported.map(({ rowNumber }) => rowNumber) });
      const audit = modeled.map(({ rowNumber, status }) => ({ rowNumber, status, filename: `row-${rowNumber}.pdf`,
        diagnostics: [], fontSizes: {} }));
      if (requested !== 'all-ready' && !exported.length) {
        expect(() => createAudit(audit, scope)).toThrow('empty-export');
      } else {
        const wanted = requested === 'all-ready' ? audit : exported.map(({ rowNumber }) => audit[rowNumber - 1]!);
        const report = createAudit(audit, scope);
        expect(JSON.parse(report.json)).toEqual(wanted);
        expect(Papa.parse<string[]>(report.csv, { skipEmptyLines: true }).data.slice(1).map(([rowNumber]) => Number(rowNumber)))
          .toEqual(wanted.map(({ rowNumber }) => rowNumber));
      }

      const firstCapacity = 46;
      const nextCapacity = 60;
      const covers = paginateCoverRows(exported, firstCapacity, nextCapacity, 0);
      let firstFormPage = covers.length + 1;
      const indexRows = covers.flat();
      expect(indexRows).toHaveLength(exported.length);
      for (const [index, { pageCount }] of exported.entries()) {
        expect(indexRows[index]).toMatchObject({ index, startPage: firstFormPage, endPage: firstFormPage + pageCount - 1 });
        firstFormPage += pageCount;
      }
      covers.forEach((page, index) => {
        const capacity = index === 0 ? firstCapacity : nextCapacity;
        const used = page.reduce((sum, entry) => sum + exported[entry.index]!.height, 0);
        expect(used).toBeLessThanOrEqual(capacity);
        const nextIndex = covers[index + 1]?.[0]?.index;
        if (nextIndex !== undefined) expect(used + exported[nextIndex]!.height).toBeGreaterThan(capacity);
      });
    }), 450);
  });

  it('checks 60 actual subset ZIP and merged PDF job receipts against extracted bytes and source fingerprints', async () => {
    const doc = await PDFDocument.create();
    const field = doc.getForm().createCheckBox('Consent');
    for (const size of [[160, 110], [200, 120]] as [number, number][]) {
      field.addToPage(doc.addPage(size), { x: 20, y: 34 });
    }
    const template = await doc.save();
    const options = { fonts: { arabic: new Uint8Array(), latin: new Uint8Array() } };
    const rosters = fc.array(fc.constantFrom('yes', 'no', 'invalid', 'نعم', 'لا'), { minLength: 2, maxLength: 9 });
    const selections = fc.array(fc.integer({ min: -1, max: 11 }), { maxLength: 14 });
    await verify(fc.asyncProperty(rosters, selections, async (values, rowSelection) => {
      const rows = values.map((Consent) => ({ Consent }));
      const roster = encoder.encode(['Consent', ...values].join('\r\n'));
      const filenames = makeFilenames(rows, 'Consent.pdf');
      const expectedRows = values.flatMap((value, index) => value !== 'invalid' && rowSelection.includes(index + 1) ? [index + 1] : []);
      const batch = createBatchProcessor();
      const notify = () => {};
      const checked = await batch({ phase: 'preflight', input: { rows, template, roster, options } }, notify);
      if (!checked || !('rows' in checked)) throw new Error('Expected preflight results');
      const scope = resolveRowSelection(checked.rows, rowSelection);
      expect(scope.selectedRowNumbers).toEqual(expectedRows);
      const sourceHashes = { templateSha256: digest(template), rosterSha256: digest(roster) };
      const exportZip = () => batch({ phase: 'zip', filenames, rowSelection }, notify);
      const exportMerged = () => batch({ phase: 'merged', rowSelection }, notify);
      if (!expectedRows.length) {
        await expect(exportZip()).rejects.toThrow('empty-export');
        await expect(exportMerged()).rejects.toThrow('empty-export');
        expect(JSON.parse(createCustodyManifest(checked.custody, undefined, scope)))
          .toEqual({ version: 1, ...sourceHashes, exportScope: 'selected-subset', selectedRowNumbers: [] });
        return;
      }

      const zip = await exportZip();
      const merged = await exportMerged();
      if (!zip || zip instanceof Uint8Array || !('entries' in zip) || !merged || !('mergedPdfSha256' in merged)) {
        throw new Error('Expected PDF exports');
      }
      const members = Object.entries(unzipSync(zip.bytes));
      expect(members.map(([filename]) => filename)).toEqual(expectedRows.map((rowNumber) => filenames[rowNumber - 1]));
      for (const [index, [, bytes]] of members.entries()) {
        const row = await PDFDocument.load(bytes);
        const expectedChecked = ['yes', 'نعم'].includes(values[expectedRows[index]! - 1]!);
        expect(row.getPageCount()).toBe(2);
        expect(row.getForm().getCheckBox('Consent').isChecked()).toBe(expectedChecked);
      }
      expect((await PDFDocument.load(merged.bytes)).getPageCount()).toBe(expectedRows.length * 2);
      expect(JSON.parse(createCustodyManifest(checked.custody, { entries: zip.entries, mergedPdfSha256: merged.mergedPdfSha256 }, scope)))
        .toEqual({ version: 1, ...sourceHashes, exportScope: 'selected-subset', selectedRowNumbers: expectedRows,
          entries: members.map(([filename, bytes]) => ({ filename, sha256: digest(bytes), bytes: bytes.length })),
          mergedPdfSha256: digest(merged.bytes) });
    }), 60);
  }, 30_000);
});

describe('seeded virtual columns, presets and canvas geometry', () => {
  it('checks 650 computed row/date values, exact padding and nonrecursive filename tokens', async () => {
    const originalRow = fc.oneof(fc.constantFrom(1, 9, 10, 500, 9999, 10_000), fc.integer({ min: 1, max: 10_000 }));
    const calendar = fc.record({ year: fc.integer({ min: 1990, max: 2100 }), month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }) });
    await verify(fc.asyncProperty(originalRow, calendar, fc.constantFrom(...VIRTUAL_COLUMNS), fc.boolean(), async (row, { year, month, day }, id, nearMidnight) => {
      const pad2 = (part: number) => part < 10 ? `0${part}` : String(part);
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      const snapshot = localVirtualDate(new Date(year, month - 1, day, nearMidnight ? 0 : 23, nearMidnight ? 1 : 59));
      expect(snapshot).toBe(date);
      const expected = (row: number) => ({ ROW_INDEX: String(row), PADDED_ROW_001: row < 10_000 ? String(10_000 + row).slice(1) : String(row),
        TODAY_ISO: date, TODAY_AR: Array.from(date, (part) => part === '-' ? part : String.fromCharCode(part.charCodeAt(0) - 48 + 0x0660)).join('') });
      expect(Object.fromEntries(VIRTUAL_COLUMNS.map((column) => [column, resolveVirtualColumn(column, row, snapshot)])))
        .toEqual(expected(row));
      const value = expected(row)[id];
      const pattern = `CERT-{{${id}}}-v1`;
      expect(resolveVirtualMapping({ column: id, template: pattern }, row, snapshot)).toBe(`CERT-${value}-v1`);
      const token = virtualFilenameToken(id);
      const rows = [{ [id]: 'real', [token]: 'raw', Literal: token }, { [id]: 'real', [token]: 'raw', Literal: token }];
      const filenames = planFilenames(rows, `{{${id}}}-{{${token}}}-{{Literal}}-${token}.pdf`, { localDate: snapshot });
      const wanted = [1, 2].map((position) => `real-raw-${token}-${expected(position)[id]}.pdf`);
      // Dates repeat within the snapshot, preserving the original collision order.
      if (id === 'TODAY_ISO' || id === 'TODAY_AR') wanted[1] = wanted[1]!.replace(/\.pdf$/, '-2.pdf');
      expect(filenames.map(({ filename }) => filename)).toEqual(wanted);
    }), 650);
  });

  it('checks 400 real PDF widget projections across rotated, shifted visible boxes', async () => {
    const geometry = fc.record({ x: fc.integer({ min: -400, max: 400 }), y: fc.integer({ min: -400, max: 400 }),
      quarterTurns: fc.integer({ min: 0, max: 3 }), shiftX: fc.integer({ min: -130, max: 190 }), shiftY: fc.integer({ min: -110, max: 160 }),
      crop: fc.constantFrom('inside', 'partial', 'disjoint'), flags: fc.constantFrom(0, 0, 0, 1, 2, 16, 32) });
    await verify(fc.asyncProperty(geometry, async ({ x, y, quarterTurns, shiftX, shiftY, crop, flags }) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([160, 140]);
      page.setMediaBox(x, y, 160, 140);
      page.setRotation(degrees(quarterTurns * 90));
      const visible: [number, number, number, number] = crop === 'inside' ? [x + 10, y + 20, x + 145, y + 125]
        : crop === 'partial' ? [x + 10, y, x + 160, y + 100] : [x, y, x + 160, y + 140];
      if (crop === 'inside') page.setCropBox(x + 10, y + 20, 135, 105);
      else if (crop === 'partial') page.setCropBox(x + 10, y - 15, 230, 115);
      else page.setCropBox(x + 180, y + 160, 100, 100);
      const field = doc.getForm().createTextField('Text');
      field.addToPage(page, { x: x + shiftX, y: y + shiftY, width: 30, height: 20, borderWidth: 0 });
      field.acroField.getWidgets()[0]!.dict.set(key('F'), PDFNumber.of(flags));
      const metadata = await inspectTemplate(await doc.save());
      const overlays = getWidgetOverlays(metadata);
      const [left, bottom, right, top] = visible;
      const [wx, wy] = [x + shiftX, y + shiftY];
      const clipped = [Math.max(left, wx), Math.max(bottom, wy), Math.min(right, wx + 30), Math.min(top, wy + 20)] as const;
      if (flags & 35 || clipped[2] <= clipped[0] || clipped[3] <= clipped[1]) {
        expect(overlays).toEqual([]);
        return;
      }
      const screenPoint = (px: number, py: number) => {
        let [sx, sy] = [(px - left) / (right - left), (top - py) / (top - bottom)];
        for (let turn = 0; turn < quarterTurns; turn++) [sx, sy] = [1 - sy, sx];
        return [sx, sy] as const;
      };
      const [sx1, sy1] = screenPoint(clipped[0], clipped[1]);
      const [sx2, sy2] = screenPoint(clipped[2], clipped[3]);
      const expected = [Math.min(sx1, sx2), Math.min(sy1, sy2), Math.abs(sx2 - sx1), Math.abs(sy2 - sy1)];
      expect(overlays).toEqual([{ pageNumber: 1, fieldName: 'Text', widgetIndex: 1, rect: expect.any(Array) }]);
      expect(overlays[0]!.rect.every((component) => component >= 0 && component <= 1)).toBe(true);
      for (const [index, component] of overlays[0]!.rect.entries()) expect(component).toBeCloseTo(expected[index]!, 12);
    }), 400);
  }, 30_000);

  it('checks 260 v1–v6 preset roundtrips and corrupted virtual or physical bindings', async () => {
    const corruption = fc.constantFrom('unknown-id', 'bad-template', 'extra-key', 'physical-conflict', 'orphan-alignment');
    await verify(fc.asyncProperty(fc.constantFrom(...VIRTUAL_COLUMNS), fc.string({ maxLength: 28 }), corruption, async (id, literal, corrupt) => {
      const affix = literal.replace(/[{}]/g, '');
      const token = virtualFilenameToken(id);
      const basic = { version: 1, mapping: { Physical: id, Other: token }, filenamePattern: `{{${token}}}.pdf`, minFontSize: 8, font: 'auto' };
      const v2 = { ...basic, version: 2, flattenZip: true };
      const v3 = { ...v2, version: 3, includeCoverSheet: true };
      const v4 = { ...v3, version: 4, alignOverrides: { Physical: 'ltr' } };
      const v5 = { ...v4, version: 5, watermark: { kind: 'none' } };
      const v6 = { ...v5, version: 6, filenamePattern: `{{${token}}}-${token}.pdf`, alignOverrides: { ...v4.alignOverrides, Computed: 'rtl' },
        virtualMappings: { Computed: { column: id, template: `${affix}{{${id}}}${affix}` } } };
      for (const preset of [basic, v2, v3, v4, v5, v6]) expect(validateMappingPreset(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
      const bad = {
        'unknown-id': { virtualMappings: { Computed: { column: token } } },
        'bad-template': { virtualMappings: { Computed: { column: id, template: `{{${id}}}{{${id}}}` } } },
        'extra-key': { virtualMappings: { Computed: { column: id, name: 'extra' } } },
        'physical-conflict': { mapping: { ...v6.mapping, Computed: id } },
        'orphan-alignment': { virtualMappings: {} },
      };
      expect(validateMappingPreset({ ...v6, ...bad[corrupt] })).toBeUndefined();
    }), 260);
  });

  it('checks 160 actual preflights that distinguish virtual prefix /MaxLen and ink overflow', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([180, 155]);
    const form = doc.getForm();
    const serial = form.createTextField('Limited');
    serial.setMaxLength(4);
    serial.addToPage(page, { x: 20, y: 85, width: 100, height: 20 });
    form.createTextField('Narrow').addToPage(page, { x: 20, y: 55, width: 30, height: 20 });
    const fonts = { arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'), latin: await readFile('public/fonts/NotoSans-Regular.ttf') };
    const check = await prepareRowPreflight(await doc.save(), { fonts });
    await verify(fc.asyncProperty(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 10, max: 60 }), async (rowNumber, length) => {
      const localDate = '2026-11-27';
      const column = 'PADDED_ROW_001';
      const value = resolveVirtualMapping({ column }, rowNumber, localDate);
      const prefixed = resolveVirtualMapping({ column, template: `${'W'.repeat(length)}{{PADDED_ROW_001}}` }, rowNumber, localDate);
      expect((await check({ Limited: value, Narrow: value })).status).toBe('pass');
      expect(await check({ Limited: prefixed, Narrow: prefixed })).toMatchObject({ status: 'flagged', diagnostics: [
        { field: 'Limited', code: 'exceeds-maxlen', maxLengthExcess: length },
        { field: 'Narrow', code: 'too-narrow', widgetIndex: 0, pageNumbers: [1] },
      ] });
    }), 160);
  }, 15_000);
});

describe('seeded QR codewords, rotated print stamps and bilingual covers', () => {
  it('checks 1,200 locally encoded payloads and failures with independent Byte/ECI and RS readback', async () => {
    const shapes = fc.record({
      capacity: fc.constantFrom(14, 26, 42, 62, 84, 106),
      delta: fc.integer({ min: -2, max: 3 }),
      flavor: fc.constantFrom('ASCII', 'Arabic', 'supplementary', 'blank', 'malformed'),
      tail: fc.array(fc.constantFrom('0', 'z', '%', ' ', 'A', '#', '-'), { minLength: 6, maxLength: 16 }),
      row: fc.integer({ min: 1, max: 21_000 }),
    });
    await verify(fc.asyncProperty(shapes, async ({ capacity, delta, flavor, tail, row }) => {
      const length = capacity + delta;
      const prefix = flavor === 'Arabic' ? 'لِ' : flavor === 'supplementary' ? '𐍈' : 'A';
      const ascii = tail.join('').repeat(20);
      const payload = flavor === 'blank' ? ' \t ' : flavor === 'malformed' ? 'بد\ud800A'
        : prefix + ascii.slice(0, length - encoder.encode(prefix).length);
      const error = flavor === 'blank' ? 'qr-stamp-empty-payload' : flavor === 'malformed' ? 'qr-stamp-invalid-payload'
        : length > (flavor === 'ASCII' ? 106 : 105) ? 'qr-stamp-payload-too-long' : undefined;
      if (error) {
        expect(() => encodeQr(payload)).toThrow(error);
        expect(() => resolveQrPayload('{{ID}}', { ID: payload }, row, '2026-11-27')).toThrow(error);
      } else {
        expect(resolveQrPayload('{{ID}}', { ID: payload }, row, '2026-11-27')).toBe(payload);
        const symbol = encodeQr(payload);
        const cap = [14, 26, 42, 62, 84, 106].findIndex((limit) => length <= limit - Number(flavor !== 'ASCII'));
        expect(symbol.version).toBe(cap + 1);
        proveQrMatrix(symbol, payload);
      }
    }), 1_200);
  }, 30_000);

  it('checks 950 corner transforms including clipped crops, physical size and unsafe geometries', async () => {
    const geometry = fc.record({
      x: fc.integer({ min: -200, max: 200 }), y: fc.integer({ min: -200, max: 200 }),
      width: fc.integer({ min: 35, max: 240 }), height: fc.integer({ min: 35, max: 240 }),
      dx0: fc.integer({ min: -18, max: 18 }), dy0: fc.integer({ min: -18, max: 18 }),
      dx1: fc.integer({ min: -18, max: 18 }), dy1: fc.integer({ min: -18, max: 18 }),
      rotation: fc.constantFrom(0, 90, 180, 270), scale: fc.constantFrom(0.5, 1, 2, 4),
      corner: fc.constantFrom('top-left', 'top-right', 'bottom-left', 'bottom-right'),
      size: fc.integer({ min: 36, max: 72 }),
    });
    await verify(fc.asyncProperty(geometry, async ({ x, y, width, height, dx0, dy0, dx1, dy1, rotation, scale, corner, size }) => {
      const media: RectangleBounds = [x + 0.25, y + 0.5, x + width + 0.25, y + height + 0.5];
      const crop: RectangleBounds = [media[0] + dx0, media[1] + dy0, media[2] + dx1, media[3] + dy1];
      const [l, b, r, t] = [media[0] + Math.max(0, dx0), media[1] + Math.max(0, dy0),
        media[2] + Math.min(0, dx1), media[3] + Math.min(0, dy1)];
      if ((r! - l!) * scale < size + 18 || (t! - b!) * scale < size + 18) {
        expect(() => qrStampLayout(media, crop, rotation, scale, corner, size)).toThrow('qr-stamp-does-not-fit');
        return;
      }
      const { side, matrix } = qrStampLayout(media, crop, rotation, scale, corner, size);
      const [a, b0, c, d, tx, ty] = matrix;
      expect(side * scale).toBe(size);
      const [pageWidth, pageHeight] = rotation % 180 ? [t! - b!, r! - l!] : [r! - l!, t! - b!];
      for (const [u, v] of [[0, 0], [side, 0], [0, side], [side, side]] as const) {
        const px = a * u + c * v + tx;
        const py = b0 * u + d * v + ty;
        const displayed = rotation === 90 ? [py - b!, px - l!] : rotation === 180 ? [r! - px, py - b!]
          : rotation === 270 ? [t! - py, r! - px] : [px - l!, t! - py];
        const [displayX, displayY] = displayed.map((value) => value * scale);
        const expectedLeft = corner.endsWith('left') ? 9 : pageWidth! * scale - 9 - size;
        const expectedTop = corner.startsWith('top') ? 9 : pageHeight! * scale - 9 - size;
        expect(displayX).toBe(expectedLeft + u * scale);
        expect(displayY).toBe(expectedTop + size - v * scale);
      }
    }), 950);
  }, 20_000);

  it('checks 800 bilingual panel height and absolute printable index cases', async () => {
    const panel = fc.record({
      title: fc.integer({ min: 10, max: 26 }), summary: fc.integer({ min: 8, max: 18 }), settings: fc.integer({ min: 8, max: 18 }),
      details: fc.tuple(fc.integer({ min: 8, max: 25 }), fc.integer({ min: 8, max: 160 })),
    });
    const row = fc.record({ height: fc.integer({ min: 23, max: 500 }), pageCount: fc.integer({ min: 1, max: 16 }) });
    await verify(fc.asyncProperty(panel, panel, fc.array(row, { minLength: 1, maxLength: 72 }), fc.option(fc.integer({ min: 8, max: 20 })),
      async (en, ar, rows, footer) => {
        const layout = coverTableLayout([en, ar], footer ?? undefined);
        const nextTop = 801.89 - Math.max(en.title, ar.title) - 18 - 34;
        const headings = Math.max(en.details[0], ar.details[0]) + Math.max(en.details[1], ar.details[1]) + 16
          + Math.max(en.summary, ar.summary) + Math.max(en.settings, ar.settings) + 22;
        const firstTop = nextTop - headings;
        expect(layout.afterTitle - layout.tableHeader).toBeCloseTo(nextTop, 8);
        expect(layout.firstTable - layout.tableHeader).toBeCloseTo(firstTop, 8);
        const bottom = footer === null ? 41 : 49 + footer;
        expect(layout.bottom).toBe(bottom);
        const sheets = paginateCoverRows(rows, layout.firstTable - layout.tableHeader, layout.afterTitle - layout.tableHeader, bottom);
        let preceding = sheets.length;
        let index = 0;
        for (const [sheetIndex, sheet] of sheets.entries()) {
          let cursor = sheetIndex ? nextTop : firstTop;
          for (const position of sheet) {
            const { height, pageCount } = rows[index]!;
            expect(position.index).toBe(index++);
            expect(position.top).toBeCloseTo(cursor, 8);
            expect(position.startPage).toBe(preceding + 1);
            expect(position.endPage).toBe(preceding + pageCount);
            preceding += pageCount;
            cursor -= height;
          }
          expect(cursor).toBeGreaterThanOrEqual(bottom);
          if (index < rows.length) expect(cursor - rows[index]!.height).toBeLessThan(bottom);
        }
        expect(index).toBe(rows.length);
      }), 800);
  }, 30_000);
});

describe('seeded independent Excel tabs, two-up geometry and v8 presets', () => {
  it('checks 1,700 workbooks with shuffled visible and suppressed worksheets using exact stored values', async () => {
    const inputs = fc.record({
      order: fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5, maxLength: 5 }),
      name: fc.constantFrom('Roster_AR', 'الموظفون', 'العربية & English', 'Roster “A”', "O'Reilly staff", '  Roster  '),
      id: fc.integer({ min: 0, max: 9_999 }),
      physicalRow: fc.integer({ min: 2, max: 1_048_576 }),
      idType: fc.constantFrom('text', 'padded', 'number', 'scientific', 'uncached'),
      summary: fc.constantFrom('valid', 'duplicates', 'blank', 'missing'),
    });
    await verify(fc.asyncProperty(inputs, async ({ order, name, id, physicalRow, idType, summary }) => {
      const inline = (text: string, ref: string) => `<c t="inlineStr" r="${ref}"><is><t>${text}</t></is></c>`;
      const worksheet = (name: string, contents: string) => `<worksheet><sheetData><row r="1">${inline(name, 'A1')}${contents}</sheetData></worksheet>`;
      const idText = String(id).padStart(5, '0');
      const scientific = `${id}E+11`;
      const reference = `A${physicalRow}`;
      const cell = idType === 'text' ? inline(idText, reference) : idType === 'padded' ? `<c r="${reference}" s="1"><v>${id}</v></c>`
        : idType === 'number' ? `<c r="${reference}"><v>${id}</v></c>`
          : `<c r="${reference}"><f>1+2</f>${idType === 'scientific' ? `<v>${scientific}</v>` : ''}</c>`;
      const names = ['Summary', name, 'Internal', 'Confidential', 'Dashboard chart'];
      const parts = {
        'xl/workbook.xml': `<workbook><sheets>${order.map((index) =>
          `<sheet name="${names[index]!.replaceAll('&', '&amp;')}" id="${index}"${[' state="visible"', '', ' state="hidden"', ' state="veryHidden"', ''][index]}/>`).join('')}</sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships>${[0, 1, 2, 3, 4].map((index) =>
          `<Relationship Id="${index}" Target="sheet${index}.xml" Type="urn:/${index === 4 ? 'chartsheet' : 'worksheet'}"/>`).join('')}</Relationships>`,
        'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
        'xl/sheet1.xml': worksheet('ID', `</row><row r="${physicalRow}">${cell}</row>`),
        'xl/sheet2.xml': '<broken/>', 'xl/sheet3.xml': '<broken/>', 'xl/sheet4.xml': '<chartsheet/>',
        ...(summary !== 'missing' && { 'xl/sheet0.xml': summary === 'blank' ? '<worksheet><sheetData/></worksheet>'
          : worksheet('Topic', summary === 'duplicates' ? `${inline('ＴＯＰＩＣ', 'B1')}</row>` : '</row>') }),
      };
      const bytes = zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, encoder.encode(xml)])), { level: 0 });
      const workbook = inspectRosterWorkbook(bytes);
      expect(workbook.sheetNames).toEqual(order.filter((index) => index < 2).map((index) => names[index]));
      const switchTo = workbook.readSheet(name);
      const error = summary === 'duplicates' ? 'invalid-roster-headers' : summary === 'missing' ? 'invalid-xlsx' : undefined;
      if (error) expect(() => workbook.readSheet('Summary')).toThrow(error);
      else expect(workbook.readSheet('Summary').headers).toEqual(summary === 'blank' ? [] : ['Topic']);
      if (workbook.sheetNames[0] === name) expect(workbook.readSheet()).toEqual(switchTo);
      else if (error) expect(() => workbook.readSheet()).toThrow(error);
      else expect(workbook.readSheet().name).toBe('Summary');
      expect(await readRoster(bytes, 'x.XLSX', { sheetName: name })).toEqual({ sheets: [switchTo] });
      expect(() => workbook.readSheet('Internal')).toThrow('invalid-xlsx');
      expect(() => workbook.readSheet('Confidential')).toThrow('invalid-xlsx');
      expect(() => workbook.readSheet('Dashboard chart')).toThrow('invalid-xlsx');
      expect(switchTo.name).toBe(name);
      expect(switchTo.rows[0]?.values.ID).toBe(idType === 'scientific' ? scientific : idType === 'uncached' ? '' : idType === 'number' ? String(id) : idText);
      const source = { row: physicalRow, column: 'A' };
      const expectedWarnings = [
        ...(idType === 'number' ? [{ column: 'ID', source, code: 'excel-numeric-identifier-warning' }] : []),
        ...(idType === 'scientific' ? [{ column: 'ID', source, code: 'excel-scientific-notation-warning' }] : []),
        ...(idType === 'scientific' || idType === 'uncached'
          ? [{ column: 'ID', source, code: 'excel-formula-warning', formulaHasCachedValue: idType === 'scientific' }] : []),
      ];
      expect(switchTo.rows[0]?.warnings).toEqual(expectedWarnings);
    }), 1_700);
  }, 40_000);

  it('checks 1,800 optimized pairs with margins, fixed order, odd slots and cover sheet offsets', async () => {
    await verify(fc.asyncProperty(
      fc.constantFrom(1, 2, 3, 25, 81), fc.integer({ min: 20, max: 1900 }), fc.integer({ min: 20, max: 1900 }),
      fc.constantFrom(0, 90, 180, 270), fc.constantFrom(0.5, 1, 1.25, 2, 4),
      fc.integer({ min: 18, max: 45 }), fc.integer({ min: 90, max: 670 }), fc.integer({ min: 20, max: 200 }),
      async (count, w, h, rotation, unit, height, capacity, continuation) => {
        const [width, pageHeight] = rotation % 180 ? [h * unit, w * unit] : [w * unit, h * unit];
        const { layout, slots } = impositionLayout(width, pageHeight);
        const possibleScales = [
          [393.945, 559.28], [559.28, 393.945], [270.64, 805.89], [805.89, 270.64],
        ].map(([w, h]) => Math.min(w! / width, h! / pageHeight));
        const scale = Math.max(...possibleScales);
        for (const slot of slots) {
          expect(slot.scale).toBeCloseTo(scale, 10);
          expect(slot.width / slot.height).toBeCloseTo(width / pageHeight, 10);
          expect(slot.x).toBeGreaterThanOrEqual(18 - 1e-9);
          expect(slot.y).toBeGreaterThanOrEqual(18 - 1e-9);
          expect(slot.x + slot.width).toBeLessThanOrEqual(layout.width - 18 + 1e-9);
          expect(slot.y + slot.height).toBeLessThanOrEqual(layout.height - 18 + 1e-9);
        }
        if (layout.sideBySide) {
          expect(slots[1].x - (slots[0].x + slots[0].width)).toBeGreaterThanOrEqual(18 - 1e-9);
          expect(slots[0].y).toBe(slots[1].y);
        } else {
          expect(slots[0].y - (slots[1].y + slots[1].height)).toBeGreaterThanOrEqual(18 - 1e-9);
          expect(slots[0].x).toBe(slots[1].x);
        }
        const rows = Array.from({ length: count }, (_, index) => ({ height: height + index % 3, pageCount: 1 }));
        const covers = paginateCoverRows(rows, capacity, capacity + continuation, 20, '2-up');
        const index = covers.flat();
        expect(index).toHaveLength(count);
        index.forEach((entry, index) => {
          const expectedSheet = covers.length + Math.trunc(index / 2) + 1;
          expect(entry).toMatchObject({ index, startPage: expectedSheet, endPage: expectedSheet });
        });
        const final = index.at(-1)!;
        expect(final.endPage - covers.length).toBe(Math.ceil(count / 2));
        expect(index.filter(({ endPage }) => endPage === final.endPage)).toHaveLength(count % 2 ? 1 : 2);
      }), 1_800);
  }, 40_000);

  it('checks 1,600 exact v1–v8 preset roundtrips and rejects mismatched print settings', async () => {
    const modes = fc.constantFrom('1-up', '2-up');
    const typography = fc.constantFrom('auto', 'latin', 'arabic');
    const languages = fc.constantFrom('auto', 'en', 'ar', 'bilingual');
    const invalidLayout = fc.constantFrom('duplex', 'two-up', 2, null, true, undefined, ['2-up'], { value: '2-up' });
    await verify(fc.asyncProperty(modes, typography, languages, invalidLayout, fc.integer({ min: 600, max: 1000 }),
      fc.boolean(), fc.boolean(), fc.string({ minLength: 1, maxLength: 20 }), async (imposition, font, coverLanguage, invalid, minimum, flattenZip, includeCoverSheet, name) => {
        const v1 = { version: 1, filenamePattern: `${name}-{{ID}}`, mapping: { Record: 'ID' }, font, minFontSize: minimum / 100 };
        const v2 = { ...v1, version: 2, flattenZip };
        const v3 = { ...v2, version: 3, includeCoverSheet };
        const v4 = { ...v3, version: 4, alignOverrides: { Record: 'center' } };
        const v5 = { ...v4, version: 5, watermark: { kind: 'draft-ar', opacity: 0.22, angle: -45 } };
        const v6 = { ...v5, version: 6, virtualMappings: { Serial: { column: 'PADDED_ROW_001', template: 'AR-{{PADDED_ROW_001}}' } } };
        const v7 = { ...v6, version: 7, coverLanguage, qrStamp: { placement: 'top-right', sizePt: 54, pattern: '{{ID}}' } };
        const v8 = { ...v7, version: 8, imposition };
        for (const preset of [v1, v2, v3, v4, v5, v6, v7, v8]) {
          expect(validateMappingPreset(JSON.parse(JSON.stringify(preset)))).toEqual(preset);
        }
        expect(validateMappingPreset({ ...v8, imposition: invalid })).toBeUndefined();
        expect(validateMappingPreset({ ...v7, imposition })).toBeUndefined();
        expect(validateMappingPreset({ ...v7, version: 8 })).toBeUndefined();
      }), 1_600);
  }, 40_000);
});


describe('seeded AcroForm extraction and string-safe spreadsheet custody', () => {
  const pieces = fc.array(fc.constantFrom('مُحَمَّد', 'سَالِم', 'ىَ', 'يِ', 'نُ', 'قّ', '00', '٠١٢', '𐍈', '🙂', 'é',
    'e\u0301', '#00123', ' (A) ', '؛،', '\u061c', '\u200e', '\u200f', '\u202e', '\u2067', '\u2069',
    '\r\n', '\n', '\r', '\"', ',', ' ', '&<>', '_x0041_', '_x000D_x000A_', '\x00', '\x1f', '\ufeff'), { maxLength: 18 });
  const formulaStart = fc.constantFrom(
    '\u061c=', '  ＝', '\u00a0\u200e＋', '\x01-\u202e', '\u2066＠', '\t', '\r\n', '\n', '\ufeff@', '+', '-', '=',
  );
  const exactDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  it('checks 1,300 exact XML string cells and formula-safe CSV cells against adversarial Unicode prefixes', async () => {
    await verify(fc.asyncProperty(pieces, formulaStart, fc.integer({ min: 0, max: 99_999 }), async (chunks, prefix, id) => {
      const formula = prefix + '1' + chunks.join('');
      const plain = '00' + String(id).padStart(5, '0') + chunks.join('');
      const filename = prefix + 'private.pdf';
      const { csv, xlsx } = makeSpreadsheets(
        [{ name: 'ID', kind: 'text' }, { name: 'Unicode', kind: 'text' }],
        [{ filename, sourceSha256: '0'.repeat(64), status: 'extracted',
          fields: { ID: { kind: 'text', value: plain }, Unicode: { kind: 'text', value: formula } } }],
      );
      const xml = decoder.decode(unzipSync(xlsx)['xl/worksheets/sheet1.xml']!);
      expect(xml).toContain('<c r="E2" t="inlineStr">');
      expect(xml).not.toMatch(/<f(?:\s|>)/);
      const { values, warnings } = inspectRosterWorkbook(xlsx).readSheet().rows[0]!;
      expect([values.Filename, values.ID, values.Unicode, warnings]).toEqual([filename, plain, formula, []]);
      expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const parsed = Papa.parse<string[]>(decoder.decode(csv), { newline: '\r\n' });
      expect(parsed.errors).toEqual([]);
      expect(parsed.data[1]).toEqual(["'" + filename, '0'.repeat(64), 'extracted', plain, "'" + formula]);
    }), 1300);
  }, 30_000);

  it('checks 700 saved AcroForm documents with exact UTF-16BE, PDFDocEncoding and native checkbox values', async () => {
    const spellings = [
      ['', ''], ['\\200\\223\\240', '•ﬁ€'], ['A\\(00\\)\\226', 'A(00)Œ'],
      ['sl\\351\\202\\201', 'slé‡†'], ['\\101\\tB\\r\\nC', 'A\tB\r\nC'], ['A\\\r\nB\\fC', 'AB\fC'],
    ] as const;
    await verify(fc.asyncProperty(pieces, fc.integer({ min: 0, max: 99_999 }), fc.constantFrom(...spellings),
      fc.constantFrom('Yes', 'Approved#2000007', 'Off'), fc.boolean(), async (chunks, id, [legacyRaw, legacy], state, compressed) => {
        const doc = await PDFDocument.create({ updateMetadata: false });
        doc.addPage();
        const form = doc.getForm();
        const exact = 'نُور ٠٠٧ ' + chunks.join('') + '\r\n' + String(id).padStart(7, '0');
        form.createTextField('Text').acroField.dict.set(key('V'), PDFHexString.fromText(exact));
        form.createTextField('Legacy').acroField.dict.set(key('V'), PDFString.of(legacy ? legacyRaw : ''));
        form.createCheckBox('Consent').acroField.dict.set(key('V'), key(state));
        const bytes = await doc.save({ updateFieldAppearances: false, useObjectStreams: compressed });
        const result = await extractBatch([{ filename: 'مِلَف ' + id + '.pdf', bytes }]);
        const row = result.rows[0]!;
        const nativeValue = state === 'Approved#2000007' ? 'Approved 00007' : state;
        expect(row.status).toBe('extracted');
        expect(row.sourceSha256).toBe(exactDigest(bytes));
        expect(row.fields).toEqual({
          Text: { kind: 'text', value: exact }, Legacy: { kind: 'text', value: legacy },
          Consent: { kind: 'checkbox', value: state === 'Off' ? 'unchecked' : 'checked', nativeValue },
        });
        const xlsx = inspectRosterWorkbook(result.artifacts.xlsx).readSheet().rows[0]!.values;
        expect([xlsx.Text, xlsx.Legacy, xlsx['Consent (native export)']]).toEqual([exact, legacy, nativeValue]);
        const audit = JSON.parse(decoder.decode(result.artifacts.audit));
        expect(audit.csvSha256).toBe(exactDigest(result.artifacts.csv));
        expect(audit.xlsxSha256).toBe(exactDigest(result.artifacts.xlsx));
      }), 700);
  }, 30_000);

  it('checks 500 mixed batches with malformed and restricted files, distinct per-file digests and schema warnings', async () => {
    const formats = ['flat', 'encrypted', 'xfa', 'signed'] as const;
    const fixtures = await Promise.all(formats.map(async (format) => ({
      filename: format + '.pdf', bytes: await readFile('fixtures/golden/' + format + '.pdf'),
    })));
    const ordered = await Promise.all([
      ['Name', 'Code'], ['Name', 'Consent'], ['Code', 'Name'], ['Choice', 'Code'],
    ].map(async (names) => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage();
      for (const name of names) {
        if (name === 'Consent') doc.getForm().createCheckBox(name);
        else if (name === 'Choice') doc.getForm().createDropdown(name);
        else doc.getForm().createTextField(name).acroField.dict.set(key('V'), PDFString.of('00007'));
      }
      return { names, bytes: await doc.save({ updateFieldAppearances: false }) };
    }));
    await verify(fc.asyncProperty(
      fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 }),
      fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
      fc.uint8Array({ minLength: 1, maxLength: 44 }), fc.boolean(),
      async (firstIndex, nextIndex, badIndices, invalidTail, reverse) => {
        const first = ordered[firstIndex]!;
        const next = ordered[nextIndex]!;
        const invalid = new Uint8Array(invalidTail.length + 1);
        invalid.set(invalidTail, 1);
        invalid[0] = 0xff;
        const restricted = badIndices.map((index) => fixtures[index]!);
        const inputs = [{ filename: 'broken.pdf', bytes: invalid }, ...restricted,
          { filename: 'first.pdf', bytes: first.bytes }, { filename: 'second.pdf', bytes: next.bytes }];
        if (reverse) inputs.reverse();
        const primary = reverse ? next : first;
        const later = reverse ? first : next;
        const missing = primary.names.filter((name) => !later.names.includes(name));
        const extra = later.names.filter((name) => !primary.names.includes(name));
        const result = await extractBatch(inputs);
        expect(result.columns.map(({ name }) => name)).toEqual([...new Set([...primary.names, ...later.names])]);
        const selected = result.rows.filter(({ status }) => status === 'extracted' || status === 'warning-schema-mismatch');
        expect(selected[0]?.status).toBe('extracted');
        expect(selected[1]?.status).toBe(missing.length || extra.length ? 'warning-schema-mismatch' : 'extracted');
        if (missing.length || extra.length) expect(selected[1]?.schema).toEqual({ missing, extra, typeChanged: [] });
        for (const [index, row] of result.rows.entries()) {
          const input = inputs[index]!;
          expect(row.sourceSha256).toBe(exactDigest(input.bytes));
          if (input.filename === 'broken.pdf') expect(row.status).toBe('blocked-invalid');
          const item = formats.find((format) => input.filename === format + '.pdf');
          if (item) {
            expect(row.status).toBe('blocked-' + item);
            expect(Object.keys(row.fields)).toEqual([]);
          }
        }
      }), 500);
  }, 30_000);
});

describe('seeded flat-PDF field designer', () => {
  const turns = [0, 90, 180, 270] as const;
  const rotations = fc.constantFrom(...turns);

  it('projects 1,080 clipped viewport drags across crop offsets, quarter turns, and page units', async () => {
    await verify(fc.asyncProperty(rotations,
      fc.tuple(fc.integer({ min: -200, max: 200 }), fc.integer({ min: -200, max: 200 })),
      fc.tuple(fc.integer({ min: 48, max: 1_500 }), fc.integer({ min: 48, max: 1_500 })),
      fc.tuple(fc.integer({ min: -100, max: 120 }), fc.integer({ min: -100, max: 120 }),
        fc.integer({ min: 1, max: 150 }), fc.integer({ min: 1, max: 150 })),
      fc.integer({ min: 1, max: 16 }), async (rotation, [x, y], [width, height], drag, unit) => {
        const page: DesignerPage = { visibleBox: { x: x / 3, y: y / 3, width, height }, rotation, userUnit: unit / 4 };
        const rect = drag.map((item) => item / 100) as unknown as NormalizedRect;
        const clipped = clampDisplayRect(rect);
        expect(clipped.every((item) => item >= 0 && item <= 1)).toBe(true);
        expect(clipped[0] + clipped[2]).toBeLessThanOrEqual(1 + 1e-10);
        expect(clipped[1] + clipped[3]).toBeLessThanOrEqual(1 + 1e-10);
        const pdf = displayToSource(clipped, page);
        for (const [index, item] of sourceToDisplay(pdf, page).entries()) expect(item).toBeCloseTo(clipped[index]!, 10);
        const quarter = rotation % 180 !== 0;
        if (pdf[2] === 0 || pdf[3] === 0) {
          expect(() => validateFieldRect(pdf, page, 'text')).toThrow('invalid-field-rect');
        } else if ((quarter ? pdf[3] : pdf[2]) * page.userUnit < 12 - 1e-9 ||
          (quarter ? pdf[2] : pdf[3]) * page.userUnit < 10 - 1e-9) {
          expect(() => validateFieldRect(pdf, page, 'text')).toThrow('field-too-small');
        } else {
          const validated = validateFieldRect(pdf, page, 'text');
          for (const [index, item] of sourceToDisplay(validated, page).entries()) expect(item).toBeCloseTo(clipped[index]!, 10);
        }
      }), 1_080);
  });

  it('rejects 780 invalid JSON, PDF placement, and colliding field-name drafts with a precise code', async () => {
    const source = await inspectFlatPdf(await readFile('fixtures/golden/flat.pdf'));
    await verify(fc.asyncProperty(fc.integer({ min: 0, max: 99_999 }),
      fc.constantFrom('duplicate-field-name', 'field-name-conflict', 'invalid-field-name', 'invalid-field-rect', 'field-out-of-bounds',
        'invalid-field-options', 'invalid-field-page', 'field-too-small', 'invalid-layout', 'layout-source-mismatch'),
      fc.boolean(), async (id, code, reverse) => {
        const name = `Participant${id}`;
        const spec: FieldDraftSpec = { name, kind: 'text', pageIndex: 0, rectPdf: [20, 40, 100, 30] };
        const fields: unknown[] = [spec];
        if (code === 'duplicate-field-name') fields.push({ ...spec, kind: 'checkbox' });
        if (code === 'field-name-conflict') fields.push({ ...spec, name: name + '.Child' });
        if (code === 'invalid-field-name') fields.push({ ...spec, name: reverse ? name + '..Child' : name + '.\u202eChild' });
        if (code === 'invalid-field-rect') fields.push({ ...spec, name: name + '-2', rectPdf: [20, 40, 0, 30] });
        if (code === 'field-out-of-bounds') fields.push({ ...spec, name: name + '-2', rectPdf: [-1 - id, 40, 100, 30] });
        if (code === 'invalid-field-options') fields.push({ ...spec, name: name + '-2', ...(reverse ? { maxLen: 2.5 } : { kind: 'checkbox', fontSize: 12 }) });
        if (code === 'invalid-field-page') fields.push({ ...spec, name: name + '-2', pageIndex: id + 1 });
        if (code === 'field-too-small') fields.push({ ...spec, name: name + '-2', rectPdf: [20, 40, 11, 10] });
        if (reverse) fields.reverse();
        const sourceSha256 = code === 'layout-source-mismatch' ? '0'.repeat(64) : source.sourceSha256;
        const version = code === 'invalid-layout' ? 0 : 1;
        await expect(loadFieldLayout(JSON.stringify({ version, sourceSha256, fields }), source)).rejects.toMatchObject({ code });
      }), 780);
  });

  it('authors, reopens, fills, and extracts 700 exact Arabic and checkbox records from SHA-bound layouts', async () => {
    const samples = await Promise.all(turns.map(async (rotation) => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([720, 550]);
      page.setCropBox(23.25, 17.125, 630.5, 510.25);
      page.setRotation(degrees(rotation));
      const bytes = await doc.save();
      return { bytes, source: await inspectFlatPdf(bytes) };
    }));
    const fonts = {
      arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
      latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
    };
    await verify(fc.asyncProperty(
      fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 9_999 }), fc.boolean(),
      fc.constantFrom('مُحَمَّد سَالِم', 'بَنِي يَمَن', 'اَلْعَرَبِيَّةُ', 'نَجْوَى', 'قَمَرٌ'),
      fc.constantFrom('auto', 'rtl', 'ltr', 'center'), fc.integer({ min: 0, max: 16 }),
      async (sampleIndex, id, checked, name, alignment, offset) => {
        const { source, bytes } = samples[sampleIndex]!;
        const page = source.pages[0]!;
        const value = `${name} #0${String(id).padStart(4, '0')}`;
        const textName = 'الشهادة.الاسم';
        const boxName = 'الشهادة.Verified';
        const fields: FieldDraftSpec[] = [
          { name: textName, kind: 'text', pageIndex: 0, rectPdf: displayToSource([0.08 + offset / 1_000, 0.14, 0.58, 0.09], page),
            alignment, multiline: true, maxLen: Array.from(value).length, fontSize: 12 },
          { name: boxName, kind: 'checkbox', pageIndex: 0, rectPdf: displayToSource([0.75, 0.14 + offset / 1_000, 0.035, 0.04], page) },
        ];
        const layoutJson = await saveFieldLayout(source, fields);
        const loaded = await loadFieldLayout(layoutJson, source);
        expect(loaded).toEqual(fields);
        const authored = await authorFlatPdf(bytes, loaded);
        const template = await inspectTemplate(authored);
        expect(template.fields.map(({ name, kind, value }) => [name, kind, value])).toEqual([
          [textName, 'text', ''], [boxName, 'checkbox', 'Off'],
        ]);
        expect(template.fields[0]?.widgets[0]?.rotation).toBe(turns[sampleIndex]);
        expect(template.fields[0]?.maxLength).toBe(Array.from(value).length);
        const filled = await preflightRow(authored, { [textName]: value, [boxName]: checked ? 'نعم' : 'لا' }, { fonts });
        expect(filled.diagnostics).toEqual([]);
        expect(filled.pdfBytes).toBeDefined();
        const readback = await extractBatch([{ filename: 'authored.pdf', bytes: filled.pdfBytes! }]);
        expect(readback.rows[0]?.fields).toEqual({
          [textName]: { kind: 'text', value },
          [boxName]: { kind: 'checkbox', value: checked ? 'checked' : 'unchecked', nativeValue: checked ? 'Yes' : 'Off' },
        });
      }), 700);
  }, 75_000);
});

describe('seeded grouping plans, split cover indexes, v9 presets and authored choices', () => {
  it('checks 850 grouped ZIP plans against traversal, case and Unicode collisions, blank groups and exact row order', async () => {
    const hostile = fc.oneof(mixedText, fc.constantFrom(
      '_Ungrouped', '_UNGROUPED', '', ' \t ', '...', '..//', '../الرياض', 'الرياض', 'x\u202Ey', 'x／y',
      'CON', 'ＬＰＴ².aux', 'AUX .doc', 'NUL', 'COM9', '\udc00', 'x\\y', 'e\u0301', 'é', 'EU', 'eu', 'EU-2',
    ));
    await verify(fc.asyncProperty(hostile, fc.array(hostile, { minLength: 1, maxLength: 17 }), fc.boolean(), async (raw, inputs, serial) => {
      const values = [raw, raw.normalize('NFKC'), ...inputs, raw, '_Ungrouped', ''].map((Dept) => ({ Dept, ID: '00123' }));
      const pattern = serial ? virtualFilenameToken('PADDED_ROW_001') + '.pdf' : '{{ID}}.pdf';
      const options = { localDate: '2026-11-27' };
      const plan = planGroupedOutput(values, 'Dept', pattern, options);
      expect(planGroupedOutput(values, 'Dept', pattern, options)).toEqual(plan);
      expect(() => validateGroupingPlan(plan, values.length)).not.toThrow();
      expect(new Set(plan.rows.map(({ zipPath }) => filenameKey(zipPath))).size).toBe(values.length);
      expect(new Set(plan.groups.map(({ folder }) => filenameKey(folder))).size).toBe(plan.groups.length);
      const observed = values.map(({ Dept }) => Dept.trim() ? Dept : null);
      expect(plan.groups.map(({ groupValue }) => groupValue)).toEqual([...new Set(observed)]);
      for (const { groupValue, folder, rowNumbers } of plan.groups) {
        expect(rowNumbers).toEqual(observed.flatMap((value, index) => value === groupValue ? [index + 1] : []));
        expect(folder === '_Ungrouped').toBe(groupValue === null);
        rowNumbers.forEach((number, index) => {
          const path = plan.rows[number - 1]!.zipPath;
          expect(isSafeGroupedPdfPath(path)).toBe(true);
          expect(posix.normalize(path)).toBe(path);
          expect(win32.normalize(path)).toBe(path.replace('/', '\\'));
          expect(path).toBe(folder + '/' + (serial ? String(number).padStart(4, '0') : (index ? '00123-' + (index + 1) : '00123')) + '.pdf');
        });
      }
    }), 850);
  }, 40_000);

  it('checks 620 split-group indexes conserve selected records and physical pages through cover continuations', async () => {
    const group = fc.constantFrom('A', 'B', 'جَدَّة', '', '_Ungrouped', '../A');
    await verify(fc.asyncProperty(fc.array(fc.record({
      Clinic: group, pages: fc.integer({ min: 1, max: 8 }), height: fc.integer({ min: 8, max: 23 }),
      status: fc.constantFrom('pass', 'flagged'), selected: fc.boolean(),
    }), { minLength: 1, maxLength: 70 }), fc.boolean(), async (records, twoUp) => {
      const plan = planGroupedOutput(records.map(({ Clinic }) => ({ Clinic })), 'Clinic');
      const scope = resolveRowSelection(records, records.flatMap(({ selected }, index) => selected ? [index + 1] : []));
      const printed = new Set(scope.selectedRowNumbers);
      const seen: number[] = [];
      for (const { rowNumbers } of plan.groups) {
        const members = rowNumbers.filter((number) => printed.has(number));
        if (!members.length) continue;
        seen.push(...members);
        const rows = members.map((number) => ({
          height: records[number - 1]!.height, pageCount: twoUp ? 1 : records[number - 1]!.pages,
        }));
        const covers = paginateCoverRows(rows, 90, 125, 20, twoUp ? '2-up' : '1-up');
        const ordered = covers.flat();
        expect(ordered.map(({ index }) => members[index])).toEqual(members);
        let completed = 0;
        for (const [index, { startPage, endPage }] of ordered.entries()) {
          const pageCount = rows[index]!.pageCount;
          if (twoUp) {
            expect(startPage).toBe(covers.length + Math.ceil((index + 1) / 2));
            expect(endPage).toBe(startPage);
          } else {
            expect(startPage).toBe(covers.length + completed + 1);
            expect(endPage).toBe(startPage + pageCount - 1);
            completed += pageCount;
          }
        }
        expect(ordered.at(-1)?.endPage).toBe(covers.length + (twoUp ? Math.ceil(members.length / 2) : completed));
      }
      expect(seen.sort((a, b) => a - b)).toEqual(scope.selectedRowNumbers);
    }), 620);
  }, 40_000);

  it('checks 800 v9 preset and source-bound drafts preserve exact physical grouping columns and reject invalid values', async () => {
    const columns = fc.constantFrom('Clinic', 'CLINIC', 'فرع', 'Équipe', 'E\u0301quipe', '__proto__', 'PADDED_ROW_001');
    const invalid = fc.constantFrom(undefined, '', ' \t ', 4, [], {}, false);
    await verify(fc.asyncProperty(columns, invalid, fc.boolean(), fc.integer({ min: 600, max: 1000 }), async (column, bad, group, size) => {
      const v8 = {
        version: 8, mapping: { ID: 'Record' }, filenamePattern: '{{Record}}.pdf', minFontSize: size / 100, font: 'auto',
        flattenZip: false, includeCoverSheet: true, alignOverrides: {}, watermark: { kind: 'none' }, virtualMappings: {},
        qrStamp: { placement: 'none' }, coverLanguage: 'bilingual', imposition: '2-up',
      } as const;
      const v9 = { ...v8, version: 9, groupByColumn: group ? column : null } as const;
      expect(validateMappingPreset(JSON.parse(JSON.stringify(v8)))).toEqual(v8);
      expect(validateMappingPreset(JSON.parse(JSON.stringify(v9)))).toEqual(v9);
      expect(validateMappingPreset({ ...v9, groupByColumn: bad })).toBeUndefined();
      expect(validateMappingPreset({ ...v8, groupByColumn: column })).toBeUndefined();
      const source = { templateSha256: 'a'.repeat(64), rosterSha256: 'b'.repeat(64), fields: ['ID'], columns: ['Record', column], sheetName: 'Roster', rowCount: 1 };
      const draft = { kind: 'arabiform-batch-draft', version: 1, source, edits: {}, hygiene: [], settings: v9, customFontSha256: null } satisfies BatchDraft;
      expect(parseBatchDraft(serializeBatchDraft(draft), source)).toEqual(draft);
      expect(() => serializeBatchDraft({ ...draft, settings: { ...v9, groupByColumn: column + '\u200e' } })).toThrow('invalid-batch-draft');
    }), 800);
  }, 40_000);

  it('roundtrips 250 genuinely authored rotated dropdown and grouped radio fills with exact Unicode exports', async () => {
    const pages = await Promise.all([0, 90, 180, 270].map(async (rotation) => {
      const flat = await PDFDocument.create({ updateMetadata: false });
      const page = flat.addPage([470, 410]);
      page.setRotation(degrees(rotation));
      page.setCropBox(11.5, 34.25, 410, 345);
      const bytes = await flat.save();
      return { bytes, source: await inspectFlatPdf(bytes) };
    }));
    const fonts = {
      arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
      latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
    };
    await verify(fc.asyncProperty(fc.integer({ min: 0, max: 3 }), fc.boolean(),
      fc.constantFrom('أَبْهَا', 'جَدَّة', 'الرِّيَاض', 'مَكَّة'), fc.integer({ min: 0, max: 99_999 }),
      async (turn, selectArabic, arabic, id) => {
        const { source, bytes } = pages[turn]!;
        const page = source.pages[0]!;
        const latin = 'Clinic 00' + String(id);
        const radio = [arabic, 'MAIL (' + String(id) + ')'];
        const options = [arabic + ' 00123', latin];
        const fields: FieldDraftSpec[] = [
          { name: 'Clinic', kind: 'dropdown', pageIndex: 0, rectPdf: displayToSource([0.1, 0.18, 0.58, 0.11], page), options },
          ...radio.map((exportValue, index): FieldDraftSpec => ({
            name: 'Contact', kind: 'radio', pageIndex: 0, rectPdf: displayToSource([0.12 + 0.3 * index, 0.44, 0.06, 0.08], page), exportValue,
          })),
        ];
        const restored = await loadFieldLayout(await saveFieldLayout(source, fields), source);
        const authored = await authorFlatPdf(bytes, restored);
        const info = await inspectTemplate(authored);
        expect(info.fields.map(({ choices }) => choices)).toEqual([options, radio].map((values) => values.map((value) => ({ value, label: value }))));
        expect(info.fields[1]?.widgets.map(({ rotation }) => rotation)).toEqual([page.rotation, page.rotation]);
        const index = selectArabic ? 0 : 1;
        const result = await preflightRow(authored, { Clinic: options[index]!, Contact: radio[index]! }, { fonts });
        expect(result.diagnostics).toEqual([]);
        const readback = await extractBatch([{ filename: 'authored.pdf', bytes: result.pdfBytes! }]);
        expect(readback.rows[0]?.fields).toEqual({
          Clinic: { kind: 'dropdown', value: options[index] },
          Contact: { kind: 'radio', value: radio[index], nativeValue: String(index) },
        });
      }), 250);
  }, 60_000);
});
