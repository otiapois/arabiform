import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFHexString, decodePDFRawStream, PDFRawStream } from 'pdf-lib';
import { expect, it } from 'vitest';
import { createCustodyManifest, hashCustodySources, MERGED_CUSTODY_FILENAME, sha256 } from '../../src/core/audit/custody';
import { createCustodyQrRecords } from '../../src/core/custody/records';
import { parseCustodyManifest, verifyCustodyPdf, verifyCustodyQr } from '../../src/core/custody/verify';
import { validateMappingPreset } from '../../src/core/draft/mapping-preset';
import { planGroupedOutput, SPLIT_CUSTODY_PATH } from '../../src/core/export/grouping';
import { extractBatch } from '../../src/core/extractor/extract';
import { inspectTemplate, preflightRow } from '../../src/core/pdf';
import { resolveQrPayload } from '../../src/core/pdf/qr-encoder';
import { qrStampLayout } from '../../src/core/pdf/qr-stamp';
import { validateBatchQrPrintRequest, validateQrStampSettings } from '../../src/core/pdf/qr-settings';
import { readRoster } from '../../src/core/roster';
import { generateStudioTemplate, STUDIO_TEMPLATE_IDS } from '../../src/core/studio/templates';
import { createBatchProcessor } from '../../src/core/worker/batch';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fonts = {
  arabic: await readFile('public/fonts/NotoNaskhArabic-Regular.ttf'),
  latin: await readFile('public/fonts/NotoSans-Regular.ttf'),
};

it('makes four standard one-page AcroForms with exact starter columns and extractable native values', async () => {
  const fields = [
    ['RecipientName', 'CourseTitle', 'IssueDate', 'CertificateID', 'HonorsCheck'],
    ['EmployeeName', 'EmployeeID', 'JobTitle', 'Department', 'StartDate', 'ActiveStatus'],
    ['PatientName', 'NationalID', 'ClinicBranch', 'ConsentCheck', 'ContactPreference'],
    ['VisitorName', 'Organization', 'BadgeID', 'AccessZone'],
  ];
  const expectedSize = [[841.89, 595.28], [595.28, 841.89], [595.28, 841.89], [419.53, 297.64]];
  for (const [index, id] of STUDIO_TEMPLATE_IDS.entries()) {
    const organizationName = 'مَرْكَزُ الأَمَان · Acme 00123';
    const { pdfBytes, csv, csvFilename } = await generateStudioTemplate(id, {
      organizationName, documentSubtitle: '2026 / الأَرْشِيف', accentPalette: 'forest',
    }, fonts);
    const meta = await inspectTemplate(pdfBytes);
    const primary = (await PDFDocument.load(pdfBytes)).getPage(0);
    expect([primary.getWidth(), primary.getHeight()]).toEqual(expectedSize[index]);
    const contents = primary.node.Contents();
    expect(contents).toBeDefined();
    const source = (await PDFDocument.load(pdfBytes)).context.enumerateIndirectObjects()
      .filter(([, object]) => object instanceof PDFRawStream)
      .map(([, object]) => decoder.decode(decodePDFRawStream(object as PDFRawStream).decode()))
      .join('\n');
    expect(source).toContain(`/ActualText ${PDFHexString.fromText(organizationName)}`);
    expect(meta.fields.map(({ name }) => name)).toEqual(fields[index]);
    const roster = (await readRoster(encoder.encode(csv), csvFilename)).sheets[0]!;
    expect(roster.headers).toEqual(fields[index]);
    for (const row of roster.rows) {
      const filled = await preflightRow(pdfBytes, row.values, { fonts });
      expect(filled.status, JSON.stringify(filled.diagnostics)).toBe('pass');
      const result = await extractBatch([{ filename: 'filled.pdf', bytes: filled.pdfBytes! }]);
      expect(result.rows[0]!.status).toBe('extracted');
      for (const { kind, name } of meta.fields) {
        const value = row.values[name];
        expect(result.rows[0]!.fields[name]!.value).toBe(kind === 'checkbox' ? value === 'yes' ? 'checked' : 'unchecked' : value);
      }
    }
  }
});

it('rejects unsafe header input and rejects custom text when it cannot fit at a readable minimum', async () => {
  await expect(generateStudioTemplate('visitor-badge-a6', { organizationName: 'Unauthorized\u202eBrand' }, fonts))
    .rejects.toThrow('studio-unsupported-text');
  await expect(generateStudioTemplate('visitor-badge-a6', { documentSubtitle: 'One\nTwo' }, fonts))
    .rejects.toThrow('studio-unsupported-text');
  await expect(generateStudioTemplate('visitor-badge-a6', { organizationName: 'W'.repeat(159) }, fonts))
    .rejects.toThrow('studio-text-does-not-fit');
});

