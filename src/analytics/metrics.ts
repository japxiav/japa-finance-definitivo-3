import type { AppState, Transaction } from '../core/types';
import {
  cashflowSummary,
  isAnalyticalExpense,
  isAnalyticalIncome,
  signedNetMovement,
  type CashflowSummary,
  type DateRange,
} from '../core/finance';
import { addCents } from '../domain/arithmetic';
import { addCivilDays, civilDaysBetween, isCivilDate } from '../domain/dates';

export interface RankedAmount {
  key: string;
  amountCents: number;
  transactionCount: number;
  share: number;
}

export interface LargestExpense {
  transactionId: string;
  description: string;
  amountCents: number;
  reportingDate: string;
  categoryId: string;
  merchant: string;
}

export interface MetricsSnapshot {
  range: Required<DateRange>;
  effectiveEnd: string;
  periodDays: number;
  observedDays: number;
  isComplete: boolean;
  summary: CashflowSummary;
  expenseTransactionCount: number;
  incomeTransactionCount: number;
  refundTransactionCount: number;
  excludedTransferTransactionCount: number;
  unknownTransactionCount: number;
  uncategorizedTransactionCount: number;
  activeExpenseDays: number;
  daysWithoutExpense: number;
  longestNoSpendStreak: number;
  averageExpenseCents: number;
  byCategory: RankedAmount[];
  byMerchant: RankedAmount[];
  byWeekday: RankedAmount[];
  byDaypart: RankedAmount[];
  largestExpense?: LargestExpense;
  transactions: Transaction[];
}

export interface AnalyticsBundle {
  currency: string;
  latestReportingDate?: string;
  current: MetricsSnapshot;
  previous: MetricsSnapshot;
}

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function clampEffectiveEnd(range: Required<DateRange>, latest?: string): string {
  if (!latest || latest < range.start) return range.start;
  return latest < range.end ? latest : range.end;
}

function dateToWeekday(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!;
}

