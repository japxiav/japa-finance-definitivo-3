import type { AppState, ImportBatch, Transaction, TransactionStatus } from './types';

export interface UndoImpact {
  transactionCount: number;
  manuallyEditedCount: number;
  linkedTransferCount: number;
  notedCount: number;
}

export function getUndoImpact(state: AppState, importId: string): UndoImpact {
  const transactions = state.transactions.filter((transaction) =>
    transaction.importId === importId && transaction.status !== 'voided',
  );

  return {
    transactionCount: transactions.length,
    manuallyEditedCount: transactions.filter((transaction) => transaction.manualEditLog.length > 0).length,
    linkedTransferCount: transactions.filter((transaction) => Boolean(transaction.transferGroupId)).length,
    notedCount: transactions.filter((transaction) => Boolean(transaction.note?.trim())).length,
  };
}

export function undoImport(state: AppState, importId: string): AppState {
  const now = new Date().toISOString();

  return {
    ...state,
    transactions: state.transactions.map((transaction) => {
      if (transaction.importId !== importId || transaction.status === 'voided') return transaction;
      return {
        ...transaction,
        statusBeforeVoid: transaction.status as TransactionStatus,
        status: 'voided',
        voidReason: 'import_undone',
        updatedAt: now,
      };
    }),
    imports: state.imports.map((batch) =>
      batch.id === importId ? { ...batch, status: 'undone' } : batch,
    ),
  };
}

export function restoreImport(state: AppState, importId: string): AppState {
  const now = new Date().toISOString();

  return {
    ...state,
    transactions: state.transactions.map((transaction) => {
      if (transaction.importId !== importId || transaction.voidReason !== 'import_undone') return transaction;
      return {
        ...transaction,
        status: transaction.statusBeforeVoid ?? 'completed',
        statusBeforeVoid: undefined,
        voidReason: undefined,
        updatedAt: now,
      };
    }),
    imports: state.imports.map((batch) =>
      batch.id === importId ? { ...batch, status: 'active' } : batch,
    ),
  };
}

export function createConfirmedBatch(
  batch: ImportBatch,
  importedCount: number,
): ImportBatch {
  return { ...batch, imported: importedCount, status: 'active' };
}
