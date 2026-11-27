import { useEffect, useState } from 'react';
import { ApprovalSealError } from '../core/pdf/approval-seal-settings';
import { errorCode } from './resources';
import type { BatchWorker } from './useBatch';

export type RenderRecord = (client: BatchWorker, row: number) => Promise<Uint8Array | undefined>;
type RecordPreview = { bytes?: Uint8Array; problem?: { code: string; pageNumber?: number; fieldName?: string } };

export function useRecordPreview(client: BatchWorker | undefined, row: number | undefined, render: RenderRecord, delayed = false) {
  const [loaded, setLoaded] = useState<{ client: BatchWorker; row: number; render: RenderRecord; result: RecordPreview }>();
  useEffect(() => {
    if (!client || row === undefined) return;
    let active = true;
    const show = (result: RecordPreview) => {
      if (active) setLoaded({ client, row, render, result });
    };
    const request = () => void render(client, row).then((bytes) => show(bytes ? { bytes } : { problem: { code: 'exportError' } }), (error: unknown) => show({
      problem: error instanceof ApprovalSealError ? error : { code: errorCode(error, 'exportError') },
    }));
    const timer = delayed ? window.setTimeout(request, 120) : undefined;
    if (!delayed) request();
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, delayed, render, row]);

  return loaded?.client === client && loaded?.row === row && loaded?.render === render ? loaded.result : undefined;
}
