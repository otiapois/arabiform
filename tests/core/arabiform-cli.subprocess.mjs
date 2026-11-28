import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import Papa from 'papaparse';
import { decodePDFRawStream, PDFArray, PDFDocument, PDFHexString, PDFName, PDFRawStream } from 'pdf-lib';

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

  const m20Template = join(directory, 'Numeral Form.pdf');
  const m20Roster = join(directory, 'Numeral Roster.csv');
  const m20Preset = join(directory, 'M20 Preset.json');
  const m20Out = join(directory, 'Approved Records');
  const m20Block = join(directory, 'Approval Collision');
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 320]);
  doc.getForm().createTextField('Date').addToPage(page, { x: 70, y: 180, width: 118, height: 30 });
  doc.getForm().createTextField('ID').addToPage(page, { x: 70, y: 138, width: 118, height: 30 });
  await writeFile(m20Template, await doc.save());
  await writeFile(m20Roster, 'Date,ID\r\n00123,00123\r\n');
  const labelAr = 'مَكْتَبُ السِّجِلَّاتِ';
  const preset = { version: 10, mapping: { Date: 'Date', ID: 'ID' }, filenamePattern: '{{ID}}.pdf', minFontSize: 8, font: 'auto',
    flattenZip: false, includeCoverSheet: false, alignOverrides: {}, watermark: { kind: 'none' }, virtualMappings: {},
    qrStamp: { placement: 'bottom-right', sizePt: 48, pattern: '{{ID}}' }, coverLanguage: 'auto', imposition: '1-up', groupByColumn: null,
    fieldTypography: { Date: { numeralPolicy: 'eastern-arabic', paddingPt: 4 }, ID: { numeralPolicy: 'western-ascii' } },
    approvalSeal: { placement: 'top-left', labelEn: 'Records Office', labelAr, issueDate: '2028-02-29' } };
  const m20Inputs = ['--template', m20Template, '--roster', m20Roster, '--preset', m20Preset, '--strict'];
  await writeFile(m20Preset, JSON.stringify(preset));
  assert.equal(run(0, '--mode', 'fill', ...m20Inputs, '--out-dir', m20Out).status, 'clean');
  const [editablePdf, printablePdf] = await Promise.all(['arabiform-editable.zip', 'arabiform-flattened.zip'].map(async (zip) => {
    const members = unzipSync(await readFile(join(m20Out, zip)));
    assert.deepEqual(Object.keys(members), ['00123.pdf']);
    return PDFDocument.load(members['00123.pdf']);
  }));
  assert.equal(editablePdf.getForm().getTextField('Date').getText(), '٠٠١٢٣');
  assert.equal(editablePdf.getForm().getTextField('ID').getText(), '00123');
  const sealText = '/ActualText ' + PDFHexString.fromText(labelAr).toString();
  function pageHasApprovalSeal(pdf) {
    const content = pdf.getPage(0).node.Contents();
    return content instanceof PDFArray && content.asArray().some((ref) => {
      const stream = pdf.context.lookup(ref);
      return stream instanceof PDFRawStream && new TextDecoder().decode(decodePDFRawStream(stream).decode()).includes(sealText);
    });
  }
  assert(!pageHasApprovalSeal(editablePdf));
  assert(pageHasApprovalSeal(printablePdf));
  assert(pageHasApprovalSeal(await PDFDocument.load(await readFile(join(m20Out, 'arabiform-merged.pdf')))));
  await writeFile(m20Preset, JSON.stringify({ ...preset, qrStamp: { ...preset.qrStamp, placement: 'top-left' } }));
  const m20Blocked = run(2, '--mode', 'fill', ...m20Inputs, '--out-dir', m20Block);
  assert.deepEqual(m20Blocked.issues.map(({ code, pageNumber }) => [code, pageNumber]), [['approval-seal-qr-overlap', 1]]);
  await assert.rejects(lstat(m20Block), { code: 'ENOENT' });

  const flagged = ['--template', 'fixtures/golden/template.pdf', '--roster', 'fixtures/golden/roster.csv'];
  assert.equal(run(2, '--mode', 'fill', ...flagged, '--strict', '--out-dir', strict).status, 'flagged');
  await assert.rejects(lstat(strict), { code: 'ENOENT' });
  assert.equal(run(2, '--mode', 'preflight', ...flagged, '--out-dir', join(directory, 'Flagged')).flagged, 1);
  assert.equal(run(2, '--mode', 'preflight', '--template', 'fixtures/golden/xfa.pdf', '--roster',
    'fixtures/golden/roster.csv', '--out-dir', join(directory, 'Blocked')).issues[0].code, 'xfa-unsupported');

  const hr = 'fixtures/m4/multi-page-hr-choices.pdf';
  const clinic = 'fixtures/m3/clinic-consent-mixed.pdf';
  const clinicRoster = 'fixtures/m3/clinic-consent-roster.csv';
  const mappings = join(directory, 'packet-mappings.json');
  const packetOut = join(directory, 'Ready Packets');
  const packetArgs = ['--mode', 'packet', '--template', hr, '--template', clinic, '--mappings', mappings];
  await writeFile(mappings, JSON.stringify([{ Employee: 'Name' }, { Name: 'Name', ID: 'ID', Consent: 'Consent' }]));
  const partial = run(2, ...packetArgs, '--roster', clinicRoster, '--cover', '--group-by', 'Consent', '--out-dir', packetOut);
  assert.equal(partial.status, 'flagged');
  assert.equal(partial.ready, 2);
  const held = partial.rows[2];
  assert.equal(held.status, 'flagged');
  assert.deepEqual(held.issues.map(({ templateIndex, templateName, fieldName, code }) => [templateIndex, templateName, fieldName, code]),
    [[2, 'clinic-consent-mixed.pdf', 'Consent', 'invalid-checkbox-value']]);
  assert.deepEqual(partial.outputs, ['arabiform-packets.zip', 'packet-custody-manifest.json']);
  const packets = unzipSync(await readFile(join(packetOut, 'arabiform-packets.zip')));
  const receipt = await readJson(join(packetOut, 'packet-custody-manifest.json'));
  assert.deepEqual(receipt.sources.templates.map(({ sha256 }) => sha256), await Promise.all([hr, clinic].map(async (path) => hash(await readFile(path)))));
  assert.equal(receipt.sources.roster.sha256, hash(await readFile(clinicRoster)));
  assert.deepEqual(Object.keys(packets), receipt.outputs.map(({ path }) => path));
  assert.deepEqual(receipt.outputs.map(({ rowNumber, filename }) => [rowNumber, filename]), [[1, '00001-packet.pdf'], [2, '00002-packet.pdf']]);
  for (const output of receipt.outputs) {
    const bytes = packets[output.path];
    assert(output.path.includes('/'));
    assert.equal(hash(bytes), output.sha256);
    assert.deepEqual(output.documents.map(({ startPage, pageCount }) => [startPage, pageCount]), [[2, 2], [4, 1]]);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 4);
    assert(!pdf.catalog.has(PDFName.of('AcroForm')));
  }
  const packetCleanRoster = join(directory, 'packet-clean.csv');
  await writeFile(packetCleanRoster, 'Name,ID,Consent\r\nMohammed,00123,yes\r\n');
  assert.equal(run(0, ...packetArgs, '--roster', packetCleanRoster, '--out-dir', join(directory, 'Clean Packet')).status, 'clean');
  const packetHeldRoster = join(directory, 'packet-held.csv');
  const packetHeldOut = join(directory, 'All Packets Held');
  await writeFile(packetHeldRoster, 'Name,ID,Consent\r\nMohammed,00123,review\r\n');
  assert.equal(run(2, ...packetArgs, '--roster', packetHeldRoster, '--out-dir', packetHeldOut).ready, 0);
  await assert.rejects(lstat(packetHeldOut), { code: 'ENOENT' });
  const packetBlockedOut = join(directory, 'Packet Intake Blocked');
  const packetBlocked = run(2, '--mode', 'packet', '--template', hr, '--template', clinic, '--template', 'fixtures/golden/xfa.pdf',
    '--roster', clinicRoster, '--out-dir', packetBlockedOut);
  assert.deepEqual(packetBlocked.issues.map(({ templateIndex, templateName, code }) => [templateIndex, templateName, code]), [[3, 'xfa.pdf', 'xfa-unsupported']]);
  await assert.rejects(lstat(packetBlockedOut), { code: 'ENOENT' });

  const m22Roster = join(directory, 'Synthetic VIP Roster.csv');
  const m22Preset = join(directory, 'M22 Preset.json');
  const m22Preflight = join(directory, 'M22 Diagnostics');
  const m22Filled = join(directory, 'M22 Filled');
  const m22Held = join(directory, 'M22 Held');
  await writeFile(m22Roster, 'Name,ID,Consent,Role\r\nOriginal,00123,no,VIP\r\nOrdinary,00007,no,Standard\r\n');
  const conditionalRules = [
    { field: 'Name', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-text', value: 'مُعْتَمَد / VIP {{ID}}' } },
    { field: 'Consent', column: 'Role', operator: 'equals', operand: 'VIP', action: { type: 'set-checkbox', checked: true } },
  ];
  const conditionalPreset = { ...preset, version: 11, mapping: { Name: 'Name', Consent: 'Consent' },
    qrStamp: { placement: 'none' }, fieldTypography: { Name: { numeralPolicy: 'eastern-arabic' } }, approvalSeal: null, conditionalRules };
  await writeFile(m22Preset, JSON.stringify(conditionalPreset));
  const m22Inputs = ['--template', clinic, '--roster', m22Roster, '--preset', m22Preset];
  const applied = [[{ field: 'Name', ruleIndex: 1 }, { field: 'Consent', ruleIndex: 2 }], []];
  const checked = run(0, '--mode', 'preflight', ...m22Inputs, '--out-dir', m22Preflight);
  assert.deepEqual(checked.rows.map(({ ruleApplied }) => ruleApplied), applied);
  const savedJson = await readJson(join(m22Preflight, 'arabiform-preflight.json'));
  assert.deepEqual(savedJson.rows.map(({ ruleApplied }) => ruleApplied), applied);
  const csv = Papa.parse(await readFile(join(m22Preflight, 'arabiform-preflight.csv'), 'utf8'), { header: true, skipEmptyLines: true });
  assert.deepEqual(csv.data.map(({ ruleApplied }) => JSON.parse(ruleApplied)), applied);
  const filled = run(0, '--mode', 'fill', ...m22Inputs, '--strict', '--out-dir', m22Filled);
  assert.deepEqual(filled.rows.map(({ ruleApplied }) => ruleApplied), applied);
  const actual = unzipSync(await readFile(join(m22Filled, 'arabiform-editable.zip')));
  assert.deepEqual(Object.keys(actual), ['00123.pdf', '00007.pdf']);
  for (const [index, bytes] of Object.values(actual).entries()) {
    const form = (await PDFDocument.load(bytes)).getForm();
    assert.equal(form.getTextField('Name').getText(), index === 0 ? 'مُعْتَمَد / VIP ٠٠١٢٣' : 'Ordinary');
    const checkbox = form.getCheckBox('Consent');
    assert.equal(checkbox.acroField.dict.get(PDFName.of('V')).toString(), index === 0 ? '/Yes' : '/Off');
    assert.deepEqual(checkbox.acroField.getWidgets().map((widget) => widget.getAppearanceState()?.toString()), index === 0 ? ['/Yes', '/Yes'] : ['/Off', '/Off']);
    assert.equal(form.getTextField('Sentinel').getText(), 'KEEP 00109');
  }
  await writeFile(m22Preset, JSON.stringify({ ...conditionalPreset, conditionalRules: [
    { ...conditionalRules[0], action: { type: 'set-text', value: '{{id}}' } }, conditionalRules[1],
  ] }));
  const invalid = run(2, '--mode', 'fill', ...m22Inputs, '--strict', '--out-dir', m22Held);
  assert.deepEqual(invalid.rows.map(({ diagnostics }) => diagnostics), Array(2).fill([
    { field: 'Name', code: 'invalid-conditional-rule', pageNumbers: [1], ruleIndex: 1 },
  ]));
  await assert.rejects(lstat(m22Held), { code: 'ENOENT' });

  const oldOffer = 'fixtures/m23/2026-offer.pdf';
  const newOffer = 'fixtures/m23/2027-offer.pdf';
  const diffArgs = ['--mode', 'diff-template', '--old', oldOffer, '--new'];
  const presetArgs = ['--preset', 'fixtures/m23/offer-preset-v11.json'];
  const cleanDiff = run(0, ...diffArgs, oldOffer, ...presetArgs, '--out-dir', join(directory, 'M23 Compatible'));
  assert.equal(cleanDiff.status, 'clean');
  assert.equal(cleanDiff.oldSha256, cleanDiff.newSha256);
  const heldDiffDir = join(directory, 'M23 Unmapped');
  const heldDiff = run(2, ...diffArgs, newOffer, ...presetArgs, '--out-dir', heldDiffDir);
  assert.equal(heldDiff.presetStatus, 'blocked');
  assert.equal(heldDiff.diagnostics[0].code, 'missing-target');
  assert.deepEqual(await readdir(heldDiffDir), ['template-migration-report.csv', 'template-migration-report.json']);
  const diffDir = join(directory, 'M23 Migrated');
  const revised = run(2, ...diffArgs, newOffer, ...presetArgs, '--rename-map', 'fixtures/m23/offer-rename-map.json', '--out-dir', diffDir);
  assert.equal(revised.presetStatus, 'ready');
  assert.deepEqual(revised.appliedRenames, [{ field: 'FullName', target: 'EmployeeFullName' }]);
  assert.equal(revised.geometryChangedFields[0].widthDeltaPt, -22);
  assert.equal(revised.oldSha256, hash(await readFile(join(root, oldOffer))));
  assert.equal(revised.newSha256, hash(await readFile(join(root, newOffer))));
  const migrated = join(diffDir, 'migrated-preset.json');
  assert.equal((await readJson(migrated)).version, 11);
  const offerInputs = ['--template', newOffer, '--preset', migrated, '--roster', 'fixtures/m23/offer-roster.csv'];
  assert.equal(run(0, '--mode', 'preflight', ...offerInputs, '--out-dir', join(directory, 'M23 Preflight')).ready, 2);

  const staleDiff = join(directory, 'M23 Stale');
  await mkdir(staleDiff);
  await writeFile(join(staleDiff, 'migrated-preset.json'), 'previous');
  assert.match(run(1, ...diffArgs, newOffer, ...presetArgs, '--out-dir', staleDiff).message, /already exists/);
  assert.deepEqual(await readdir(staleDiff), ['migrated-preset.json']);
  assert.equal(await readFile(join(staleDiff, 'migrated-preset.json'), 'utf8'), 'previous');
  const blockedDiffDir = join(directory, 'M23 Rejected New');
  const blocked = run(2, ...diffArgs, 'fixtures/golden/encrypted.pdf', '--out-dir', blockedDiffDir);
  assert.deepEqual(blocked.issues, [{ side: 'new', code: 'encrypted-pdf' }]);
  await assert.rejects(lstat(blockedDiffDir), { code: 'ENOENT' });

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
  console.log('Real subprocess checks passed for all seven modes, exact custody, M20 typography and seal, M21 packet exit 0/2, M22 v11 Arabic and checkbox /V, M23 template diff exit 0/2 and v11 migration, strict no-output refusal, and output-path guards.');
} finally {
  const actual = await realpath(directory);
  assert.equal(dirname(actual), tmp);
  await rm(actual, { recursive: true });
}
