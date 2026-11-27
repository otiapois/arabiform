import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PacketInput, PacketIssue, PacketOutput, PacketRunOptions, preflightPacket } from '../core/packet/assembler';
import type { FieldMetadata } from '../core/pdf/template';
import { ChoiceList } from './Choices';
import { diagnosticProblem } from './Diagnostics';
import { Filename } from './Filename';
import { errorCode, loadFonts, saveDownload } from './resources';
import type { RosterSource } from './roster-source';
import './packet-workbench.css';

const en = {
  title: 'Assemble packets',
  intro: 'Use one roster to fill a set of PDF forms in order. Each ready row produces one print-ready PDF packet.',
  demo: 'Try Synthetic 2-Document HR + Consent Packet Demo',
  synthetic: 'Synthetic Sample',
  syntheticNote: 'The final row has an intentionally invalid consent value.',
  reset: 'Reset packet workspace',
  sources: 'Packet source files',
  templates: 'AcroForm templates',
  add: 'Add PDFs',
  templateHint: 'Choose or drop 2–4 fillable PDFs.',
  order: 'Packets use the order shown here.',
  limit: 'A packet can hold up to 4 templates. Remove a template to add more.',
  earlier: 'Move earlier',
  later: 'Move later',
  replace: 'Replace',
  remove: 'Remove',
  loading: 'Reading files…',
  roster: 'Shared roster',
  rosterHint: 'Choose or drop one roster.',
  singleRoster: 'Choose one roster file.',
  chooseRoster: 'Choose CSV or Excel',
  worksheet: 'Worksheet',
  rosterSize: (count: number) => `${count} roster rows`,
  sourceError: 'The file could not be read. Choose it again.',
  mapping: 'Field mapping',
  mappingHelp: 'Review each template’s field mappings. Unmapped fields keep their original values.',
  mappingWait: 'Add templates and a valid roster to map their fields.',
  autoMap: 'Reset to auto-map',
  leave: 'Leave unchanged',
  output: 'Packet settings',
  group: 'Group packets by roster column',
  noGroup: 'No grouping',
  filename: 'Packet filename pattern',
  filenameHelp: 'Use {{Column}} to include a roster value in the filename.',
  cover: 'Include bilingual cover and table of contents',
  preflight: 'Check packets',
  checking: 'Checking packets…',
  assembling: 'Building ready packets…',
  finish: 'Packet check complete.',
  needsInputs: 'Add 2–4 readable PDF templates and a roster with data rows.',
  failed: 'The packet batch could not be completed.',
  noReady: 'Review the flagged rows before preparing downloads.',
  table: 'Packet readiness',
  results: 'Per-person results',
  total: 'Total rows',
  ready: 'Ready',
  flagged: 'Flagged',
  row: 'Row',
  status: 'Status',
  path: 'Packet file',
  review: 'Diagnostics',
  warnings: 'Roster warnings',
  zip: 'Per-Person Packets',
  manifest: 'Packet Custody Manifest',
  unflattenable: 'This field has no printable appearance.',
  noMapping: 'Map at least one editable field to a roster column.',
  mappingMismatch: 'Choose an exact editable field and roster column.',
  invalidGroup: 'Choose an existing roster column for grouping.',
  invalidFilename: 'The filename pattern refers to an unknown roster column.',
  invalidTemplateName: 'Use a PDF filename without control characters.',
  invalidTemplateTitle: 'Use a nonblank document title without control characters.',
  invalidCover: 'The cover could not be rendered. Review the document titles or turn off the cover.',
  allowedChoices: 'Allowed choices',
  blank: 'Blank',
};

