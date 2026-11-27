import { readFile } from 'node:fs/promises';
import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { beforeAll, expect, it, vi } from 'vitest';
import { planGroupedOutput } from '../../src/core/export/grouping';
import type { PreflightOptions } from '../../src/core/pdf';
import { createBatchProcessor } from '../../src/core/worker/batch';

const key = PDFName.of;
const idle = () => {};
let fonts: PreflightOptions['fonts'];

beforeAll(async () => {
  fonts = {
    arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
    latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
  };
});

it('counts compatible merged and split covers without creating, embedding or serializing a PDF', async () => {
  const template = await readFile('fixtures/golden/template.pdf');
  const rows = ['Layla', 'مُحَمَّد سَالِم', 'Hamad'].map((Name) => ({ Name, ID: '00123' }));
  const roster = new Uint8Array();
  const batch = createBatchProcessor();
  const grouping = planGroupedOutput([{ Branch: 'A' }, { Branch: 'B' }, { Branch: 'C' }], 'Branch');
  const coverSheet = { templateName: 'نَمُوذَج 00123.pdf', filenames: ['Layla.pdf', 'مُحَمَّد سَالِم.pdf', 'Hamad.pdf'],
    locale: 'en' as const, coverLanguage: 'bilingual' as const, includeCustody: true, exportedAt: '2026-11-28' };
  await batch({ phase: 'preflight', input: { rows, template, roster, options: { fonts } } }, idle);
  const load = vi.spyOn(PDFDocument, 'load');
  const create = vi.spyOn(PDFDocument, 'create');
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  const embedFont = vi.spyOn(PDFDocument.prototype, 'embedFont');
  try {
    const request = { phase: 'estimate' as const, grouping, coverSheet, imposition: '2-up' as const };
    const [whole, nothing] = await Promise.all([
      batch(request, idle), batch({ ...request, rowSelection: [] }, idle),
    ]);
    expect(whole).toMatchObject({
      totalRecords: 3, templatePagesPerRecord: 1, coverPages: 1, activePhysicalSheets: 3, oneUpPhysicalSheets: 4,
      twoUpPhysicalSheets: 3, sheetsSavedByTwoUp: 1, percentPaperSaved: 25,
      split: {
        totalRecords: 3, coverPages: 3, activePhysicalSheets: 6, oneUpPhysicalSheets: 6, twoUpPhysicalSheets: 6,
        sheetsSavedByTwoUp: 0, percentPaperSaved: 0, groupBreakdowns: [
          { filename: 'A-merged.pdf', rowNumbers: [1], activePhysicalSheets: 2 },
          { filename: 'B-merged.pdf', rowNumbers: [2], activePhysicalSheets: 2 },
          { filename: 'C-merged.pdf', rowNumbers: [3], activePhysicalSheets: 2 },
        ],
      },
    });
    expect(nothing).toMatchObject({
      totalRecords: 0, coverPages: 0, activePhysicalSheets: 0, twoUpPhysicalSheets: 0, percentPaperSaved: 0,
      split: { groupBreakdowns: [], activePhysicalSheets: 0 },
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(embedFont).not.toHaveBeenCalled();
    await expect(batch({ ...request, coverSheet: { ...coverSheet, templateName: '🙂.pdf' } }, idle))
      .rejects.toThrow('cover-sheet-unsupported-text');
    expect(await batch({ ...request, rowSelection: [3] }, idle)).toMatchObject({
      totalRecords: 1, activePhysicalSheets: 2, split: { groupBreakdowns: [{ rowNumbers: [3] }] },
    });
    expect(await batch({ ...request, imposition: '1-up', rowSelection: [3, 1] }, idle)).toMatchObject({
      imposition: '1-up', totalRecords: 2, activePhysicalSheets: 3, twoUpPhysicalSheets: 2,
      split: { activePhysicalSheets: 4, groupBreakdowns: [{ rowNumbers: [1] }, { rowNumbers: [3] }] },
    });
  } finally {
    load.mockRestore();
    create.mockRestore();
    save.mockRestore();
    embedFont.mockRestore();
  }
});

it('reports 1-up separately when a non-widget print annotation makes 2-up unavailable', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 150]);
  source.getForm().createCheckBox('Present').addToPage(page, { x: 30, y: 35, width: 18, height: 18 });
  page.node.addAnnot(source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20], F: 4 })));
  const template = await source.save();
  const batch = createBatchProcessor();
  await batch({ phase: 'preflight', input: { rows: [{ Present: 'yes' }], template,
    roster: new Uint8Array(), options: { fonts } } }, idle);
  expect(await batch({ phase: 'estimate', imposition: '2-up' }, idle)).toMatchObject({
    activePhysicalSheets: 1, imposition: '1-up', twoUpUnavailableReason: 'imposition-unsupported-print-annotation',
    twoUpPhysicalSheets: null, sheetsSavedByTwoUp: null, percentPaperSaved: null,
  });
  await expect(batch({ phase: 'merged', imposition: '2-up' }, idle)).rejects.toThrow('imposition-unsupported-print-annotation');
});

it('measures painted ink at the rotated widget edge in physical points and omits blank and flagged rows', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([240, 180]);
  page.node.set(key('UserUnit'), PDFNumber.of(2));
  const name = source.getForm().createTextField('Recipient');
  name.addToPage(page, { x: 70, y: 40, width: 80, height: 24, borderWidth: 0, rotate: degrees(90) });
  name.setMaxLength(16);
  const template = await source.save();
  const batch = createBatchProcessor();
  const checked = await batch({ phase: 'preflight', input: {
    rows: [{ Recipient: '   ' }, { Recipient: 'ليلى' }, { Recipient: 'S'.repeat(25) }],
    template, roster: new Uint8Array(), options: { fonts, alignOverrides: { Recipient: 'ltr' } },
  } }, idle);
  if (!checked || !('spotlight' in checked)) throw new Error('Expected prepared rows');
  const [blank, painted, flagged] = checked.rows;
  expect(blank).toMatchObject({ status: 'pass' });
  expect(blank?.smallestInkFontSizePt).toBeUndefined();
  expect(blank?.inkClearancePt).toBeUndefined();
  expect(painted).toMatchObject({ status: 'pass', smallestInkFontSizePt: painted!.fontSizes.Recipient![0]! * 2 });
  expect(painted?.inkClearancePt).toBeCloseTo(3.2, 9);
  expect(flagged).toMatchObject({ status: 'flagged' });
  expect(flagged?.smallestInkFontSizePt).toBeUndefined();
  expect(flagged?.inkClearancePt).toBeUndefined();
  expect(checked.spotlight).toEqual({ longestMappedTextRow: 3, smallestFontRow: 2, firstFlaggedRow: 3, shortestMappedTextRow: 2 });
});
