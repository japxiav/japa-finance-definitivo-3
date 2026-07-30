import type { Account, AccountBalanceSnapshot, ReconciliationBatchRecord } from '../core/types';
import { civilDateFromUtcInstant, civilDaysBetween, isCivilDate, isInstantTimestamp } from '../domain/dates';

export interface ReconciliationAccountBalance {
  accountId: string;
  balanceCents: number;
}

export interface ReconciliationSnapshotBatch {
  reconciliationBatchId: string;
  logicalAsOf: string;
  snapshots: AccountBalanceSnapshot[];
  batch: ReconciliationBatchRecord;
}

export function createReconciliationSnapshotBatch(input: {
  accounts: Account[];
  balances: ReconciliationAccountBalance[];
  currency: string;
  logicalAsOf: string;
  logicalDate: string;
  reconciliationBatchId: string;
  createdAt: string;
  source?: 'import' | 'manual';
}): ReconciliationSnapshotBatch {
  const selectedAccounts = input.accounts.filter(
    (account) => account.active && account.currency === input.currency,
  );
  if (selectedAccounts.length === 0) throw new Error('ACTIVE_ACCOUNT_NOT_FOUND');
  if (new Set(selectedAccounts.map((account) => account.id)).size !== selectedAccounts.length) {
    throw new Error('DUPLICATE_ACCOUNT_REFERENCE');
  }
  if (!input.reconciliationBatchId.trim()) throw new Error('RECONCILIATION_BATCH_ID_REQUIRED');
  if (!isInstantTimestamp(input.logicalAsOf)) throw new Error('LOGICAL_AS_OF_INVALID');
  if (!isCivilDate(input.logicalDate)) throw new Error('LOGICAL_DATE_INVALID');
  if (!isInstantTimestamp(input.createdAt)) throw new Error('CREATED_AT_INVALID');
  if (input.logicalAsOf > input.createdAt) throw new Error('LOGICAL_AS_OF_IN_FUTURE');
  const utcLogicalDate = civilDateFromUtcInstant(input.logicalAsOf);
  if (Math.abs(civilDaysBetween(utcLogicalDate, input.logicalDate)) > 1) {
    throw new Error('LOGICAL_DATE_INCOHERENT');
  }

  const balanceByAccount = new Map(input.balances.map((item) => [item.accountId, item.balanceCents]));
  if (balanceByAccount.size !== input.balances.length) throw new Error('DUPLICATE_ACCOUNT_BALANCE');

  const selectedIds = new Set(selectedAccounts.map((account) => account.id));
  if (input.balances.some((item) => !selectedIds.has(item.accountId))) {
    throw new Error('ACCOUNT_REFERENCE_INVALID');
  }

  const snapshots = selectedAccounts.map((account) => {
    const balanceCents = balanceByAccount.get(account.id);
    if (!Number.isSafeInteger(balanceCents)) {
      throw new Error(`ACCOUNT_BALANCE_REQUIRED:${account.id}`);
    }
    return {
      id: `${input.reconciliationBatchId}:${account.id}`,
      accountId: account.id,
      currency: account.currency,
      balanceCents: balanceCents!,
      asOf: input.logicalAsOf,
      logicalAsOf: input.logicalAsOf,
      reconciliationBatchId: input.reconciliationBatchId,
      source: input.source ?? 'manual',
      reconciled: true,
      createdAt: input.createdAt,
    };
  });

  return {
    reconciliationBatchId: input.reconciliationBatchId,
    logicalAsOf: input.logicalAsOf,
    snapshots,
    batch: {
      id: input.reconciliationBatchId,
      logicalDate: input.logicalDate,
      logicalAsOf: input.logicalAsOf,
      createdAt: input.createdAt,
      source: input.source ?? 'manual',
      status: 'COMPLETE',
    },
  };
}
