import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { decodePDFRawStream, degrees, PDFDocument, PDFName, PDFRawStream, type PDFPage } from 'pdf-lib';
import { expect, it } from 'vitest';
import { encodeQr, resolveQrPayload } from '../../src/core/pdf/qr-encoder';
import { createFlattenedZip, createMergedPdf } from '../../src/core/pdf/exports';
import { validateQrStampSettings, type QrPrintRequest } from '../../src/core/pdf/qr-settings';
import { createBatchProcessor } from '../../src/core/worker/batch';
import { proveQrMatrix } from './qr-proof';

it('preserves physical text, resolves unambiguous virtual tokens, and does not expand inserted text', () => {
  expect(resolveQrPayload('{{ID}}-{{PADDED_ROW_001}}-[[@PADDED_ROW_001]]', { ID: ' 00123 {{literal}} ', PADDED_ROW_001: 'physical' }, 7, '2026-11-27'))
    .toBe(' 00123 {{literal}} -physical-0007');
  expect(resolveQrPayload('CERT-{{PADDED_ROW_001}}', {}, 7, '2026-11-27')).toBe('CERT-0007');
  expect(() => resolveQrPayload('CERT-{{unknown}}', {}, 7, '2026-11-27')).toThrow('qr-stamp-unknown-token');
  expect(() => resolveQrPayload('CERT-{{', {}, 7, '2026-11-27')).toThrow('qr-stamp-invalid-payload');
  expect(() => resolveQrPayload('{{ID}}', { ID: '  ' }, 7, '2026-11-27')).toThrow('qr-stamp-empty-payload');
});

it('chooses the smallest byte-mode ECC M version and rejects lossy Unicode or excessive bytes', () => {
  for (const [index, capacity] of [14, 26, 42, 62, 84, 106].entries()) {
    expect(encodeQr('a'.repeat(capacity)).version).toBe(index + 1);
    expect(encodeQr('ع' + 'a'.repeat(capacity - 3)).version).toBe(index + 1);
    if (index > 0) expect(encodeQr('a'.repeat([14, 26, 42, 62, 84][index - 1]! + 1)).version).toBe(index + 1);
  }
  expect(() => encodeQr('a'.repeat(107))).toThrow('qr-stamp-payload-too-long');
  expect(() => encodeQr('ع'.repeat(53))).toThrow('qr-stamp-payload-too-long');
  expect(() => encodeQr('\uD800')).toThrow('qr-stamp-invalid-payload');
});

it.each([
  [14, 1, 1, '3979e03d4c69405769a07e2f150b58e27cbb77d6e4c2ba446f0ab6c318ccf5be'],
  [26, 2, 2, '2c77992479b8613f78f170868b32d1397fc69df5e800464cd2c694e167201b88'],
  [42, 3, 6, '83924910a4b9236542b7698524bf79676437a3d86d750815ebdff239cf3c2843'],
  [62, 4, 1, 'b59eefe5c52be0481c1295a1b983417e72fa71078f054814bcb73a3c5a6e4093'],
  [84, 5, 2, 'b6f380788c753221cb02444ed2c6b04281c7a02b4d1d652b5d941a17738d76a5'],
  [106, 6, 2, '49c5d106e660954fc80349b314c8a78119c7672146b201ccd2b8c04f7058b582'],
  [105, 6, 2, '9821d0abc9087fee3cede48ccb933a843841fc92c23c98c13ca56124b6337eaa'],
] as const)('reads back the %i-byte matrix and preserves its independently checked optimal mask', (length, version, mask, hash) => {
  const payload = length === 105 ? 'ل'.repeat(52) + 'A'
    : Array.from({ length }, (_, index) => String.fromCharCode(32 + (17 * length + 37 * index) % 95)).join('');
  const matrix = encodeQr(payload);
  proveQrMatrix(matrix, payload);
  expect(matrix).toMatchObject({ version, mask });
  expect(createHash('sha256').update(Uint8Array.from(matrix.modules.flat().map(Number))).digest('hex')).toBe(hash);
});

it('validates the exact disabled and active settings shapes', () => {
  expect(validateQrStampSettings({ placement: 'none' })).toEqual({ placement: 'none' });
  const active = { placement: 'top-right', pattern: ' {{ID}} ', sizePt: 48.25 };
  expect(validateQrStampSettings(active)).toEqual(active);
  for (const invalid of [
    { ...active, placement: 'none' }, { ...active, placement: 'center' }, { ...active, sizePt: 35.999 },
    { ...active, sizePt: 72.001 }, { ...active, sizePt: Infinity }, { ...active, sizePt: '48' },
    { ...active, pattern: ' \t ' }, { ...active, extra: true }, { ...active, pattern: '\udc00' },
  ]) expect(validateQrStampSettings(invalid)).toBeUndefined();
});

const pdfName = PDFName.of;

async function fixture({ overlap = false, hidden = false, tooSmall = false } = {}) {
  const doc = await PDFDocument.create();
  const first = doc.addPage([160, 210]);
  const second = doc.addPage(tooSmall ? [60, 210] : [210, 160]);
  second.setRotation(degrees(90));
  const field = doc.getForm().createTextField('ID');
  field.addToPage(first, overlap || hidden ? { x: 105, y: 24, width: 27, height: 22 } : { x: 27, y: 92, width: 91, height: 20 });
  if (hidden) field.acroField.getWidgets()[0]!.dict.set(pdfName('F'), doc.context.obj(2));
  return doc.save();
}

