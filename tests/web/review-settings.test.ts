import { describe, expect, it } from 'vitest';
import { resolveVirtualMapping } from '../../src/core/roster/virtual-columns';
import { reviewSourceColumns } from '../../src/core/shaping/redaction';
import { makeBatchInput } from '../../src/web/batch-preflight';
import { planReviewOutput } from '../../src/web/RedactedReview';
import type { BatchSettings } from '../../src/web/useBatch';

describe('review settings in the Fill PDFs workbench', () => {
  it('substitutes private filename tokens and detects raw QR and grouping mirrors', () => {
    const columns = reviewSourceColumns({ ID: 'keep-last-4', Name: 'none' }, [['ID', 'Identity'], ['Name', 'Full name']]);
    const source = { placement: 'top-left', sizePt: 48, pattern: 'C-{{ Identity }}' } as const;
    expect(planReviewOutput(columns, 'form-{{Identity}}.pdf', 'Identity', source)).toEqual({
      pattern: 'row-[[@PADDED_ROW_001]].pdf',
      groupProtected: true,
      qrProtected: true,
    });
    expect(planReviewOutput(columns, '{{Full name}}.pdf', 'Group', { ...source, custodyRecord: true })).toEqual({
      pattern: '{{Full name}}.pdf',
      groupProtected: false,
      qrProtected: false,
    });
  });

  it('leaves source values intact and sends selected policies to shared preflight only while configured', () => {
    const bytes = new Uint8Array();
    const fonts = { arabic: bytes, latin: bytes };
    const input: BatchSettings = {
      template: bytes, templateName: 'sample.pdf', roster: bytes, rosterName: 'sample.csv',
      rows: [{ values: { ID: '0012345678', Name: 'ليلى' }, warnings: [] }],
      mapping: { ID: 'ID', Name: 'Name' }, virtualMappings: {}, localDate: '2026-11-28',
      resolveVirtualMapping, alignOverrides: {}, fieldTypography: {}, minFontSize: 8, font: 'auto',
    };
    expect(makeBatchInput(input, fonts).options).not.toHaveProperty('maskPolicies');
    const policies = { ID: 'keep-last-4' } as const;
    const masked = makeBatchInput({ ...input, maskPolicies: policies }, fonts);
    expect(masked.options.maskPolicies).toBe(policies);
    expect(masked.rows).toEqual([{ ID: '0012345678', Name: 'ليلى' }]);
  });
});
