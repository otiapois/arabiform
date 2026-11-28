import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import FilePicker, { chooseLocalFile } from './FilePicker';
import { fillLabel, type translator } from './labels';
import { QueuePanel } from './QueuePanel';
import { saveDownload } from './resources';
import type { FlatSource, MigratedTemplate } from './fill-template-source';
import { sampleWorkflows, useWorkbench } from './useWorkbench';
import type { DesignSession, UtilityMode } from './UtilityModes';
import { WatermarkControls } from './WatermarkControls';

const DeferredFillView = lazy(() => import('./DeferredFillView'));
const ShortcutsDialog = lazy(() => import('./ShortcutsDialog'));
const UtilityModes = lazy(() => import('./UtilityModes'));

type Mode = 'fill' | UtilityMode;
const modes: readonly Mode[] = ['fill', 'extract', 'design', 'create', 'verify', 'packet', 'compare', 'compare-batches'];

type AppProps = {
  language: ReturnType<typeof translator>;
  heading?: string;
  summary?: string;
  details?: { __html: string };
};

export function App({ language, heading, summary, details }: AppProps) {
  const { arabic, labels } = language;
  const desk = useWorkbench(arabic ? 'ar' : 'en');
  const [mode, setMode] = useState<Mode>('fill');
  const fillMode = mode === 'fill';
  const activeMode = useRef(mode);
  const [opened, setOpened] = useState<Partial<Record<UtilityMode, true>>>();
  const [design, setDesign] = useState<DesignSession>();
  const [shortcutTrigger, setShortcutTrigger] = useState<HTMLElement>();
  const [characterKeys, setCharacterKeys] = useState(true);
  const [cliOpen, setCliOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const modeLabels = {
    fill: arabic ? <>تعبئة ملفات <bdi dir="ltr">PDF</bdi></> : 'Fill PDFs',
    extract: arabic ? <>استخراج بيانات <bdi dir="ltr">PDF</bdi> إلى <bdi dir="ltr">CSV / .xlsx</bdi></> : 'Extract PDFs → CSV / .xlsx',
    design: arabic ? 'تصميم الحقول' : 'Design fields',
    create: arabic ? 'إنشاء قالب' : 'Create template',
    verify: arabic ? 'التحقق من بيان الحيازة' : 'Verify receipt',
    packet: labels.packetMode,
    compare: arabic ? 'مقارنة القوالب' : 'Compare templates',
    'compare-batches': arabic ? 'مقارنة الدفعات' : 'Compare batches',
  };

  function openMode(next: Mode, source?: FlatSource) {
    activeMode.current = next;
    if (next !== 'fill') setOpened((previous) => previous?.[next] ? previous : { ...previous, [next]: true });
    if (next === 'design') setDesign((current) => !current || source
      ? { revision: (current?.revision ?? 0) + 1, source }
      : current);
    setMode(next);
  }

  function useTemplateInFill(file: File, migration?: MigratedTemplate) {
    if (activeMode.current !== 'design' && activeMode.current !== 'create' && activeMode.current !== 'compare') return;
    flushSync(() => openMode('fill'));
    document.getElementById('files-heading')?.focus();
    void desk.loadPdf(file, migration);
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

  const { customFont } = desk;
  const subset = desk.exportScope.exportScope === 'selected-subset';
  const emptySubset = subset && desk.exportCount === 0;
  const custodyLabel = arabic
    ? <>نزّل بيان سلسلة الحيازة <bdi dir="ltr">(.json)</bdi></>
    : 'Download Custody Manifest (.json)';
  const custodyPending = <button type="button" className="button secondary" data-testid="custody-download" disabled>{custodyLabel}</button>;

  return (
    <>
      {desk.batchSession && <Suspense><DeferredFillView view="BatchSession" {...desk.batchSession} /></Suspense>}
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
              <Suspense><DeferredFillView view="CapacityDisclosure" template={desk.template.info} minFontSize={desk.minFontSize} arabic={arabic} labels={labels} /></Suspense>
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
                    {desk.errors.pdf && <Suspense><DeferredFillView view="SourceError" code={desk.errors.pdf} arabic={arabic}
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
                    {desk.errors.roster && <Suspense><DeferredFillView view="SourceError" code={desk.errors.roster} arabic={arabic} /></Suspense>}
                    {desk.roster?.workbook && <Suspense><DeferredFillView view="WorksheetPicker" desk={desk} language={language} /></Suspense>}
                    <div className="source-note" aria-live="polite">
                      {(desk.sample || desk.template?.synthetic) && <strong className="tag tag-pass">{labels.synthetic}</strong>}
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
                      ? <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}><DeferredFillView view="MappingRows" desk={desk} language={language} /></Suspense>
                      : <p className="quiet">{labels.mappingWait}</p>}
                    <details className="conditional-rules" onToggle={(event) => setRulesOpen(event.currentTarget.open)}>
                      <summary data-testid="conditional-rules-toggle">{arabic ? 'قواعد التعبئة الشرطية' : 'Conditional rules'}</summary>
                      {rulesOpen && <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                        <DeferredFillView view="ConditionalRules" desk={desk} arabic={arabic} />
                      </Suspense>}
                    </details>
                    <details className="conditional-rules" onToggle={(event) => setValidationOpen(event.currentTarget.open)}>
                      <summary data-testid="data-validation-toggle">{arabic ? 'التحقق من بيانات الجدول' : 'Data validation'}</summary>
                      {validationOpen && <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                        <DeferredFillView view="DataValidation" desk={desk} arabic={arabic} />
                      </Suspense>}
                    </details>
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
                        <Suspense><DeferredFillView view="CustomFontFeedback" customFont={customFont} desk={desk} arabic={arabic} /></Suspense>
                      )}
                    </div>
                    <label className="full-control">
                      {labels.pattern}
                      <input type="text" dir="auto" aria-label={labels.pattern} className="pattern-input" value={desk.pattern}
                        disabled={desk.exporting} onChange={(event) => desk.changePattern(event.currentTarget.value)} />
                      <small>{labels.patternHelp}</small>
                    </label>
                    {(desk.template || desk.roster || desk.groupByColumn !== null) && <Suspense><DeferredFillView view="FilenameOptions" desk={desk} arabic={arabic} /></Suspense>}
                    <label className="output-mode zip-mode">
                      <input type="checkbox" data-testid="flatten-zip" checked={desk.flattenZip} disabled={desk.exporting}
                        onChange={(event) => desk.changeFlattenZip(event.currentTarget.checked)} />
                      <span>{labels.flattenZip}</span>
                    </label>
                    {desk.template && <Suspense><DeferredFillView view="PrintLayout" desk={desk} arabic={arabic} /></Suspense>}
                    <label className="output-mode">
                      <input type="checkbox" data-testid="include-cover-sheet" checked={desk.includeCoverSheet} disabled={desk.exporting}
                        onChange={(event) => desk.changeIncludeCoverSheet(event.currentTarget.checked)} />
                      <span>{labels.includeCoverSheet}</span>
                    </label>
                    {desk.includeCoverSheet && (
                      <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                        <DeferredFillView view="CoverOptions" desk={desk} arabic={arabic} />
                      </Suspense>
                    )}
                    <WatermarkControls settings={desk.watermark} change={desk.changeWatermark} disabled={desk.exporting}
                      invalid={desk.watermarkBlocked} arabic={arabic} />
                    <details className="qr-stamp" open={desk.qrOpen} onToggle={(event) => desk.setQrOpen(event.currentTarget.open)}>
                      <summary data-testid="qr-stamp-toggle">{arabic ? 'رمز QR للطباعة (اختياري)' : 'Print QR stamp (optional)'}</summary>
                      {desk.qrOpen && (
                        <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                          <DeferredFillView view="QrStampOptions" desk={desk} arabic={arabic} />
                        </Suspense>
                      )}
                    </details>
                    {(desk.template || desk.approvalSeal) && <Suspense><DeferredFillView view="ApprovalSealControl" desk={desk} arabic={arabic} /></Suspense>}
                    {(desk.template || desk.roster) && <Suspense><DeferredFillView view="ReviewAndDispatchOptions" desk={desk} language={language} /></Suspense>}
                    <div className="preset-controls">
                      <h3>{labels.preset}</h3>
                      <p className="quiet">{labels.presetHelp}</p>
                      <div className="actions compact">
                        <label className="button secondary preset-picker">
                          {labels.presetImport}
                          <input type="file" data-testid="preset-upload" aria-label={labels.presetImport} accept=".json,application/json" disabled={desk.exporting}
                            onChange={(event) => chooseLocalFile(event, desk.importPreset)} />
                        </label>
                        <button type="button" className="button secondary" data-testid="preset-download" disabled={!desk.template || !desk.sheet || desk.settingsSaveBlocked || desk.virtualTemplateBlocked || desk.conditionalSaveBlocked}
                          onClick={() => void desk.exportPreset()}>{labels.presetExport}</button>
                      </div>
                      {(desk.presetError || desk.presetWarnings) && (
                        <Suspense><DeferredFillView view="PresetFeedback" invalid={desk.presetError} warnings={desk.presetWarnings} arabic={arabic} /></Suspense>
                      )}
                      <details className="cli-command" data-testid="cli-command-helper" onToggle={(event) => setCliOpen(event.currentTarget.open)}>
                        <summary>{arabic ? 'أمر التشغيل المحلي' : 'Local CLI command'}</summary>
                        {cliOpen && <Suspense fallback={<p className="quiet" role="status">{labels.loading}</p>}>
                          <DeferredFillView view="LocalCliCommand" desk={desk} arabic={arabic} />
                        </Suspense>}
                      </details>
                    </div>
                    {desk.template && desk.sheet && (
                      <Suspense>
                        <DeferredFillView view="BatchDraftControls" key={desk.sourceRevision} desk={desk} arabic={arabic} />
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
                      <DeferredFillView view="WorkbenchPreview" template={desk.template} desk={desk} language={language} />
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
                <DeferredFillView view="Hygiene" key={desk.sourceRevision} desk={desk} arabic={arabic} />
              </Suspense>
            )}
            <QueuePanel desk={desk} language={language} characterKeys={characterKeys} />

            <section className="panel exports" aria-labelledby="export-heading">
              <header>
                <h2 id="export-heading">{labels.export}</h2>
                {desk.results
                  ? <Suspense><DeferredFillView view="CheckedExportCounts" desk={desk} arabic={arabic} /></Suspense>
                  : <p data-testid="export-counts">{labels.exportWait}</p>}
              </header>
              <div className="panel-body export-actions">
                {!subset && <p role="status" className="tag tag-pass" data-testid="export-scope">{fillLabel(labels.exportAll, { count: desk.exportCount })}</p>}
                {(subset || desk.checkedWorker || (desk.grouping && desk.results)) &&
                  <Suspense><DeferredFillView view="ExportDetails" desk={desk} language={language} /></Suspense>}
                <div className="actions">
                  <button type="button" className="button primary" data-testid="download-zip" disabled={!desk.exportCount || desk.exporting || desk.groupingBlocked || (desk.flattenZip && desk.printSettingsBlocked)}
                    onClick={() => desk.download('zip')}>{arabic ? <span>{labels.zip} <bdi dir="ltr">(ZIP)</bdi></span> : labels.zip}</button>
                  <button type="button" className="button secondary" disabled={!desk.exportCount || desk.exporting || desk.printSettingsBlocked}
                    onClick={() => desk.download('merged')}>{labels.merged}</button>
                  {desk.template && <Suspense><DeferredFillView view="PrintCertificateDownload" desk={desk} arabic={arabic} /></Suspense>}
                  {desk.grouping && <Suspense><DeferredFillView view="SplitDownload" desk={desk} arabic={arabic} /></Suspense>}
                </div>
                <div className="actions audit-actions" role="group" aria-label={labels.audit}>
                  <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting || desk.groupingBlocked}
                    onClick={() => desk.download('csv')}>{arabic ? <span>{labels.auditCsv} <bdi dir="ltr">(CSV)</bdi></span> : labels.auditCsv}</button>
                  <button type="button" className="button secondary" disabled={!desk.results || emptySubset || desk.exporting || desk.groupingBlocked}
                    onClick={() => desk.download('json')}>{arabic ? <span>{labels.auditJson} <bdi dir="ltr">(JSON)</bdi></span> : labels.auditJson}</button>
                </div>
                <div className="custody-controls">
                  {desk.custody ? (
                    <Suspense fallback={custodyPending}>
                      <DeferredFillView view="CompletedCustody" desk={desk} arabic={arabic} label={custodyLabel} />
                    </Suspense>
                  ) : custodyPending}
                </div>
                {(desk.exporting || desk.exportError) && <Suspense><DeferredFillView view="ExportFeedback" desk={desk} language={language} /></Suspense>}
              </div>
            </section>
          </div>

          {opened && <Suspense fallback={!fillMode && <p role="status" className="quiet">{labels.loading}</p>}>
            <UtilityModes mode={mode} opened={opened} design={design} arabic={arabic} loading={labels.loading} onUseInFill={useTemplateInFill} />
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
