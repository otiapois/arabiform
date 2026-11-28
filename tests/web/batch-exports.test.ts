import { describe, expect, it, vi } from 'vitest';
import { planGroupedOutput } from '../../src/core/export/grouping';
import { buildDownload, type MergedPrintCache } from '../../src/web/batch-exports';
import type { OutputSettings } from '../../src/web/useBatch';

const values: Record<string, string>[] = [{ ID: '' }, { ID: '00007', PADDED_ROW_001: 'physical' }, { ID: '00123' }];
const source = {
  rows: values.map((row) => ({ values: row, warnings: [] })),
  localDate: '2026-05-02',
};
const output: OutputSettings = {
  filenamePlans: source.rows.map((_, index) => ({ filename: `${index + 1}.pdf`, filenameAdjusted: false })),
  rowSelection: [2, 3], flattenZip: true, groupingBlocked: false,
  cover: { locale: 'ar', templateName: 'source.pdf', coverLanguage: 'bilingual' },
  qrStamp: { placement: 'bottom-right', sizePt: 48, pattern: 'CERT-{{ID}}-{{PADDED_ROW_001}}-[[@PADDED_ROW_001]]-[[@TODAY_ISO]]' },
};
const onProgress = () => {};
const isCurrent = () => true;

function worker() {
  return {
    zip: vi.fn().mockResolvedValue({ bytes: new Uint8Array(), entries: [] }),
    merged: vi.fn().mockResolvedValue({ bytes: new Uint8Array(), mergedPdfSha256: 'digest' }),
    split: vi.fn().mockResolvedValue({ bytes: new Uint8Array(), groupByColumn: 'Clinic', groups: [] }),
    certificate: vi.fn().mockResolvedValue(new Uint8Array()),
  };
}

