import type { Account, AppState, CurrencyCode, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { addCents } from '../domain/arithmetic';
import { addCivilYears, civilDaysBetween } from '../domain/dates';
import { expandPlannedEventOccurrences } from '../domain/recurrence';
import type { PlannedEvent as DomainPlannedEvent } from '../domain/model';

export type BalanceConfidence = 'confirmed' | 'estimated' | 'stale' | 'missing';

export interface AccountPosition {
  account: Account;
  snapshotBalanceCents?: number;
  currentBalanceCents?: number;
  logicalAsOf?: string;
  logicalDate?: string;
  latestMovementDate?: string;
  movementSinceSnapshotCents: number;
  movementCountSinceSnapshot: number;
  confidence: BalanceConfidence;
}

export interface BalanceBridge {
  openingBalanceCents: number;
  externalFlowCents: number;
  internalMovementCents: number;
  feeCents: number;
  adjustmentCents: number;
  closingBalanceCents: number;
  logicalAsOf: string;
  logicalDate: string;
}

export interface CurrencyPosition {
  currency: CurrencyCode;
  positions: AccountPosition[];
  knownAccountCount: number;
  missingAccountCount: number;
  currentBalanceCents?: number;
  confidence: BalanceConfidence;
  latestAsOf?: string;
  bridge?: BalanceBridge;
}

function transactionInstant(transaction: Transaction): string | undefined {
  return transaction.completedAt ?? transaction.startedAt;
}

function isAfterSnapshot(transaction: Transaction, logicalDate: string, logicalAsOf: string): boolean {
  if (transaction.reportingDate > logicalDate) return true;
  if (transaction.reportingDate < logicalDate) return false;
  const instant = transactionInstant(transaction);
  return Boolean(instant && instant > logicalAsOf);
}

function latestCompleteBatch(state: AppState, currency: string) {
  return state.reconciliationBatches
    .filter((batch) => batch.status === 'COMPLETE')
    .sort((a, b) => b.logicalAsOf.localeCompare(a.logicalAsOf))
    .find((batch) => state.balanceSnapshots.some((snapshot) =>
      snapshot.reconciliationBatchId === batch.id
      && snapshot.currency === currency
      && snapshot.reconciled));
}

function confidenceFor(logicalDate: string, movementCount: number, latestDataDate: string | undefined, today: string): BalanceConfidence {
  const observedDate = latestDataDate && latestDataDate > logicalDate ? latestDataDate : logicalDate;
  if (civilDaysBetween(observedDate, today) > 7) return 'stale';
  return movementCount > 0 ? 'estimated' : 'confirmed';
}

export function buildCurrencyPosition(state: AppState, currency: string, today: string): CurrencyPosition {
  const accounts = state.accounts.filter((account) => account.active && account.currency === currency);
  const completeBatchIds = new Set(state.reconciliationBatches
    .filter((batch) => batch.status === 'COMPLETE')
    .map((batch) => batch.id));

  const positions = accounts.map((account): AccountPosition => {
    const snapshot = state.balanceSnapshots
      .filter((item) => item.accountId === account.id
        && item.currency === currency
        && item.reconciled
        && Boolean(item.reconciliationBatchId && completeBatchIds.has(item.reconciliationBatchId)))
      .sort((a, b) => (b.logicalAsOf ?? b.asOf).localeCompare(a.logicalAsOf ?? a.asOf))[0];
    const accountTransactions = state.transactions
      .filter((transaction) => transaction.accountId === account.id
        && transaction.currency === currency
        && transaction.status === 'completed')
      .sort((a, b) => b.reportingDate.localeCompare(a.reportingDate)
        || (transactionInstant(b) ?? '').localeCompare(transactionInstant(a) ?? ''));
    const latestMovementDate = accountTransactions[0]?.reportingDate;
    if (!snapshot) {
      return {
        account,
        latestMovementDate,
        movementSinceSnapshotCents: 0,
        movementCountSinceSnapshot: 0,
        confidence: 'missing',
      };
    }
    const logicalAsOf = snapshot.logicalAsOf ?? snapshot.asOf;
    const logicalDate = state.reconciliationBatches.find((batch) => batch.id === snapshot.reconciliationBatchId)?.logicalDate
      ?? logicalAsOf.slice(0, 10);
    const movements = accountTransactions.filter((transaction) => isAfterSnapshot(transaction, logicalDate, logicalAsOf));
    const movementSinceSnapshotCents = movements.reduce((total, transaction) => addCents(total, signedNetMovement(transaction)), 0);
    return {
      account,
      snapshotBalanceCents: snapshot.balanceCents,
      currentBalanceCents: addCents(snapshot.balanceCents, movementSinceSnapshotCents),
      logicalAsOf,
      logicalDate,
      latestMovementDate,
      movementSinceSnapshotCents,
      movementCountSinceSnapshot: movements.length,
      confidence: confidenceFor(logicalDate, movements.length, latestMovementDate, today),
    };
  });

  const known = positions.filter((position) => position.currentBalanceCents !== undefined);
  const currentBalanceCents = known.length === positions.length && known.length > 0
    ? known.reduce((total, position) => addCents(total, position.currentBalanceCents!), 0)
    : undefined;
  const confidence: BalanceConfidence = positions.some((position) => position.confidence === 'missing')
    ? 'missing'
    : positions.some((position) => position.confidence === 'stale')
      ? 'stale'
      : positions.some((position) => position.confidence === 'estimated')
        ? 'estimated'
        : positions.length ? 'confirmed' : 'missing';

  const latestBatch = latestCompleteBatch(state, currency);
  let bridge: BalanceBridge | undefined;
  if (latestBatch) {
    const snapshots = state.balanceSnapshots.filter((snapshot) =>
      snapshot.reconciliationBatchId === latestBatch.id
      && snapshot.currency === currency
      && snapshot.reconciled);
    const openingBalanceCents = snapshots.reduce((total, snapshot) => addCents(total, snapshot.balanceCents), 0);
    const logicalDate = latestBatch.logicalDate ?? latestBatch.logicalAsOf.slice(0, 10);
    const movements = state.transactions.filter((transaction) =>
      transaction.currency === currency
      && transaction.status === 'completed'
      && isAfterSnapshot(transaction, logicalDate, latestBatch.logicalAsOf));
    let externalFlowCents = 0;
    let internalMovementCents = 0;
    let feeCents = 0;
    let adjustmentCents = 0;
    for (const transaction of movements) {
      const movement = signedNetMovement(transaction);
      if (transaction.technicalType === 'bank_fee') feeCents = addCents(feeCents, movement);
      else if (transaction.technicalType === 'internal_transfer' || transaction.technicalType === 'currency_conversion') {
        internalMovementCents = addCents(internalMovementCents, movement);
      } else if (transaction.technicalType === 'adjustment') adjustmentCents = addCents(adjustmentCents, movement);
      else externalFlowCents = addCents(externalFlowCents, movement);
    }
    bridge = {
      openingBalanceCents,
      externalFlowCents,
      internalMovementCents,
      feeCents,
      adjustmentCents,
      closingBalanceCents: [openingBalanceCents, externalFlowCents, internalMovementCents, feeCents, adjustmentCents]
        .reduce((total, amount) => addCents(total, amount), 0),
      logicalAsOf: latestBatch.logicalAsOf,
      logicalDate,
    };
  }

  return {
    currency,
    positions,
    knownAccountCount: known.length,
    missingAccountCount: positions.length - known.length,
    currentBalanceCents,
    confidence,
    latestAsOf: positions.map((position) => position.logicalAsOf).filter(Boolean).sort().at(-1),
    bridge,
  };
}

export interface FreeMoneyPosition {
  status: 'ready' | 'incomplete';
  currentBalanceCents?: number;
  reserveCents: number;
  commitmentsCents: number;
  freeCents?: number;
  nextIncomeDate?: string;
  daysToNextIncome?: number;
  safeDailyCents?: number;
}

export function buildFreeMoneyPosition(state: AppState, currencyPosition: CurrencyPosition, today: string): FreeMoneyPosition {
  const reserveCents = state.reservePolicies.find((policy) => policy.currency === currencyPosition.currency)?.minimumCents ?? 0;
  const plannedEvents: DomainPlannedEvent[] = state.plannedEvents
    .filter((event) => event.active
      && event.currency === currencyPosition.currency
      && Boolean(event.accountId))
    .map((event) => ({
      id: event.id,
      title: event.title,
      kind: event.direction === 'inflow'
        ? 'income' as const
        : event.kind === 'installment'
          ? 'installment' as const
          : 'expense' as const,
      accountId: event.accountId!,
      currency: event.currency,
      amountCents: event.amountCents,
      dueDate: event.dueDate,
      evidenceLevel: 'planned' as const,
      status: 'active' as const,
      recurrence: event.recurrence,
    }));
  // Cinco anos é apenas um limite defensivo para localizar a próxima renda
  // recorrente. Não altera o forecast oficial nem inventa ocorrências.
  const searchEnd = addCivilYears(today, 5);
  const nextIncome = expandPlannedEventOccurrences(plannedEvents, today, searchEnd)
    .find((occurrence) => occurrence.event.kind === 'income');
  const horizonEnd = nextIncome?.date ?? today;
  const commitmentsCents = expandPlannedEventOccurrences(plannedEvents, today, horizonEnd)
    .filter((occurrence) => occurrence.event.kind !== 'income')
    .reduce((total, occurrence) => addCents(total, occurrence.event.amountCents), 0);
  if (currencyPosition.currentBalanceCents === undefined) {
    return { status: 'incomplete', reserveCents, commitmentsCents, nextIncomeDate: nextIncome?.date };
  }
  const freeCents = addCents(addCents(currencyPosition.currentBalanceCents, -commitmentsCents), -reserveCents);
  const daysToNextIncome = nextIncome ? Math.max(0, civilDaysBetween(today, nextIncome.date)) : undefined;
  return {
    status: 'ready',
    currentBalanceCents: currencyPosition.currentBalanceCents,
    reserveCents,
    commitmentsCents,
    freeCents,
    nextIncomeDate: nextIncome?.date,
    daysToNextIncome,
    safeDailyCents: daysToNextIncome && daysToNextIncome > 0 ? Math.floor(Math.max(0, freeCents) / daysToNextIncome) : undefined,
  };
}
