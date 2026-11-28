import { useEffect, useMemo, useRef, useState } from 'react';
import type { TemplateDiff } from '../core/template/diff-migrator';
import copyByLocale from './compare-template-labels';
import type { MigratedTemplate } from './fill-template-source';
import FilePicker from './FilePicker';
import { saveDownload } from './resources';
import { sourceProblem } from './source-problems';
import './compare-templates.css';

type Engine = typeof import('../core/template/diff-migrator');
type Copy = typeof copyByLocale.en;
type Input = { file: File; synthetic?: boolean };
type Inputs = { old?: Input; next?: Input; preset?: Input };
type Comparison = Required<Pick<Inputs, 'old' | 'next'>> & (
  | { diff: TemplateDiff; engine: Engine; error?: never }
  | { diff?: never; engine?: never; error: { side?: 'old' | 'next'; code?: string } }
);

const signed = (number: number) => number > 0 ? '+' + number : String(number);

function WidgetLocation({ page, occurrence, copy }: { page: number | null; occurrence?: number; copy: Copy }) {
  return <span className="quiet">
    {page === null ? copy.unknownPage : <>{copy.page} <bdi dir="ltr">{page}</bdi></>}
    {occurrence !== undefined && <> · {copy.widget} <bdi dir="ltr">{occurrence}</bdi></>}
  </span>;
}

