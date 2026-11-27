import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { clampDisplayRect, displayToSource, sourceToDisplay, type NormalizedRect } from '../core/designer/geometry';
import { DesignerError, validateFieldRect, validateFieldSpecs, type FieldDraftSpec } from '../core/designer/spec';
import type { DesignField } from './DesignerCanvas';
import DesignerInspector from './DesignerInspector';
import { designerKinds, draftField, fieldCaption } from './designer-fields';
import { designerCopy } from './designer-labels';
import { saveDownload } from './resources';
import type { FlatSource } from './fill-template-source';
import './field-designer.css';

const DesignerCanvas = lazy(() => import('./DesignerCanvas'));

type Snapshot = { fields: DesignField[]; selectedId?: number; pageIndex: number };
type Point = readonly [x: number, y: number];
const empty: Snapshot = { fields: [], pageIndex: 0 };
type ErrorDetails = { code: keyof ReturnType<typeof designerCopy>['errors']; geometry?: string; kind?: FieldDraftSpec['kind'] };

function FileAction({ label, id, accept, disabled, choose }: {
  label: ReactNode;
  id: string;
  accept: string;
  disabled: boolean;
  choose: (file: File) => void;
}) {
  return (
    <label className="button secondary preset-picker">
      {label}
      <input type="file" accept={accept} disabled={disabled} data-testid={id} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) choose(file);
      }} />
    </label>
  );
}

