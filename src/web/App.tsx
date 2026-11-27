import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { fillLabel, type translator } from './labels';
import { QueuePanel } from './QueuePanel';
import { saveDownload } from './resources';
import type { FlatSource } from './fill-template-source';
import { sampleWorkflows, useWorkbench } from './useWorkbench';
import { WatermarkControls } from './WatermarkControls';

const MappingRows = lazy(() => import('./MappingRows'));
const VirtualFilenameTokens = lazy(() => import('./MappingRows').then(({ VirtualFilenameTokens }) => ({ default: VirtualFilenameTokens })));
const PresetFeedback = lazy(() => import('./MappingRows').then(({ PresetFeedback }) => ({ default: PresetFeedback })));
const CapacityDisclosure = lazy(() => import('./CapacityDisclosure').then(({ CapacityDisclosure }) => ({ default: CapacityDisclosure })));
const WorkbenchPreview = lazy(() => import('./WorkbenchPreview'));
const Hygiene = lazy(() => import('./Hygiene'));
const BatchDraftControls = lazy(() => import('./BatchDraftControls'));
const CustodyPanel = lazy(() => import('./CustodyPanel'));
const ShortcutsDialog = lazy(() => import('./ShortcutsDialog'));
const QrStampOptions = lazy(() => import('./QrStampOptions'));
const CoverOptions = lazy(() => import('./CoverOptions'));
const ExportError = lazy(() => import('./ExportError'));
const CustomFontFeedback = lazy(() => import('./CustomFontFeedback'));
const WorksheetPicker = lazy(() => import('./SourcePrintControls').then(({ WorksheetPicker }) => ({ default: WorksheetPicker })));
const PrintLayout = lazy(() => import('./SourcePrintControls').then(({ PrintLayout }) => ({ default: PrintLayout })));
const PdfExtractor = lazy(() => import('./PdfExtractor'));
const FieldDesigner = lazy(() => import('./FieldDesigner'));
const TemplateStudio = lazy(() => import('./TemplateStudio'));
const ReceiptVerifier = lazy(() => import('./ReceiptVerifier'));
const SourceError = lazy(() => import('./SourceError'));
const ExportCounts = lazy(() => import('./BatchExportStatus').then(({ ExportCounts }) => ({ default: ExportCounts })));
const SelectedExportScope = lazy(() => import('./BatchExportStatus').then(({ SelectedExportScope }) => ({ default: SelectedExportScope })));
const ExportProgress = lazy(() => import('./BatchExportStatus').then(({ ExportProgress }) => ({ default: ExportProgress })));
const GroupingControl = lazy(() => import('./GroupedOutputs').then(({ GroupingControl }) => ({ default: GroupingControl })));
const GroupedSummary = lazy(() => import('./GroupedOutputs').then(({ GroupedSummary }) => ({ default: GroupedSummary })));
const SplitDownload = lazy(() => import('./GroupedOutputs').then(({ SplitDownload }) => ({ default: SplitDownload })));
const LocalCliCommand = lazy(() => import('./LocalCliCommand'));
const PrintEstimate = lazy(() => import('./PrintEstimate'));

const modes = ['fill', 'extract', 'design', 'create', 'verify'] as const;
type Mode = typeof modes[number];

type AppProps = {
  language: ReturnType<typeof translator>;
  heading?: string;
  summary?: string;
  details?: { __html: string };
};

type FilePickerProps = {
  id: string;
  label: string;
  pickerLabel: string;
  accept: string;
  filename?: string;
  placeholder: ReactNode;
  isLoading: boolean;
  loadingLabel: string;
  onChoose: (file: File) => void;
  allowDrop?: boolean;
};

function chooseLocalFile(event: ChangeEvent<HTMLInputElement>, onChoose: (file: File) => void) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = '';
  if (file) onChoose(file);
}

function FilePicker({ id, label, pickerLabel, accept, filename, placeholder, isLoading, loadingLabel, onChoose, allowDrop }: FilePickerProps) {
  return (
    <div className="file-picker">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="file-box" onDragOver={allowDrop ? (event) => event.preventDefault() : undefined} onDrop={allowDrop ? (event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onChoose(file);
      } : undefined}>
        <span className="file-icon" aria-hidden="true" />
        {filename && !isLoading
          ? <bdi dir="auto" className="loaded-filename">{filename}</bdi>
          : <span className="quiet">{isLoading ? loadingLabel : placeholder}</span>}
        <label className="file-action">
          <span>{pickerLabel}</span>
          <input
            type="file"
            id={id}
            data-testid={id}
            accept={accept}
            aria-label={pickerLabel}
            onChange={(event) => chooseLocalFile(event, onChoose)}
          />
        </label>
      </div>
    </div>
  );
}

