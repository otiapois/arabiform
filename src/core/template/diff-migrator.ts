import Papa from 'papaparse';
import { sha256 } from '../audit/custody';
import { isRecord, validateMappingPreset, type MappingPreset } from '../draft/mapping-preset';
import { inspectTemplate, PdfIntakeError, type FieldMetadata, type PdfIntakeCode, type TemplateMetadata, type WidgetMetadata } from '../pdf';
import { matchChoice, type FieldChoice } from '../pdf/choice-match';
import { decimalNumber, decimalParts, distanceInPoints, subtractDecimals, type DecimalParts } from '../pdf/decimal-points';
import { escapeSpreadsheetCell } from '../roster/spreadsheet-csv';
import { conditionalRuleColumns, prepareConditionalFields, type ConditionalFieldRule } from '../rules/conditional-fields';

type PdfBytes = Uint8Array | ArrayBuffer;
type FieldKind = FieldMetadata['kind'];
type WidgetLocation = { field: string; pageNumber: number | null; occurrence: number };

export const TEMPLATE_MIGRATION_CSV_FILENAME = 'template-migration-report.csv';
export const TEMPLATE_MIGRATION_JSON_FILENAME = 'template-migration-report.json';
export const MIGRATED_PRESET_FILENAME = 'migrated-preset.json';

export type WidgetGeometryChange = WidgetLocation & {
  oldWidthPt: number; newWidthPt: number; widthDeltaPt: number;
  oldHeightPt: number; newHeightPt: number; heightDeltaPt: number;
  shrunk: boolean;
};

export interface TemplateDiff {
  oldSha256: string;
  newSha256: string;
  oldFields: FieldMetadata[];
  newFields: FieldMetadata[];
  addedFields: FieldMetadata[];
  removedFields: FieldMetadata[];
  typeChangedFields: { field: string; oldKind: FieldKind; newKind: FieldKind }[];
  geometryChangedFields: WidgetGeometryChange[];
  maxLenChangedFields: { field: string; oldMaxLength: number | null; newMaxLength: number | null; reduced: boolean }[];
  choiceOptionsChangedFields: { field: string; added: FieldChoice[]; removed: FieldChoice[];
    oldOptions: FieldChoice[]; newOptions: FieldChoice[]; oldExportStates?: (string | null)[]; newExportStates?: (string | null)[] }[];
  widgetCountChangedFields: { field: string; pageNumber: number | null; oldCount: number; newCount: number }[];
  widgetAvailabilityChangedFields: (WidgetLocation & { oldUsable: boolean; newUsable: boolean })[];
  availabilityChangedFields: { field: string; oldReadOnly: boolean; newReadOnly: boolean; oldUsable: boolean; newUsable: boolean }[];
  breaking: boolean;
}

export class TemplateDiffIntakeError extends Error {
  constructor(readonly side: 'old' | 'new', readonly code: PdfIntakeCode, cause: PdfIntakeError) {
    super(code, { cause });
    this.name = 'TemplateDiffIntakeError';
  }
}

const compareNames = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const pageNumber = (pageIndex: number) => pageIndex < 0 ? null : pageIndex + 1;
const zero: DecimalParts = [0n, 0];
type WidgetDimensions = { width: DecimalParts; height: DecimalParts };

// Width/height are measured along the PDF page's default user-space axes. Crop and rotation affect usability,
// while UserUnit converts the actual widget rectangle dimensions to physical points.
function dimensions(widget: WidgetMetadata, pages: TemplateMetadata['pages']): WidgetDimensions {
  const bounds = widget.printBounds;
  if (!bounds) return { width: zero, height: zero };
  if (!bounds.every(Number.isFinite)) throw new PdfIntakeError('invalid-pdf');
  const unit = decimalParts(pages[widget.pageIndex]?.userUnit ?? 1);
  const width = distanceInPoints(bounds[0], bounds[2], unit);
  const height = distanceInPoints(bounds[1], bounds[3], unit);
  if (![width, height].every((size) => Number.isFinite(decimalNumber(size)))) throw new PdfIntakeError('invalid-pdf');
  return { width, height };
}

async function inspectSide(bytes: PdfBytes, side: TemplateDiffIntakeError['side']) {
  try {
    const template = await inspectTemplate(bytes);
    const widgetDimensions = new Map(template.fields.flatMap(({ widgets }) =>
      widgets.map((widget) => [widget, dimensions(widget, template.pages)] as const)));
    return { fields: template.fields, widgetDimensions };
  } catch (error) {
    if (!(error instanceof PdfIntakeError)) throw error;
    throw new TemplateDiffIntakeError(side, error.code, error);
  }
}