const ar: typeof en = {
  title: 'تجميع الحزم',
  intro: 'استخدم جدولًا واحدًا لتعبئة مجموعة من نماذج PDF بالترتيب. ينتج كل صف جاهز حزمة PDF واحدة صالحة للطباعة.',
  demo: 'جرّب عينة اصطناعية لحزمة الموارد البشرية والموافقة من مستندين',
  synthetic: 'عينة اصطناعية',
  syntheticNote: 'يتضمن الصف الأخير قيمة موافقة غير صالحة لأغراض التجربة.',
  reset: 'امسح مساحة تجميع الحزم',
  sources: 'ملفات مصدر الحزم',
  templates: 'قوالب AcroForm',
  add: 'أضف ملفات PDF',
  templateHint: 'اختر من قالبين إلى أربعة قوالب PDF قابلة للتعبئة أو اسحبها هنا.',
  order: 'تُجمّع المستندات بالترتيب المعروض هنا.',
  limit: 'تتسع الحزمة لأربعة قوالب. احذف قالبًا لإضافة آخر.',
  earlier: 'قدّم القالب',
  later: 'أخّر القالب',
  replace: 'استبدل',
  remove: 'احذف',
  loading: 'جارٍ قراءة الملفات…',
  roster: 'جدول البيانات المشترك',
  rosterHint: 'اختر جدول بيانات واحدًا أو اسحبه هنا.',
  singleRoster: 'اختر ملف جدول بيانات واحدًا.',
  chooseRoster: 'اختر ملف CSV أو Excel',
  worksheet: 'ورقة العمل',
  rosterSize: (count) => `عدد صفوف الجدول ${count}`,
  sourceError: 'تعذّرت قراءة الملف. اختره مجددًا.',
  mapping: 'ربط الحقول',
  mappingHelp: 'راجع ربط الحقول في كل قالب. تحتفظ الحقول غير المرتبطة بقيمها الأصلية.',
  mappingWait: 'أضف القوالب وجدول بيانات صالحًا لربط الحقول.',
  autoMap: 'استعد الربط التلقائي',
  leave: 'اتركه دون تغيير',
  output: 'إعدادات الحزم',
  group: 'جمّع الحزم حسب عمود في الجدول',
  noGroup: 'بلا تجميع',
  filename: 'نمط أسماء ملفات الحزم',
  filenameHelp: 'أدرج قيمة من الجدول في اسم الملف.',
  cover: 'أضف غلافًا وفهرسًا باللغتين',
  preflight: 'افحص الحزم',
  checking: 'جارٍ فحص الحزم…',
  assembling: 'جارٍ إنشاء الحزم الجاهزة…',
  finish: 'اكتمل فحص الحزم.',
  needsInputs: 'أضف من قالبين إلى أربعة قوالب PDF صالحة للقراءة وجدولًا يحتوي على بيانات.',
  failed: 'تعذّر إكمال دفعة الحزم.',
  noReady: 'راجع الصفوف التي تحتاج إلى مراجعة قبل تجهيز التنزيلات.',
  table: 'حالة الحزم',
  results: 'نتائج كل شخص',
  total: 'إجمالي الصفوف',
  ready: 'جاهز',
  flagged: 'يحتاج إلى مراجعة',
  row: 'الصف',
  status: 'الحالة',
  path: 'ملف الحزمة',
  review: 'نتائج الفحص',
  warnings: 'تنبيهات الجدول',
  zip: 'حزم لكل شخص',
  manifest: 'بيان سلسلة حيازة الحزم',
  unflattenable: 'لا يتوفّر مظهر صالح لطباعة هذا الحقل.',
  noMapping: 'اربط حقلًا واحدًا قابلًا للتعبئة على الأقل بعمود في الجدول.',
  mappingMismatch: 'اختر حقلًا قابلًا للتعبئة وعمودًا موجودًا في الجدول.',
  invalidGroup: 'اختر عمودًا موجودًا في الجدول للتجميع.',
  invalidFilename: 'يشير نمط اسم الملف إلى عمود غير موجود في الجدول.',
  invalidTemplateName: 'استخدم اسم ملف PDF خاليًا من أحرف التحكم.',
  invalidTemplateTitle: 'استخدم عنوانًا للمستند لا يخلو من النص ولا يحتوي على أحرف تحكم.',
  invalidCover: 'تعذّر إنشاء الغلاف. راجع عناوين المستندات أو ألغِ إضافة الغلاف.',
  allowedChoices: 'الخيارات المتاحة',
  blank: 'فارغ',
};

type Copy = typeof en;
type TemplateSource = { id: number; name: string; title?: string; preset?: Record<string, string> } & (
  | { status: 'loading' }
  | { status: 'invalid'; code: string }
  | { status: 'ready'; bytes: Uint8Array; fields: FieldMetadata[] }
);
type ReadyTemplate = Extract<TemplateSource, { status: 'ready' }>;
type CheckedPacket = Extract<Awaited<ReturnType<typeof preflightPacket>>, { status: 'checked' }>;
type PacketArtifacts = Pick<PacketOutput, 'zipBytes' | 'manifestJson'> & { zipFilename: string; manifestFilename: string };
type ModeProgress = Parameters<NonNullable<PacketRunOptions['onProgress']>>[0];