function hourFromTransaction(transaction: Transaction): number | undefined {
  const value = transaction.completedAt ?? transaction.startedAt;
  const match = value?.match(/T(\d{2}):/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : undefined;
}

function daypart(transaction: Transaction): string {
  const hour = hourFromTransaction(transaction);
  if (hour === undefined) return 'Horário desconhecido';
  if (hour < 6) return 'Madrugada';
  if (hour < 12) return 'Manhã';
  if (hour < 18) return 'Tarde';
  return 'Noite';
}

function ranked(
  transactions: Transaction[],
  totalCents: number,
  keyFor: (transaction: Transaction) => string,
): RankedAmount[] {
  const map = new Map<string, { amountCents: number; transactionCount: number }>();
  for (const transaction of transactions) {
    const amount = Math.abs(signedNetMovement(transaction));
    const key = keyFor(transaction) || 'Não informado';
    const current = map.get(key) ?? { amountCents: 0, transactionCount: 0 };
    map.set(key, {
      amountCents: addCents(current.amountCents, amount),
      transactionCount: current.transactionCount + 1,
    });
  }
  return [...map.entries()]
    .map(([key, item]) => ({
      key,
      ...item,
      share: totalCents > 0 ? item.amountCents / totalCents : 0,
    }))
    .sort((a, b) => b.amountCents - a.amountCents || b.transactionCount - a.transactionCount || a.key.localeCompare(b.key));
}

function longestNoSpend(range: Required<DateRange>, expenseDates: Set<string>, effectiveEnd: string): number {
  if (effectiveEnd < range.start) return 0;
  let longest = 0;
  let current = 0;
  let cursor = range.start;
  while (cursor <= effectiveEnd) {
    if (expenseDates.has(cursor)) current = 0;
    else {
      current += 1;
      longest = Math.max(longest, current);
    }
    if (cursor === effectiveEnd) break;
    cursor = addCivilDays(cursor, 1);
  }
  return longest;
}

function snapshot(
  allTransactions: Transaction[],
  currency: string,
  range: Required<DateRange>,
  latestReportingDate?: string,
): MetricsSnapshot {
  const transactions = allTransactions.filter((transaction) =>
    transaction.status === 'completed'
    && transaction.currency === currency
    && transaction.reportingDate >= range.start
    && transaction.reportingDate <= range.end,
  );
  const analytical = transactions.filter((transaction) => !transaction.analysisExcluded);
  const expenses = analytical.filter((transaction) => isAnalyticalExpense(transaction) && signedNetMovement(transaction) < 0);
  const incomes = analytical.filter((transaction) => isAnalyticalIncome(transaction) && signedNetMovement(transaction) > 0);
  const refunds = analytical.filter((transaction) => transaction.kind === 'refund' && signedNetMovement(transaction) > 0);
  const excludedTransfers = transactions.filter((transaction) =>
    transaction.kind === 'transfer' && transaction.analysisExcluded);
  const unknown = analytical.filter((transaction) => transaction.kind === 'unknown');
  const uncategorized = analytical.filter((transaction) => !transaction.categoryId);
  const summary = cashflowSummary(allTransactions, currency, range);
  const effectiveEnd = clampEffectiveEnd(range, latestReportingDate);
  const expenseDates = new Set(expenses.map((transaction) => transaction.reportingDate));
  const periodDays = civilDaysBetween(range.start, range.end) + 1;
  const observedDays = Math.max(1, civilDaysBetween(range.start, effectiveEnd) + 1);
  const largest = [...expenses].sort((a, b) => Math.abs(signedNetMovement(b)) - Math.abs(signedNetMovement(a)))[0];

  return {
    range,
    effectiveEnd,
    periodDays,
    observedDays,
    isComplete: Boolean(latestReportingDate && latestReportingDate >= range.end),
    summary,
    expenseTransactionCount: expenses.length,
    incomeTransactionCount: incomes.length,
    refundTransactionCount: refunds.length,
    excludedTransferTransactionCount: excludedTransfers.length,
    unknownTransactionCount: unknown.length,
    uncategorizedTransactionCount: uncategorized.length,
    activeExpenseDays: expenseDates.size,
    daysWithoutExpense: Math.max(0, observedDays - expenseDates.size),
    longestNoSpendStreak: longestNoSpend(range, expenseDates, effectiveEnd),
    averageExpenseCents: expenses.length ? Math.round(summary.expenseCents / expenses.length) : 0,
    byCategory: ranked(expenses, summary.expenseCents, (transaction) => transaction.categoryId ?? 'uncategorized'),
    byMerchant: ranked(expenses, summary.expenseCents, (transaction) => transaction.merchantNormalized || transaction.descriptionOriginal),
    byWeekday: ranked(expenses, summary.expenseCents, (transaction) => dateToWeekday(transaction.reportingDate)),
    byDaypart: ranked(expenses, summary.expenseCents, daypart),
    largestExpense: largest ? {
      transactionId: largest.id,
      description: largest.descriptionOriginal,
      amountCents: Math.abs(signedNetMovement(largest)),
      reportingDate: largest.reportingDate,
      categoryId: largest.categoryId ?? 'uncategorized',
      merchant: largest.merchantNormalized,
    } : undefined,
    transactions,
  };
}

function previousRange(current: Required<DateRange>): Required<DateRange> {
  const days = civilDaysBetween(current.start, current.end) + 1;
  const end = addCivilDays(current.start, -1);
  return { start: addCivilDays(end, -(days - 1)), end };
}

function defaultRange(latest?: string): Required<DateRange> {
  const end = latest && isCivilDate(latest) ? latest : new Date().toISOString().slice(0, 10);
  return { start: addCivilDays(end, -29), end };
}

export function buildAnalytics(
  state: AppState,
  currency: string,
  selectedRange?: DateRange,
): AnalyticsBundle {
  const relevantDates = state.transactions
    .filter((transaction) => transaction.status === 'completed' && transaction.currency === currency)
    .map((transaction) => transaction.reportingDate)
    .filter(isCivilDate)
    .sort();
  const latestReportingDate = relevantDates.at(-1);
  const currentRange = selectedRange?.start && selectedRange?.end
    ? { start: selectedRange.start, end: selectedRange.end }
    : defaultRange(latestReportingDate);
  return {
    currency,
    latestReportingDate,
    current: snapshot(state.transactions, currency, currentRange, latestReportingDate),
    previous: snapshot(state.transactions, currency, previousRange(currentRange), latestReportingDate),
  };
}

export function latestReconciledBalance(state: AppState, currency: string): {
  balanceCents: number;
  logicalAsOf: string;
  batchId: string;
} | undefined {
  const batches = state.reconciliationBatches
    .filter((batch) => batch.status === 'COMPLETE')
    .sort((a, b) => b.logicalAsOf.localeCompare(a.logicalAsOf));
  for (const batch of batches) {
    const snapshots = state.balanceSnapshots.filter((snapshot) =>
      snapshot.reconciliationBatchId === batch.id && snapshot.currency === currency && snapshot.reconciled,
    );
    if (!snapshots.length) continue;
    return {
      balanceCents: snapshots.reduce((total, item) => addCents(total, item.balanceCents), 0),
      logicalAsOf: batch.logicalAsOf,
      batchId: batch.id,
    };
  }
  return undefined;
}

export function previousReconciledBalance(state: AppState, currency: string): {
  currentCents: number;
  previousCents: number;
  differenceCents: number;
} | undefined {
  const batches = state.reconciliationBatches
    .filter((batch) => batch.status === 'COMPLETE')
    .sort((a, b) => b.logicalAsOf.localeCompare(a.logicalAsOf));
  const totals: number[] = [];
  for (const batch of batches) {
    const snapshots = state.balanceSnapshots.filter((snapshot) =>
      snapshot.reconciliationBatchId === batch.id && snapshot.currency === currency && snapshot.reconciled,
    );
    if (!snapshots.length) continue;
    totals.push(snapshots.reduce((sum, snapshot) => addCents(sum, snapshot.balanceCents), 0));
    if (totals.length === 2) break;
  }
  if (totals.length < 2) return undefined;
  return { currentCents: totals[0]!, previousCents: totals[1]!, differenceCents: addCents(totals[0]!, -totals[1]!) };
}
