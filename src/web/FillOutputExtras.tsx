import ApprovalSealControl from './ApprovalSealControl';
import { ExportCounts, ExportProgress, SelectedExportScope } from './BatchExportStatus';
import CustodyPanel from './CustodyPanel';
import ExportError from './ExportError';
import { GroupedSummary, GroupingControl, SplitDownload } from './GroupedOutputs';
import { VirtualFilenameTokens } from './MappingRows';
import PrintEstimate from './PrintEstimate';
import { PrintLayout } from './SourcePrintControls';
import type { ReactNode } from 'react';
import type { translator } from './labels';
import type { useWorkbench } from './useWorkbench';

type Desk = ReturnType<typeof useWorkbench>;
type Language = ReturnType<typeof translator>;

export function FilenameOptions({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  return <>
    {(desk.template || desk.roster) && <VirtualFilenameTokens arabic={arabic} />}
    {(desk.sheet || desk.groupByColumn !== null) && <GroupingControl desk={desk} arabic={arabic} />}
  </>;
}

export function CheckedExportCounts({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  return <ExportCounts arabic={arabic} subset={desk.exportScope.exportScope === 'selected-subset'}
    ready={desk.ready} flagged={desk.flagged} />;
}

export function ExportDetails({ desk, language: { arabic } }: { desk: Desk; language: Language }) {
  return <>
    {desk.exportScope.exportScope === 'selected-subset' &&
      <SelectedExportScope arabic={arabic} count={desk.exportCount} showEmpty={!desk.exportCount && Boolean(desk.results)} />}
    {desk.grouping && desk.results && <GroupedSummary desk={desk} arabic={arabic} />}
    {desk.checkedWorker && <PrintEstimate worker={desk.checkedWorker} output={desk.output} arabic={arabic} />}
  </>;
}

export function ExportFeedback({ desk, language }: { desk: Desk; language: Language }) {
  return <>
    {desk.exporting && <ExportProgress arabic={language.arabic} />}
    {desk.exportError && <ExportError error={desk.exportError} language={language} />}
  </>;
}

export function PrintCertificateDownload({ desk, arabic }: { desk: Desk; arabic: boolean }) {
  return <button type="button" className="button secondary" data-testid="print-certificate-download"
    disabled={!desk.exportCount || desk.exporting || desk.printSettingsBlocked} onClick={() => desk.download('certificate')}>
    <span>{arabic ? 'نزّل شهادة ما قبل الطباعة' : 'Download Print-Shop Certificate'}{' '}<bdi dir="ltr">(.pdf)</bdi></span>
  </button>;
}

export function CompletedCustody({ desk, arabic, label }: { desk: Desk; arabic: boolean; label: ReactNode }) {
  if (!desk.custody) return null;
  const emptySubset = desk.exportScope.exportScope === 'selected-subset' && !desk.exportCount;
  return <CustodyPanel sources={desk.custody} outputs={desk.custodyOutputs} scope={desk.exportScope}
    disabled={emptySubset || desk.exporting} label={label} arabic={arabic} />;
}

export { ApprovalSealControl, PrintLayout, SplitDownload };