const pdfAccept = '.pdf,application/pdf';
const rosterAccept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const emptyHeaders: string[] = [];
const emptyMappings: Record<string, string>[] = [];
const setupProblems = {
  'unflattenable-widget': 'unflattenable',
  'no-mapping': 'noMapping',
  'packet-mapping-mismatch': 'mappingMismatch',
  'invalid-grouping-column': 'invalidGroup',
  'invalid-filename-column': 'invalidFilename',
  'invalid-template-name': 'invalidTemplateName',
  'invalid-template-title': 'invalidTemplateTitle',
  'packet-template-count': 'needsInputs',
  'empty-roster': 'needsInputs',
} satisfies Record<string, keyof Copy>;

function Picker({ id, accept, multiple, heading, note, button, read }: {
  id: string;
  accept: string;
  multiple?: boolean;
  heading: string;
  note: ReactNode;
  button: ReactNode;
  read: (files: File[]) => void;
}) {
  return (
    <div className="file-picker">
      <label className="field-label" htmlFor={id}>{heading}</label>
      <div className="file-box" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        read(Array.from(event.dataTransfer.files));
      }}>
        <span className="file-icon" aria-hidden="true" />
        <span className="quiet">{note}</span>
        <label className="file-action">
          {button}
          <input id={id} data-testid={id} type="file" accept={accept} multiple={multiple} aria-label={heading}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              read(files);
            }} />
        </label>
      </div>
    </div>
  );
}

async function readTemplate(file: File, source: Pick<TemplateSource, 'id' | 'name' | 'title' | 'preset'>): Promise<TemplateSource> {
  try {
    const [{ openTemplate }, buffer] = await Promise.all([import('../core/pdf/template'), file.arrayBuffer()]);
    const bytes = new Uint8Array(buffer);
    const { fields } = await openTemplate(bytes);
    return { ...source, status: 'ready', bytes, fields: fields.map(({ meta }) => meta).filter((field) =>
      !field.readOnly && (field.kind === 'text' || field.kind === 'checkbox' || Boolean(field.choices?.length))) };
  } catch (error) {
    return { ...source, status: 'invalid', code: errorCode(error, 'invalid-pdf') };
  }
}

function mappingFor(template: ReadyTemplate, roster: RosterSource, choices?: Record<string, string>) {
  const fields = template.fields.filter(({ kind }) => kind === 'text' || kind === 'checkbox');
  const headers = roster.sheet!.headers;
  const suggested = roster.engine.autoMap(fields.map(({ name }) => name), headers);
  return Object.fromEntries(template.fields.flatMap(({ name }) => {
    const column = choices && Object.hasOwn(choices, name) ? choices[name]
      : Object.hasOwn(suggested, name) ? suggested[name] : undefined;
    return column && headers.includes(column) ? [[name, column]] : [];
  }));
}

