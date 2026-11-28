import type { Imposition } from '../pdf/exports';
import { STUDIO_TEMPLATE_IDS, type StudioTemplateId } from '../studio/templates';
import { DEFAULT_WATERMARK_ANGLE, DEFAULT_WATERMARK_OPACITY, validateWatermarkSettings } from '../pdf/watermark-settings';
import type { CustodyVariant } from '../audit/custody';

type BatchFiles = { template: string; roster: string; outDir: string; preset?: string; sheet?: string; groupBy?: string; date?: string };
export type BatchCommandLine =
  | { mode: 'preflight'; files: BatchFiles }
  | { mode: 'fill'; files: BatchFiles; strict: boolean; imposition?: Imposition; cover: boolean; watermark?: string; qr: boolean };
export type CliCommand =
  | { mode: 'help' }
  | BatchCommandLine
  | { mode: 'packet'; templates: string[]; roster: string; outDir: string; mappings?: string; sheet?: string; groupBy?: string; cover: boolean }
  | { mode: 'extract'; outDir: string; source: { inDir: string } | { paths: string[] } }
  | { mode: 'verify'; manifest: string; source: { qrPayload: string } | { paths: string[]; variant?: CustodyVariant } }
  | { mode: 'studio'; template: StudioTemplateId; outDir: string }
  | { mode: 'diff-template'; old: string; new: string; preset?: string; renameMap?: string; outDir: string };

export const CLI_USAGE = [
  'npm run arabiform-cli -- --mode preflight|fill --template <pdf> --roster <csv|xlsx> --out-dir <dir>',
  '  [--preset <json>] [--sheet <name>] [--group-by <header>] [--date YYYY-MM-DD]',
  '  fill only: [--strict] [--imposition 1-up|2-up] [--cover] [--watermark <text>] [--qr]',
  '  --sheet-base64url and --group-by-base64url accept unpadded UTF-8 base64url instead of the literal name.',
  'npm run arabiform-cli -- --mode packet --template <pdf> --template <pdf> [--template <pdf> ...] --roster <csv|xlsx> --out-dir <dir>',
  '  [--mappings <json>] [--sheet <name>] [--group-by <header>] [--cover]',
  '  Packet mappings are an ordered JSON array of field-to-header objects or null for auto-mapping.',
  'npm run arabiform-cli -- --mode studio --template <id> --out-dir <dir>',
  '  studio IDs: ' + STUDIO_TEMPLATE_IDS.join(', '),
  'npm run arabiform-cli -- --mode diff-template --old <pdf> --new <pdf> [--preset <json>] [--rename-map <json>] --out-dir <dir>',
  '  Rename map is a JSON object from old field names to exact new field names. Requires --preset.',
  'npm run arabiform-cli -- --mode extract (--in-dir <dir> | <pdf>...) --out-dir <dir>',
  'npm run arabiform-cli -- --mode verify --manifest <json> ([--variant editable|flattened|merged] <pdf>... | --qr-payload <payload>)',
  'Exit codes: 0 clean, 2 flagged/blocked/unverified, 1 usage or local I/O error.',
].join('\n');

export class CliUsageError extends Error {}

const devices = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9]|LPT[0-9])(?:[ .]|$)/i;