export default function FieldDesigner({ arabic, initialSource, onUseInFill }: {
  arabic: boolean;
  initialSource?: FlatSource;
  onUseInFill: (file: File) => void;
}) {
  const copy = designerCopy(arabic);
  const [source, setSource] = useState<FlatSource & { synthetic?: boolean } | undefined>(initialSource);
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [tool, setTool] = useState<FieldDraftSpec['kind']>('text');
  const [focusId, setFocusId] = useState<number>();
  const [dropdownDraft, setDropdownDraft] = useState<{ id: number; text: string }>();
  const [error, setError] = useState<ErrorDetails>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'loading' | 'preparing' | 'readingLayout' | 'savingLayout'>();
  const operation = useRef(false);
  const mounted = useRef(true);
  const placeButton = useRef<HTMLButtonElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const { fields, selectedId, pageIndex } = snapshot;
  const page = source?.info.pages[pageIndex];
  const pageFields = fields.filter(({ spec }) => spec.pageIndex === pageIndex);
  const selected = pageFields.find(({ id }) => id === selectedId);
  const rotated = page?.rotation === 90 || page?.rotation === 270;
  const visibleWidth = page ? (rotated ? page.visibleBox.height : page.visibleBox.width) * page.userUnit : 1;
  const visibleHeight = page ? (rotated ? page.visibleBox.width : page.visibleBox.height) * page.userUnit : 1;
  const dropdownText = selected?.spec.kind === 'dropdown' ? selected.spec.options?.join('\n') ?? '' : undefined;
  const pendingOptions = dropdownText !== undefined && dropdownDraft?.id === selected?.id && dropdownDraft?.text !== dropdownText;
  const canExport = Boolean(source && fields.length && !busy && !pendingOptions);
  const basename = source?.name.replace(/\.pdf$/i, '') || 'arabiform';

  function showError(problem: unknown, kind?: FieldDraftSpec['kind']) {
    if (!mounted.current) return;
    if (!(problem instanceof DesignerError)) {
      setError({ code: 'failed' });
      return;
    }
    const coordinates = problem.rectPdf?.every(Number.isFinite)
      ? problem.rectPdf.map((value) => Number(value.toFixed(4))).join(', ')
      : undefined;
    setError({ code: problem.code, geometry: coordinates, kind });
  }

  async function perform(label: NonNullable<typeof busy>, work: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setError(undefined);
    setNotice('');
    setBusy(label);
    try {
      await work();
    } catch (problem) {
      showError(problem);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(undefined);
    }
  }

  function openSource(file?: File) {
    void perform('loading', async () => {
      setSource(undefined);
      setSnapshot(empty);
      setHistory([]);
      setFocusId(undefined);
      setDropdownDraft(undefined);
      setTool('text');
      const pendingFile: File = file ?? await import('./designer-demo').then(({ createDesignerDemo }) => createDesignerDemo());
      const [{ inspectFlatPdf }, buffer] = await Promise.all([import('../core/designer/source'), pendingFile.arrayBuffer()]);
      const bytes = new Uint8Array(buffer);
      const info = await inspectFlatPdf(bytes);
      if (mounted.current) setSource({ name: pendingFile.name, bytes, info, synthetic: !file });
    });
  }

  function record(next: Snapshot) {
    setHistory((current) => [...current.slice(-49), snapshot]);
    setSnapshot(next);
    setError(undefined);
    setNotice('');
  }

  function select(id: number) {
    setFocusId(undefined);
    if (selectedId !== id) setDropdownDraft(undefined);
    setSnapshot((current) => ({ ...current, selectedId: id }));
    setError(undefined);
  }

  function place(input: NormalizedRect | Point) {
    if (!page || operation.current) return;
    const wide = tool === 'text' || tool === 'dropdown';
    const width = Math.min(1, (wide ? 150 : 20) / visibleWidth);
    const height = Math.min(1, (wide ? 28 : 20) / visibleHeight);
    const rect = input.length === 2 ? [
      Math.max(0, Math.min(1 - width, input[0] - width / 2)),
      Math.max(0, Math.min(1 - height, input[1] - height / 2)),
      width,
      height,
    ] as const : clampDisplayRect(input);
    let count = 1;
    let name = `${copy[tool]} ${count}`;
    const names = new Set(fields.map(({ spec }) => spec.name.split('.', 1)[0]));
    while (names.has(name)) name = `${copy[tool]} ${++count}`;
    if (tool === 'radio' && selected?.spec.kind === 'radio') name = selected.spec.name;
    try {
      const id = ++nextId.current;
      const rectPdf = validateFieldRect(displayToSource(rect, page), page, tool);
      const spec = draftField(tool, { name, pageIndex, rectPdf }, fields.map(({ spec }) => spec), copy);
      record({ pageIndex, selectedId: id, fields: [...fields, { id, spec }] });
      setDropdownDraft(undefined);
      setFocusId(id);
    } catch (problem) {
      showError(problem);
    }
  }

  function changeKind(kind: FieldDraftSpec['kind']) {
    if (!selected) return;
    const { name, pageIndex, rectPdf } = selected.spec;
    const next = draftField(kind, { name, pageIndex, rectPdf }, fields.map(({ spec }) => spec), copy);
    if (edit(selected.id, next)) setDropdownDraft(undefined);
  }

  function edit(id: number, spec: FieldDraftSpec) {
    if (!source || operation.current) return false;
    const revised = fields.map((field) => field.id === id ? { id, spec } : field);
    try {
      const checked = validateFieldSpecs(revised.map((field) => field.spec), source.info.pages);
      record({ pageIndex, fields: revised.map((field, index) => ({ id: field.id, spec: checked[index]! })), selectedId: id });
      return true;
    } catch (problem) {
      showError(problem, spec.kind);
      return false;
    }
  }

  function nudge(id: number, deltaX: number, deltaY: number) {
    const field = pageFields.find((item) => item.id === id);
    if (!field || !page) return;
    const [x, y, width, height] = sourceToDisplay(field.spec.rectPdf, page);
    const nextX = Math.min(Math.max(0, x + deltaX / visibleWidth), Math.max(0, 1 - width));
    const nextY = Math.min(Math.max(0, y + deltaY / visibleHeight), Math.max(0, 1 - height));
    if (nextX === x && nextY === y) return;
    edit(id, { ...field.spec, rectPdf: displayToSource([nextX, nextY, width, height], page) });
  }

  function remove(id: number) {
    const next = pageFields.find((field) => field.id !== id);
    record({ pageIndex, fields: fields.filter((field) => field.id !== id), selectedId: next?.id });
    setDropdownDraft(undefined);
    setFocusId(next?.id);
    if (!next) placeButton.current?.focus({ preventScroll: true });
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous || operation.current) return;
    setSnapshot(previous);
    setHistory(history.slice(0, -1));
    setFocusId(previous.selectedId);
    setDropdownDraft(undefined);
    setError(undefined);
    setNotice('');
  }

  function loadLayout(file: File) {
    if (!source) return;
    void perform('readingLayout', async () => {
      const [{ loadFieldLayout }, text] = await Promise.all([import('../core/designer/layout'), file.text()]);
      const specs = await loadFieldLayout(text, source.info);
      if (!mounted.current) return;
      const next = specs.map((spec) => ({ id: ++nextId.current, spec }));
      record({ fields: next, pageIndex: next[0]?.spec.pageIndex ?? 0, selectedId: next[0]?.id });
      setFocusId(undefined);
      setDropdownDraft(undefined);
      setNotice(copy.layoutRestored);
    });
  }

  function saveLayout() {
    if (!source || !canExport) return;
    void perform('savingLayout', async () => {
      const { saveFieldLayout } = await import('../core/designer/layout');
      const json = await saveFieldLayout(source.info, fields.map(({ spec }) => spec));
      if (mounted.current) saveDownload(json, `${basename}-field-layout.json`, 'application/json');
    });
  }

  function create(useInFill: boolean) {
    if (!source || !canExport) return;
    void perform('preparing', async () => {
      const { authorFlatPdf } = await import('../core/designer/author');
      const bytes = await authorFlatPdf(source.bytes, fields.map(({ spec }) => spec));
      if (!mounted.current) return;
      const filename = `${basename}-acroform.pdf`;
      if (useInFill) onUseInFill(new File([Uint8Array.from(bytes)], filename, { type: 'application/pdf' }));
      else {
        saveDownload(bytes, filename, 'application/pdf');
        setNotice(copy.downloadReady);
      }
    });
  }

  const fileLabel = (label: string, extension: string) => <>{label}{' '}<bdi dir="ltr">({extension})</bdi></>;

  return (
    <section className="panel field-designer" aria-labelledby="designer-title" data-testid="field-designer">
      <header>
        <h2 id="designer-title">{copy.title}</h2>
        <p>{copy.intro}</p>
      </header>
      <div className="panel-body designer-body">
        <div className="designer-source" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) openSource(file);
        }}>
          <div className="actions">
            <FileAction label={copy.choose} id="designer-upload" accept=".pdf,application/pdf" disabled={Boolean(busy)} choose={openSource} />
            <button type="button" className="button secondary" disabled={Boolean(busy)} data-testid="designer-demo" onClick={() => openSource()}>
              {copy.demo}
            </button>
          </div>
          {source && <p className="designer-source-name">{copy.source}{' '}<bdi dir="auto">{source.name}</bdi>
            {source.synthetic && <strong className="tag tag-pass">{copy.synthetic}</strong>}
          </p>}
        </div>
        {busy && <p className="quiet" role="status">{copy[busy]}</p>}
        {notice && <p className="quiet" role="status">{notice}</p>}
        <p className="sr-only" role="status">
          {page && <>{copy.fieldsOnPage}{' · '}{pageFields.length}{selected && <> · <bdi dir="auto">{fieldCaption(selected.spec)}</bdi></>}</>}
        </p>
        {!page && !busy && !error && <p className="quiet">{copy.chooseFirst}</p>}
        {page && source && (
          <div className="designer-editor">
            <div className="designer-paper">
              <div className="designer-toolbar">
                <div className="actions" role="group" aria-label={copy.tools}>
                  {designerKinds.map((kind) => (
                    <button type="button" key={kind} className={`button ${tool === kind ? 'primary' : 'secondary'}`}
                      aria-pressed={tool === kind} data-testid={`designer-tool-${kind}`} disabled={Boolean(busy)}
                      onClick={() => setTool(kind)}>{copy[kind]}</button>
                  ))}
                  <button type="button" className="button secondary" ref={placeButton} data-testid="designer-place" disabled={Boolean(busy)}
                    onClick={() => place([.5, .5])}>{copy.place}</button>
                  <button type="button" className="button secondary" data-testid="designer-undo" disabled={Boolean(busy) || !history.length}
                    onClick={undo}>{copy.undo}</button>
                </div>
                <label className="designer-page-control">
                  {copy.page}
                  <select data-testid="designer-page" value={pageIndex + 1} disabled={Boolean(busy)}
                    onChange={(event) => {
                      setFocusId(undefined);
                      setDropdownDraft(undefined);
                      setSnapshot({ fields, pageIndex: Number(event.currentTarget.value) - 1 });
                      setError(undefined);
                    }}>
                    {source.info.pages.map((_, index) => <option value={index + 1} key={index}>{index + 1}</option>)}
                  </select>
                </label>
              </div>
              <p className="quiet">{copy.help}</p>
              {tool === 'radio' && <p className="quiet">{copy.radioHelp}</p>}
              <Suspense fallback={<p className="quiet" role="status">{copy.previewLoading}</p>}>
                <DesignerCanvas key={source.info.sourceSha256} bytes={source.bytes} page={page} pageIndex={pageIndex} fields={pageFields}
                  selectedId={selectedId} focusId={focusId} copy={copy} disabled={Boolean(busy)} onPlace={place} onSelect={select}
                  onNudge={nudge} onDelete={remove} onUndo={undo} canUndo={Boolean(history.length)} />
              </Suspense>
            </div>
            <DesignerInspector copy={copy} fields={pageFields} selected={selected} disabled={Boolean(busy)} onSelect={select}
              onChange={(spec) => selected ? edit(selected.id, spec) : false} onChangeKind={changeKind} onDelete={remove}
              options={pendingOptions ? dropdownDraft?.text : dropdownText} optionsPending={Boolean(pendingOptions)}
              onOptionText={(text) => {
                setDropdownDraft(text === undefined || !selected ? undefined : { id: selected.id, text });
                if (error?.code === 'invalid-field-options' && error.kind === 'dropdown') setError(undefined);
              }} />
          </div>
        )}
        {error && <p className="alert" role="alert" data-testid="designer-error" data-code={error.code}>
          {error.code === 'invalid-field-options' && error.kind === 'dropdown' ? copy.invalidOptions
            : error.code === 'invalid-field-options' && error.kind === 'radio' ? copy.invalidRadio : copy.errors[error.code]}
          {error.geometry && <>{' '}<bdi dir="ltr">[X, Y, W, H: {error.geometry}]</bdi></>}
        </p>}
        {source && <div className="designer-outputs">
          <div className="actions">
            <button type="button" className="button primary" data-testid="designer-download" disabled={!canExport}
              onClick={() => create(false)}>{fileLabel(copy.download, '.pdf')}</button>
            <button type="button" className="button secondary" data-testid="designer-use-fill" disabled={!canExport}
              onClick={() => create(true)}>{copy.useFill}</button>
          </div>
          <div className="actions">
            <button type="button" className="button secondary" data-testid="designer-save-layout" disabled={!canExport}
              onClick={saveLayout}>{fileLabel(copy.save, '.json')}</button>
            <FileAction label={fileLabel(copy.load, '.json')} id="designer-load-layout" accept=".json,application/json"
              disabled={Boolean(busy)} choose={loadLayout} />
          </div>
        </div>}
      </div>
    </section>
  );
}