it('binds a custody QR to original sheet and row and issues it only from completed structured print outputs', async () => {
  const studio = await generateStudioTemplate('visitor-badge-a6', {}, fonts);
  const roster = encoder.encode(studio.csv);
  const table = (await readRoster(roster, studio.csvFilename)).sheets[0]!;
  const rows = table.rows.map(({ values }) => values);
  const worker = createBatchProcessor();
  const preflight = await worker({ phase: 'preflight', input: {
    template: studio.pdfBytes, roster, sheetName: 'Wave 2', rows, options: { fonts },
  } }, () => {});
  if (!preflight || !('custody' in preflight)) throw new Error('missing preflight');
  const sources = preflight.custody;
  const filenames = ['Same.pdf', 'Other.pdf'];
  const selection = { exportScope: 'selected-subset' as const, selectedRowNumbers: [2] };
  const qrStamp = { placement: 'bottom-right', sizePt: 72, custodyRecord: true } as const;
  const [record] = await createCustodyQrRecords(sources, selection.selectedRowNumbers);
  const batchIdentity = JSON.stringify(['ArabiForm custody QR v1', sources.templateSha256, sources.rosterSha256, 'Wave 2']);
  const prefix = createHash('sha256').update(batchIdentity).digest('hex').slice(0, 12);
  expect(record).toEqual({ rowNumber: 2, payload: `ARABIFORM:1:${prefix}:2` });
  const editable = await worker({ phase: 'zip', filenames, qrStamp, rowSelection: [2] }, () => {});
  if (!editable || editable instanceof Uint8Array || !('entries' in editable)) throw new Error('missing editable result');
  expect(editable.qrRecords).toBeUndefined();
  expect(() => validateBatchQrPrintRequest({ ...qrStamp, payloads: [null, record!.payload] }, 2)).toThrow('qr-stamp-invalid-settings');
  const plainQr = await worker({ phase: 'zip', filenames, qrStamp: { placement: 'bottom-right', sizePt: 72, payloads: [null, record!.payload] },
    rowSelection: [2], flattenZip: true }, () => {});
  if (!plainQr || plainQr instanceof Uint8Array || !('entries' in plainQr)) throw new Error('missing legacy print result');
  const legacyReceipt = await parseCustodyManifest(createCustodyManifest(sources, plainQr, selection));
  expect(verifyCustodyQr(legacyReceipt, record!.payload).status).toBe('UNMATCHED_UNKNOWN');
  const zip = await worker({ phase: 'zip', filenames, qrStamp, rowSelection: [2], flattenZip: true }, () => {});
  if (!zip || zip instanceof Uint8Array || !('entries' in zip)) throw new Error('missing print ZIP');
  const receipt = await parseCustodyManifest(createCustodyManifest(sources, zip, selection));
  expect(zip.qrRecords).toEqual([record]);
  expect(verifyCustodyQr(receipt, record!.payload)).toMatchObject({ status: 'VERIFIED_QR_RECORD', rowNumber: 2 });
  for (const incorrect of [record!.payload + '\n', record!.payload.slice(0, -1) + '1',
    record!.payload.replace(prefix, prefix.toUpperCase()), record!.payload.replace(/:2$/, ':02')]) {
    expect(verifyCustodyQr(receipt, incorrect).status).toBe('UNMATCHED_UNKNOWN');
  }
  await expect(parseCustodyManifest(createCustodyManifest({ ...sources, sheetName: 'Different sheet' }, zip, selection)))
    .rejects.toThrow('custody-invalid-manifest');
  const member = unzipSync(zip.bytes)['Other.pdf']!;
  expect((await verifyCustodyPdf(receipt, { filename: 'renamed.pdf', bytes: member })).status).toBe('VERIFIED_EXACT_MATCH');
  const altered = member.slice();
  altered[5] = altered[5]! ^ 1;
  expect((await verifyCustodyPdf(receipt, { filename: 'Other.pdf', bytes: altered })).status).toBe('TAMPERED_BYTE_MISMATCH');
  expect((await verifyCustodyPdf(receipt, { filename: 'random.pdf', bytes: altered })).status).toBe('UNMATCHED_UNKNOWN');

  const merged = await worker({ phase: 'merged', qrStamp, rowSelection: [2], imposition: '2-up' }, () => {});
  if (!merged || !('mergedPdfSha256' in merged)) throw new Error('missing merged result');
  const mergedReceipt = await parseCustodyManifest(createCustodyManifest(sources, merged, selection));
  expect(verifyCustodyQr(mergedReceipt, record!.payload).status).toBe('VERIFIED_QR_RECORD');
  expect((await verifyCustodyPdf(mergedReceipt, { filename: MERGED_CUSTODY_FILENAME, bytes: merged.bytes })).status).toBe('VERIFIED_EXACT_MATCH');
  const grouping = planGroupedOutput(rows, 'Organization', 'Same.pdf');
  const split = await worker({ phase: 'split', grouping, qrStamp, rowSelection: [2], imposition: '2-up' }, () => {});
  if (!split || !('groups' in split)) throw new Error('missing split result');
  const splitArchive = unzipSync(split.bytes);
  const splitReceipt = await parseCustodyManifest(decoder.decode(splitArchive[SPLIT_CUSTODY_PATH]!));
  expect(split.qrRecords).toEqual([record]);
  expect(splitReceipt.qrRecords).toEqual([record]);
  const groupName = split.groups[0]!.zipPath;
  expect((await verifyCustodyPdf(splitReceipt, { filename: groupName, bytes: splitArchive[groupName]! })).status).toBe('VERIFIED_EXACT_MATCH');
  // The largest stamp fits the page yet cannot obscure any visitor badge widget.
  expect(qrStampLayout([0, 0, 419.53, 297.64], [0, 0, 419.53, 297.64], 0, 1, 'bottom-right', 72).side).toBe(72);
});

