import { sha256 } from '../audit/custody';
import type { HygieneOperation, HygieneSummary } from '../roster/hygiene';
import { isRecord, validateMappingPreset, type MappingPreset } from './mapping-preset';
import { conditionalRuleColumns } from '../rules/conditional-fields';

export type BatchDraftSource = {
  templateSha256: string;
  rosterSha256: string;
  fields: string[];
  sheetName: string;
  columns: string[];
  rowCount: number;
};

export type BatchDraft = {
  kind: 'arabiform-batch-draft';
  version: 1;
  source: BatchDraftSource;
  edits: Record<number, Record<string, string>>;
  hygiene: HygieneSummary[];
  settings: Exclude<MappingPreset, { version: 1 | 2 | 3 }>;
  customFontSha256: string | null;
};

const hexHash = /^[0-9a-f]{64}$/;
const booleanOptions = ['normalizeSpaces', 'normalizeAlef', 'normalizeTaaMarbuta', 'normalizeAlefMaqsura', 'stripHarakat', 'matchCase'];
const hygieneOptions = new Set(['columns', 'find', 'replace', ...booleanOptions]);

export { sha256 as hashBatchDraftInput };

function isHash(value: unknown): value is string {
  return typeof value === 'string' && hexHash.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNameList(value: unknown): value is string[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length) return false;
  for (const item of value) if (typeof item !== 'string' || !item.length) return false;
  return true;
}

function isSource(value: unknown): value is BatchDraftSource {
  return isRecord(value) && Object.keys(value).length === 6
    && isHash(value.templateSha256) && isHash(value.rosterSha256)
    && typeof value.sheetName === 'string' && value.sheetName.length > 0
    && isNameList(value.fields) && isNameList(value.columns) && value.columns.length > 0 && isCount(value.rowCount);
}

function isOperation(value: unknown, columnCount: number): value is HygieneOperation {
  return isRecord(value) && Object.keys(value).every((key) => hygieneOptions.has(key))
    && Array.isArray(value.columns) && value.columns.length > 0 && new Set(value.columns).size === value.columns.length
    && Array.from(value.columns).every((index) => isCount(index) && index < columnCount)
    && (value.find === undefined || typeof value.find === 'string')
    && (value.replace === undefined || typeof value.find === 'string' && typeof value.replace === 'string')
    && booleanOptions.every((key) => value[key] === undefined || typeof value[key] === 'boolean');
}

function isHygieneSummary(value: unknown, source: BatchDraftSource): value is HygieneSummary {
  return isRecord(value) && Object.keys(value).length === 3 && isOperation(value.operation, source.columns.length)
    && isCount(value.affectedRows) && value.affectedRows > 0 && value.affectedRows <= source.rowCount
    && isCount(value.affectedCells) && value.affectedCells >= value.affectedRows
    && value.affectedCells <= value.affectedRows * value.operation.columns.length;
}

function validateBatchDraft(data: unknown): BatchDraft {
  const invalid = () => new Error('invalid-batch-draft');
  if (!isRecord(data) || Object.keys(data).length !== 7 || data.kind !== 'arabiform-batch-draft' || data.version !== 1
    || !isSource(data.source) || !isRecord(data.edits) || !Array.isArray(data.hygiene)
    || (data.customFontSha256 !== null && !isHash(data.customFontSha256))) throw invalid();

  const { source, customFontSha256 } = data;
  const fieldNames = new Set(source.fields);
  const columns = new Set(source.columns);
  const settings = validateMappingPreset(data.settings);
  if (!settings || settings.version === 1 || settings.version === 2 || settings.version === 3
    || Object.entries(settings.mapping).some(([field, column]) => !fieldNames.has(field) || column !== '' && !columns.has(column))
    || 'virtualMappings' in settings && Object.keys(settings.virtualMappings).some((field) => !fieldNames.has(field))
    || 'groupByColumn' in settings && settings.groupByColumn !== null && !columns.has(settings.groupByColumn)) throw invalid();
  if ('conditionalRules' in settings && settings.conditionalRules.some((rule) =>
    !(Object.hasOwn(settings.mapping, rule.field) && settings.mapping[rule.field] || Object.hasOwn(settings.virtualMappings, rule.field))
    || conditionalRuleColumns(rule).some((column) => !columns.has(column)))) throw invalid();

  const edits: [number, Record<string, string>][] = [];
  for (const [index, values] of Object.entries(data.edits)) {
    const row = Number(index);
    if (!isCount(row) || row >= source.rowCount || String(row) !== index || !isRecord(values)) throw invalid();
    const cells: [string, string][] = [];
    for (const [column, value] of Object.entries(values)) {
      if (!columns.has(column) || typeof value !== 'string') throw invalid();
      cells.push([column, value]);
    }
    if (!cells.length) throw invalid();
    edits.push([row, Object.fromEntries(cells)]);
  }
  const hygiene: HygieneSummary[] = [];
  for (const summary of data.hygiene) {
    if (!isHygieneSummary(summary, source)) throw invalid();
    hygiene.push(summary);
  }
  return { kind: data.kind, version: data.version, source, edits: Object.fromEntries(edits), hygiene, settings, customFontSha256 };
}

function sameNames(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((name, index) => name === second[index]);
}

export function serializeBatchDraft(draft: BatchDraft): string {
  return JSON.stringify(validateBatchDraft(draft), null, 2);
}

export function parseBatchDraft(text: string, source: BatchDraftSource, activeCustomFontSha256?: string): BatchDraft {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new Error('invalid-batch-draft', { cause });
  }
  const draft = validateBatchDraft(data);
  const saved = draft.source;
  if (saved.templateSha256 !== source.templateSha256 || saved.rosterSha256 !== source.rosterSha256
    || saved.sheetName !== source.sheetName || saved.rowCount !== source.rowCount
    || !sameNames(saved.fields, source.fields) || !sameNames(saved.columns, source.columns)) throw new Error('batch-draft-source-mismatch');
  if (draft.customFontSha256 !== null && draft.customFontSha256 !== activeCustomFontSha256) throw new Error('batch-draft-custom-font-mismatch');
  return draft;
}
