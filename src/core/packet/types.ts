import type { FieldDiagnostic } from '../pdf';
import type { FontBytes } from '../pdf/shaping';
import type { RosterWarning } from '../roster';

export interface PacketTemplate {
  bytes: Uint8Array | ArrayBuffer;
  name: string;
  title?: string;
  mapping?: Readonly<Record<string, string>>;
}

export interface PacketInput {
  templates: readonly PacketTemplate[];
  roster: { bytes: Uint8Array | ArrayBuffer; name: string; sheetName?: string };
  fonts: FontBytes;
  groupByColumn?: string;
  filenamePattern?: string;
  localDate?: string;
  includeCover?: boolean;
}

export interface PacketRunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { phase: 'preflight' | 'assemble'; completed: number; total: number }) => void;
}

export interface PacketIssue extends Partial<Omit<FieldDiagnostic, 'field' | 'code'>> {
  code: string;
  message: string;
  templateIndex?: number;
  templateName?: string;
  fieldName?: string;
  columnName?: string;
}

export interface PacketRow {
  rowNumber: number;
  status: 'ready' | 'flagged';
  filename: string;
  path: string;
  issues: PacketIssue[];
  sourceWarnings: RosterWarning[];
}

interface PacketFingerprint { bytes: number; sha256: string }

export interface PacketDocument {
  templateIndex: number;
  title: string;
  startPage: number;
  pageCount: number;
}

export interface PacketManifest {
  version: 1;
  kind: 'arabiform-packet-custody';
  sources: {
    templates: (PacketFingerprint & { templateIndex: number; name: string; title: string; pageCount: number })[];
    roster: PacketFingerprint & { name: string; sheetName?: string };
  };
  outputs: (PacketFingerprint & { rowNumber: number; filename: string; path: string; pageCount: number; documents: PacketDocument[] })[];
  groupByColumn?: string;
}

export interface PacketOutput {
  zipBytes: Uint8Array;
  manifest: PacketManifest;
  manifestJson: string;
}

export type PacketPreflightResult =
  | { status: 'blocked'; issues: PacketIssue[] }
  | { status: 'checked'; rows: PacketRow[]; ready: number; flagged: number; assemble: (options?: PacketRunOptions) => Promise<PacketOutput> };
