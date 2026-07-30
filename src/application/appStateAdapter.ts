import { localCivilDateFromInstant } from '../core/date';
import type { AppState, ReconciliationBatchRecord } from '../core/types';
import type { CivilDate, FinancialState } from '../domain/model';

export interface AdaptedFinancialState {
  state?: FinancialState;
  reconciliationBatchId?: string;
  blockers: string[];
}

function snapshotsForBatch(
  app: AppState,
  accounts: AppState['accounts'],
  batch: ReconciliationBatchRecord,
  currency: string,
) {
  const selected = accounts.map((account) => {
    const matches = app.balanceSnapshots.filter((snapshot) =>
      snapshot.accountId === account.id &&
      snapshot.currency === currency &&
      snapshot.reconciled &&
      snapshot.reconciliationBatchId === batch.id &&
      (snapshot.logicalAsOf ?? snapshot.asOf) === batch.logicalAsOf,
    );
    return matches.length === 1 ? matches[0] : undefined;
  });
  return selected.every(Boolean) ? selected : undefined;
}

export function adaptAppStateToFinancialState(app: AppState, currency: string): AdaptedFinancialState {
  const accounts = app.accounts.filter((account) => account.active && account.currency === currency);
  if (!accounts.length) return { blockers: ['ACTIVE_ACCOUNT_NOT_FOUND'] };

  const completeBatches = app.reconciliationBatches
    .filter((batch) => batch.status === 'COMPLETE')
    .sort((left, right) =>
      right.logicalAsOf.localeCompare(left.logicalAsOf) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
    );

  let persistedBatch: ReconciliationBatchRecord | undefined;
  let selected: Array<AppState['balanceSnapshots'][number] | undefined> | undefined;
  for (const candidate of completeBatches) {
    const candidateSnapshots = snapshotsForBatch(app, accounts, candidate, currency);
    if (candidateSnapshots) {
      persistedBatch = candidate;
      selected = candidateSnapshots;
      break;
    }
  }

  if (!persistedBatch || !selected) {
    const hasAnySnapshot = accounts.some((account) => app.balanceSnapshots.some((snapshot) =>
      snapshot.accountId === account.id && snapshot.currency === currency && snapshot.reconciled,
    ));
    return { blockers: [hasAnySnapshot ? 'SNAPSHOT_BATCH_MISMATCH' : 'ACTIVE_ACCOUNT_SNAPSHOT_MISSING'] };
  }

  const selectedAccountIds = new Set(accounts.map((account) => account.id));
  const plannedEvents = app.plannedEvents
    .filter((event) =>
      event.active &&
      event.currency === currency &&
      Boolean(event.accountId) &&
      selectedAccountIds.has(event.accountId!),
    )
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
      dueDate: event.dueDate as CivilDate,
      evidenceLevel: 'planned' as const,
      status: 'active' as const,
      recurrence: event.recurrence ? {
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        until: event.recurrence.until,
        maxOccurrences: event.recurrence.maxOccurrences,
      } : undefined,
    }));

  return {
    reconciliationBatchId: persistedBatch.id,
    blockers: [],
    state: {
      accounts: accounts.map(({ id, name, currency: accountCurrency, active }) => ({
        id, name, currency: accountCurrency, active,
      })),
      reconciliationBatches: [{
        id: persistedBatch.id,
        logicalDate: (persistedBatch.logicalDate ?? localCivilDateFromInstant(persistedBatch.logicalAsOf)) as CivilDate,
        logicalAsOf: persistedBatch.logicalAsOf,
        createdAt: persistedBatch.createdAt,
        source: persistedBatch.source,
        status: persistedBatch.status,
      }],
      balanceSnapshots: selected.map((snapshot) => ({
        id: snapshot!.id,
        accountId: snapshot!.accountId,
        currency: snapshot!.currency,
        balanceCents: snapshot!.balanceCents,
        reconciliationBatchId: persistedBatch!.id,
        reconciled: true as const,
      })),
      reservePolicies: app.reservePolicies
        .filter((policy) => policy.currency === currency)
        .map((policy, index) => ({
          id: `legacy-reserve:${currency}:${index}`,
          currency: policy.currency,
          minimumCents: policy.minimumCents,
          targetCents: policy.targetCents,
          updatedAt: policy.updatedAt,
        })),
      plannedEvents,
      plannedTransfers: app.plannedTransfers
        .filter((transfer) =>
          selectedAccountIds.has(transfer.sourceAccountId) &&
          selectedAccountIds.has(transfer.destinationAccountId))
        .map((transfer) => ({
          id: transfer.id,
          title: transfer.title,
          sourceAccountId: transfer.sourceAccountId,
          destinationAccountId: transfer.destinationAccountId,
          amountCents: transfer.amountCents,
          feeCents: transfer.feeCents,
          dueDate: transfer.dueDate as CivilDate,
          evidenceLevel: transfer.evidenceLevel,
          status: transfer.status,
        })),
    },
  };
}