export function isSafeLocalComponent(component: string): boolean {
  const normalized = component.normalize('NFKC');
  return Boolean(normalized) && normalized !== '.' && normalized !== '..'
    && !/[<>:"/\\|?*\p{Cc}\p{Cs}]/u.test(normalized)
    && !/[. ]$/.test(normalized) && !devices.test(normalized);
}

export function isSafeLocalPath(path: string): boolean {
  if (path === '.') return true;
  // Check the literal spelling before a platform path resolver can discard "..".
  const relative = path.replace(/^(?:[A-Za-z]:[\\/]|\.[\\/]|\/)/, '');
  return !/^[\\/]{2}|^\\/.test(path) && relative.split(/[\\/]/).every(isSafeLocalComponent);
}

const batchFlags = ['template', 'roster', 'out-dir', 'preset', 'sheet', 'sheet-base64url', 'group-by', 'group-by-base64url', 'date'];
const flagsByMode = {
  preflight: batchFlags,
  fill: [...batchFlags, 'strict', 'imposition', 'cover', 'watermark', 'qr'],
  packet: ['template', 'roster', 'out-dir', 'mappings', 'sheet', 'sheet-base64url', 'group-by', 'group-by-base64url', 'cover'],
  extract: ['in-dir', 'out-dir'],
  verify: ['manifest', 'qr-payload', 'variant'],
  studio: ['template', 'out-dir'],
  'diff-template': ['old', 'new', 'preset', 'rename-map', 'out-dir'],
};
const valueFlags = new Set(['mode', ...Object.values(flagsByMode).flat()].filter((flag) => !['strict', 'cover', 'qr'].includes(flag)));
const boolFlags = new Set(['strict', 'cover', 'qr']);

export function cliWatermark(text: string) {
  return validateWatermarkSettings({ kind: 'custom', text, opacity: DEFAULT_WATERMARK_OPACITY, angle: DEFAULT_WATERMARK_ANGLE });
}

function nameOption(literal: string | undefined, encoded: string | undefined, flag: string) {
  if (literal !== undefined && encoded !== undefined) throw new CliUsageError('Use either --' + flag + ' or --' + flag + '-base64url.');
  if (encoded === undefined) {
    if (literal !== undefined && !literal.trim()) throw new CliUsageError('Expected a nonblank name for --' + flag + '.');
    return literal;
  }
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    if (btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== encoded) throw new Error();
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    if (!decoded.trim()) throw new Error();
    return decoded;
  } catch {
    throw new CliUsageError('Invalid UTF-8 base64url for --' + flag + '-base64url.');
  }
}