function TemplateChanges({ copy, diff }: { copy: Copy; diff: TemplateDiff }) {
  const shrunk = diff.geometryChangedFields.filter((change) => change.shrunk).length;
  const limited = diff.maxLenChangedFields.some((change) => change.reduced);
  const groups = [
    { title: copy.added, entries: diff.addedFields.map(({ name, kind }) =>
      <li key={name}><bdi dir="auto">{name}</bdi><span>{copy.kinds[kind]}</span></li>) },
    { title: copy.removed, entries: diff.removedFields.map(({ name, kind }) =>
      <li key={name}><bdi dir="auto">{name}</bdi><span>{copy.kinds[kind]}</span></li>) },
    {
      title: copy.geometry,
      entries: diff.geometryChangedFields.map((change) => (
        <li key={JSON.stringify([change.field, change.pageNumber, change.occurrence])}>
          <bdi dir="auto">{change.field}</bdi>
          <WidgetLocation page={change.pageNumber} occurrence={change.occurrence} copy={copy} />
          {change.shrunk && <strong className="tag tag-flagged">{copy.narrower}</strong>}
          <span>{copy.dimensions}{' '}
            <bdi dir="ltr">{change.oldWidthPt} × {change.oldHeightPt} → {change.newWidthPt} × {change.newHeightPt} pt</bdi>
          </span>
          <span>{copy.difference}{' '}<bdi dir="ltr">{signed(change.widthDeltaPt)} × {signed(change.heightDeltaPt)} pt</bdi></span>
        </li>
      )),
    },
    {
      title: copy.options,
      entries: diff.choiceOptionsChangedFields.map(({ field, added, removed, oldOptions, newOptions, oldExportStates, newExportStates }) => {
        const changes = added.length || removed.length
          ? [[copy.added, added], [copy.removed, removed]] as const
          : [[copy.optionsOld, oldOptions], [copy.optionsNew, newOptions]] as const;
        return (
          <li key={field}>
            <bdi dir="auto">{field}</bdi>
            {changes.map(([label, options]) => (
              options.length > 0 &&
              <div key={label}>
                <span className="quiet">{label}</span>
                <ul className="compare-options">
                  {options.map(({ label: optionLabel, value }, index) =>
                    <li key={index}><bdi dir="auto">{optionLabel}</bdi>
                      {optionLabel !== value && <>{' '}(<bdi dir="auto">{value}</bdi>)</>}
                    </li>)}
                </ul>
              </div>
            ))}
            {oldExportStates && <span>{copy.statesOld}{' '}<bdi dir="auto">{oldExportStates.map((state) => state ?? '—').join(', ')}</bdi></span>}
            {newExportStates && <span>{copy.statesNew}{' '}<bdi dir="auto">{newExportStates.map((state) => state ?? '—').join(', ')}</bdi></span>}
          </li>
        );
      }),
    },
    {
      title: copy.maxLength,
      entries: diff.maxLenChangedFields.map(({ field, oldMaxLength, newMaxLength, reduced }) => (
        <li key={field}>
          <bdi dir="auto">{field}</bdi>
          {reduced && <strong className="tag tag-flagged">{copy.reduced}</strong>}
          <bdi dir="ltr">{oldMaxLength ?? copy.unlimited}{' → '}{newMaxLength ?? copy.unlimited}</bdi>
        </li>
      )),
    },
    { title: copy.type, entries: diff.typeChangedFields.map(({ field, oldKind, newKind }) =>
      <li key={field}><bdi dir="auto">{field}</bdi><span>{copy.kinds[oldKind]}{copy.transition}{copy.kinds[newKind]}</span></li>) },
    {
      title: copy.availability,
      entries: diff.availabilityChangedFields.map(({ field, oldReadOnly, newReadOnly, oldUsable, newUsable }) => (
        <li key={field}>
          <bdi dir="auto">{field}</bdi>
          {oldReadOnly !== newReadOnly && <span>{oldReadOnly ? copy.readOnly : copy.editable}{copy.transition}{newReadOnly ? copy.readOnly : copy.editable}</span>}
          {oldUsable !== newUsable && <span>{oldUsable ? copy.usable : copy.unusable}{copy.transition}{newUsable ? copy.usable : copy.unusable}</span>}
        </li>
      )),
    },
    {
      title: copy.widgetCount,
      entries: diff.widgetCountChangedFields.map(({ field, pageNumber, oldCount, newCount }) => (
        <li key={JSON.stringify([field, pageNumber])}>
          <bdi dir="auto">{field}</bdi><WidgetLocation page={pageNumber} copy={copy} /><bdi dir="ltr">{oldCount} → {newCount}</bdi>
        </li>
      )),
    },
    {
      title: copy.widgetAvailability,
      entries: diff.widgetAvailabilityChangedFields.map(({ field, pageNumber, occurrence, oldUsable, newUsable }) => (
        <li key={JSON.stringify([field, pageNumber, occurrence])}>
          <bdi dir="auto">{field}</bdi><WidgetLocation page={pageNumber} occurrence={occurrence} copy={copy} />
          <span>{oldUsable ? copy.usable : copy.unusable}{copy.transition}{newUsable ? copy.usable : copy.unusable}</span>
        </li>
      )),
    },
  ].filter(({ entries }) => entries.length > 0);

  return (
    <section className="compare-changes" aria-labelledby="compare-changes-title" data-testid="compare-changes">
      <h3 id="compare-changes-title">{copy.changes}</h3>
      <dl className="compare-counts">
        {([
          [copy.added, diff.addedFields.length],
          [copy.removed, diff.removedFields.length],
          [copy.shrunk, shrunk],
          [copy.options, diff.choiceOptionsChangedFields.length],
        ] as const).map(([label, count]) => (
          <div key={label}><dt>{label}</dt><dd>{count}</dd></div>
        ))}
      </dl>
      {!groups.length ? <p className="quiet">{copy.noChanges}</p> : (
        <>
          {(shrunk > 0 || limited || diff.breaking) && (
            <p className="alert warning" data-testid="compare-warning">{shrunk > 0 || limited ? copy.fitWarning : copy.review}</p>
          )}
          <div className="compare-diagnostics">
            {groups.map(({ title, entries }) =>
              <section key={title} className="compare-detail"><h4>{title}</h4><ul>{entries}</ul></section>)}
          </div>
        </>
      )}
    </section>
  );
}

