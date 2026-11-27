import { lazy, Suspense, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { fillLabel, translator } from './labels';
import { QueuePanel } from './QueuePanel';
import { saveDownload } from './resources';
import { sampleWorkflows, useWorkbench } from './useWorkbench';
import { WatermarkControls } from './WatermarkControls';

const MappingRows = lazy(() => import('./MappingRows'));
const VirtualFilenameTokens = lazy(() => import('./MappingRows').then(({ VirtualFilenameTokens }) => ({ default: VirtualFilenameTokens })));
const PresetWarnings = lazy(() => import('./MappingRows').then(({ PresetWarnings }) => ({ default: PresetWarnings })));
const CapacityDisclosure = lazy(() => import('./CapacityDisclosure').then(({ CapacityDisclosure }) => ({ default: CapacityDisclosure })));
const WorkbenchPreview = lazy(() => import('./PdfPreview').then(({ WorkbenchPreview }) => ({ default: WorkbenchPreview })));
const Hygiene = lazy(() => import('./Hygiene'));
const BatchDraftControls = lazy(() => import('./BatchDraftControls'));
const CustodyPanel = lazy(() => import('./CustodyPanel'));
const ShortcutsDialog = lazy(() => import('./ShortcutsDialog'));
const QrStampOptions = lazy(() => import('./QrStampOptions'));
const CoverOptions = lazy(() => import('./CoverOptions'));
const ExportError = lazy(() => import('./ExportError'));
const CustomFontFeedback = lazy(() => import('./CustomFontFeedback'));

type AppProps = {
  arabic: boolean;
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
};

function chooseLocalFile(event: ChangeEvent<HTMLInputElement>, onChoose: (file: File) => void) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = '';
  if (file) onChoose(file);
}

function FilePicker({ id, label, pickerLabel, accept, filename, placeholder, isLoading, loadingLabel, onChoose }: FilePickerProps) {
  return (
    <div className="file-picker">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="file-box">
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

export function App({ arabic, heading, summary, details }: AppProps) {
  const language = translator(arabic);
  const { labels, problem } = language;
  const desk = useWorkbench(arabic ? 'ar' : 'en');
  const [shortcutTrigger, setShortcutTrigger] = useState<HTMLElement>();
  const [characterKeys, setCharacterKeys] = useState(true);
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
        const search = document.getElementById('queue-search');
        if (!search) return;
        event.preventDefault();
        search.focus();
      }
    }
    document.addEventListener('keydown', handleCharacterShortcut);
    return () => document.removeEventListener('keydown', handleCharacterShortcut);
  }, [arabic, characterKeys]);

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
            <button type="button" className="button primary sample-button" disabled={desk.busy.pdf && desk.busy.roster} onClick={() => void desk.loadSample()}>
              {labels.trySample}
            </button>
          </div>
        </section>

        <section className="sample-gallery" aria-labelledby="sample-workflows-heading" data-testid="sample-gallery">
          <h2 id="sample-workflows-heading">{labels.sampleWorkflows}</h2>
          <div className="sample-cards">
            {sampleWorkflows.map(workflow => (
              <button key={workflow} type="button" className="button secondary sample-card" data-testid={`sample-${workflow}`}
                aria-label={`${labels[workflow]} · ${labels.synthetic}`}
                aria-current={desk.loadedSample === workflow ? 'true' : undefined}
                disabled={desk.busy.pdf || desk.busy.roster} onClick={() => void desk.loadSample(workflow)}>
                <span>{labels[workflow]}</span>
                <small>{labels.synthetic}{' · '}{labels[`${workflow}Feature`]}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="workbench" id="workbench" tabIndex={-1}>
          {desk.template && (
            <Suspense><CapacityDisclosure template={desk.template.info} minFontSize={desk.minFontSize} arabic={arabic} labels={labels} /></Suspense>
          )}
          <div className="workbench-grid">
            <div className="setup">
              <section className="panel source-panel" aria-labelledby="files-heading">
                <header><h2 id="files-heading">{labels.files}</h2></header>
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
                  />
                  {desk.errors.pdf && <p className="alert" role="alert">{problem(desk.errors.pdf) ?? labels.loadError}</p>}
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
                  {desk.errors.roster && <p className="alert" role="alert">{problem(desk.errors.roster) ?? labels.loadError}</p>}
                  {desk.roster && desk.roster.data.sheets.length > 1 && (
                    <label className="full-control">
                      {labels.sheet}
                      <select data-testid="worksheet" value={desk.sheetIndex} onChange={(event) => desk.changeSheet(Number(event.currentTarget.value))}>
                        {desk.roster.data.sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="source-note" aria-live="polite">
                    {desk.loadedSample && <strong className="tag tag-pass">{labels.synthetic}</strong>}
                    <p>{desk.loadedSample === 'workshop' ? labels.sampleNotice : desk.loadedSample ? labels.workflowNotice : labels.realNotice}</p>
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
                  <label className="output-mode zip-mode">
                    <input type="checkbox" data-testid="flatten-zip" checked={desk.flattenZip} disabled={desk.exportingZip}
                      onChange={(event) => desk.changeFlattenZip(event.currentTarget.checked)} />
                    <span>{labels.flattenZip}</span>
                  </label>
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
                    {desk.presetError && <p className="alert" role="alert" data-testid="preset-error">{labels.presetInvalid}</p>}
                    {desk.presetWarnings && <Suspense><PresetWarnings warnings={desk.presetWarnings} arabic={arabic} /></Suspense>}
                  </div>
                  {desk.template && desk.sheet && (
                    <Suspense>
                      <BatchDraftControls desk={desk} arabic={arabic} />
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
              <p data-testid="export-counts">{!desk.results ? labels.exportWait
                : subset ? labels.exportSubsetHelp : fillLabel(labels.exportHelp, { ready, flagged })}</p>
            </header>
            <div className="panel-body export-actions">
              <p role="status" className={subset ? 'tag tag-subset' : 'tag tag-pass'} data-testid="export-scope">
                {fillLabel(subset ? labels.exportSelected : labels.exportAll, { count: desk.exportCount })}
              </p>
              {emptySubset && desk.results && <p className="alert warning" data-testid="export-subset-empty">{labels.exportSubsetEmpty}</p>}
              <div className="actions">
                <button type="button" className="button primary" disabled={!desk.exportCount || desk.exporting || (desk.flattenZip && desk.printSettingsBlocked)}
                  onClick={() => desk.download('zip')}>{labels.zip}</button>
                <button type="button" className="button secondary" disabled={!desk.exportCount || desk.exporting || desk.printSettingsBlocked}
                  onClick={() => desk.download('merged')}>{labels.merged}</button>
              </div>
              <div className="actions audit-actions" role="group" aria-label={labels.audit}>
                <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting} onClick={() => desk.download('csv')}>{labels.auditCsv}</button>
                <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting} onClick={() => desk.download('json')}>{labels.auditJson}</button>
              </div>
              <div className="custody-controls">
                {desk.custody ? (
                  <Suspense fallback={custodyPending}>
                    <CustodyPanel sources={desk.custody} outputs={desk.custodyOutputs} scope={desk.exportScope} disabled={emptySubset || desk.exporting}
                      label={custodyLabel} arabic={arabic} />
                  </Suspense>
                ) : custodyPending}
              </div>
              {desk.exporting && <p role="status">{labels.exporting}</p>}
              {desk.exportError && <Suspense><ExportError error={desk.exportError} language={language} /></Suspense>}
            </div>
          </section>
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
