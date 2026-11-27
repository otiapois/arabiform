import { describe, expect, it, vi } from 'vitest';
import { buildDownload } from '../../src/web/batch-exports';
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
});
