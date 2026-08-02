import type { AppState, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';

function wiseBalanceBase(transaction: Transaction): string | undefined {
  const id = transaction.bankTransactionId ?? '';
  const match = /^(?:FEE-)?(BALANCE-[A-Z0-9-]+)$/i.exec(id);
  if (match?.[1]) return match[1].toUpperCase();
  const description = transaction.descriptionOriginal;
  const fromDescription = /(?:Wise Charges for:\s*)?(BALANCE-[A-Z0-9-]+)/i.exec(description);
  return fromDescription?.[1]?.toUpperCase();
}

function compoundGroupFor(transaction: Transaction): string | undefined {
  const balance = wiseBalanceBase(transaction);
  if (balance) return `wise-conversion:${balance}`;
  if (/rende\+/i.test(transaction.descriptionOriginal)) return `wise-rende:${transaction.bankTransactionId ?? transaction.semanticFingerprint ?? transaction.id}`;
  return undefined;
}

export function linkCompoundEvents(state: AppState): AppState {
  const transactions = state.transactions.map((transaction) => {
    const compoundEventId = compoundGroupFor(transaction) ?? transaction.compoundEventId;
    if (!compoundEventId) return transaction;
    if (compoundEventId.startsWith('wise-conversion:')) {
      const isFee = transaction.technicalType === 'bank_fee' || /^FEE-/i.test(transaction.bankTransactionId ?? '') || /wise charges for/i.test(transaction.descriptionOriginal);
      return {
        ...transaction,
        compoundEventId,
        transferGroupId: isFee ? transaction.transferGroupId : compoundEventId,
        technicalType: isFee ? 'bank_fee' as const : 'currency_conversion' as const,
        kind: isFee ? 'expense' as const : 'transfer' as const,
        analysisExcluded: !isFee,
        categoryId: isFee ? transaction.categoryId : undefined,
        categorySource: isFee ? transaction.categorySource : 'none' as const,
        categoryReviewStatus: isFee ? 'resolved' as const : 'not_applicable' as const,
        reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'unknown_kind'),
        needsReview: transaction.reviewReasons.some((reason) => reason !== 'unknown_kind'),
      };
    }
    return {
      ...transaction,
      compoundEventId,
      transferGroupId: compoundEventId,
      technicalType: 'internal_transfer' as const,
      kind: 'transfer' as const,
      analysisExcluded: true,
      categoryId: undefined,
      categorySource: 'none' as const,
      categoryReviewStatus: 'not_applicable' as const,
      reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'unknown_kind' && reason !== 'ambiguous_transfer'),
      needsReview: transaction.reviewReasons.some((reason) => reason !== 'unknown_kind' && reason !== 'ambiguous_transfer'),
    };
  });
  return { ...state, transactions };
}

export interface CompoundEventSummary {
  id: string;
  kind: 'conversion' | 'internal_product' | 'other';
  transactionIds: string[];
  reportingDate: string;
  source?: Transaction;
  target?: Transaction;
  fees: Transaction[];
}

export function buildCompoundEventSummaries(state: AppState): CompoundEventSummary[] {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of state.transactions) {
    if (!transaction.compoundEventId || transaction.status === 'voided') continue;
    const current = groups.get(transaction.compoundEventId) ?? [];
    current.push(transaction);
    groups.set(transaction.compoundEventId, current);
  }
  return [...groups.entries()].map(([id, transactions]) => ({
    id,
    kind: id.startsWith('wise-conversion:') ? 'conversion' : id.startsWith('wise-rende:') ? 'internal_product' : 'other',
    transactionIds: transactions.map((item) => item.id),
    reportingDate: transactions.map((item) => item.reportingDate).sort()[0]!,
    source: transactions.find((item) => item.technicalType === 'currency_conversion' && signedNetMovement(item) < 0),
    target: transactions.find((item) => item.technicalType === 'currency_conversion' && signedNetMovement(item) > 0),
    fees: transactions.filter((item) => item.technicalType === 'bank_fee'),
  }));
}
