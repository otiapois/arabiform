import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const entry = fileURLToPath(new URL('../../scripts/arabiform-cli.ts', import.meta.url));
const tmp = await realpath(tmpdir());
assert(process.platform !== 'win32' || /^D:\\/i.test(tmp), 'Set TEMP/TMP to the D drive before running subprocess checks.');
const directory = await mkdtemp(join(tmp, 'arabiform-cli-'));
const root = fileURLToPath(new URL('../../', import.meta.url));

function run(code, ...flags) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry, ...flags], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, code, JSON.stringify({ flags, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout || result.stderr);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const studio = join(directory, 'Studio Assets');
const out = join(directory, 'Exported Records');
const reports = join(directory, 'Reports');
const extracts = join(directory, 'Extracts');
const template = join(studio, 'visitor-badge-a6.pdf');
const roster = join(studio, 'visitor-badge-a6-synthetic-sample.csv');
const manifestPath = join(out, 'custody-manifest.json');
const strict = join(directory, 'Strict Block');

try {
  assert.deepEqual(run(0, '--mode', 'studio', '--template', 'visitor-badge-a6', '--out-dir', studio).outputs, [
    'visitor-badge-a6.pdf', 'visitor-badge-a6-synthetic-sample.csv',
  ]);
  const inputs = ['--template', template, '--roster', roster, '--date', '2026-11-27'];
  assert.equal(run(0, '--mode', 'preflight', ...inputs, '--out-dir', reports).status, 'clean');
  assert.equal((await readJson(join(reports, 'arabiform-preflight.json'))).flagged, 0);

  assert.equal(run(0, '--mode', 'fill', ...inputs, '--strict', '--out-dir', out, '--imposition', '2-up', '--cover',
    '--watermark', 'DRAFT', '--qr', '--group-by', 'Organization').status, 'clean');
  const manifest = await readJson(manifestPath);
  assert.equal(manifest.version, 2);
  for (const [name, entries, variant] of [
    ['arabiform-editable.zip', manifest.entries, 'editable'], ['arabiform-flattened.zip', manifest.flattenedEntries, 'flattened'],
  ]) {
    const archived = unzipSync(await readFile(join(out, name)));
    assert.deepEqual(Object.keys(archived), entries.map(({ zipPath }) => zipPath));
    const pdfs = [];
    for (const [index, entry] of entries.entries()) {
      const bytes = archived[entry.zipPath];
      assert.equal(bytes.length, entry.bytes);
      assert.equal(hash(bytes), entry.sha256);
      // Write in inverse file order to check directory ingestion's sort rule.
      const pdf = join(directory, variant, (entries.length - index) + '-' + entry.filename);
      await mkdir(dirname(pdf), { recursive: true });
      await writeFile(pdf, bytes);
      pdfs.push(pdf);
    }
    const verified = run(0, '--mode', 'verify', '--manifest', manifestPath, '--variant', variant, ...pdfs);
    assert(verified.verdicts.every((verdict) => verdict.variant === variant));
    const wrong = run(2, '--mode', 'verify', '--manifest', manifestPath, '--variant',
      variant === 'editable' ? 'flattened' : 'editable', ...pdfs);
    assert(wrong.verdicts.every((verdict) => verdict.status !== 'VERIFIED_EXACT_MATCH'));
    if (variant === 'editable') {
      const extract = run(0, '--mode', 'extract', '--in-dir', dirname(pdfs[0]), '--out-dir', extracts);
      assert.equal(extract.total, pdfs.length);
      const audit = await readJson(join(extracts, 'extraction-audit.json'));
      assert.deepEqual(audit.rows.map(({ filename }) => filename), pdfs.map((path) => path.slice(dirname(path).length + 1)).sort());
      const csv = await readFile(join(extracts, 'arabiform-extracted.csv'));
      assert.deepEqual([...csv.subarray(0, 3)], [239, 187, 191]);
      assert.equal(audit.csvSha256, hash(csv));
      assert.equal(audit.xlsxSha256, hash(await readFile(join(extracts, 'arabiform-extracted.xlsx'))));
      const delivered = entryFile(entries[0]);
      const altered = Uint8Array.from(archived[entries[0].zipPath]);
      altered[5] ^= 1;
      await writeFile(delivered, altered);
      assert.equal(run(2, '--mode', 'verify', '--manifest', manifestPath, '--variant', 'editable', delivered).status, 'TAMPERED_BYTE_MISMATCH');
    }
  }
  function entryFile(entry) {
    return join(directory, entry.filename);
  }
  const merged = join(out, 'arabiform-merged.pdf');
  assert.equal(hash(await readFile(merged)), manifest.mergedPdfSha256);
  assert.equal(run(0, '--mode', 'verify', '--manifest', manifestPath, merged).verdicts[0].variant, 'merged');
  assert.equal(run(0, '--mode', 'verify', '--manifest', manifestPath, '--qr-payload', manifest.qrRecords[0].payload).status, 'VERIFIED_QR_RECORD');
  assert.equal(run(2, '--mode', 'verify', '--manifest', manifestPath, '--qr-payload', 'invalid').status, 'UNMATCHED_UNKNOWN');

  const flagged = ['--template', 'fixtures/golden/template.pdf', '--roster', 'fixtures/golden/roster.csv'];
  assert.equal(run(2, '--mode', 'fill', ...flagged, '--strict', '--out-dir', strict).status, 'flagged');
  await assert.rejects(lstat(strict), { code: 'ENOENT' });
  assert.equal(run(2, '--mode', 'preflight', ...flagged, '--out-dir', join(directory, 'Flagged')).flagged, 1);
  assert.equal(run(2, '--mode', 'preflight', '--template', 'fixtures/golden/xfa.pdf', '--roster',
    'fixtures/golden/roster.csv', '--out-dir', join(directory, 'Blocked')).issues[0].code, 'xfa-unsupported');

  const reserved = join(directory, 'Reserved');
  await mkdir(reserved);
  await writeFile(join(reserved, 'arabiform-preflight.json'), 'existing');
  assert.match(run(1, '--mode', 'preflight', ...inputs, '--out-dir', reserved).message, /already exists/);
  assert.deepEqual(await readdir(reserved), ['arabiform-preflight.json']);
  assert.equal(await readFile(join(reserved, 'arabiform-preflight.json'), 'utf8'), 'existing');

  const link = join(directory, 'Escape');
  const target = join(directory, 'Target');
  await mkdir(target);
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(run(1, '--mode', 'preflight', ...inputs, '--out-dir', join(link, 'nested')).message, /link, junction/);
  assert.deepEqual(await readdir(target), []);
  assert.equal(run(1, '--mode', 'studio', '--template', 'visitor-badge-a6', '--out-dir', 'safe/../escape').status, 'usage-error');
  console.log('Real subprocess checks passed for all five modes, exact custody, strict output refusal and output-path guards.');
} finally {
  const actual = await realpath(directory);
  assert.equal(dirname(actual), tmp);
  await rm(actual, { recursive: true });
}