function IssueList({ issues, copy, arabic }: { issues: PacketIssue[]; copy: Copy; arabic: boolean }) {
  return (
    <ul className="diagnostics">
      {issues.map((issue, index) => {
        const key = Object.hasOwn(setupProblems, issue.code) ? setupProblems[issue.code as keyof typeof setupProblems] : undefined;
        const reason = key ? copy[key] : issue.code.startsWith('cover-sheet-') ? copy.invalidCover
          : diagnosticProblem(issue.code, { arabic }) ?? <bdi dir="auto">{issue.message}</bdi>;
        return <li key={index}>
          {issue.templateIndex !== undefined && <><bdi dir="ltr">#{issue.templateIndex}</bdi>{' '}</>}
          {issue.templateName && <><bdi dir="auto">{issue.templateName}</bdi>{' · '}</>}
          {issue.fieldName && <><bdi dir="auto">{issue.fieldName}</bdi>{' · '}</>}
          {issue.columnName && <><bdi dir="auto">{issue.columnName}</bdi>{' · '}</>}
          {reason}
          {issue.choices?.length ? <ChoiceList choices={issue.choices} label={copy.allowedChoices} blank={copy.blank} /> : null}
        </li>;
      })}
    </ul>
  );
}

export default function PacketWorkbench({ arabic, active }: { arabic: boolean; active: boolean }) {
  const copy = arabic ? ar : en;
  const heading = useRef<HTMLHeadingElement>(null);
  const nextTemplate = useRef(0);
  const rosterRevision = useRef(0);
  const operation = useRef<AbortController | undefined>(undefined);
  const [templates, setTemplates] = useState<TemplateSource[]>([]);
  const [roster, setRoster] = useState<RosterSource>();
  const [rosterName, setRosterName] = useState('');
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string>();
  const [templateLimit, setTemplateLimit] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<number>();
  const [mappings, setMappings] = useState<Record<number, Record<string, string>>>({});
  const [group, setGroup] = useState('');
  const [pattern, setPattern] = useState('');
  const [cover, setCover] = useState(false);
  const [syntheticRoster, setSyntheticRoster] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'preflight' | 'assemble'>();
  const [progress, setProgress] = useState<ModeProgress>();
  const [issues, setIssues] = useState<PacketIssue[]>();
  const [runError, setRunError] = useState(false);
  const [result, setResult] = useState<Omit<CheckedPacket, 'assemble'>>();
  const [output, setOutput] = useState<PacketArtifacts>();

  useLayoutEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => () => operation.current?.abort(), []);

  const readyTemplates = useMemo(() => templates.filter((source): source is ReadyTemplate => source.status === 'ready'), [templates]);
  const activeTemplate = readyTemplates.find(({ id }) => id === selectedTemplate) ?? readyTemplates[0];
  const headers = roster?.sheet?.headers ?? emptyHeaders;
  const actualMappings = useMemo(() => roster?.sheet ? readyTemplates.map((source) =>
    mappingFor(source, roster, mappings[source.id] ?? source.preset)) : emptyMappings, [mappings, readyTemplates, roster]);
  const canCheck = templates.length >= 2 && templates.length === readyTemplates.length && Boolean(roster?.sheet?.rows.length);
  const defaultPattern = headers.includes('ID') ? '{{ID}}-packet.pdf' : '[[@ROW_INDEX]]-packet.pdf';
  const busyMessage = phase === 'loading' ? copy.loading : phase === 'preflight' ? copy.checking : phase === 'assemble' ? copy.assembling : '';

  function invalidate() {
    operation.current?.abort();
    operation.current = undefined;
    setPhase(undefined);
    setProgress(undefined);
    setIssues(undefined);
    setRunError(false);
    setResult(undefined);
    setOutput(undefined);
  }

  function reset() {
    invalidate();
    rosterRevision.current++;
    setTemplates([]);
    setRoster(undefined);
    setRosterName('');
    setRosterBusy(false);
    setRosterError(undefined);
    setTemplateLimit(false);
    setSelectedTemplate(undefined);
    setMappings({});
    setGroup('');
    setPattern('');
    setCover(false);
    setSyntheticRoster(false);
  }

  function addTemplates(files: File[], replace?: number) {
    if (!files.length) return;
    invalidate();
    if (templates.length + files.length - Number(replace !== undefined) > 4) {
      setTemplateLimit(true);
      return;
    }
    setTemplateLimit(false);
    const entries = files.map((file) => ({ id: ++nextTemplate.current, name: file.name, status: 'loading' as const }));
    setTemplates((current) => replace === undefined ? [...current, ...entries]
      : current.map((template) => template.id === replace ? entries[0]! : template));
    if (replace !== undefined) {
      setMappings(({ [replace]: _removed, ...rest }) => rest);
      if (activeTemplate?.id === replace) setSelectedTemplate(entries[0]!.id);
    }
    for (const [index, file] of files.entries()) {
      const entry = entries[index]!;
      void readTemplate(file, entry).then((loaded) =>
        setTemplates((current) => current.map((source) => source.id === loaded.id ? loaded : source)));
    }
  }

  async function readRoster(files: File[]) {
    if (!files.length) return;
    invalidate();
    if (files.length !== 1) {
      setRosterError('packet-single-roster');
      return;
    }
    const revision = ++rosterRevision.current;
    const file = files[0]!;
    const openedAt = new Date();
    setRoster(undefined);
    setRosterName(file.name);
    setRosterBusy(true);
    setRosterError(undefined);
    setGroup('');
    setSyntheticRoster(false);
    try {
      const { loadRosterSource } = await import('./roster-source');
      const source = await loadRosterSource(file, openedAt);
      if (revision === rosterRevision.current) setRoster(source);
    } catch (error) {
      if (revision === rosterRevision.current) setRosterError(errorCode(error, 'unsupported-roster'));
    } finally {
      if (revision === rosterRevision.current) setRosterBusy(false);
    }
  }

  async function run(
    current: AbortController,
    sources: ReadyTemplate[],
    data: RosterSource,
    fieldMappings: Record<string, string>[],
    options: Pick<PacketInput, 'includeCover' | 'groupByColumn' | 'filenamePattern'>,
  ) {
    const { signal } = current;
    try {
      setPhase('preflight');
      const [{ preflightPacket, PACKET_ZIP_FILENAME, PACKET_MANIFEST_FILENAME }, fonts] =
        await Promise.all([import('../core/packet/assembler'), loadFonts()]);
      if (signal.aborted) return;
      const onProgress = (update: ModeProgress) => {
        if (!signal.aborted) setProgress(update);
      };
      const checked = await preflightPacket({
        templates: sources.map(({ name, title, bytes }, index) => ({ name, title, bytes, mapping: fieldMappings[index]! })),
        roster: { name: data.name, bytes: data.bytes, sheetName: data.sheetName },
        localDate: data.localDate,
        fonts,
        ...options,
      }, { signal, onProgress });
      if (signal.aborted) return;
      if (checked.status === 'blocked') {
        setIssues(checked.issues);
        return;
      }
      const { assemble, ...rows } = checked;
      setResult(rows);
      if (!rows.ready) return;
      setPhase('assemble');
      setProgress(undefined);
      const { zipBytes, manifestJson } = await assemble({ signal, onProgress });
      if (!signal.aborted) setOutput({ zipBytes, manifestJson, zipFilename: PACKET_ZIP_FILENAME, manifestFilename: PACKET_MANIFEST_FILENAME });
    } catch {
      if (!signal.aborted) setRunError(true);
    } finally {
      if (!signal.aborted) {
        setPhase(undefined);
        setProgress(undefined);
      }
    }
  }

  async function demo() {
    reset();
    const current = new AbortController();
    operation.current = current;
    setPhase('loading');
    try {
      const { loadPacketDemo } = await import('./packet-demo');
      const sample = await loadPacketDemo();
      if (current.signal.aborted) return;
      const [{ loadRosterSource }, ...loaded] = await Promise.all([
        import('./roster-source'),
        ...sample.templates.map(({ file, title, mapping }) =>
          readTemplate(file, { id: ++nextTemplate.current, name: file.name, title, preset: mapping })),
      ]);
      const data = await loadRosterSource(sample.roster, new Date());
      if (current.signal.aborted) return;
      setTemplates(loaded);
      setRoster(data);
      setRosterName(data.name);
      setSyntheticRoster(true);
      setCover(true);
      const valid = loaded.filter((source): source is ReadyTemplate => source.status === 'ready');
      if (valid.length !== loaded.length) throw new Error('packet-demo-source');
      await run(current, valid, data, valid.map((source) => mappingFor(source, data, source.preset)), { includeCover: true });
    } catch {
      if (!current.signal.aborted) {
        setPhase(undefined);
        setRunError(true);
      }
    }
  }

  function selectSheet(name: string) {
    if (!roster?.workbook || roster.sheetName === name) return;
    invalidate();
    setGroup('');
    setRoster({ ...roster, ...roster.workbook.select(name) });
  }

  function reorder(index: number, offset: number) {
    if (!templates[index + offset]) return;
    invalidate();
    const ordered = [...templates];
    [ordered[index], ordered[index + offset]] = [ordered[index + offset]!, ordered[index]!];
    setTemplates(ordered);
  }

  const activeMapping = activeTemplate ? actualMappings[readyTemplates.indexOf(activeTemplate)] : undefined;
  const displayedRosterError = rosterError ?? roster?.sheetError;

  return (
    <section className="packet-workbench workbench" aria-labelledby="packet-heading" data-testid="packet-workbench">
      <header className="panel packet-intro">
        <div>
          <h2 id="packet-heading" tabIndex={-1} ref={heading}>{copy.title}</h2>
          <p className="quiet">{copy.intro}</p>
        </div>
        <div className="actions">
          <button type="button" className="button secondary" data-testid="packet-demo" onClick={() => void demo()}>
            {copy.demo}
          </button>
          <button type="button" className="text-button" data-testid="packet-reset" onClick={reset}>{copy.reset}</button>
        </div>
      </header>

      <div className="workbench-grid packet-grid">
        <div className="setup">
          <section className="panel" aria-labelledby="packet-source-heading">
            <header><h3 id="packet-source-heading">{copy.sources}</h3></header>
            <div className="panel-body file-stack">
              <Picker id="packet-templates-upload" accept={pdfAccept} multiple heading={copy.templates} note={copy.templateHint}
                button={copy.add} read={addTemplates} />
              {templateLimit && <p className="alert" role="alert">{copy.limit}</p>}
              {templates.length > 0 && <div className="packet-order">
                <p className="quiet">{copy.order}</p>
                <ol data-testid="packet-template-list">
                  {templates.map((template, index) => <li key={template.id} data-testid="packet-template">
                    <div className="packet-template-name" id={`packet-name-${template.id}`}>
                      <bdi className="packet-number" dir="ltr">#{index + 1}</bdi>{' '}
                      <bdi dir="auto" className="loaded-filename">{template.name}</bdi>
                    </div>
                    {template.preset && <span className="tag tag-pass packet-template-tag">{copy.synthetic}</span>}
                    <div className="packet-file-actions">
                      <button type="button" className="text-button" data-testid="packet-move-earlier"
                        aria-label={`${copy.earlier} ${template.name}`} aria-disabled={index === 0}
                        onClick={() => reorder(index, -1)}>{copy.earlier}</button>
                      <button type="button" className="text-button" data-testid="packet-move-later"
                        aria-label={`${copy.later} ${template.name}`} aria-disabled={index === templates.length - 1}
                        onClick={() => reorder(index, 1)}>{copy.later}</button>
                      <label className="file-action">
                        {copy.replace}
                        <input type="file" accept={pdfAccept} data-testid="packet-template-replace" aria-label={`${copy.replace} ${template.name}`}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) addTemplates([file], template.id);
                          }} />
                      </label>
                      <button type="button" className="text-button" data-testid="packet-template-remove" aria-label={`${copy.remove} ${template.name}`}
                        onClick={() => {
                          invalidate();
                          setTemplateLimit(false);
                          setMappings(({ [template.id]: _removed, ...rest }) => rest);
                          setTemplates((current) => current.filter(({ id }) => id !== template.id));
                          document.getElementById('packet-templates-upload')?.focus();
                        }}>{copy.remove}</button>
                    </div>
                    {template.status === 'loading' && <p className="quiet" role="status">{copy.loading}</p>}
                    {template.status === 'invalid' && <p className="alert" role="alert">{diagnosticProblem(template.code, { arabic }) ?? copy.sourceError}</p>}
                  </li>)}
                </ol>
              </div>}
              <Picker id="packet-roster-upload" accept={rosterAccept} heading={copy.roster} note={rosterName
                ? <bdi dir="auto" className="loaded-filename">{rosterName}</bdi>
                : <>{copy.rosterHint}{' '}<bdi dir="ltr">(.csv / .xlsx)</bdi></>}
                button={copy.chooseRoster} read={(files) => void readRoster(files)} />
              {rosterBusy && <p className="quiet" role="status">{copy.loading}</p>}
              {syntheticRoster && <div className="source-note" data-testid="packet-synthetic">
                <strong className="tag tag-pass">{copy.synthetic}</strong><p>{copy.syntheticNote}</p>
              </div>}
              {roster?.workbook && <label className="full-control">
                {copy.worksheet}
                <select data-testid="packet-worksheet" dir="auto" value={roster.sheetName}
                  aria-describedby={displayedRosterError ? 'packet-roster-error' : undefined}
                  onChange={(event) => selectSheet(event.currentTarget.value)}>
                  {roster.workbook.sheetNames.map((name) => <option dir="auto" key={name} value={name}>{name}</option>)}
                </select>
              </label>}
              {displayedRosterError && <p id="packet-roster-error" data-testid="packet-roster-error" className="alert" role="alert">
                {displayedRosterError === 'packet-single-roster' ? copy.singleRoster : diagnosticProblem(displayedRosterError, { arabic }) ?? copy.sourceError}
              </p>}
              {roster?.sheet && <p className="quiet">{copy.rosterSize(roster.sheet.rows.length)}</p>}
            </div>
          </section>

          <section className="panel" aria-labelledby="packet-options-heading">
            <header><h3 id="packet-options-heading">{copy.output}</h3></header>
            <div className="panel-body settings-fields">
              <label className="full-control">
                {copy.filename}
                <input data-testid="packet-filename-pattern" type="text" className="pattern-input" dir="auto" value={pattern} placeholder={defaultPattern}
                  onChange={(event) => { invalidate(); setPattern(event.currentTarget.value); }} />
                <small>{copy.filenameHelp}{arabic && <> <bdi dir="ltr">{'{{Column}}'}</bdi></>}</small>
              </label>
              <label className="full-control">
                {copy.group}
                <select data-testid="packet-group-by" dir="auto" value={group} disabled={!headers.length}
                  onChange={(event) => { invalidate(); setGroup(event.currentTarget.value); }}>
                  <option value="">{copy.noGroup}</option>
                  {headers.map((header) => <option key={header} dir="auto" value={header}>{header}</option>)}
                </select>
              </label>
              <label className="output-mode">
                <input data-testid="packet-cover" type="checkbox" checked={cover}
                  onChange={(event) => { invalidate(); setCover(event.currentTarget.checked); }} />
                <span>{copy.cover}</span>
              </label>
            </div>
          </section>
        </div>

        <section className="panel" aria-labelledby="packet-mapping-heading">
          <header>
            <h3 id="packet-mapping-heading">{copy.mapping}</h3>
            <p>{copy.mappingHelp}</p>
          </header>
          <div className="panel-body packet-mapping">
            {!activeMapping && <p className="quiet">{copy.mappingWait}</p>}
            {readyTemplates.length > 0 && <>
              <div role="tablist" aria-labelledby="packet-mapping-heading" className="packet-tabs">
                {readyTemplates.map((template, index) => <button key={template.id} type="button" role="tab"
                  id={`packet-tab-${template.id}`} className="button secondary" data-testid="packet-template-tab"
                  aria-controls={`packet-tabpanel-${template.id}`} aria-selected={template.id === activeTemplate?.id}
                  tabIndex={template.id === activeTemplate?.id ? 0 : -1} onClick={() => setSelectedTemplate(template.id)}
                  onKeyDown={(event) => {
                    let target = index;
                    if (event.key === 'Home') target = 0;
                    else if (event.key === 'End') target = readyTemplates.length - 1;
                    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      const delta = (event.key === 'ArrowRight') === !arabic ? 1 : -1;
                      target = (index + delta + readyTemplates.length) % readyTemplates.length;
                    } else return;
                    event.preventDefault();
                    const id = readyTemplates[target]!.id;
                    setSelectedTemplate(id);
                    document.getElementById(`packet-tab-${id}`)?.focus();
                  }}>
                  <bdi className="packet-number" dir="ltr">#{templates.indexOf(template) + 1}</bdi>{' '}
                  <bdi dir="auto">{template.name}</bdi>
                </button>)}
              </div>
              {readyTemplates.map((template) => <div key={template.id} role="tabpanel" id={`packet-tabpanel-${template.id}`}
                aria-labelledby={`packet-tab-${template.id}`} hidden={template.id !== activeTemplate?.id}>
                {template.id === activeTemplate?.id && activeMapping && <div className="packet-fields">
                  <button type="button" className="text-button" data-testid="packet-auto-map" onClick={() => {
                    invalidate();
                    setMappings((current) => ({ ...current, [template.id]: {} }));
                  }}>{copy.autoMap}</button>
                  {template.fields.map(({ name }, index) => <label className="full-control" key={name}>
                    <bdi dir="auto">{name}</bdi>
                    <select data-testid="packet-field-mapping" data-field={name} id={`packet-map-${template.id}-${index}`}
                      dir="auto" value={Object.hasOwn(activeMapping, name) ? activeMapping[name] : ''}
                      onChange={(event) => {
                        invalidate();
                        const value = event.currentTarget.value;
                        setMappings((current) => ({ ...current, [template.id]: {
                          ...(current[template.id] ?? template.preset), [name]: value,
                        } }));
                      }}>
                      <option value="">{copy.leave}</option>
                      {headers.map((header) => <option key={header} dir="auto" value={header}>{header}</option>)}
                    </select>
                  </label>)}
                </div>}
              </div>)}
            </>}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="packet-results-heading">
        <header className="packet-results-header">
          <div>
            <h3 id="packet-results-heading">{copy.results}</h3>
            {!canCheck && !phase && <p>{copy.needsInputs}</p>}
          </div>
          <button type="button" className="button primary" data-testid="packet-preflight" disabled={!canCheck || Boolean(phase)}
            onClick={() => {
              invalidate();
              const current = new AbortController();
              operation.current = current;
              void run(current, readyTemplates, roster!, actualMappings,
                { groupByColumn: group || undefined, filenamePattern: pattern || undefined, includeCover: cover });
            }}>{copy.preflight}</button>
        </header>
        <div className="panel-body packet-results">
          <p role="status" aria-atomic="true" data-testid="packet-progress" className="quiet packet-progress">
            {busyMessage}
            {progress && progress.phase === phase && <> <bdi dir="ltr">{progress.completed} / {progress.total}</bdi></>}
            {!phase && result && !runError && copy.finish}
          </p>
          {runError && <p className="alert" role="alert">{copy.failed}</p>}
          {issues && <div className="alert" role="alert"><IssueList issues={issues} copy={copy} arabic={arabic} /></div>}
          {result && <>
            <dl className="counts packet-counts" aria-live="polite" aria-atomic="true">
              <div><dt>{copy.total}</dt><dd data-testid="packet-total-count">{result.rows.length}</dd></div>
              <div><dt>{copy.ready}</dt><dd className="ink-green" data-testid="packet-ready-count">{result.ready}</dd></div>
              <div><dt>{copy.flagged}</dt><dd className="ink-amber" data-testid="packet-flagged-count">{result.flagged}</dd></div>
            </dl>
            <div className="table-scroll packet-table" role="region" aria-label={copy.table} tabIndex={0}>
              <table data-testid="packet-readiness-table">
                <thead>
                  <tr><th scope="col">{copy.row}</th><th scope="col">{copy.status}</th><th scope="col">{copy.path}</th><th scope="col">{copy.review}</th></tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => <tr key={row.rowNumber} data-status={row.status}>
                    <th scope="row">{row.rowNumber}</th>
                    <td><span className={row.status === 'ready' ? 'tag tag-pass' : 'tag tag-flagged'}>
                      {row.status === 'ready' ? copy.ready : copy.flagged}
                    </span></td>
                    <td>{row.status === 'ready' && <Filename name={row.path} />}</td>
                    <td>
                      {row.issues.length > 0 && <IssueList issues={row.issues} copy={copy} arabic={arabic} />}
                      {row.sourceWarnings.length > 0 && <details>
                        <summary>{copy.warnings}</summary>
                        <ul className="diagnostics">
                          {row.sourceWarnings.map(({ source, code, column }, index) => <li key={index}>
                            <bdi dir="ltr">{source.column}{source.row}</bdi>{' · '}<bdi dir="auto">{column}</bdi>{' · '}
                            {diagnosticProblem(code, { arabic })}
                          </li>)}
                        </ul>
                      </details>}
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {!result.ready && <p className="quiet">{copy.noReady}</p>}
          </>}
          <div className="actions">
            <button type="button" className="button primary" data-testid="packet-download-zip" disabled={!output}
              onClick={() => output && saveDownload(output.zipBytes, output.zipFilename, 'application/zip')}>
              <span>{copy.zip}{' '}<bdi dir="ltr">(.zip)</bdi></span>
            </button>
            <button type="button" className="button secondary" data-testid="packet-download-manifest" disabled={!output}
              onClick={() => output && saveDownload(output.manifestJson, output.manifestFilename, 'application/json')}>
              <span>{copy.manifest}{' '}<bdi dir="ltr">(.json)</bdi></span>
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