export function parseCliArgs(args: readonly string[]): CliCommand {
  if (args.length === 1 && args[0] === '--help') return { mode: 'help' };
  const values = new Map<string, string>();
  const paths: string[] = [];
  const templates: string[] = [];
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!positional && arg === '--') {
      positional = true;
    } else if (!positional && arg.startsWith('-')) {
      const flag = arg.slice(2);
      if (!arg.startsWith('--') || (!valueFlags.has(flag) && !boolFlags.has(flag))) throw new CliUsageError('Unknown option ' + arg + '.');
      if (values.has(flag) && flag !== 'template') throw new CliUsageError('Duplicate option ' + arg + '.');
      if (boolFlags.has(flag)) {
        values.set(flag, '');
      } else {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new CliUsageError('Missing value for ' + arg + '.');
        if (flag === 'template') templates.push(value);
        values.set(flag, value);
      }
    } else {
      paths.push(arg);
    }
  }
  const mode = values.get('mode');
  if (mode !== 'preflight' && mode !== 'fill' && mode !== 'packet' && mode !== 'extract' && mode !== 'verify' && mode !== 'studio'
    && mode !== 'diff-template') {
    throw new CliUsageError('Choose --mode preflight, fill, packet, extract, verify, studio, or diff-template.');
  }
  if (mode !== 'packet' && templates.length > 1) throw new CliUsageError('Duplicate option --template.');
  for (const flag of values.keys()) {
    if (flag !== 'mode' && !flagsByMode[mode].includes(flag)) throw new CliUsageError('--' + flag + ' is unavailable in ' + mode + ' mode.');
  }
  if (paths.length && mode !== 'extract' && mode !== 'verify') throw new CliUsageError('Unexpected PDF arguments in ' + mode + ' mode.');

  const required = (flag: string) => {
    const value = values.get(flag);
    if (value === undefined) throw new CliUsageError('Missing --' + flag + '.');
    return value;
  };
  const pathValue = (value: string, label: string, extension?: RegExp) => {
    if (!isSafeLocalPath(value)) throw new CliUsageError('Unsafe local path for ' + label + '.');
    if (extension && !extension.test(value)) throw new CliUsageError('Unexpected file extension for ' + label + '.');
    return value;
  };
  const optionalPath = (flag: string, extension?: RegExp) => {
    const value = values.get(flag);
    return value === undefined ? undefined : pathValue(value, '--' + flag, extension);
  };
  if (mode === 'verify') {
    const manifest = pathValue(required('manifest'), '--manifest', /\.json$/i);
    const qrPayload = values.get('qr-payload');
    const variant = values.get('variant');
    if (variant !== undefined && variant !== 'editable' && variant !== 'flattened' && variant !== 'merged') {
      throw new CliUsageError('Expected editable, flattened, or merged for --variant.');
    }
    if (qrPayload !== undefined ? paths.length || variant : !paths.length) {
      throw new CliUsageError('Provide PDF arguments or --qr-payload. --variant applies only to PDFs.');
    }
    return { mode, manifest, source: qrPayload !== undefined ? { qrPayload } : {
      paths: paths.map((path) => pathValue(path, 'PDF', /\.pdf$/i)), variant,
    } };
  }
  const outDir = pathValue(required('out-dir'), '--out-dir');
  if (mode === 'diff-template') {
    const preset = optionalPath('preset', /\.json$/i);
    const renameMap = optionalPath('rename-map', /\.json$/i);
    if (renameMap && !preset) throw new CliUsageError('--rename-map requires --preset.');
    return { mode, outDir, preset, renameMap,
      old: pathValue(required('old'), '--old', /\.pdf$/i), new: pathValue(required('new'), '--new', /\.pdf$/i) };
  }
  if (mode === 'extract') {
    const inDir = optionalPath('in-dir');
    if (inDir !== undefined ? paths.length : !paths.length) throw new CliUsageError('Provide either --in-dir or 1 to 200 PDF paths.');
    if (paths.length > 200) throw new CliUsageError('Extract accepts 1 to 200 PDF files.');
    return { mode, outDir, source: inDir === undefined ? {
      paths: paths.map((path) => pathValue(path, 'PDF', /\.pdf$/i)),
    } : { inDir } };
  }
  const template = mode === 'packet' ? undefined : required('template');
  if (mode === 'studio') {
    const id = STUDIO_TEMPLATE_IDS.find((candidate) => candidate === template);
    if (!id) throw new CliUsageError('Unknown studio template ID.');
    return { mode, template: id, outDir };
  }
  const roster = pathValue(required('roster'), '--roster', /\.(?:csv|xlsx)$/i);
  const sheet = nameOption(values.get('sheet'), values.get('sheet-base64url'), 'sheet');
  if (sheet !== undefined && !/\.xlsx$/i.test(roster)) throw new CliUsageError('--sheet applies only to .xlsx rosters.');
  const groupBy = nameOption(values.get('group-by'), values.get('group-by-base64url'), 'group-by');
  if (mode === 'packet') {
    if (templates.length < 2 || templates.length > 4) throw new CliUsageError('Supply 2 to 4 ordered --template paths.');
    return { mode, templates: templates.map((path) => pathValue(path, '--template', /\.pdf$/i)),
      roster, outDir, mappings: optionalPath('mappings', /\.json$/i), sheet, groupBy, cover: values.has('cover') };
  }
  const date = values.get('date');
  if (date !== undefined) {
    const parsed = new Date(date + 'T00:00:00.000Z');
    if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new CliUsageError('Expected a valid YYYY-MM-DD for --date.');
    }
  }
  const files = { template: pathValue(template!, '--template', /\.pdf$/i), roster, outDir, preset: optionalPath('preset', /\.json$/i), sheet, groupBy, date };
  if (mode === 'preflight') return { mode, files };
  const imposition = values.get('imposition');
  if (imposition !== undefined && imposition !== '1-up' && imposition !== '2-up') throw new CliUsageError('Expected 1-up or 2-up for --imposition.');
  const watermark = values.get('watermark');
  if (watermark !== undefined && !cliWatermark(watermark)) throw new CliUsageError('Invalid --watermark text. Use 1 to 32 printable characters.');
  return { mode, files, strict: values.has('strict'), imposition, cover: values.has('cover'), watermark, qr: values.has('qr') };
}
