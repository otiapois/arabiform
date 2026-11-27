import { isVirtualColumnId, resolveVirtualColumn } from '../roster/virtual-columns';

// ISO/IEC 18004 Byte mode, level M. These versions have equal-length RS
// blocks within each symbol. Versions 1–6 do not carry version information.
const versions = [
  { data: 16, blocks: 1, parity: 10 },
  { data: 28, blocks: 1, parity: 16 },
  { data: 44, blocks: 1, parity: 26 },
  { data: 64, blocks: 2, parity: 18 },
  { data: 86, blocks: 2, parity: 24 },
  { data: 108, blocks: 4, parity: 16 },
] as const;

const textEncoder = new TextEncoder();

function readPayload(payload: string) {
  if (/[\uD800-\uDFFF]/u.test(payload)) throw new Error('qr-stamp-invalid-payload');
  if (!payload.trim()) throw new Error('qr-stamp-empty-payload');
  if (payload.length > 106) throw new Error('qr-stamp-payload-too-long');
  const bytes = textEncoder.encode(payload);
  const eci = bytes.some((byte) => byte > 127);
  const versionIndex = versions.findIndex(({ data }) => bytes.length * 8 + 12 + (eci ? 12 : 0) <= data * 8);
  if (versionIndex < 0) throw new Error('qr-stamp-payload-too-long');
  return { bytes, eci, versionIndex };
}

export function resolveQrPayload(pattern: string, values: Readonly<Record<string, string>>, rowNumber: number, localDate: string): string {
  // Match only the pattern, so delimiters inside roster values remain literal.
  const tokens = /\{\{([^{}]+)\}\}|\[\[@([^\[\]]+)\]\]|\{\{|\}\}|\[\[@|\]\]/g;
  const payload = pattern.replace(tokens, (_, physical: string | undefined, virtual: string | undefined) => {
    if (physical !== undefined && Object.hasOwn(values, physical)) return values[physical]!;
    const name = virtual ?? physical;
    if (name === undefined) throw new Error('qr-stamp-invalid-payload');
    if (!isVirtualColumnId(name)) throw new Error('qr-stamp-unknown-token');
    return resolveVirtualColumn(name, rowNumber, localDate);
  });
  readPayload(payload);
  return payload;
}

function multiply(a: number, b: number): number {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return result;
}

function generator(degree: number): number[] {
  const coefficients = Array<number>(degree).fill(0);
  coefficients[degree - 1] = 1;
  for (let exponent = 0, root = 1; exponent < degree; exponent++, root = multiply(root, 2)) {
    for (let i = 0; i < degree; i++) {
      coefficients[i] = multiply(coefficients[i]!, root) ^ (coefficients[i + 1] ?? 0);
    }
  }
  return coefficients;
}

function buildCodewords({ bytes, eci, versionIndex }: ReturnType<typeof readPayload>): number[] {
  const { data, blocks, parity } = versions[versionIndex]!;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  if (eci) {
    append(0b0111, 4);
    append(26, 8); // ECI assignment for UTF-8
  }
  append(0b0100, 4);
  append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, data * 8 - bits.length));
  append(0, (8 - bits.length % 8) % 8);

  const payload: number[] = [];
  for (let offset = 0; offset < bits.length; offset += 8) {
    let byte = 0;
    for (let i = 0; i < 8; i++) byte = (byte << 1) | bits[offset + i]!;
    payload.push(byte);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; payload.length < data; i++) payload.push(pads[i % 2]!);

  const blockSize = data / blocks;
  const coefficients = generator(parity);
  const ecc = Array.from({ length: blocks }, (_, block) => {
    const remainder = Array<number>(parity).fill(0);
    for (const byte of payload.slice(block * blockSize, (block + 1) * blockSize)) {
      const lead = byte ^ remainder.shift()!;
      remainder.push(0);
      for (let i = 0; i < parity; i++) remainder[i] = remainder[i]! ^ multiply(coefficients[i]!, lead);
    }
    return remainder;
  });
  const codewords: number[] = [];
  for (let column = 0; column < blockSize; column++) {
    for (let block = 0; block < blocks; block++) codewords.push(payload[block * blockSize + column]!);
  }
  for (let column = 0; column < parity; column++) {
    for (const block of ecc) codewords.push(block[column]!);
  }
  return codewords;
}

