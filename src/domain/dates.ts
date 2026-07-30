import type { CivilDate, InstantTimestamp } from './model';

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class CivilDateArithmeticError extends Error {
  constructor() {
    super('CIVIL_DATE_OUT_OF_RANGE');
    this.name = 'CivilDateArithmeticError';
  }
}

export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string') return false;
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function isInstantTimestamp(value: unknown): value is InstantTimestamp {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function formatCivilDate(date: Date): CivilDate {
  try {
    const iso = date.toISOString();
    const candidate = iso.slice(0, 10);
    if (!isCivilDate(candidate)) throw new CivilDateArithmeticError();
    return candidate;
  } catch (error) {
    if (error instanceof CivilDateArithmeticError) throw error;
    throw new CivilDateArithmeticError();
  }
}

export function civilDateFromUtcInstant(value: InstantTimestamp): CivilDate {
  if (!isInstantTimestamp(value)) throw new CivilDateArithmeticError();
  return value.slice(0, 10);
}

export function civilDaysBetween(start: CivilDate, end: CivilDate): number {
  if (!isCivilDate(start) || !isCivilDate(end)) throw new CivilDateArithmeticError();
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  const milliseconds = Date.UTC(endYear!, endMonth! - 1, endDay!)
    - Date.UTC(startYear!, startMonth! - 1, startDay!);
  return milliseconds / 86_400_000;
}

export function addCivilDays(value: CivilDate, days: number): CivilDate {
  if (!isCivilDate(value) || !Number.isSafeInteger(days)) throw new CivilDateArithmeticError();
  const [year, month, day] = value.split('-').map(Number);
  return formatCivilDate(new Date(Date.UTC(year!, month! - 1, day! + days)));
}

export function addCivilMonths(value: CivilDate, months: number): CivilDate {
  if (!isCivilDate(value) || !Number.isSafeInteger(months)) throw new CivilDateArithmeticError();
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day!, lastDay));
  return formatCivilDate(target);
}

export function addCivilYears(value: CivilDate, years: number): CivilDate {
  if (!Number.isSafeInteger(years) || !Number.isSafeInteger(years * 12)) {
    throw new CivilDateArithmeticError();
  }
  return addCivilMonths(value, years * 12);
}
