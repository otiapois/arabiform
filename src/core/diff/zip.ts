import { Inflate, zipSync } from 'fflate';
import { filenameKey } from '../roster/filenames';
import { BatchDiffError, type BatchDiffCode } from './errors';

const MIB = 1024 * 1024;
export const MAX_BATCH_ZIP_BYTES = 64 * MIB;
const MAX_MEMBER_BYTES = 32 * MIB;
const MAX_EXPANDED_BYTES = 128 * MIB;
const MAX_ENTRIES = 2000;
const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const UTF8 = 0x0800;
const HAS_DESCRIPTOR = 0x0008;
const PORTABLE_EXTRAS = new Set([0x000a, 0x5455, 0x5855, 0x7855, 0x7875]);
const ILLEGAL = /[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9]|CONIN\$|CONOUT\$)(?:[ .]|$)/i;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});

interface BatchZipMember { path: string; key: string; bytes: Uint8Array }
interface ZipHeader {
  path: string;
  key: string;
  directory: boolean;
  name: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  packed: number;
  size: number;
  offset: number;
}

function portablePart(part: string): boolean {
  const compatible = part.normalize('NFKC');
  return Boolean(compatible) && compatible !== '.' && compatible !== '..' && !ILLEGAL.test(compatible)
    && !/[. ]$/.test(compatible) && !DEVICE.test(compatible) && encoder.encode(part).length <= 255;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}