function widgetsByPage(widgets: readonly WidgetMetadata[]) {
  const byPage = new Map<number, WidgetMetadata[]>();
  for (const widget of widgets) {
    const samePage = byPage.get(widget.pageIndex);
    if (samePage) samePage.push(widget);
    else byPage.set(widget.pageIndex, [widget]);
  }
  return byPage;
}

function usableWidget(widget: WidgetMetadata) {
  return widget.usable && widget.width > 0 && widget.height > 0 && widget.rotation % 90 === 0;
}

function usableField(field: FieldMetadata) {
  return !field.incompleteWidgets && !field.multiSelect && field.widgets.length > 0 && field.widgets.every(usableWidget)
    && (field.kind === 'text' ? field.readOnly || field.supportsTextCapacity
      : field.kind === 'checkbox' || Boolean(field.choices?.length))
    && (!field.choiceExportStates || field.choiceExportStates.every((state) => state !== null)
      && new Set(field.choiceExportStates).size === field.choiceExportStates.length);
}

function choiceKey(choice: FieldChoice, state?: string | null) {
  return JSON.stringify([choice.value, choice.label, state]);
}

function optionDifference(options: FieldChoice[], keys: string[], otherKeys: string[]) {
  const remaining = new Map<string, number>();
  for (const key of otherKeys) remaining.set(key, (remaining.get(key) ?? 0) + 1);
  return options.filter((_, index) => {
    const key = keys[index]!;
    const count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

export async function inspectTemplateDiff(oldBytes: PdfBytes, newBytes: PdfBytes): Promise<TemplateDiff> {
  // Both sides use the full Fill intake. Report the old side first if both inputs fail.
  const oldTemplate = await inspectSide(oldBytes, 'old');
  const newTemplate = await inspectSide(newBytes, 'new');
  const [oldSha256, newSha256] = await Promise.all([sha256(oldBytes), sha256(newBytes)]);
  const sorted = (fields: FieldMetadata[]) => fields.sort((a, b) => compareNames(a.name, b.name));
  const oldFields = sorted(oldTemplate.fields);
  const newFields = sorted(newTemplate.fields);
  const oldByName = new Map(oldFields.map((field) => [field.name, field]));
  const newByName = new Map(newFields.map((field) => [field.name, field]));
  const diff: TemplateDiff = {
    oldSha256, newSha256, oldFields, newFields,
    addedFields: newFields.filter(({ name }) => !oldByName.has(name)),
    removedFields: oldFields.filter(({ name }) => !newByName.has(name)),
    typeChangedFields: [], geometryChangedFields: [], maxLenChangedFields: [], choiceOptionsChangedFields: [],
    widgetCountChangedFields: [], widgetAvailabilityChangedFields: [], availabilityChangedFields: [], breaking: false,
  };

  for (const previous of oldFields) {
    const field = previous.name;
    const current = newByName.get(field);
    if (!current) continue;
    if (previous.kind !== current.kind) diff.typeChangedFields.push({ field, oldKind: previous.kind, newKind: current.kind });
    const oldReadOnly = previous.readOnly;
    const newReadOnly = current.readOnly;
    const oldUsable = usableField(previous);
    const newUsable = usableField(current);
    if (oldReadOnly !== newReadOnly || oldUsable !== newUsable) {
      diff.availabilityChangedFields.push({ field, oldReadOnly, newReadOnly, oldUsable, newUsable });
    }

    const oldMaxLength = previous.maxLength ?? null;
    const newMaxLength = current.maxLength ?? null;
    if (oldMaxLength !== newMaxLength) diff.maxLenChangedFields.push({
      field, oldMaxLength, newMaxLength, reduced: newMaxLength !== null && (oldMaxLength === null || newMaxLength < oldMaxLength),
    });

    const oldOptions = previous.choices ?? [];
    const newOptions = current.choices ?? [];
    const oldExportStates = previous.choiceExportStates;
    const newExportStates = current.choiceExportStates;
    const oldKeys = oldOptions.map((choice, index) => choiceKey(choice, oldExportStates?.[index]));
    const newKeys = newOptions.map((choice, index) => choiceKey(choice, newExportStates?.[index]));
    if (oldKeys.length !== newKeys.length || oldKeys.some((key, index) => key !== newKeys[index])
      || JSON.stringify(oldExportStates) !== JSON.stringify(newExportStates)) {
      diff.choiceOptionsChangedFields.push({
        field, oldOptions, newOptions, oldExportStates, newExportStates,
        added: optionDifference(newOptions, newKeys, oldKeys), removed: optionDifference(oldOptions, oldKeys, newKeys),
      });
    }

    const beforeByPage = widgetsByPage(previous.widgets);
    const afterByPage = widgetsByPage(current.widgets);
    const pages = [...new Set([...beforeByPage.keys(), ...afterByPage.keys()])].sort((a, b) => a - b);
    for (const pageIndex of pages) {
      const before = beforeByPage.get(pageIndex) ?? [];
      const after = afterByPage.get(pageIndex) ?? [];
      const page = pageNumber(pageIndex);
      if (before.length !== after.length) diff.widgetCountChangedFields.push({
        field, pageNumber: page, oldCount: before.length, newCount: after.length,
      });
      for (let index = 0; index < Math.min(before.length, after.length); index++) {
        const oldWidget = before[index]!;
        const newWidget = after[index]!;
        const location = { field, pageNumber: page, occurrence: index + 1 };
        const oldWidgetUsable = usableWidget(oldWidget);
        const newWidgetUsable = usableWidget(newWidget);
        if (oldWidgetUsable !== newWidgetUsable) diff.widgetAvailabilityChangedFields.push({
          ...location, oldUsable: oldWidgetUsable, newUsable: newWidgetUsable,
        });
        const { width: oldWidth, height: oldHeight } = oldTemplate.widgetDimensions.get(oldWidget)!;
        const { width: newWidth, height: newHeight } = newTemplate.widgetDimensions.get(newWidget)!;
        const widthDelta = subtractDecimals(newWidth, oldWidth);
        const heightDelta = subtractDecimals(newHeight, oldHeight);
        if (!widthDelta[0] && !heightDelta[0]) continue;
        diff.geometryChangedFields.push({
          ...location, oldWidthPt: decimalNumber(oldWidth), newWidthPt: decimalNumber(newWidth), widthDeltaPt: decimalNumber(widthDelta),
          oldHeightPt: decimalNumber(oldHeight), newHeightPt: decimalNumber(newHeight), heightDeltaPt: decimalNumber(heightDelta),
          shrunk: widthDelta[0] < 0n || heightDelta[0] < 0n,
        });
      }
    }
  }

  diff.breaking = diff.removedFields.length > 0 || diff.typeChangedFields.length > 0
    || diff.geometryChangedFields.some(({ shrunk }) => shrunk) || diff.maxLenChangedFields.some(({ reduced }) => reduced)
    || diff.choiceOptionsChangedFields.some(({ removed }) => removed.length > 0)
    || diff.widgetCountChangedFields.some(({ oldCount, newCount }) => newCount < oldCount)
    || diff.availabilityChangedFields.some(({ oldReadOnly, newReadOnly, oldUsable, newUsable }) =>
      !oldReadOnly && newReadOnly || oldUsable && !newUsable)
    || diff.widgetAvailabilityChangedFields.some(({ oldUsable, newUsable }) => oldUsable && !newUsable);
  return diff;
}

export interface MigrationDiagnostic {
  code: 'invalid-preset' | 'invalid-rename-map' | 'unknown-rename-source' | 'unused-rename-source'
    | 'missing-source' | 'missing-target' | 'incompatible-target' | 'read-only-target' | 'unusable-target'
    | 'target-collision' | 'invalid-choice' | 'invalid-rule';
  field?: string;
  target?: string;
  ruleIndex?: number;
}

export interface TemplatePresetMigration {
  preset?: MappingPreset;
  diagnostics: MigrationDiagnostic[];
  renameCandidates: { field: string; targets: string[] }[];
  appliedRenames: { field: string; target: string }[];
}

type IndexedRule = { rule: ConditionalFieldRule; ruleIndex: number };

function canonicalChoice(field: FieldMetadata, token: string) {
  const index = matchChoice(field.choices ?? [], token);
  if (index === undefined) return undefined;
  return JSON.stringify([field.choices![index]!.value, field.choiceExportStates?.[index]]);
}

function targetIssue(source: FieldMetadata, target: FieldMetadata, textOnly: boolean, rules: readonly IndexedRule[]): MigrationDiagnostic | undefined {
  const field = source.name;
  const details = { field, target: target.name };
  if (source.kind !== target.kind || textOnly && source.kind !== 'text') return { ...details, code: 'incompatible-target' };
  if (target.readOnly) return { ...details, code: 'read-only-target' };
  if (!usableField(target)) return { ...details, code: 'unusable-target' };
  for (const { rule, ruleIndex } of rules) {
    const columns = conditionalRuleColumns(rule);
    const placeholderRow = Object.fromEntries(columns.map((column) => [column, '']));
    const check = prepareConditionalFields([{ ...rule, field: target.name }], columns, [target])({ [target.name]: '' }, placeholderRow);
    if (rule.action.type === 'set-choice' && (source.kind === 'dropdown' || source.kind === 'radio')) {
      const before = canonicalChoice(source, rule.action.value);
      if (!before || before !== canonicalChoice(target, rule.action.value)) return { ...details, ruleIndex, code: 'invalid-choice' };
    }
    if (check.diagnostics.length) return { ...details, ruleIndex, code: 'invalid-rule' };
  }
}

export function migrateTemplatePreset(diff: TemplateDiff, input: unknown, renames: unknown = {}): TemplatePresetMigration {
  const result: TemplatePresetMigration = { diagnostics: [], renameCandidates: [], appliedRenames: [] };
  const preset = validateMappingPreset(input);
  if (!preset) {
    result.diagnostics.push({ code: 'invalid-preset' });
    return result;
  }
  if (!isRecord(renames) || Object.entries(renames).some(([field, target]) => !field.trim() || typeof target !== 'string' || !target.trim())) {
    result.diagnostics.push({ code: 'invalid-rename-map' });
    return result;
  }

  const before = new Map(diff.oldFields.map((field) => [field.name, field]));
  const after = new Map(diff.newFields.map((field) => [field.name, field]));
  const activeMappings = Object.entries(preset.mapping).filter(([, column]) => column);
  const virtualMappings = 'virtualMappings' in preset ? Object.entries(preset.virtualMappings) : [];
  const alignment = 'alignOverrides' in preset ? Object.entries(preset.alignOverrides) : [];
  const typography = 'fieldTypography' in preset ? Object.entries(preset.fieldTypography) : [];
  const textOnly = new Set([...virtualMappings, ...alignment, ...typography].map(([field]) => field));
  const active = new Set([...activeMappings, ...virtualMappings].map(([field]) => field));
  const conditionalRules = 'conditionalRules' in preset ? preset.conditionalRules : [];
  const rulesByField = new Map<string, IndexedRule[]>();
  for (const [index, rule] of conditionalRules.entries()) {
    const ruleIndex = index + 1;
    if (!active.has(rule.field)) result.diagnostics.push({ field: rule.field, ruleIndex, code: 'invalid-rule' });
    const fieldRules = rulesByField.get(rule.field) ?? [];
    fieldRules.push({ rule, ruleIndex });
    rulesByField.set(rule.field, fieldRules);
  }
  const explicit = new Map<string, string>(Object.entries(renames) as [string, string][]);
  for (const field of [...explicit.keys()].sort(compareNames)) {
    if (!before.has(field)) result.diagnostics.push({ field, code: 'unknown-rename-source' });
    else if (!active.has(field)) result.diagnostics.push({ field, code: 'unused-rename-source' });
  }

  const assigned = new Map<string, string>();
  const occupants = new Map<string, string[]>();
  const repair = new Set<string>();
  for (const field of [...active].sort(compareNames)) {
    const source = before.get(field);
    if (!source) {
      result.diagnostics.push({ field, code: 'missing-source' });
      continue;
    }
    const name = explicit.get(field) ?? field;
    const target = after.get(name);
    const issue = target
      ? targetIssue(source, target, textOnly.has(field), rulesByField.get(field) ?? [])
      : { field, target: name, code: 'missing-target' as const };
    if (issue) {
      result.diagnostics.push(issue);
      repair.add(field);
      continue;
    }
    assigned.set(field, name);
    const sources = occupants.get(name) ?? [];
    sources.push(field);
    occupants.set(name, sources);
  }
  for (const [target, fields] of occupants) {
    if (fields.length < 2) continue;
    for (const field of fields) {
      result.diagnostics.push({ field, target, code: 'target-collision' });
      repair.add(field);
    }
  }

  for (const field of [...active].sort(compareNames)) {
    if ((!repair.has(field) && !explicit.has(field)) || !before.has(field)) continue;
    const source = before.get(field)!;
    const targets = diff.newFields.filter((target) =>
      target.name.trim() && (occupants.get(target.name) ?? []).every((occupant) => occupant === field)
      && !targetIssue(source, target, textOnly.has(field), rulesByField.get(field) ?? [])).map(({ name }) => name);
    result.renameCandidates.push({ field, targets });
  }
  if (result.diagnostics.length) return result;

  const rewrite = <T>(entries: [string, T][]) => entries.map(([field, value]): [string, T] => [assigned.get(field)!, value]);
  const blanks = Object.entries(preset.mapping).filter(([field, column]) => !column && after.has(field) && !occupants.has(field));
  const migrated = validateMappingPreset({
    ...preset, mapping: Object.fromEntries([...blanks, ...rewrite(activeMappings)]),
    ...('virtualMappings' in preset && { virtualMappings: Object.fromEntries(rewrite(virtualMappings)) }),
    ...('alignOverrides' in preset && { alignOverrides: Object.fromEntries(rewrite(alignment)) }),
    ...('fieldTypography' in preset && { fieldTypography: Object.fromEntries(rewrite(typography)) }),
    ...('conditionalRules' in preset && { conditionalRules: conditionalRules.map((rule) => ({ ...rule, field: assigned.get(rule.field)! })) }),
  });
  if (!migrated) {
    result.diagnostics.push({ code: 'invalid-preset' });
    return result;
  }
  result.preset = migrated;
  result.appliedRenames = [...assigned].flatMap(([field, target]) => field === target ? [] : [{ field, target }]);
  return result;
}

export function buildTemplateMigrationReport(diff: TemplateDiff, migration?: TemplatePresetMigration) {
  const { oldFields, newFields, addedFields, removedFields, ...changes } = diff;
  const summarize = ({ name, kind }: FieldMetadata) => ({ name, kind });
  const status = migration && !migration.preset ? 'blocked' : diff.breaking ? 'flagged' : 'clean';
  return {
    version: 1, status, ...changes, addedFields: addedFields.map(summarize), removedFields: removedFields.map(summarize),
    oldFieldCount: oldFields.length, newFieldCount: newFields.length,
    presetStatus: migration ? migration.preset ? 'ready' : 'blocked' : 'not-supplied',
    appliedRenames: migration?.appliedRenames ?? [], diagnostics: migration?.diagnostics ?? [],
  };
}

type TemplateMigrationReport = ReturnType<typeof buildTemplateMigrationReport>;

export function serializeTemplateMigrationReportCsv(report: TemplateMigrationReport): string {
  const rows: (string | number)[][] = [];
  const add = (change: string, { field = '', pageNumber = null, occurrence = '' }: {
    field?: string; pageNumber?: number | null; occurrence?: number | '';
  }, before: unknown, after: unknown, details: unknown = null) => rows.push([
    report.oldSha256, report.newSha256, report.status, change, escapeSpreadsheetCell(field), pageNumber ?? '', occurrence,
    JSON.stringify(before), JSON.stringify(after), JSON.stringify(details),
  ]);
  add('summary', {}, report.oldFieldCount, report.newFieldCount, { breaking: report.breaking, presetStatus: report.presetStatus });
  for (const { name, kind } of report.addedFields) add('added', { field: name }, null, kind);
  for (const { name, kind } of report.removedFields) add('removed', { field: name }, kind, null);
  for (const change of report.typeChangedFields) add('type', change, change.oldKind, change.newKind);
  for (const change of report.geometryChangedFields) add('geometry', change,
    { widthPt: change.oldWidthPt, heightPt: change.oldHeightPt }, { widthPt: change.newWidthPt, heightPt: change.newHeightPt },
    { widthDeltaPt: change.widthDeltaPt, heightDeltaPt: change.heightDeltaPt, shrunk: change.shrunk });
  for (const change of report.maxLenChangedFields) add('maxLen', change, change.oldMaxLength, change.newMaxLength, { reduced: change.reduced });
  for (const change of report.choiceOptionsChangedFields) add('choices', change,
    { options: change.oldOptions, exportStates: change.oldExportStates }, { options: change.newOptions, exportStates: change.newExportStates },
    { added: change.added, removed: change.removed });
  for (const change of report.widgetCountChangedFields) add('widget-count', change, change.oldCount, change.newCount);
  for (const change of report.widgetAvailabilityChangedFields) add('widget-availability', change, change.oldUsable, change.newUsable);
  for (const change of report.availabilityChangedFields) add('field-availability', change,
    { readOnly: change.oldReadOnly, usable: change.oldUsable }, { readOnly: change.newReadOnly, usable: change.newUsable });
  for (const rename of report.appliedRenames) add('rename', rename, rename.field, rename.target);
  for (const issue of report.diagnostics) add('diagnostic', issue, null, null, issue);
  return '\uFEFF' + Papa.unparse({ fields: [
    'oldSha256', 'newSha256', 'status', 'change', 'field', 'pageNumber', 'occurrence', 'old', 'new', 'details',
  ], data: rows }, { newline: '\r\n' }) + '\r\n';
}
