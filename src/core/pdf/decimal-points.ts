export type DecimalParts = readonly [coefficient: bigint, exponent: number];

export function decimalParts(value: number): DecimalParts {
  const [mantissa, power = '0'] = String(value).split('e');
  const [integer, fraction = ''] = mantissa!.split('.');
  return [BigInt(integer! + fraction), Number(power) - fraction.length];
}

export function subtractDecimals([left, leftExponent]: DecimalParts, [right, rightExponent]: DecimalParts): DecimalParts {
  const exponent = Math.min(leftExponent, rightExponent);
  return [left * 10n ** BigInt(leftExponent - exponent) - right * 10n ** BigInt(rightExponent - exponent), exponent];
}

export function distanceInPoints(from: number, to: number, [unit, unitExponent]: DecimalParts): DecimalParts {
  // Use decimal coordinates so, for example, 16.08 − 7.08 is exactly 9 points.
  const [distance, exponent] = subtractDecimals(decimalParts(to), decimalParts(from));
  return [distance * unit, exponent + unitExponent];
}

export function decimalNumber([coefficient, exponent]: DecimalParts): number {
  return Number(`${coefficient}e${exponent}`);
}
