import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Papa from 'papaparse';
import { degrees, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../../src/core/cli/arguments';
import { dispatchCli } from '../../src/core/cli/dispatch';
import { validateMappingPreset, type MappingPresetV11 } from '../../src/core/draft/mapping-preset';
import { buttonNormal, buttonOnState } from '../../src/core/pdf/choices';
import { buildTemplateMigrationReport, inspectTemplateDiff, migrateTemplatePreset,
  serializeTemplateMigrationReportCsv } from '../../src/core/template/diff-migrator';

const fixture = (name: string) => readFile(`fixtures/m23/${name}`);
const offer = async () => {
  const [old, revised, preset] = await Promise.all([fixture('2026-offer.pdf'), fixture('2027-offer.pdf'), fixture('offer-preset-v11.json')]);
  return { old, revised, preset: JSON.parse(preset.toString('utf8')) as MappingPresetV11 };
};
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const rect = { x: 24, y: 32, width: 90, height: 24, borderWidth: 0 };

describe('template structure', () => {
  it('compares deterministic synthetic versions, hashes exact bytes, and never includes existing field values in reports', async () => {
    const { old, revised } = await offer();
    const diff = await inspectTemplateDiff(old, revised);
    expect(diff).toMatchObject({
      oldSha256: hash(old), newSha256: hash(revised), breaking: true,
      addedFields: [{ name: 'EmployeeFullName', kind: 'text' }], removedFields: [{ name: 'FullName', kind: 'text' }],
      typeChangedFields: [], widgetCountChangedFields: [], widgetAvailabilityChangedFields: [],
      geometryChangedFields: [{
        field: 'EmployeeCode', pageNumber: 1, occurrence: 1, oldWidthPt: 154, newWidthPt: 132, widthDeltaPt: -22,
        oldHeightPt: 32, newHeightPt: 32, heightDeltaPt: 0, shrunk: true,
      }],
      maxLenChangedFields: [{ field: 'EmployeeCode', oldMaxLength: 40, newMaxLength: 28, reduced: true }],
      choiceOptionsChangedFields: [{ field: 'Department', added: [], removed: [{ value: 'ARCHIVE', label: 'Legacy archive' }] }],
    });
    const report = buildTemplateMigrationReport(diff);
    const csv = serializeTemplateMigrationReportCsv(report);
    expect(JSON.stringify(report)).not.toContain('KEEP 00109');
    expect(csv).not.toContain('KEEP 00109');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
    expect(rows.map(({ change }) => change)).toEqual(['summary', 'added', 'removed', 'geometry', 'maxLen', 'choices']);
    expect(rows.every(({ oldSha256, newSha256 }) => oldSha256 === hash(old) && newSha256 === hash(revised))).toBe(true);
    expect(JSON.parse(rows[3]!.details!)).toEqual({ widthDeltaPt: -22, heightDeltaPt: 0, shrunk: true });
    expect(await inspectTemplateDiff(revised, revised)).toMatchObject({
      oldSha256: diff.newSha256, newSha256: diff.newSha256, breaking: false,
      addedFields: [], removedFields: [], typeChangedFields: [], geometryChangedFields: [], maxLenChangedFields: [], choiceOptionsChangedFields: [],
    });
  });

  it.each([
    ['xfa', 'xfa-unsupported'], ['encrypted', 'encrypted-pdf'], ['signed', 'signed-pdf-warning'], ['flat', 'flat-scanned-no-fields'],
    ['invalid', 'invalid-pdf'],
  ])('uses full intake independently on old and new %s files', async (name, code) => {
    const clean = await fixture('2027-offer.pdf');
    const rejected = name === 'invalid' ? Uint8Array.of(1, 2, 3) : await readFile(`fixtures/golden/${name}.pdf`);
    await expect(inspectTemplateDiff(rejected, clean)).rejects.toMatchObject({ side: 'old', code });
    await expect(inspectTemplateDiff(clean, rejected)).rejects.toMatchObject({ side: 'new', code });
    await expect(inspectTemplateDiff(rejected, rejected)).rejects.toMatchObject({ side: 'old', code });
  });

  it('pairs repeated widgets per page, scales with UserUnit, and tracks clipping from crop separately', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page1 = doc.addPage([300, 300]);
    const page2 = doc.addPage([300, 380]);
    const name = doc.getForm().createTextField('Name');
    name.addToPage(page1, rect);
    name.addToPage(page1, { ...rect, y: 90, width: 62, height: 20 });
    name.addToPage(page2, { ...rect, width: 110, height: 33 });
    page2.setRotation(degrees(90));
    page2.setCropBox(10, 10, 250, 270);
    page2.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    const old = await doc.save();
    const widgets = name.acroField.getWidgets();
    widgets[0]!.setRectangle({ ...rect, x: 27, height: 29 });
    widgets[1]!.setRectangle({ ...rect, y: 90, width: 55, height: 20 });
    // Identical raw dimensions, different physical dimensions on this page.
    page2.node.set(PDFName.of('UserUnit'), PDFNumber.of(1.5));
    page2.setRotation(degrees(270));
    page2.setCropBox(40, 20, 220, 260);
    const revised = await doc.save({ updateFieldAppearances: false });
    const diff = await inspectTemplateDiff(old, revised);
    expect(diff.geometryChangedFields).toEqual([
      { field: 'Name', pageNumber: 1, occurrence: 1, oldWidthPt: 90, newWidthPt: 90, widthDeltaPt: 0,
        oldHeightPt: 24, newHeightPt: 29, heightDeltaPt: 5, shrunk: false },
      { field: 'Name', pageNumber: 1, occurrence: 2, oldWidthPt: 62, newWidthPt: 55, widthDeltaPt: -7,
        oldHeightPt: 20, newHeightPt: 20, heightDeltaPt: 0, shrunk: true },
      { field: 'Name', pageNumber: 2, occurrence: 1, oldWidthPt: 220, newWidthPt: 165, widthDeltaPt: -55,
        oldHeightPt: 66, newHeightPt: 49.5, heightDeltaPt: -16.5, shrunk: true },
    ]);
    expect(diff.widgetAvailabilityChangedFields).toEqual([{ field: 'Name', pageNumber: 2, occurrence: 1, oldUsable: true, newUsable: false }]);
    expect(diff.availabilityChangedFields).toMatchObject([{ field: 'Name', oldUsable: true, newUsable: false }]);
    expect(migrateTemplatePreset(diff, { version: 1, mapping: { Name: 'Column' }, filenamePattern: '', minFontSize: 8, font: 'auto' }).diagnostics)
      .toEqual([{ code: 'unusable-target', field: 'Name', target: 'Name' }]);
  });

  it('detects unchanged radio /Opt labels with replaced /AP export states', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([320, 320]);
    const choice = doc.getForm().createRadioGroup('Contact');
    choice.addOptionToPage('Email', page, rect);
    choice.addOptionToPage('Phone', page, { ...rect, x: 134 });
    const old = await doc.save();
    const normal = buttonNormal(choice.acroField.getWidgets()[0]!.dict)!;
    const oldOn = buttonOnState(normal)!;
    normal.set(PDFName.of('Reissued'), normal.get(oldOn)!);
    normal.delete(oldOn);
    const diff = await inspectTemplateDiff(old, await doc.save({ updateFieldAppearances: false }));
    expect(diff.choiceOptionsChangedFields).toEqual([{
      field: 'Contact', oldExportStates: [oldOn.decodeText(), '1'], newExportStates: ['Reissued', '1'],
      oldOptions: [{ value: 'Email', label: 'Email' }, { value: 'Phone', label: 'Phone' }],
      newOptions: [{ value: 'Email', label: 'Email' }, { value: 'Phone', label: 'Phone' }],
      added: [{ value: 'Email', label: 'Email' }], removed: [{ value: 'Email', label: 'Email' }],
    }]);
    expect(diff.breaking).toBe(true);
  });

  it('uses decimal physical dimensions across different fractional origins and retains a small real shrink', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([320, 300]);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(1.25));
    const field = doc.getForm().createTextField('Name');
    field.addToPage(page, rect);
    const raw = field.acroField.getWidgets()[0]!.dict;
    const setBox = (left: number, right: number) => raw.set(PDFName.of('Rect'), doc.context.obj([left, 32.02, right, 59.03]));
    setBox(0.1, 92.11);
    const old = await doc.save({ updateFieldAppearances: false });
    setBox(32.18, 124.19);
    const moved = await doc.save({ updateFieldAppearances: false });
    expect(await inspectTemplateDiff(old, moved)).toMatchObject({ breaking: false, geometryChangedFields: [] });
    setBox(32.18, 124.1899999);
    const revised = await doc.save({ updateFieldAppearances: false });
    expect(await inspectTemplateDiff(old, revised)).toMatchObject({
      breaking: true, geometryChangedFields: [{ oldWidthPt: 115.0125, newWidthPt: 115.012499875, widthDeltaPt: -0.000000125,
        oldHeightPt: 33.7625, newHeightPt: 33.7625, heightDeltaPt: 0, shrunk: true }],
    });
  });

  it('protects CSV field names that spreadsheet software can execute', async () => {
    const { old } = await offer();
    const doc = await PDFDocument.load(old, { updateMetadata: false });
    doc.getForm().createTextField('＝1+1').addToPage(doc.getPage(0), rect);
    const report = buildTemplateMigrationReport(await inspectTemplateDiff(old, await doc.save()));
    expect(report.addedFields).toEqual([{ name: '＝1+1', kind: 'text' }]);
    expect(serializeTemplateMigrationReportCsv(report)).toContain("'＝1+1");
  });
});

