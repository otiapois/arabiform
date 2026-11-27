import type { QrCorner } from './qr-settings';
import { textInputDiagnostic } from './text-input';

export interface ApprovalSealSettings {
  placement: QrCorner;
  labelEn: string;
  labelAr: string;
  issueDate: string;
}

export const MAX_APPROVAL_SEAL_LABEL_CODE_POINTS = 32;

export interface ApprovalSealProblem {
  code: 'approval-seal-invalid-settings' | 'approval-seal-page-too-small' | 'approval-seal-widget-overlap'
    | 'approval-seal-qr-overlap' | 'approval-seal-text-unrenderable';
  pageNumber?: number;
  fieldName?: string;
}

export class ApprovalSealError extends Error implements ApprovalSealProblem {
  readonly code: ApprovalSealProblem['code'];
  readonly pageNumber?: number;
  readonly fieldName?: string;

  constructor({ code, pageNumber, fieldName }: ApprovalSealProblem) {
    super(code);
    this.name = 'ApprovalSealError';
    this.code = code;
    this.pageNumber = pageNumber;
    this.fieldName = fieldName;
  }
}

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && Array.from(value).length <= MAX_APPROVAL_SEAL_LABEL_CODE_POINTS
    && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) && !textInputDiagnostic(value);
}

function isIssueDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateApprovalSealSettings(value: unknown): ApprovalSealSettings | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object' || !value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 4 || !['placement', 'labelEn', 'labelAr', 'issueDate'].every((key) => Object.hasOwn(data, key))) return undefined;
  const { placement, labelEn, labelAr, issueDate } = data;
  if ((placement === 'top-left' || placement === 'top-right' || placement === 'bottom-left' || placement === 'bottom-right')
    && isLabel(labelEn) && isLabel(labelAr) && isIssueDate(issueDate)) return { placement, labelEn, labelAr, issueDate };
}