describe('preparing browser-local print downloads', () => {
  it('resolves selected effective values at their original row positions for both print paths', async () => {
    const client = worker();
    const subset = { exportScope: 'selected-subset' as const, selectedRowNumbers: [2, 3] };
    const request = {
      placement: 'bottom-right', sizePt: 48,
      payloads: [null, 'CERT-00007-physical-0002-2026-05-02', 'CERT-00123-0003-0003-2026-05-02'],
    };
    const filenames = ['1.pdf', '2.pdf', '3.pdf'];
    const imposed = { ...output, imposition: '2-up' } as const;
    await buildDownload('zip', client, onProgress, source, [], imposed, subset, isCurrent);
    await buildDownload('merged', client, onProgress, source, [], imposed, subset, isCurrent);
    expect(client.zip).toHaveBeenCalledWith(filenames, onProgress, true, undefined, [2, 3], request);
    expect(client.merged).toHaveBeenCalledWith(onProgress, { ...output.cover, filenames }, undefined, [2, 3], request, '2-up');
  });

  it('blocks an invalid print row before invoking the worker and leaves editable ZIP usable', async () => {
    const client = worker();
    const scope = { exportScope: 'all-ready' as const, selectedRowNumbers: [1, 2, 3] };
    const settings: OutputSettings = { ...output, rowSelection: 'all-ready', qrStamp: { placement: 'top-right', sizePt: 48, pattern: '{{ID}}' } };
    for (const kind of ['merged', 'zip'] as const) {
      await expect(buildDownload(kind, client, onProgress, source, [], settings, scope, isCurrent)).rejects
        .toMatchObject({ message: 'qr-stamp-empty-payload', rowNumber: 1 });
    }
    expect(client.zip).not.toHaveBeenCalled();
    expect(client.merged).not.toHaveBeenCalled();
    await buildDownload('zip', client, onProgress, source, [], { ...settings, flattenZip: false }, scope, isCurrent);
    expect(client.zip).toHaveBeenCalledWith(['1.pdf', '2.pdf', '3.pdf'], onProgress, false, undefined, 'all-ready', undefined);
  });

  it('passes custody QR selection to the worker and preserves its exported records without using the dormant pattern', async () => {
    const client = worker();
    const qrRecords = [{ rowNumber: 1, payload: 'printed-custody-payload' }];
    client.zip.mockResolvedValue({ bytes: new Uint8Array(), entries: [], qrRecords });
    const scope = { exportScope: 'all-ready' as const, selectedRowNumbers: [1, 2, 3] };
    const settings: OutputSettings = {
      ...output,
      rowSelection: 'all-ready',
      qrStamp: { placement: 'top-right', sizePt: 48, pattern: '{{ID}}', custodyRecord: true },
    };
    const download = await buildDownload('zip', client, onProgress, source, [], settings, scope, isCurrent);
    expect(client.zip).toHaveBeenCalledWith(['1.pdf', '2.pdf', '3.pdf'], onProgress, true, undefined, 'all-ready',
      { placement: 'top-right', sizePt: 48, custodyRecord: true });
    expect(download?.digests).toMatchObject({ qrRecords });
  });

  it('appends approval seal options only to printed downloads', async () => {
    const client = worker();
    const scope = { exportScope: 'selected-subset' as const, selectedRowNumbers: [2, 3] };
    const approvalSeal = { placement: 'top-left', labelEn: 'Synthetic Sample', labelAr: 'عينة اصطناعية', issueDate: '2026-05-02' } as const;
    const grouping = planGroupedOutput(source.rows, 'ID', '{{ID}}.pdf');
    const settings = { ...output, qrStamp: undefined, approvalSeal, grouping };
    const filenames = ['1.pdf', '2.pdf', '3.pdf'];
    const printArgs = [onProgress, { ...output.cover, filenames }, undefined, [2, 3], undefined, undefined] as const;

    await buildDownload('zip', client, onProgress, source, [], { ...settings, grouping: undefined }, scope, isCurrent);
    await buildDownload('zip', client, onProgress, source, [], settings, scope, isCurrent);
    await buildDownload('zip', client, onProgress, source, [], { ...settings, flattenZip: false }, scope, isCurrent);
    await buildDownload('merged', client, onProgress, source, [], settings, scope, isCurrent);
    await buildDownload('split', client, onProgress, source, [], settings, scope, isCurrent);
    await buildDownload('split', client, onProgress, source, [], { ...settings, approvalSeal: undefined }, scope, isCurrent);

    expect(client.zip).toHaveBeenNthCalledWith(1, filenames, onProgress, true, undefined, [2, 3], undefined, undefined, approvalSeal);
    expect(client.zip).toHaveBeenNthCalledWith(2, filenames, onProgress, true, undefined, [2, 3], undefined, grouping, approvalSeal);
    expect(client.zip).toHaveBeenNthCalledWith(3, filenames, onProgress, false, undefined, [2, 3], undefined, grouping);
    expect(client.merged).toHaveBeenCalledWith(...printArgs, approvalSeal);
    expect(client.split).toHaveBeenNthCalledWith(1, grouping, ...printArgs, approvalSeal);
    expect(client.split).toHaveBeenNthCalledWith(2, grouping, ...printArgs);
  });

  it('skips payload resolution when the QR import finishes after cancellation', async () => {
    const client = worker();
    const scope = { exportScope: 'all-ready' as const, selectedRowNumbers: [1, 2, 3] };
    const settings: OutputSettings = { ...output, rowSelection: 'all-ready', qrStamp: { placement: 'top-right', sizePt: 48, pattern: '{{ID}}' } };
    let current = true;
    const download = buildDownload('merged', client, onProgress, source, [], settings, scope, () => current);
    current = false;

    await expect(download).resolves.toBeUndefined();
    expect(client.merged).not.toHaveBeenCalled();
  });

  it.each([['certificate', 'merged'], ['merged', 'certificate']] as const)(
    'uses the same combined bytes for %s then %s and forwards four-up options to merged and split', async (first, second) => {
      const client = worker();
      const mergedBytes = new Uint8Array([1, 2, 3]);
      const certificateBytes = new Uint8Array([4, 5, 6]);
      const proof = { bytes: mergedBytes, mergedPdfSha256: 'digest' };
      client.merged.mockResolvedValue(proof);
      client.certificate.mockResolvedValue(certificateBytes);
      const fourUp = { fourUpOrder: 'cut-and-stack', centerCutGuides: true } as const;
      const grouping = planGroupedOutput(source.rows, 'ID', '{{ID}}.pdf');
      const settings = { ...output, qrStamp: undefined, grouping, imposition: '4-up', fourUp } as const;
      const scope = { exportScope: 'selected-subset' as const, selectedRowNumbers: [2, 3] };
      const cache: MergedPrintCache = {};
      const names = { templateName: 'template.pdf', rosterName: 'people.csv' };
      const downloads = new Map<string, Awaited<ReturnType<typeof buildDownload>>>();
      for (const kind of [first, second]) {
        downloads.set(kind, await buildDownload(kind, client, onProgress, source, [], settings, scope, isCurrent, cache, names));
      }
      await buildDownload('split', client, onProgress, source, [], settings, scope, isCurrent, cache, names);
      const printArgs = [onProgress, { ...output.cover, filenames: ['1.pdf', '2.pdf', '3.pdf'] }, undefined, [2, 3], undefined, '4-up', undefined, fourUp];
      expect(client.merged).toHaveBeenCalledExactlyOnceWith(...printArgs);
      expect(client.split).toHaveBeenCalledExactlyOnceWith(grouping, ...printArgs);
      expect(client.certificate).toHaveBeenCalledExactlyOnceWith(proof, { ...names, outputName: 'arabiform-merged.pdf' });
      expect(downloads.get('merged')).toMatchObject({ data: mergedBytes, filename: 'arabiform-merged.pdf', digests: { mergedPdfSha256: 'digest' } });
      expect(downloads.get('certificate')).toEqual({ data: certificateBytes, filename: 'print-shop-certificate.pdf', mime: 'application/pdf' });
    },
  );

  it('keeps an empty selection and a canceled job from requesting a certificate', async () => {
    const client = worker();
    const cache: MergedPrintCache = {};
    const names = { templateName: 'template.pdf', rosterName: 'people.csv' };
    const settings = { ...output, qrStamp: undefined };
    const scope = { exportScope: 'selected-subset' as const, selectedRowNumbers: [] };
    await expect(buildDownload('certificate', client, onProgress, source, [], settings, scope, isCurrent, cache, names)).resolves.toBeUndefined();
    expect(client.merged).not.toHaveBeenCalled();
    let current = true;
    client.merged.mockImplementationOnce(async () => {
      current = false;
      return { bytes: new Uint8Array([1]), mergedPdfSha256: 'digest' };
    });
    await expect(buildDownload('certificate', client, onProgress, source, [], settings, { ...scope, selectedRowNumbers: [2] }, () => current,
      cache, names)).resolves.toBeUndefined();
    expect(client.certificate).not.toHaveBeenCalled();
    expect(cache.merged).toBeUndefined();
  });
});