describe('explicit preset migration', () => {
  it('requires an operator rename then preserves version 11 settings and rewrites every affected namespace', async () => {
    const { old, revised, preset } = await offer();
    const diff = await inspectTemplateDiff(old, revised);
    const unresolved = migrateTemplatePreset(diff, preset);
    expect(unresolved).toEqual({
      diagnostics: [{ field: 'FullName', target: 'FullName', code: 'missing-target' }],
      renameCandidates: [{ field: 'FullName', targets: ['EmployeeFullName', 'Sentinel'] }], appliedRenames: [],
    });
    const renamed = migrateTemplatePreset(diff, preset, { FullName: 'EmployeeFullName' });
    const next = renamed.preset;
    expect(renamed.diagnostics).toEqual([]);
    expect(renamed.appliedRenames).toEqual([{ field: 'FullName', target: 'EmployeeFullName' }]);
    expect(validateMappingPreset(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(next).toEqual({
      ...preset, mapping: { EmployeeFullName: 'Name', EmployeeCode: 'Code', Department: 'Department', Sentinel: '' },
      alignOverrides: { EmployeeFullName: 'rtl', EmployeeCode: 'ltr' },
      fieldTypography: { EmployeeFullName: preset.fieldTypography.FullName, EmployeeCode: preset.fieldTypography.EmployeeCode },
      conditionalRules: [{ ...preset.conditionalRules[0], field: 'EmployeeFullName' }, preset.conditionalRules[1]],
    });
    expect(preset.mapping.FullName).toBe('Name');
    expect(diff.breaking).toBe(true);
  });

  it('separates unsafe targets, source mismatches, and namespace collisions without guessing or dropping active bindings', async () => {
    const { old, revised, preset } = await offer();
    const doc = await PDFDocument.load(revised, { updateMetadata: false });
    doc.getForm().getTextField('EmployeeFullName').enableReadOnly();
    doc.getForm().createCheckBox('FullName').addToPage(doc.getPage(0), rect);
    doc.getForm().createTextField('Other').addToPage(doc.getPage(0), { ...rect, y: 4 });
    const diff = await inspectTemplateDiff(old, await doc.save());
    expect(diff.typeChangedFields).toEqual([{ field: 'FullName', oldKind: 'text', newKind: 'checkbox' }]);
    for (const [renames, code] of [
      [{}, 'incompatible-target'],
      [{ FullName: 'Department' }, 'incompatible-target'],
      [{ FullName: 'EmployeeFullName' }, 'read-only-target'],
      [{ FullName: 'ReviewReference' }, 'target-collision'],
      [{ FullName: 'Unknown' }, 'missing-target'],
      [{ FullName: 'Other', Typo: 'Other' }, 'unknown-rename-source'],
      [{ FullName: 'Other', Sentinel: 'Other' }, 'unused-rename-source'],
      [[['FullName', 'Other']], 'invalid-rename-map'],
    ] as const) {
      const result = migrateTemplatePreset(diff, preset, renames);
      expect(result.preset).toBeUndefined();
      expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
    }
    expect(migrateTemplatePreset(diff, { ...preset, mapping: { ...preset.mapping, Unlisted: 'Code' } }, { FullName: 'Other' }).diagnostics)
      .toEqual([{ field: 'Unlisted', code: 'missing-source' }]);
    const safe = migrateTemplatePreset(diff, { ...preset, mapping: { ...preset.mapping, Other: '' } }, { FullName: 'Other' });
    expect(safe.preset?.mapping).toEqual({ Other: 'Name', EmployeeCode: 'Code', Department: 'Department', Sentinel: '' });
    expect(safe.renameCandidates).toEqual([{ field: 'FullName', targets: ['Other', 'Sentinel'] }]);
    const virtual = migrateTemplatePreset(diff, { ...preset, mapping: { ...preset.mapping, Other: '' } }, {
      FullName: 'Sentinel', ReviewReference: 'Other',
    });
    expect(virtual.preset?.mapping).toEqual({ Sentinel: 'Name', EmployeeCode: 'Code', Department: 'Department' });
    expect(virtual.preset && 'virtualMappings' in virtual.preset && virtual.preset.virtualMappings)
      .toEqual({ Other: preset.virtualMappings.ReviewReference });
  });

  it('rejects a removed option or a preserved label that now identifies a different canonical export', async () => {
    const { old, revised, preset } = await offer();
    const doc = await PDFDocument.load(revised, { updateMetadata: false });
    doc.getForm().getDropdown('Department').acroField.dict.set(PDFName.of('Opt'), doc.context.obj([
      [PDFString.of('ENG-V2'), PDFString.of('Engineering')], [PDFString.of('OPS'), PDFString.of('Operations')],
    ]));
    const diff = await inspectTemplateDiff(old, await doc.save({ updateFieldAppearances: false }));
    for (const value of ['Engineering', 'ENG', 'ARCHIVE', 'Legacy archive']) {
      const unsafe = { ...preset, conditionalRules: [preset.conditionalRules[0], {
        ...preset.conditionalRules[1], action: { type: 'set-choice', value },
      }] };
      expect(migrateTemplatePreset(diff, unsafe, { FullName: 'EmployeeFullName' }).diagnostics)
        .toEqual([{ code: 'invalid-choice', field: 'Department', target: 'Department', ruleIndex: 2 }]);
    }
    const inactive = { ...preset, conditionalRules: [{ ...preset.conditionalRules[0], field: 'Sentinel' }] };
    expect(migrateTemplatePreset(diff, inactive, { FullName: 'EmployeeFullName' }).diagnostics)
      .toEqual([{ field: 'Sentinel', ruleIndex: 1, code: 'invalid-rule' }]);
  });
});

describe('diff-template CLI', () => {
  it('parses explicit local paths and keeps PDF positional arguments and flags scoped to their modes', () => {
    const args = ['--mode', 'diff-template', '--old', 'Older year.pdf', '--new', 'Revised PDF.pdf', '--out-dir', 'diff'];
    expect(parseCliArgs([...args, '--preset', 'original.json', '--rename-map', 'rename.json'])).toEqual({
      mode: 'diff-template', old: 'Older year.pdf', new: 'Revised PDF.pdf', outDir: 'diff', preset: 'original.json', renameMap: 'rename.json',
    });
    expect(() => parseCliArgs([...args, '--rename-map', 'rename.json'])).toThrow('requires --preset');
    expect(() => parseCliArgs([...args, '--roster', 'test.csv'])).toThrow('unavailable');
    expect(() => parseCliArgs([...args, 'third.pdf'])).toThrow('Unexpected PDF');
    expect(() => parseCliArgs([...args, '--old', 'another.pdf'])).toThrow('Duplicate');
    expect(() => parseCliArgs(args.map((arg) => arg === 'Revised PDF.pdf' ? '../template.pdf' : arg))).toThrow('Unsafe local path');
  });

  it('writes reports for valid comparison only and exports a proven preset even with structural warnings', async () => {
    const { old, revised, preset } = await offer();
    const request = { mode: 'diff-template' as const, old, new: revised, presetJson: JSON.stringify(preset) };
    const compare = (renameMapJson?: string) => dispatchCli({ ...request, renameMapJson });
    const reports = ['template-migration-report.csv', 'template-migration-report.json'];
    const unresolved = await compare();
    expect(unresolved).toMatchObject({ exitCode: 2, report: { status: 'blocked', presetStatus: 'blocked' } });
    expect(unresolved.artifacts.map(({ name }) => name)).toEqual(reports);
    const ready = await compare('{"FullName":"EmployeeFullName"}');
    expect(ready).toMatchObject({ exitCode: 2, report: { status: 'flagged', presetStatus: 'ready' } });
    expect(ready.artifacts.map(({ name }) => name)).toEqual([...reports, 'migrated-preset.json']);
    expect(await compare('{"FullName":"EmployeeCode","Full\u004eame":"EmployeeFullName"}'))
      .toMatchObject({ exitCode: 2, report: { diagnostics: [{ code: 'invalid-rename-map' }] } });
    expect(await compare('{"FullName":')).toMatchObject({ exitCode: 1, artifacts: [], diagnostic: true });
    expect(await dispatchCli({ ...request, new: old })).toMatchObject({ exitCode: 0, report: { status: 'clean', presetStatus: 'ready' } });
    expect(await dispatchCli({ ...request, new: new Uint8Array() })).toMatchObject({ exitCode: 2, artifacts: [],
      report: { issues: [{ code: 'invalid-pdf', side: 'new' }] }, diagnostic: true });
  });
});
