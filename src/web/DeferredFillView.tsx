import { lazy, type ComponentProps, type ComponentType } from 'react';

function lazyOutput<Name extends keyof typeof import('./FillOutputExtras')>(name: Name) {
  return lazy(() => import('./FillOutputExtras').then((components) => ({ default: components[name] })));
}

const views = {
  MappingRows: lazy(() => import('./MappingRows')),
  ConditionalRules: lazy(() => import('./ConditionalRules')),
  DataValidation: lazy(() => import('./DataValidation')),
  WorkbenchPreview: lazy(() => import('./WorkbenchPreview')),
  Hygiene: lazy(() => import('./Hygiene')),
  BatchDraftControls: lazy(() => import('./BatchDraftControls')),
  BatchSession: lazy(() => import('./BatchSession')),
  QrStampOptions: lazy(() => import('./QrStampOptions')),
  CoverOptions: lazy(() => import('./CoverOptions')),
  CustomFontFeedback: lazy(() => import('./CustomFontFeedback')),
  SourceError: lazy(() => import('./SourceError')),
  ReviewAndDispatchOptions: lazy(() => import('./ReviewAndDispatchOptions')),
  LocalCliCommand: lazy(() => import('./LocalCliCommand')),
  PresetFeedback: lazy(() => import('./MappingRows').then(({ PresetFeedback }) => ({ default: PresetFeedback }))),
  CapacityDisclosure: lazy(() => import('./CapacityDisclosure').then(({ CapacityDisclosure }) => ({ default: CapacityDisclosure }))),
  WorksheetPicker: lazy(() => import('./SourcePrintControls').then(({ WorksheetPicker }) => ({ default: WorksheetPicker }))),
  FilenameOptions: lazyOutput('FilenameOptions'),
  PrintLayout: lazyOutput('PrintLayout'),
  ApprovalSealControl: lazyOutput('ApprovalSealControl'),
  CheckedExportCounts: lazyOutput('CheckedExportCounts'),
  ExportDetails: lazyOutput('ExportDetails'),
  ExportFeedback: lazyOutput('ExportFeedback'),
  SplitDownload: lazyOutput('SplitDownload'),
  PrintCertificateDownload: lazyOutput('PrintCertificateDownload'),
  CompletedCustody: lazyOutput('CompletedCustody'),
};

type ViewName = keyof typeof views;
type Props = { [Name in ViewName]: { view: Name } & ComponentProps<typeof views[Name]> }[ViewName];

export default function DeferredFillView({ view, ...props }: Props) {
  // The discriminated props pair every view with that component's props.
  const View = views[view] as ComponentType<typeof props>;
  return <View {...props} />;
}
