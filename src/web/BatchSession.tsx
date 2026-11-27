import { memo, useLayoutEffect } from 'react';
import { useBatch } from './useBatch';

export type BatchPublication = {
  batch: Parameters<typeof useBatch>[0];
  job: ReturnType<typeof useBatch>;
};

export default memo(function BatchSession({ batch, selected, output, sealPreviewBlocked, publish }: {
  batch: Parameters<typeof useBatch>[0];
  selected: number;
  output: Parameters<typeof useBatch>[2];
  sealPreviewBlocked: boolean;
  publish: (publication: BatchPublication) => void;
}) {
  const job = useBatch(batch, selected, output, sealPreviewBlocked);
  // Publish before paint. The memo boundary keeps a parent update from starting another publication.
  useLayoutEffect(() => publish({ batch, job }), [batch, job, publish]);
  return null;
});