it('keeps legacy grouped duplicates, names, digests and normalized path ambiguity fail-closed', async () => {
  const sources = await hashCustodySources(encoder.encode('template'), encoder.encode('roster'));
  const [a, b, bad] = ['%PDF-1.7\none', '%PDF-1.7\ntwo', '%PDF-1.7\nbad'].map((value) => encoder.encode(value));
  const first = { filename: 'same.pdf', sha256: await sha256(a!), bytes: a!.byteLength, zipPath: 'A/same.pdf' };
  const second = { filename: 'same.pdf', sha256: await sha256(b!), bytes: b!.byteLength, zipPath: 'B/same.pdf' };
  const json = createCustodyManifest(sources, { entries: [first, second], groupByColumn: 'Department' });
  const receipt = await parseCustodyManifest(json);
  expect(await verifyCustodyPdf(receipt, { filename: 'same.pdf', bytes: b! })).toMatchObject({
    status: 'VERIFIED_EXACT_MATCH', expectedSha256: [first.sha256, second.sha256],
  });
  expect(await verifyCustodyPdf(receipt, { filename: 'A/same.pdf', bytes: b! })).toMatchObject({
    status: 'TAMPERED_BYTE_MISMATCH', expectedSha256: [first.sha256],
  });
  expect(await verifyCustodyPdf(receipt, { filename: 'same.pdf', bytes: bad! })).toMatchObject({
    status: 'TAMPERED_BYTE_MISMATCH', expectedSha256: [first.sha256, second.sha256],
  });
  const duplicate = createCustodyManifest(sources, { entries: [first, { ...second, zipPath: 'Ａ/same.pdf' }] });
  for (const malformed of [duplicate, json.replace('"version": 1', '"version": 8, "\\u0076ersion": 1'), '{', json.replace('A/same.pdf', '../same.pdf')]) {
    await expect(parseCustodyManifest(malformed)).rejects.toThrow('custody-invalid-manifest');
  }
});

it('preserves a real legacy roster token and validates the new opt-in through each QR-capable preset', () => {
  const legacy = { placement: 'top-right', sizePt: 48, pattern: '{{CUSTODY_RECORD}}' } as const;
  const custody = { ...legacy, pattern: 'OLD {{ID}}', custodyRecord: true };
  expect(resolveQrPayload(legacy.pattern, { CUSTODY_RECORD: '007' }, 1, '2026-11-27')).toBe('007');
  expect(validateQrStampSettings(legacy)).toEqual(legacy);
  expect(validateQrStampSettings(custody)).toEqual(custody);
  expect(validateQrStampSettings({ ...legacy, custodyRecord: false })).toBeUndefined();
  for (const version of [7, 8, 9]) {
    const preset = {
      version, filenamePattern: 'record.pdf', mapping: {}, minFontSize: 8, font: 'auto', includeCoverSheet: false, flattenZip: false,
      alignOverrides: {}, watermark: { kind: 'none' }, virtualMappings: {}, qrStamp: custody, coverLanguage: 'auto',
      ...(version >= 8 && { imposition: '1-up' }), ...(version === 9 && { groupByColumn: 'Department' }),
    };
    expect(validateMappingPreset(preset)).toMatchObject({ version, qrStamp: custody });
  }
});