function stampOperators(page: PDFPage) {
  const contents = page.node.Contents();
  const refs = contents && 'asArray' in contents ? contents.asArray() : [];
  return refs.map((ref) => {
    const raw = page.doc.context.lookup(ref);
    return raw instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(raw).decode()) : '';
  }).filter((text) => /1 g\n0 0 \d+ \d+ re\nf\n0 g\n/.test(text));
}

it('blocks visible widget overlap, insufficient space, and missing payloads on both print outputs', async () => {
  const qr: QrPrintRequest = { placement: 'bottom-right', sizePt: 48, payloads: ['00123'] };
  const safe = [{ filename: 'safe.pdf', pdfBytes: await fixture() }];
  const overlapping = [{ filename: 'overlap.pdf', pdfBytes: await fixture({ overlap: true }) }];
  const hidden = [{ filename: 'hidden.pdf', pdfBytes: await fixture({ hidden: true }) }];
  const tooSmall = [{ filename: 'small.pdf', pdfBytes: await fixture({ tooSmall: true }) }];
  for (const request of [
    (rows: typeof safe, stamp: QrPrintRequest) => createMergedPdf(rows, undefined, undefined, undefined, stamp),
    (rows: typeof safe, stamp: QrPrintRequest) => createFlattenedZip(rows, undefined, undefined, stamp),
  ]) {
    await expect(request(overlapping, qr)).rejects.toThrow('qr-stamp-widget-overlap');
    await expect(request(tooSmall, qr)).rejects.toThrow('qr-stamp-does-not-fit');
    await expect(request(safe, { ...qr, payloads: [null] })).rejects.toThrow('qr-stamp-invalid-payload');
    await expect(request(safe, { ...qr, payloads: Array<string>(1) })).rejects.toThrow('qr-stamp-invalid-settings');
    await expect(request(hidden, qr)).resolves.toBeInstanceOf(Uint8Array);
  }
});

it('stamps original selected row indexes on every printed page, preserves editable ZIP and retries after rejection', async () => {
  const template = await fixture();
  const assetRoot = process.env.ARABIFORM_ASSET_ROOT ?? '.';
  const fonts = {
    arabic: await readFile(resolve(assetRoot, 'public/fonts/NotoNaskhArabic-Regular.ttf')),
    latin: await readFile(resolve(assetRoot, 'public/fonts/NotoSans-Regular.ttf')),
  };
  const batch = createBatchProcessor();
  const progress = () => {};
  const filenames = ['one.pdf', 'two.pdf', 'three.pdf'];
  await batch({ phase: 'preflight', input: { template, roster: new Uint8Array(), options: { fonts }, rows: [{ ID: '1' }, { ID: '2' }, { ID: '3' }] } }, progress);
  const rowSelection = [3, 1];
  const qrStamp = { placement: 'bottom-right', sizePt: 48, payloads: ['FIRST', null, 'ثالث'] } as const;
  const selectedPayloads = ['FIRST', 'ثالث'];
  await expect(batch({ phase: 'merged', qrStamp: { ...qrStamp, payloads: [null, null, 'ثالث'] }, rowSelection }, progress))
    .rejects.toThrow('qr-stamp-invalid-payload');
  const merged = await batch({ phase: 'merged', qrStamp, rowSelection, coverSheet: { locale: 'ar', coverLanguage: 'bilingual', filenames, templateName: 'Form.pdf' } }, progress);
  if (!merged || !('bytes' in merged)) throw new Error('missing merge');
  const mergedDoc = await PDFDocument.load(merged.bytes);
  const pages = mergedDoc.getPages();
  expect(pages).toHaveLength(5);
  expect(stampOperators(pages[0]!)).toHaveLength(0);
  const zipCommand = { phase: 'zip', filenames, rowSelection, qrStamp } as const;
  const printed = await batch({ ...zipCommand, flattenZip: true }, progress);
  const editable = await batch({ ...zipCommand, qrStamp: { ...qrStamp, payloads: [] } }, progress);
  if (!printed || !('bytes' in printed) || !editable || !('bytes' in editable)) throw new Error('missing zip');
  const printMembers = unzipSync(printed.bytes);
  const editableMembers = unzipSync(editable.bytes);
  expect(Object.keys(printMembers)).toEqual(['one.pdf', 'three.pdf']);
  expect(Object.keys(editableMembers)).toEqual(['one.pdf', 'three.pdf']);
  expect(stampOperators(pages[1]!)).not.toEqual(stampOperators(pages[3]!));
  for (const [index, filename] of Object.keys(printMembers).entries()) {
    const member = await PDFDocument.load(printMembers[filename]!);
    const selected = encodeQr(selectedPayloads[index]!);
    const members = member.getPages();
    for (const [page, printed] of members.entries()) {
      const ops = stampOperators(printed);
      expect(ops).toEqual(stampOperators(pages[1 + index * 2 + page]!));
      expect(ops).toHaveLength(1);
      const expectedRuns = selected.modules.reduce((sum, row) =>
        sum + row.filter((dark, position) => dark && !row[position - 1]).length, 0);
      expect(ops[0]!.match(/ re\n/g)).toHaveLength(1 + expectedRuns);
    }
    const original = await batch({ phase: 'preview', rowIndex: index === 0 ? 0 : 2 }, progress);
    expect(editableMembers[filename]).toEqual(original);
  }
}, 20_000);
