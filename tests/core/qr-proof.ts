import assert from 'node:assert/strict';

const formats = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
const layouts = [[1, 16, 10], [1, 28, 16], [1, 44, 26], [2, 32, 18], [2, 43, 24], [4, 27, 16]] as const;
const exponents = [1];
const logarithms = Array<number>(256);
for (let power = 0; power < 255; power++) {
  const value = exponents[power]!;
  logarithms[value] = power;
  exponents.push(value < 128 ? value * 2 : (value * 2) ^ 285);
}

function unmask(bit: boolean, mask: number, row: number, col: number): number {
  const product = row * col;
  const residues = [(row + col) & 1, row & 1, col % 3, (row + col) % 3, ((row >> 1) + Math.trunc(col / 3)) & 1,
    product % 2 + product % 3, (product % 2 + product % 3) & 1, ((row + col) % 2 + product % 3) & 1];
  return Number(bit) ^ Number(residues[mask] === 0);
}

/** Read the QR symbol back from its modules using a separate implementation. */
export function proveQrMatrix(symbol: { version: number; size: number; mask: number; modules: boolean[][] }, expected: string): void {
  const { size, version, mask, modules } = symbol;
  assert.equal(size, 17 + version * 4);
  assert.equal(modules.length, size);
  assert(modules.every((row) => row.length === size && row.every((cell) => typeof cell === 'boolean')));
  const format = formats[mask];
  assert.notEqual(format, undefined);
  const formatA = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const formatB = Array.from({ length: 15 }, (_, i) => i < 8 ? [size - i - 1, 8] : [8, size - 15 + i]);
  for (const positions of [formatA, formatB]) {
    const result = positions.reduce((word, [x, y], i) => word + (Number(modules[y!]![x!]) << i), 0);
    assert.equal(result, format, 'format information with ECC M');
  }
  assert(modules[size - 8]![8], 'fixed dark module');
  const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
  for (const [left, top] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
    for (let row = -1; row <= 7; row++) {
      for (let col = -1; col <= 7; col++) {
        const sample = modules[top + row]?.[left + col];
        if (sample !== undefined) assert.equal(sample, finder[row]?.[col] === '1', 'finder and separator');
      }
    }
  }
  for (let i = 8; i <= size - 9; i++) {
    assert.equal(modules[i]![6], i % 2 === 0, 'vertical timing');
    assert.equal(modules[6]![i], i % 2 === 0, 'horizontal timing');
  }
  if (version > 1) {
    const pattern = ['11111', '10001', '10101', '10001', '11111'];
    for (let row = 0; row < 5; row++) {
      assert.equal(modules[size - 9 + row]!.slice(size - 9, size - 4).map(Number).join(''), pattern[row], 'alignment pattern');
    }
  }

  const reserved = (y: number, x: number) => x === 6 || y === 6 || (y < 9 && x < 9)
    || (y < 9 && x >= size - 8) || (x < 9 && y >= size - 8)
    || (version > 1 && x >= size - 9 && x <= size - 5 && y >= size - 9 && y <= size - 5);
  const traversal: number[] = [];
  for (let col = size - 1; col >= 0; col--) if (col !== 6) traversal.push(col);
  const bits: number[] = [];
  for (let pair = 0; pair < traversal.length; pair += 2) {
    for (let i = 0; i < size; i++) {
      const row = pair % 4 === 0 ? size - 1 - i : i;
      for (const col of [traversal[pair]!, traversal[pair + 1]!]) {
        if (!reserved(row, col)) bits.push(unmask(modules[row]![col]!, mask, row, col));
      }
    }
  }
  const [count, data, parity] = layouts[version - 1]!;
  const symbols = (data + parity) * count;
  assert.equal(bits.length, 8 * symbols + (version === 1 ? 0 : 7));
  assert(bits.slice(8 * symbols).every((value) => value === 0), 'zero remainder bits');
  const codewords = Array.from({ length: symbols }, (_, pos) =>
    bits.slice(8 * pos, 8 * (pos + 1)).reduce((word, bit) => 2 * word + bit, 0));
  const decoded: number[] = [];
  for (let i = 0; i < count; i++) {
    const block = codewords.filter((_value, pos) => pos % count === i);
    for (let power = 0; power < parity; power++) {
      let syndrome = 0;
      for (const byte of block) syndrome = byte ^ (syndrome ? exponents[(logarithms[syndrome]! + power) % 255]! : 0);
      assert.equal(syndrome, 0, 'Reed–Solomon syndrome');
    }
    decoded.push(...block.slice(0, data));
  }
  const dataBits = decoded.flatMap((word) => Array.from({ length: 8 }, (_, i) => (word >> (7 - i)) & 1));
  let offset = 0;
  const read = (length: number) => {
    const value = dataBits.slice(offset, offset + length).reduce((word, bit) => 2 * word + bit, 0);
    offset += length;
    return value;
  };
  const mode = read(4);
  const unicode = /[^\x00-\x7f]/u.test(expected);
  if (unicode) {
    assert.equal(mode, 7, 'ECI segment');
    assert.equal(read(8), 26, 'UTF-8 assignment');
    assert.equal(read(4), 4, 'Byte segment after ECI');
  } else {
    assert.equal(mode, 4, 'Byte segment');
  }
  const length = read(8);
  const bytes = Uint8Array.from({ length }, () => read(8));
  assert.equal(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), expected, 'exact payload');
  assert.equal(read(Math.min(4, dataBits.length - offset)), 0, 'terminator');
  assert.equal(read((8 - offset % 8) % 8), 0, 'zero bit padding');
  for (let i = 0; offset < dataBits.length; i++) assert.equal(read(8), i % 2 === 0 ? 236 : 17, 'pad codeword');
}
