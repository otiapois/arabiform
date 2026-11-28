import { lazy, Suspense } from 'react';
import type { FlatSource, MigratedTemplate } from './fill-template-source';

const PdfExtractor = lazy(() => import('./PdfExtractor'));
const FieldDesigner = lazy(() => import('./FieldDesigner'));
const TemplateStudio = lazy(() => import('./TemplateStudio'));
const ReceiptVerifier = lazy(() => import('./ReceiptVerifier'));
const PacketWorkbench = lazy(() => import('./PacketWorkbench'));
const CompareTemplates = lazy(() => import('./CompareTemplates'));
const CompareBatches = lazy(() => import('./CompareBatches'));

export type UtilityMode = 'extract' | 'design' | 'create' | 'verify' | 'packet' | 'compare' | 'compare-batches';
export type DesignSession = { revision: number; source?: FlatSource };

export default function UtilityModes({ mode, opened, design, arabic, loading, onUseInFill }: {
  mode: 'fill' | UtilityMode;
  opened: Partial<Record<UtilityMode, true>>;
  design?: DesignSession;
  arabic: boolean;
  loading: string;
  onUseInFill: (file: File, migration?: MigratedTemplate) => void;
}) {
  const fallback = <p role="status" className="quiet">{loading}</p>;
  return <>
    {opened.extract && <div hidden={mode !== 'extract'}>
      <Suspense fallback={fallback}><PdfExtractor arabic={arabic} /></Suspense>
    </div>}
    {design && <div hidden={mode !== 'design'}>
      <Suspense fallback={fallback}>
        <FieldDesigner key={design.revision} arabic={arabic} initialSource={design.source} onUseInFill={onUseInFill} />
      </Suspense>
    </div>}
    {opened.create && <div hidden={mode !== 'create'}>
      <Suspense fallback={fallback}><TemplateStudio arabic={arabic} onUseInFill={onUseInFill} /></Suspense>
    </div>}
    {mode === 'verify' && <Suspense fallback={fallback}><ReceiptVerifier arabic={arabic} /></Suspense>}
    {opened.packet && <div hidden={mode !== 'packet'}>
      <Suspense fallback={fallback}><PacketWorkbench arabic={arabic} active={mode === 'packet'} /></Suspense>
    </div>}
    {opened.compare && <div hidden={mode !== 'compare'}>
      <Suspense fallback={fallback}><CompareTemplates arabic={arabic} onUseInFill={onUseInFill} /></Suspense>
    </div>}
    {opened['compare-batches'] && <div hidden={mode !== 'compare-batches'}>
      <Suspense fallback={fallback}><CompareBatches arabic={arabic} /></Suspense>
    </div>}
  </>;
}