function drawFormat(size: number, mask: number, put: (x: number, y: number, dark: boolean) => void) {
  // Level M contributes format bits 00. BCH(15,5) uses generator 0x537.
  let remainder = mask << 10;
  for (let i = 14; i >= 10; i--) if (remainder & (1 << i)) remainder ^= 0x537 << (i - 10);
  const format = ((mask << 10) | remainder) ^ 0x5412;
  const bit = (index: number) => Boolean(format & (1 << index));
  for (let i = 0; i < 6; i++) put(8, i, bit(i));
  put(8, 7, bit(6));
  put(8, 8, bit(7));
  put(7, 8, bit(8));
  for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
  put(8, size - 8, true);
}

const masks = [
  (x: number, y: number) => (x + y) % 2 === 0,
  (_x: number, y: number) => y % 2 === 0,
  (x: number) => x % 3 === 0,
  (x: number, y: number) => (x + y) % 3 === 0,
  (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x: number, y: number) => (x * y) % 2 + (x * y) % 3 === 0,
  (x: number, y: number) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x: number, y: number) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function linePenalty(line: readonly boolean[]): number {
  // N1 scores monochrome runs. N3 uses the 1:1:3:1:1 finder ratio with
  // at least four light units on either side; the symbol border is light.
  const runs: number[] = [];
  let dark = false;
  let length = 0;
  let score = 0;
  for (const module of line) {
    if (module !== dark) {
      runs.push(length);
      if (length >= 5) score += length - 2;
      length = 0;
      dark = module;
    }
    length++;
  }
  if (length >= 5) score += length - 2;
  runs.push(length);
  if (dark) runs.push(line.length);
  else runs[runs.length - 1]! += line.length;
  runs[0]! += line.length;
  for (let i = 1; i + 5 < runs.length; i += 2) {
    const unit = runs[i]!;
    if (runs[i + 1] !== unit || runs[i + 2] !== 3 * unit
      || runs[i + 3] !== unit || runs[i + 4] !== unit) continue;
    const before = runs[i - 1]!;
    const after = runs[i + 5]!;
    if (before >= 4 * unit && after >= unit) score += 40;
    if (after >= 4 * unit && before >= unit) score += 40;
  }
  return score;
}

function matrixPenalty(modules: readonly boolean[][]): number {
  const size = modules.length;
  let dark = 0;
  let score = 0;
  for (let y = 0; y < size; y++) {
    score += linePenalty(modules[y]!) + linePenalty(modules.map((row) => row[y]!));
    for (let x = 0; x < size; x++) {
      const color = modules[y]![x]!;
      if (color) dark++;
      // N2 scores each monochrome 2 × 2 block.
      if (x > 0 && y > 0 && modules[y]![x - 1] === color && modules[y - 1]![x] === color
        && modules[y - 1]![x - 1] === color) score += 3;
    }
  }
  // N4 scores each 5% departure from a half-dark symbol.
  return score + 10 * Math.floor(Math.abs(20 * dark - 10 * size * size) / (size * size));
}

export function encodeQr(payload: string): { version: number; size: number; mask: number; modules: boolean[][] } {
  const input = readPayload(payload);
  const version = input.versionIndex + 1;
  const size = 17 + 4 * version;
  const functionModules: (boolean | undefined)[][] = Array.from({ length: size }, () => Array<boolean | undefined>(size).fill(undefined));
  const put = (x: number, y: number, dark: boolean) => { functionModules[y]![x] = dark; };
  for (let i = 0; i < size; i++) {
    put(i, 6, i % 2 === 0);
    put(6, i, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let y = Math.max(0, cy - 4); y <= Math.min(size - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(size - 1, cx + 4); x++) {
        const ring = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        put(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  if (version > 1) {
    const center = size - 7;
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) put(center + x, center + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
    }
  }
  drawFormat(size, 0, put);
  const codewords = buildCodewords(input);
  const dataModules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  let index = 0;
  let upwards = true;
  for (let right = size - 1; right > 0; right -= 2, upwards = !upwards) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = upwards ? size - 1 - row : row;
      for (const x of [right, right - 1]) {
        if (functionModules[y]![x] !== undefined) continue;
        dataModules[y]![x] = Boolean((codewords[index >>> 3] ?? 0) & (0x80 >>> (index & 7)));
        index++;
      }
    }
  }
  let bestMask = 0;
  let bestScore = Infinity;
  let bestModules: boolean[][] = [];
  for (const [mask, flips] of masks.entries()) {
    const modules = functionModules.map((row, y) => row.map((module, x) => module ?? (dataModules[y]![x] !== flips(x, y))));
    drawFormat(size, mask, (x, y, dark) => { modules[y]![x] = dark; });
    const score = matrixPenalty(modules);
    if (score < bestScore) {
      bestMask = mask;
      bestScore = score;
      bestModules = modules;
    }
  }
  return { version, size, mask: bestMask, modules: bestModules };
}
