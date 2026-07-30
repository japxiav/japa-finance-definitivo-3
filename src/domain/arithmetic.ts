const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

export class MonetaryArithmeticError extends Error {
  constructor() {
    super('ARITHMETIC_OVERFLOW');
    this.name = 'MonetaryArithmeticError';
  }
}

export function addCents(...values: number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new MonetaryArithmeticError();
    total += BigInt(value);
    if (total > MAX_SAFE || total < MIN_SAFE) throw new MonetaryArithmeticError();
  }
  return Number(total);
}

export function subtractCents(minuend: number, ...subtrahends: number[]): number {
  return addCents(minuend, ...subtrahends.map((value) => -value));
}

export function canAddCents(...values: number[]): boolean {
  try {
    addCents(...values);
    return true;
  } catch {
    return false;
  }
}