export function App({ language, heading, summary, details }: AppProps) {
  const { arabic, labels } = language;
  const desk = useWorkbench(arabic ? 'ar' : 'en');
  const [mode, setMode] = useState<Mode>('fill');
  const extractMode = mode === 'extract';
  const designMode = mode === 'design';
  const fillMode = mode === 'fill';
  const activeMode = useRef(mode);
  const [extractOpened, setExtractOpened] = useState(false);
  const [studioOpened, setStudioOpened] = useState(false);
  const [design, setDesign] = useState<{ revision: number; source?: FlatSource }>();
  const [shortcutTrigger, setShortcutTrigger] = useState<HTMLElement>();
  const [characterKeys, setCharacterKeys] = useState(true);
  const [cliOpen, setCliOpen] = useState(false);
  const modeLabels = {
    fill: arabic ? <>تعبئة ملفات <bdi dir="ltr">PDF</bdi></> : 'Fill PDFs',
    extract: arabic ? <>استخراج بيانات <bdi dir="ltr">PDF</bdi> إلى <bdi dir="ltr">CSV / .xlsx</bdi></> : 'Extract PDFs → CSV / .xlsx',
    design: arabic ? 'تصميم الحقول' : 'Design fields',
    create: arabic ? 'إنشاء قالب' : 'Create template',
    verify: arabic ? 'التحقق من بيان الحيازة' : 'Verify receipt',
  };

  function openMode(next: Mode, source?: FlatSource) {
    activeMode.current = next;
    if (next === 'extract') setExtractOpened(true);
    if (next === 'create') setStudioOpened(true);
    if (next === 'design') setDesign((current) => !current || source
      ? { revision: (current?.revision ?? 0) + 1, source }
      : current);
    setMode(next);
  }

  function useTemplateInFill(file: File) {
    if (activeMode.current !== 'design' && activeMode.current !== 'create') return;
    flushSync(() => openMode('fill'));
    document.getElementById('files-heading')?.focus();
    void desk.loadPdf(file);
  }

  useEffect(() => {
    if (!characterKeys) return;
    function handleCharacterShortcut(event: KeyboardEvent) {
      const helpKey = event.key === '?' || (arabic && event.key === '؟');
      if ((!helpKey && event.key !== '/') || event.defaultPrevented || event.isComposing || event.repeat
        || event.altKey || event.ctrlKey || event.metaKey || document.designMode === 'on'
        || document.querySelector(':modal')) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (target instanceof Element && target.closest('input, textarea, select, [role="textbox"], [role="combobox"]')) return;
      if (helpKey) {
        const trigger = document.activeElement;
        if (!(trigger instanceof HTMLElement)) return;
        event.preventDefault();
        setShortcutTrigger((current) => current ?? trigger);
      } else {
        if (!fillMode) return;
        const search = document.getElementById('queue-search');
        if (!search) return;
        event.preventDefault();
        search.focus();
      }
    }
    document.addEventListener('keydown', handleCharacterShortcut);
    return () => document.removeEventListener('keydown', handleCharacterShortcut);
  }, [arabic, characterKeys, fillMode]);

  const { ready, flagged, customFont } = desk;
  const subset = desk.exportScope.exportScope === 'selected-subset';
  const emptySubset = subset && desk.exportCount === 0;
  const custodyLabel = arabic
    ? <>نزّل بيان سلسلة الحيازة <bdi dir="ltr">(.json)</bdi></>
    : 'Download Custody Manifest (.json)';
  const custodyPending = <button type="button" className="button secondary" data-testid="custody-download" disabled>{custodyLabel}</button>;

  return (
    <>
      <a className="skip-link" href="#workbench">{labels.skip}</a>
      <header className="site-header">
        <div className="shell header-inner">
          <a href={arabic ? '/ar/pdf-mail-merge' : '/'} className="brand">
            <span className="brand-mark" aria-hidden="true"><span /></span>
            <span>ArabiForm</span>
          </a>
          <nav aria-label={labels.studio} className="site-nav">
            <a href="#workbench">{labels.studio}</a>
            <a href="/arabic-pdf-form-filler">{labels.arabicGuide}</a>
            <a href="/preserve-leading-zeros-pdf">{labels.zeroGuide}</a>
            <a href="/privacy-and-proof">{labels.privacyGuide}</a>
          </nav>
          <a className="locale" href={arabic ? '/' : '/ar/pdf-mail-merge'} lang={arabic ? 'en' : 'ar'}>{labels.locale}</a>
        </div>
      </header>

      <main className="shell">
        <section className="hero" aria-labelledby="studio-title">
          <div>
            <h1 id="studio-title">{heading || labels.title}</h1>
            <p className="hero-summary">{summary || labels.summary}</p>
          </div>
          <div className="hero-actions">
            <div className="privacy-badge" title={labels.privacyPolicy}>
              <span className="privacy-dot" aria-hidden="true" />
              {labels.privacyBadge}
            </div>
            <button type="button" className="button primary sample-button" hidden={!fillMode} disabled={desk.busy.pdf && desk.busy.roster} onClick={() => void desk.loadSample()}>
              {labels.trySample}
            </button>
          </div>
        </section>

        <div id="workbench" tabIndex={-1}>
          <div className="workbench-modes" role="group" aria-label={arabic ? 'وضع العمل' : 'Workspace mode'}>
            {modes.map((name) => (
              <button type="button" id={'mode-' + name} className="button" data-testid={'mode-' + name} key={name}
                aria-pressed={mode === name} onClick={() => openMode(name)}>
                <span>{modeLabels[name]}</span>
              </button>
            ))}
          </div>

          <section className="sample-gallery" hidden={!fillMode} aria-labelledby="sample-workflows-heading" data-testid="sample-gallery">
            <h2 id="sample-workflows-heading">{labels.sampleWorkflows}</h2>
            <div className="sample-cards">
              {sampleWorkflows.map(workflow => (
                <button key={workflow} type="button" className="button secondary sample-card" data-testid={`sample-${workflow}`}
                  aria-label={`${labels[workflow]} · ${labels.synthetic}`}
                  aria-current={desk.sample?.workflow === workflow ? 'true' : undefined}
                  disabled={desk.busy.pdf || desk.busy.roster} onClick={() => void desk.loadSample(workflow)}>
                  <span>{labels[workflow]}</span>
                  <small>{labels.synthetic}{' · '}{labels[`${workflow}Feature`]}</small>
                </button>
              ))}
            </div>
          </section>

          <div className="workbench" hidden={!fillMode}>
            {desk.template && (
              <Suspense><CapacityDisclosure template={desk.template.info} minFontSize={desk.minFontSize} arabic={arabic} labels={labels} /></Suspense>
            )}
            <div className="workbench-grid">
              <div className="setup">
                <section className="panel source-panel" aria-labelledby="files-heading">
                  <header><h2 id="files-heading" tabIndex={-1}>{labels.files}</h2></header>
                  <div className="panel-body file-stack">
                    <FilePicker
                      id="pdf-upload"
                      label={labels.yourTemplate}
                      pickerLabel={labels.choosePdf}
                      accept=".pdf,application/pdf"
                      filename={desk.template?.name}
                      placeholder={labels.noPdf}
                      isLoading={desk.busy.pdf}
                      loadingLabel={labels.loading}
                      onChoose={desk.loadPdf}
                      allowDrop
                    />
                    {desk.errors.pdf && <Suspense><SourceError code={desk.errors.pdf} arabic={arabic}
                      onDesign={desk.flatSource ? () => {
                        openMode('design', desk.flatSource);
                        document.getElementById('mode-design')?.focus();
                      } : undefined} /></Suspense>}
                    <FilePicker
                      id="roster-upload"
                      label={labels.yourRoster}
                      pickerLabel={labels.chooseRoster}
                      accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      filename={desk.roster?.name}
                      placeholder={<>{labels.noRoster}{' '}<bdi dir="ltr">.xlsx</bdi></>}
                      isLoading={desk.busy.roster}
                      loadingLabel={labels.loading}
                      onChoose={desk.loadRoster}
                    />
                    {desk.errors.roster && <Suspense><SourceError code={desk.errors.roster} arabic={arabic} /></Suspense>}
                    {desk.roster?.workbook && <Suspense><WorksheetPicker desk={desk} language={language} /></Suspense>}
                    <div className="source-note" aria-live="polite">
                      {desk.sample && <strong className="tag tag-pass">{labels.synthetic}</strong>}
                      <p>{desk.sample?.notice ?? labels.realNotice}</p>
                    </div>
                  </div>
                </section>
                <section className="panel mapping-panel" aria-labelledby="mapping-heading">
                  <header className="wide-heading">
                    <h2 id="mapping-heading">{labels.settings}</h2>
                    {desk.fields.length > 0 && desk.sheet && (
                      <button type="button" className="text-button" onClick={desk.resetMapping}>{labels.autoMap}</button>
                    )}
                  </header>
                  <div className="panel-body">
                    {desk.templateFields.length > 0
                      ? <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}><MappingRows desk={desk} language={language} /></Suspense>
                      : <p className="quiet">{labels.mappingWait}</p>}
                  </div>
                </section>
                <section className="panel settings-panel" aria-labelledby="settings-heading">
                  <header><h2 id="settings-heading">{labels.pdfSettings}</h2></header>
                  <div className="panel-body settings-fields">
                    <label className="full-control">
                      <span className="range-label">
                        <span>{labels.minSize}</span>
                        <output htmlFor="min-font-size">{desk.minFontSize} {labels.points}</output>
                      </span>
                      <input id="min-font-size" aria-label={labels.minSize} type="range" min={6} max={10} step={0.01} value={desk.minFontSize} onChange={(event) => desk.changeSize(Number(event.currentTarget.value))} />
                    </label>
                    <label className="full-control">
                      {labels.font}
                      <select value={desk.font} disabled={Boolean(customFont)} onChange={(event) => desk.changeFont(event.currentTarget.value as typeof desk.font)}>
                        <option value="auto">{labels.fontAuto}</option>
                        <option value="arabic">{labels.fontNaskh}</option>
                        <option value="latin">{labels.fontSans}</option>
                      </select>
                    </label>
                    <div className="custom-font">
                      <FilePicker
                        id="custom-font-upload"
                        label={labels.customFont}
                        pickerLabel={labels.chooseFont}
                        accept=".ttf,.otf"
                        filename={customFont?.status === 'ready' ? customFont.family : undefined}
                        placeholder={labels.noCustomFont}
                        isLoading={customFont?.status === 'loading'}
                        loadingLabel={labels.customFontLoading}
                        onChoose={desk.loadCustomFont}
                      />
                      <div className="custom-font-help">
                        <small>{labels.customFontLocal}</small>
                        {customFont && <button type="button" className="text-button" data-testid="custom-font-clear" onClick={desk.clearCustomFont}>{labels.clearFont}</button>}
                      </div>
                      {customFont && customFont.status !== 'loading' && (
                        <Suspense><CustomFontFeedback customFont={customFont} desk={desk} arabic={arabic} /></Suspense>
                      )}
                    </div>
                    <label className="full-control">
                      {labels.pattern}
                      <input type="text" dir="auto" aria-label={labels.pattern} className="pattern-input" value={desk.pattern}
                        disabled={desk.exporting} onChange={(event) => desk.changePattern(event.currentTarget.value)} />
                      <small>{labels.patternHelp}</small>
                    </label>
                    {(desk.template || desk.roster) && <Suspense><VirtualFilenameTokens arabic={arabic} /></Suspense>}
                    {(desk.sheet || desk.groupByColumn !== null) && <Suspense><GroupingControl desk={desk} arabic={arabic} /></Suspense>}
                    <label className="output-mode zip-mode">
                      <input type="checkbox" data-testid="flatten-zip" checked={desk.flattenZip} disabled={desk.exporting}
                        onChange={(event) => desk.changeFlattenZip(event.currentTarget.checked)} />
                      <span>{labels.flattenZip}</span>
                    </label>
                    {desk.template && <Suspense><PrintLayout desk={desk} arabic={arabic} /></Suspense>}
                    <label className="output-mode">
                      <input type="checkbox" data-testid="include-cover-sheet" checked={desk.includeCoverSheet} disabled={desk.exporting}
                        onChange={(event) => desk.changeIncludeCoverSheet(event.currentTarget.checked)} />
                      <span>{labels.includeCoverSheet}</span>
                    </label>
                    {desk.includeCoverSheet && (
                      <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                        <CoverOptions desk={desk} arabic={arabic} />
                      </Suspense>
                    )}
                    <WatermarkControls settings={desk.watermark} change={desk.changeWatermark} disabled={desk.exporting}
                      invalid={desk.watermarkBlocked} arabic={arabic} />
                    <details className="qr-stamp" open={desk.qrOpen} onToggle={(event) => desk.setQrOpen(event.currentTarget.open)}>
                      <summary data-testid="qr-stamp-toggle">{arabic ? 'رمز QR للطباعة (اختياري)' : 'Print QR stamp (optional)'}</summary>
                      {desk.qrOpen && (
                        <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                          <QrStampOptions desk={desk} arabic={arabic} />
                        </Suspense>
                      )}
                    </details>
                    <div className="preset-controls">
                      <h3>{labels.preset}</h3>
                      <p className="quiet">{labels.presetHelp}</p>
                      <div className="actions compact">
                        <label className="button secondary preset-picker">
                          {labels.presetImport}
                          <input type="file" data-testid="preset-upload" aria-label={labels.presetImport} accept=".json,application/json" disabled={desk.exporting}
                            onChange={(event) => chooseLocalFile(event, desk.importPreset)} />
                        </label>
                        <button type="button" className="button secondary" data-testid="preset-download" disabled={!desk.template || !desk.sheet || desk.printSettingsBlocked || desk.virtualTemplateBlocked}
                          onClick={() => void desk.exportPreset()}>{labels.presetExport}</button>
                      </div>
                      {(desk.presetError || desk.presetWarnings) && (
                        <Suspense><PresetFeedback invalid={desk.presetError} warnings={desk.presetWarnings} arabic={arabic} /></Suspense>
                      )}
                      <details className="cli-command" data-testid="cli-command-helper" onToggle={(event) => setCliOpen(event.currentTarget.open)}>
                        <summary>{arabic ? 'أمر التشغيل المحلي' : 'Local CLI command'}</summary>
                        {cliOpen && <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                          <LocalCliCommand desk={desk} arabic={arabic} />
                        </Suspense>}
                      </details>
                    </div>
                    {desk.template && desk.sheet && (
                      <Suspense>
                        <BatchDraftControls key={desk.sourceRevision} desk={desk} arabic={arabic} />
                      </Suspense>
                    )}
                  </div>
                </section>
              </div>

              <section id="preview" tabIndex={-1} className="panel preview" aria-labelledby="preview-heading">
                {desk.template
                  ? (
                    <Suspense fallback={<>
                      <h2 className="preview-heading" id="preview-heading">{labels.preview}</h2>
                      <div className="preview-bed"><p className="preview-message" role="status">{labels.previewBusy}</p></div>
                    </>}>
                      <WorkbenchPreview template={desk.template} desk={desk} language={language} />
                    </Suspense>
                  )
                  : (
                    <>
                    <header className="preview-heading wide-heading">
                      <div><h2 id="preview-heading">{labels.preview}</h2><p>{labels.previewHelp}</p></div>
                    </header>
                    <div className="preview-bed empty-preview" data-testid="empty-preview">
                      <div className="document-placeholder" aria-hidden="true">
                        <span className="document-title" />
                        <span className="document-lines" />
                        <span className="document-field" />
                        <span className="document-fields"><span /><span /></span>
                        <span className="document-field document-notes" />
                        <span className="document-signature" />
                      </div>
                      <p className="preview-message">{labels.previewEmpty}</p>
                    </div>
                    </>
                  )}
              </section>
            </div>

            {desk.rows.length > 0 && (
              <Suspense>
                <Hygiene key={desk.sourceRevision} desk={desk} arabic={arabic} />
              </Suspense>
            )}
            <QueuePanel key={desk.sourceRevision} desk={desk} language={language} characterKeys={characterKeys} />

            <section className="panel exports" aria-labelledby="export-heading">
              <header>
                <h2 id="export-heading">{labels.export}</h2>
                {desk.results
                  ? <Suspense><ExportCounts arabic={arabic} subset={subset} ready={ready} flagged={flagged} /></Suspense>
                  : <p data-testid="export-counts">{labels.exportWait}</p>}
              </header>
              <div className="panel-body export-actions">
                {subset
                  ? <Suspense><SelectedExportScope arabic={arabic} count={desk.exportCount} showEmpty={emptySubset && Boolean(desk.results)} /></Suspense>
                  : <p role="status" className="tag tag-pass" data-testid="export-scope">{fillLabel(labels.exportAll, { count: desk.exportCount })}</p>}
                {desk.grouping && desk.results && <Suspense><GroupedSummary desk={desk} arabic={arabic} /></Suspense>}
                {desk.checkedWorker && <Suspense><PrintEstimate worker={desk.checkedWorker} output={desk.output} arabic={arabic} /></Suspense>}
                <div className="actions">
                  <button type="button" className="button primary" data-testid="download-zip" disabled={!desk.exportCount || desk.exporting || desk.groupingBlocked || (desk.flattenZip && desk.printSettingsBlocked)}
                    onClick={() => desk.download('zip')}>{arabic ? <span>{labels.zip} <bdi dir="ltr">(ZIP)</bdi></span> : labels.zip}</button>
                  <button type="button" className="button secondary" disabled={!desk.exportCount || desk.exporting || desk.printSettingsBlocked}
                    onClick={() => desk.download('merged')}>{labels.merged}</button>
                  {desk.grouping && <Suspense><SplitDownload desk={desk} arabic={arabic} /></Suspense>}
                </div>
                <div className="actions audit-actions" role="group" aria-label={labels.audit}>
                  <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting || desk.groupingBlocked} onClick={() => desk.download('csv')}>{labels.auditCsv}</button>
                  <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting || desk.groupingBlocked}
                    onClick={() => desk.download('json')}>{arabic ? <span>{labels.auditJson} <bdi dir="ltr">(JSON)</bdi></span> : labels.auditJson}</button>
                </div>
                <div className="custody-controls">
                  {desk.custody ? (
                    <Suspense fallback={custodyPending}>
                      <CustodyPanel sources={desk.custody} outputs={desk.custodyOutputs} scope={desk.exportScope} disabled={emptySubset || desk.exporting}
                        label={custodyLabel} arabic={arabic} />
                    </Suspense>
                  ) : custodyPending}
                </div>
                {desk.exporting && <Suspense><ExportProgress arabic={arabic} /></Suspense>}
                {desk.exportError && <Suspense><ExportError error={desk.exportError} language={language} /></Suspense>}
              </div>
            </section>
          </div>

          {extractOpened && <div hidden={!extractMode}>
            <Suspense fallback={<p role="status" className="quiet">{labels.loading}</p>}><PdfExtractor arabic={arabic} /></Suspense>
          </div>}
          {design && <div hidden={!designMode}>
            <Suspense fallback={<p role="status" className="quiet">{labels.loading}</p>}>
              <FieldDesigner key={design.revision} arabic={arabic} initialSource={design.source} onUseInFill={useTemplateInFill} />
            </Suspense>
          </div>}
          {studioOpened && <div hidden={mode !== 'create'}>
            <Suspense fallback={<p role="status" className="quiet">{labels.loading}</p>}>
              <TemplateStudio arabic={arabic} onUseInFill={useTemplateInFill} />
            </Suspense>
          </div>}
          {mode === 'verify' && <Suspense fallback={<p role="status" className="quiet">{labels.loading}</p>}>
            <ReceiptVerifier arabic={arabic} />
          </Suspense>}
        </div>

        {details && <div className="route-details" dangerouslySetInnerHTML={details} />}
        <section className="checklist" aria-labelledby="checklist-heading">
          <div><h2 id="checklist-heading">{labels.checklistTitle}</h2><p>{labels.checklistSummary}</p></div>
          <button type="button" className="button secondary" onClick={async () => {
            const { scopeChecklist } = await import('./scope-checklist');
            saveDownload(scopeChecklist[arabic ? 'ar' : 'en'], 'arabiform-scope-checklist.txt', 'text/plain;charset=utf-8');
          }}>
            {labels.checklist}
          </button>
        </section>
      </main>
      <footer className="site-footer">
        <div className="shell footer-inner">
          <span>{labels.footer}</span>
          <p>{labels.privacyPolicy}</p>
          <button type="button" className="text-button shortcuts-trigger" data-testid="shortcuts-open" aria-haspopup="dialog"
            aria-keyshortcuts={characterKeys ? (arabic ? '? ؟' : '?') : undefined}
            onClick={(event) => setShortcutTrigger(event.currentTarget)}>{labels.shortcuts}</button>
        </div>
      </footer>
      {shortcutTrigger && (
        <Suspense>
          <ShortcutsDialog arabic={arabic} characterKeys={characterKeys} onChangeCharacterKeys={setCharacterKeys}
            onClose={() => {
              // Clear the dismissed dialog before a new shortcut reuses the same trigger.
              flushSync(() => setShortcutTrigger(undefined));
              shortcutTrigger.focus({ preventScroll: true });
            }} />
        </Suspense>
      )}
    </>
  );
}
