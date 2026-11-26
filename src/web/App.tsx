import { lazy, Suspense, type ChangeEvent } from 'react';
import { ChoiceList } from './Choices';
import { Diagnostics } from './Diagnostics';
import { fillLabel, translator } from './labels';
import { Queue } from './Queue';
import { saveDownload } from './resources';
import { useWorkbench } from './useWorkbench';

const PdfPreview = lazy(() => import('./PdfPreview'));

type AppProps = {
  arabic: boolean;
  heading?: string;
  summary?: string;
  details?: string;
};

type FilePickerProps = {
  id: string;
  label: string;
  pickerLabel: string;
  accept: string;
  filename?: string;
  placeholder: string;
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
        <bdi dir="auto" className={filename ? 'loaded-filename' : 'quiet'}>{isLoading ? loadingLabel : filename ?? placeholder}</bdi>
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
  const desk = useWorkbench();
  const { ready, flagged, customFont } = desk;
  const selectedResult = desk.results?.[desk.selected];
  const bytes = selectedResult?.status === 'pass' ? desk.previewBytes : desk.template?.bytes;
  const { missingFields, missingColumns } = desk.presetWarnings ?? { missingFields: [], missingColumns: [] };
  const presetMismatches = [[labels.missingFields, missingFields], [labels.missingColumns, missingColumns]] as const;
  const fieldKinds = { text: labels.kindText, checkbox: labels.kindCheckbox, radio: labels.kindRadio, dropdown: labels.kindDropdown };
  const textMapped = desk.fields.some(({ kind, name }) => (kind === 'text' || kind === 'dropdown') && desk.mapping[name]);
  const missingCustomGlyphs = customFont?.status === 'ready'
    && desk.results?.some((result) => result.diagnostics.some(({ code }) => code === 'missing-glyphs'));
  const fontCheck = !desk.results || !textMapped ? labels.customFontCoverage
    : missingCustomGlyphs ? labels.customFontMissing : labels.customFontChecked;

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
            <button type="button" className="button primary sample-button" disabled={desk.busy.pdf && desk.busy.roster} onClick={desk.loadSample}>
              {labels.trySample}
            </button>
          </div>
        </section>

        <div className="workbench" id="workbench" tabIndex={-1}>
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
                    placeholder={labels.noRoster}
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
                    {desk.synthetic && <strong className="tag tag-pass">{labels.synthetic}</strong>}
                    <p>{desk.synthetic ? labels.sampleNotice : labels.realNotice}</p>
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
                  {desk.templateFields.length > 0 && desk.sheet
                    ? (
                      <>
                        <p className="quiet mapping-help">{labels.mappingHelp}</p>
                        <div className="mapping-labels" aria-hidden="true">
                          <span>{labels.pdfField}</span><span>{labels.rosterColumn}</span>
                        </div>
                        <div className="mapping-rows">
                          {desk.templateFields.map((field) => (
                            <div key={field.name} className="mapping-row">
                              <div className="mapping-field">
                                <bdi title={field.name}>{field.name}</bdi>
                                <span className="tag tag-pending">{fieldKinds[field.kind]}</span>
                                {field.choices?.length ? (
                                  <details className="choice-options">
                                    <summary>{labels.allowedChoices}</summary>
                                    <ChoiceList choices={field.choices} label={labels.allowedChoices} blank={labels.blankChoice} />
                                  </details>
                                ) : null}
                              </div>
                              {Object.hasOwn(desk.mapping, field.name) ? (
                                <div className="mapping-target">
                                  <select dir="auto" aria-label={field.name} data-pdf-field={field.name} value={desk.mapping[field.name]}
                                    onChange={(event) => desk.changeMapping(field.name, event.currentTarget.value)}>
                                    <option value="">{labels.unmapped}</option>
                                    {desk.sheet?.headers.map((column) => <option key={column} value={column}>{column}</option>)}
                                  </select>
                                  {field.choices && !desk.mapping[field.name] && <small className="quiet">{labels.preserved}</small>}
                                </div>
                              ) : <span className="quiet">{labels.preserved}</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )
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
                    {customFont?.status === 'ready' && (
                      <small role="status" data-testid="custom-font-status">{fontCheck}</small>
                    )}
                    {customFont?.status === 'invalid' && (
                      <p className="alert" role="alert" data-testid="custom-font-error">
                        {customFont.maxMiB === undefined ? problem('invalid-custom-font')
                          : fillLabel(labels.customFontTooLarge, { limit: customFont.maxMiB })}
                      </p>
                    )}
                  </div>
                  <label className="full-control">
                    {labels.pattern}
                    <input type="text" dir="auto" aria-label={labels.pattern} className="pattern-input" value={desk.pattern}
                      disabled={desk.exportingFilenames} onChange={(event) => desk.changePattern(event.currentTarget.value)} />
                    <small>{labels.patternHelp}</small>
                  </label>
                  <label className="zip-mode">
                    <input type="checkbox" data-testid="flatten-zip" checked={desk.flattenZip} disabled={desk.exportingZip}
                      onChange={(event) => desk.changeFlattenZip(event.currentTarget.checked)} />
                    <span>{labels.flattenZip}</span>
                  </label>
                  <div className="preset-controls">
                    <h3>{labels.preset}</h3>
                    <p className="quiet">{labels.presetHelp}</p>
                    <div className="actions compact">
                      <label className="button secondary preset-picker">
                        {labels.presetImport}
                        <input type="file" data-testid="preset-upload" aria-label={labels.presetImport} accept=".json,application/json"
                          onChange={(event) => chooseLocalFile(event, desk.importPreset)} />
                      </label>
                      <button type="button" className="button secondary" data-testid="preset-download" disabled={!desk.template || !desk.sheet}
                        onClick={desk.exportPreset}>{labels.presetExport}</button>
                    </div>
                    {desk.presetError && <p className="alert" role="alert" data-testid="preset-error">{labels.presetInvalid}</p>}
                    {(missingFields.length > 0 || missingColumns.length > 0) && (
                      <div className="alert warning preset-warning" role="status" data-testid="preset-warning">
                        <p>{labels.presetMismatch}</p>
                        {presetMismatches.map(([label, names]) =>
                          names.length > 0 && (
                            <p key={label}>{label}{' · '}
                              {names.map((name, index) => <span key={name}>{index > 0 ? ', ' : ''}<bdi dir="auto">{name}</bdi></span>)}
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <section id="preview" tabIndex={-1} className="panel preview" aria-labelledby="preview-heading">
              <header className="preview-heading wide-heading">
                <div>
                  <h2 id="preview-heading">{labels.preview}</h2>
                  <p>{selectedResult?.status === 'pass' ? labels.previewReady : selectedResult?.status === 'flagged' ? labels.previewFlagged : desk.template ? labels.previewTemplate : labels.previewHelp}</p>
                </div>
                {selectedResult && <span className={`tag tag-${selectedResult.status}`}>{fillLabel(labels.selected, { row: desk.selected + 1 })}</span>}
              </header>
              {!!selectedResult?.diagnostics.length && (
                <div className="preview-diagnostics">
                  <Diagnostics issues={selectedResult.diagnostics} minSize={desk.minFontSize} language={language} testId="preview-diagnostics" />
                </div>
              )}
              {desk.template
                ? (
                  <Suspense fallback={<div className="preview-bed"><p className="preview-message" role="status">{labels.previewBusy}</p></div>}>
                    <PdfPreview bytes={bytes} fields={desk.template.info.fields} diagnostics={selectedResult?.diagnostics}
                      minSize={desk.minFontSize} unavailable={desk.previewError} language={language}
                      requestedPage={desk.previewPage} onPageChange={desk.setPreviewPage} />
                  </Suspense>
                )
                : (
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
                )}
            </section>
          </div>

          <Queue key={desk.roster?.name + ':' + desk.sheetIndex} desk={desk} language={language} />

          <section className="panel exports" aria-labelledby="export-heading">
            <header>
              <h2 id="export-heading">{labels.export}</h2>
              <p data-testid="export-counts">{desk.results ? fillLabel(labels.exportHelp, { ready, flagged }) : labels.exportWait}</p>
            </header>
            <div className="panel-body export-actions">
              <div className="actions">
                <button type="button" className="button primary" disabled={!ready || desk.exporting} onClick={() => desk.download('zip')}>{labels.zip}</button>
                <button type="button" className="button secondary" disabled={!ready || desk.exporting} onClick={() => desk.download('merged')}>{labels.merged}</button>
              </div>
              <div className="actions audit-actions" aria-label={labels.audit}>
                <button type="button" className="button secondary" disabled={!desk.results || desk.exporting} onClick={() => desk.download('csv')}>{labels.auditCsv}</button>
                <button type="button" className="button secondary" disabled={!desk.results || desk.exporting} onClick={() => desk.download('json')}>{labels.auditJson}</button>
              </div>
              {desk.exporting && <p role="status">{labels.exporting}</p>}
              {desk.exportError && <p className="alert" role="alert">{problem(desk.exportError) ?? labels.exportError}</p>}
            </div>
          </section>
        </div>

        {details && <div className="route-details" dangerouslySetInnerHTML={{ __html: details }} />}
        <section className="checklist" aria-labelledby="checklist-heading">
          <div><h2 id="checklist-heading">{labels.checklistTitle}</h2><p>{labels.checklistSummary}</p></div>
          <button type="button" className="button secondary" onClick={() => saveDownload(labels.checklistText, 'arabiform-scope-checklist.txt', 'text/plain;charset=utf-8')}>
            {labels.checklist}
          </button>
        </section>
      </main>
      <footer className="site-footer">
        <div className="shell footer-inner"><span>{labels.footer}</span><p>{labels.privacyPolicy}</p></div>
      </footer>
    </>
  );
}