export function readBatchZip(bytes: Uint8Array, batch: BatchDiffError['batch']): BatchZipMember[] {
  const fail = (code: BatchDiffCode, path: string | null = null, cause?: unknown): never => {
    throw new BatchDiffError(batch, code, path, cause);
  };
  if (bytes.length > MAX_BATCH_ZIP_BYTES) fail('zip-limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const checkExtra = (start: number, end: number, path: string) => {
    const seen = new Set<number>();
    while (start < end) {
      if (end - start < 4) fail('invalid-zip', path);
      const tag = u16(start);
      if (!PORTABLE_EXTRAS.has(tag) || seen.has(tag)) fail('invalid-zip', path);
      seen.add(tag);
      start += 4 + u16(start + 2);
      if (start > end) fail('invalid-zip', path);
    }
  };

  let end = bytes.length - 22;
  const searchStart = Math.max(0, end - 0xffff);
  for (; end >= searchStart; end--) {
    if (u32(end) === END && end + 22 + u16(end + 20) === bytes.length) break;
  }
  if (end < searchStart) fail('invalid-zip');
  const total = u16(end + 10);
  const centralStart = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== total || centralStart + u32(end + 12) !== end) fail('invalid-zip');
  if (total > MAX_ENTRIES) fail('zip-limit');
  const headers: ZipHeader[] = [];
  const aliases = new Map<string, { raw: string; directory: boolean; explicit: boolean }>();
  let expanded = 0;
  let cursor = centralStart;
  for (let index = 0; index < total; index++) {
    if (cursor + 46 > end || u32(cursor) !== CENTRAL || u16(cursor + 34)) fail('invalid-zip');
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const crc = u32(cursor + 16);
    const packed = u32(cursor + 20);
    const size = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const nameEnd = cursor + 46 + nameLength;
    const recordEnd = nameEnd + extraLength + u16(cursor + 32);
    if (recordEnd > end || (method !== 0 && method !== 8) || (flags & ~(UTF8 | HAS_DESCRIPTOR | (method === 8 ? 6 : 0)))) fail('invalid-zip');
    const name = bytes.subarray(cursor + 46, nameEnd);
    let path: string;
    try {
      if (!(flags & UTF8) && name.some((byte) => byte >= 128)) fail('unsafe-path');
      path = utf8.decode(name);
    } catch (cause) {
      return fail('unsafe-path', null, cause);
    }
    const directory = path.endsWith('/');
    const relative = directory ? path.slice(0, -1) : path;
    const parts = relative.split('/');
    if (name.length > 4096 || !parts.every(portablePart)) fail('unsafe-path', path);
    const attr = u32(cursor + 38);
    const kind = attr >>> 28;
    if ((attr & 0x08) || (attr & 0x10 && !directory) || (kind && kind !== (directory ? 4 : 8))) fail('unsafe-path', path);
    if (directory ? size !== 0 : !/\.pdf$/i.test(relative)) fail(directory ? 'invalid-zip' : 'non-pdf-entry', path);
    let rawPrefix = '';
    let aliasPrefix = '';
    for (const [partIndex, part] of parts.entries()) {
      rawPrefix += '/' + part;
      aliasPrefix += '/' + filenameKey(part);
      const explicit = partIndex === parts.length - 1;
      const isDirectory = !explicit || directory;
      const prior = aliases.get(aliasPrefix);
      if (prior && (prior.raw !== rawPrefix || prior.directory !== isDirectory || prior.explicit && explicit)) fail('duplicate-path', path);
      aliases.set(aliasPrefix, { raw: rawPrefix, directory: isDirectory, explicit: explicit || prior?.explicit === true });
    }
    checkExtra(nameEnd, nameEnd + extraLength, path);
    expanded += size;
    if (size > MAX_MEMBER_BYTES || expanded > MAX_EXPANDED_BYTES || size > Math.max(MIB, packed * 250)) fail('zip-limit', path);
    if (method === 0 && packed !== size) fail('invalid-zip', path);
    headers.push({ path, key: relative.normalize('NFC'), directory, name, flags, method, crc, packed, size, offset: u32(cursor + 42) });
    cursor = recordEnd;
  }
  if (cursor !== end) fail('invalid-zip');

  const offsets = headers.map(({ offset }) => offset).sort((left, right) => left - right);
  if ((offsets[0] ?? centralStart) !== 0) fail('invalid-zip');
  const recordEnds = new Map(offsets.map((offset, index) => [offset, offsets[index + 1] ?? centralStart]));
  if (recordEnds.size !== total) fail('invalid-zip');
  const members: BatchZipMember[] = [];
  for (const { path, key, directory, name, flags, method, crc, packed, size, offset } of headers) {
    const recordEnd = recordEnds.get(offset)!;
    if (offset + 30 > recordEnd || recordEnd > centralStart || u32(offset) !== LOCAL
      || u16(offset + 6) !== flags || u16(offset + 8) !== method || u16(offset + 26) !== name.length) fail('invalid-zip', path);
    const nameStart = offset + 30;
    const afterName = nameStart + name.length;
    const afterExtra = afterName + u16(offset + 28);
    const afterData = afterExtra + packed;
    if (afterData > recordEnd || !name.every((byte, index) => byte === bytes[nameStart + index])) fail('invalid-zip', path);
    checkExtra(afterName, afterExtra, path);
    const fileHeader = [u32(offset + 14), u32(offset + 18), u32(offset + 22)];
    const expected = [crc, packed, size];
    if (flags & HAS_DESCRIPTOR) {
      if (!fileHeader.every((value, index) => value === 0 || value === expected[index])) fail('invalid-zip', path);
      const marker = recordEnd - afterData === 16 && u32(afterData) === DESCRIPTOR ? 4 : 0;
      if (recordEnd - afterData !== 12 + marker || !expected.every((value, index) => value === u32(afterData + marker + index * 4))) {
        fail('invalid-zip', path);
      }
    } else if (afterData !== recordEnd || !fileHeader.every((value, index) => value === expected[index])) {
      fail('invalid-zip', path);
    }
    const compressed = bytes.subarray(afterExtra, afterData);
    let content = compressed;
    if (method === 8) {
      if (!compressed.length) fail('invalid-zip', path);
      content = new Uint8Array(size);
      let written = 0;
      const inflate = new Inflate((chunk) => {
        if (written + chunk.length > size) fail('invalid-zip', path);
        content.set(chunk, written);
        written += chunk.length;
      });
      try {
        // Feed bounded chunks so a false expanded-size claim cannot cause an unbounded allocation.
        for (let at = 0; at < compressed.length; at += 4096) {
          inflate.push(compressed.subarray(at, at + 4096), at + 4096 >= compressed.length);
        }
      } catch (cause) {
        return fail('invalid-zip', path, cause);
      }
      if (written !== size) fail('invalid-zip', path);
    }
    if (crc32(content) !== crc) fail('invalid-zip', path);
    if (!directory) members.push({ path, key, bytes: content });
  }
  return members;
}

export function writeDeltaZip(members: ReadonlyMap<string, Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(members), { level: 0, mtime: new Date(2000, 0, 1, 12) });
}