export default function CompareTemplates({
  arabic, onUseInFill,
}: { arabic: boolean; onUseInFill: (file: File, migration: MigratedTemplate) => void }) {
  const copy = arabic ? copyByLocale.ar : copyByLocale.en;
  const [{ old, next, preset }, setInputs] = useState<Inputs>({});
  const [comparison, setComparison] = useState<Comparison>();
  const [parsedPreset, setParsedPreset] = useState<{ input: Input; value: unknown }>();
  const [renames, setRenames] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [demo, setDemo] = useState<'loading' | 'failed'>();
  const demoRequest = useRef(0);

  useEffect(() => () => { demoRequest.current++; }, []);

  useEffect(() => {
    if (!old || !next) return;
    let active = true;
    async function compare(old: Input, next: Input) {
      const [engine, oldBytes, newBytes] = await Promise.all([
        import('../core/template/diff-migrator'), old.file.arrayBuffer(), next.file.arrayBuffer(),
      ]);
      if (!active) return;
      try {
        const diff = await engine.inspectTemplateDiff(new Uint8Array(oldBytes), new Uint8Array(newBytes));
        if (active) setComparison({ old, next, diff, engine });
      } catch (error) {
        if (active) setComparison({ old, next, error: error instanceof engine.TemplateDiffIntakeError
          ? { side: error.side === 'old' ? 'old' : 'next', code: error.code } : {} });
      }
    }
    void compare(old, next).catch(() => { if (active) setComparison({ old, next, error: {} }); });
    return () => { active = false; };
  }, [old, next]);

  useEffect(() => {
    if (!preset) return;
    let active = true;
    void preset.file.text().then((text): unknown => JSON.parse(text)).catch(() => null).then((value) => {
      if (active) setParsedPreset({ input: preset, value });
    });
    return () => { active = false; };
  }, [preset]);

  const current = comparison?.old === old && comparison?.next === next ? comparison : undefined;
  const presetLoading = Boolean(preset && parsedPreset?.input !== preset);
  const migration = useMemo(() => {
    if (current?.diff && preset && parsedPreset?.input === preset) {
      return current.engine.migrateTemplatePreset(current.diff, parsedPreset.value, Object.fromEntries(renames));
    }
  }, [current, preset, parsedPreset, renames]);
  const migrated = migration?.preset;

  function choose(key: keyof Inputs, file?: File) {
    demoRequest.current++;
    setDemo(undefined);
    setInputs((previous) => ({ ...previous, [key]: file ? { file } : undefined }));
    setRenames(new Map());
  }

  async function openDemo() {
    const id = ++demoRequest.current;
    setInputs({});
    setRenames(new Map());
    setDemo('loading');
    try {
      const { loadCompareDemo } = await import('./compare-demo');
      if (id !== demoRequest.current) return;
      setInputs(loadCompareDemo());
      setDemo(undefined);
    } catch {
      if (id === demoRequest.current) setDemo('failed');
    }
  }

  function report(format: 'csv' | 'json') {
    if (!current?.diff || presetLoading) return;
    const { engine, diff } = current;
    const data = engine.buildTemplateMigrationReport(diff, migration);
    saveDownload(
      format === 'csv' ? engine.serializeTemplateMigrationReportCsv(data) : JSON.stringify(data, null, 2),
      'arabiform-template-migration-report.' + format,
      format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    );
  }

  const sources = [
    { key: 'old', input: old, label: copy.old, picker: copy.chooseOld },
    { key: 'next', input: next, label: copy.next, picker: copy.chooseNew },
    { key: 'preset', input: preset, label: copy.preset, picker: copy.choosePreset },
  ] as const;
  const error = current?.error;
  const checking = Boolean(old && next && !current);

  return (
    <section className="panel compare-templates" aria-labelledby="compare-title" data-testid="compare-templates">
      <header><h2 id="compare-title">{copy.title}</h2><p>{copy.intro}</p></header>
      <div className="panel-body compare-body">
        <div className="compare-sources">
          {sources.map(({ key, input, label, picker }) => {
            const json = key === 'preset';
            return (
              <div key={key}>
                <FilePicker id={key === 'next' ? 'compare-new-upload' : 'compare-' + key + '-upload'}
                  label={label} pickerLabel={picker} accept={json ? '.json,application/json' : '.pdf,application/pdf'}
                  filename={input?.file.name} placeholder={json ? copy.dropJson : copy.dropPdf}
                  onChoose={(file) => choose(key, file)} allowDrop />
                {input?.synthetic && <strong className="tag tag-pass">{copy.synthetic}</strong>}
                {json && input && <button type="button" className="text-button" data-testid="compare-remove-preset"
                  onClick={() => choose('preset')}>{copy.removePreset}</button>}
              </div>
            );
          })}
        </div>
        <div className="actions">
          <button type="button" className="button secondary" data-testid="compare-demo" onClick={() => void openDemo()}>
            <span>{copy.demo}{arabic && <> <bdi dir="ltr">(2026 → 2027)</bdi></>}</span>
          </button>
        </div>
        <p className={current?.diff && !presetLoading ? 'sr-only' : 'quiet compare-progress'} role="status">
          {demo === 'loading' ? copy.preparingDemo : checking ? copy.checking
            : current?.diff ? presetLoading ? copy.checkingPreset : copy.changes : !error && !demo ? copy.waiting : ''}
        </p>
        {demo === 'failed' && <p className="alert" role="alert">{copy.demoFailed}</p>}
        {error && <p className="alert" role="alert" data-testid="compare-error" data-code={error.code}>
          {error.side && <><strong>{copy[error.side]}</strong>{' · '}</>}
          {(error.code && sourceProblem(error.code, arabic)) || copy.pdfFailed}
        </p>}
        {current?.diff && (
          <>
            <TemplateChanges diff={current.diff} copy={copy} />
            <section className="compare-migration" aria-labelledby="compare-migration-title">
              <h3 id="compare-migration-title">{copy.migration}</h3>
              {!preset ? <p className="quiet">{copy.addPreset}</p> : migration && (
                <>
                  <p role="status" className={migrated ? 'quiet' : 'alert warning'} data-testid="compare-migration-status">
                    {migrated ? copy.migrated : copy.blocked}
                  </p>
                  {migration.diagnostics.length > 0 && (
                    <ul className="compare-issues">
                      {migration.diagnostics.map(({ code, field, target, ruleIndex }, index) => (
                        <li key={index} data-code={code}>
                          {field !== undefined && <bdi dir="auto">{field}</bdi>}
                          {target !== undefined && target !== field && <>{copy.transition}<bdi dir="auto">{target}</bdi></>}
                          {field !== undefined && ' · '}
                          {ruleIndex !== undefined && <>{copy.rule} <bdi dir="ltr">{ruleIndex}</bdi>{' · '}</>}
                          {copy.diagnostics[code]}
                        </li>
                      ))}
                    </ul>
                  )}
                  {migration.renameCandidates.length > 0 && (
                    <div className="compare-renames">
                      {migration.renameCandidates.map(({ field, targets }) => {
                        const selected = renames.get(field) ?? '';
                        return (
                          <label className="full-control" key={field}>
                            <span>{copy.chooseRename}{' '}<bdi dir="auto">{field}</bdi></span>
                            <select dir="auto" value={selected} data-testid="compare-rename"
                              disabled={targets.length === 0 && !selected} onChange={(event) => {
                                const choice = event.currentTarget.value;
                                setRenames((previous) => {
                                  const next = new Map(previous);
                                  if (choice) next.set(field, choice);
                                  else next.delete(field);
                                  return next;
                                });
                              }}>
                              <option value="">{targets.length ? copy.pickTarget : copy.noTargets}</option>
                              {selected && !targets.includes(selected) && <option value={selected}>{copy.recheckSelection}</option>}
                              {targets.map((target) => <option value={target} dir="auto" key={target}>{target}</option>)}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              <div className="actions">
                <button type="button" className="button primary" data-testid="compare-open-fill" disabled={!migrated}
                  onClick={() => {
                    if (migrated && next) onUseInFill(next.file, { preset: migrated, synthetic: next.synthetic });
                  }}>{copy.openFill}</button>
                <button type="button" className="button secondary" data-testid="compare-migrated-preset" disabled={!migrated}
                  onClick={() => migrated && saveDownload(JSON.stringify(migrated, null, 2), 'arabiform-migrated-preset.json', 'application/json')}>
                  <span>{copy.savePreset}{' '}<bdi dir="ltr">(.json)</bdi></span>
                </button>
                {(['csv', 'json'] as const).map((format) => (
                  <button type="button" key={format} className="button secondary" data-testid={'compare-report-' + format}
                    disabled={presetLoading} onClick={() => report(format)}>
                    <span>{copy.saveReport}{' '}<bdi dir="ltr">{'(.' + format + ')'}</bdi></span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
