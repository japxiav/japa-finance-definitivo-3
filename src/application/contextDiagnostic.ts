import type { AppState } from '../core/types';
import { findInternalTransferSuggestions } from './internalTransfers';
import { findTransferRecurrenceSuggestions } from './transferRecurrence';
import { buildReviewGroups } from '../classification/grouping';

export interface ContextDiagnostic {
  contextSnapshotVersion: 1;
  generatedAt: string;
  schemaVersion: number;
  summary: {
    accounts: number;
    transactions: number;
    unresolvedImportIssues: number;
    reviewGroups: number;
    recurringTransferGroups: number;
    internalTransferSuggestions: number;
  };
  identity: AppState['ownerIdentity'];
  accounts: Array<{
    id: string;
    name: string;
    institution: string;
    currency: string;
    active: boolean;
    transactionCount: number;
    firstDate?: string;
    lastDate?: string;
  }>;
  whatTheAppKnows: unknown[];
  whatTheAppAssumes: unknown[];
  conflicts: unknown[];
  unknowns: unknown[];
  rules: AppState['rules'];
}

export function buildContextDiagnostic(state: AppState): ContextDiagnostic {
  const reviewGroups = buildReviewGroups(state);
  const recurrences = findTransferRecurrenceSuggestions(state);
  const internalTransfers = findInternalTransferSuggestions(state);
  const activeTransactions = state.transactions.filter((transaction) => transaction.status === 'completed' || transaction.status === 'reverted');
  const transactionsByAccount = new Map<string, typeof activeTransactions>();
  for (const transaction of activeTransactions) {
    const list = transactionsByAccount.get(transaction.accountId) ?? [];
    list.push(transaction);
    transactionsByAccount.set(transaction.accountId, list);
  }

  const accounts = state.accounts.map((account) => {
    const transactions = transactionsByAccount.get(account.id) ?? [];
    const dates = transactions.map((item) => item.reportingDate).sort();
    return {
      id: account.id,
      name: account.name,
      institution: account.institution,
      currency: account.currency,
      active: account.active,
      transactionCount: transactions.length,
      firstDate: dates[0],
      lastDate: dates.at(-1),
    };
  });

  return {
    contextSnapshotVersion: 1,
    generatedAt: new Date().toISOString(),
    schemaVersion: state.schemaVersion,
    summary: {
      accounts: state.accounts.length,
      transactions: activeTransactions.length,
      unresolvedImportIssues: state.importIssues.filter((item) => item.status === 'unresolved').length,
      reviewGroups: reviewGroups.filter((group) => group.status === 'pending').length,
      recurringTransferGroups: recurrences.length,
      internalTransferSuggestions: internalTransfers.length,
    },
    identity: state.ownerIdentity,
    accounts,
    whatTheAppKnows: [
      ...state.transactions.filter((transaction) => transaction.ownerIdentityMatched).map((transaction) => ({
        type: 'owner_identity_transfer',
        transactionId: transaction.id,
        description: transaction.descriptionOriginal,
        confidence: transaction.contextConfidence,
        evidence: transaction.contextEvidence,
      })),
      ...state.internalTransferDecisions.filter((decision) => decision.status === 'confirmed').map((decision) => ({
        type: 'confirmed_internal_transfer',
        ...decision,
      })),
      ...state.transactionAllocations.map((allocation) => ({ type: 'confirmed_transfer_purpose', ...allocation })),
    ],
    whatTheAppAssumes: [
      ...reviewGroups.map((group) => ({
        type: 'category_group',
        key: group.key,
        label: group.merchantLabel,
        transactionCount: group.transactionIds.length,
        suggestion: group.suggestedCategoryId,
        confidence: group.suggestionConfidence,
        score: group.suggestionScore,
        evidence: group.suggestionEvidence,
      })),
      ...recurrences.map((group) => ({ type: 'recurring_transfer_group', ...group })),
      ...internalTransfers.map((suggestion) => ({
        type: 'possible_internal_transfer',
        key: suggestion.key,
        outflowTransactionId: suggestion.outflow.id,
        inflowTransactionId: suggestion.inflow.id,
        amountCents: suggestion.amountCents,
        currency: suggestion.outflow.currency,
        confidence: suggestion.confidence,
        evidence: suggestion.evidence,
      })),
    ],
    conflicts: state.importIssues.filter((item) => item.status === 'unresolved').map((item) => ({
      type: 'import_issue',
      id: item.id,
      kind: item.kind,
      message: item.message,
      accountId: item.accountId,
      rowNumber: item.rowNumber,
    })),
    unknowns: state.transactions.filter((transaction) => transaction.status === 'completed' && (
      transaction.technicalType === 'unknown'
      || transaction.categoryReviewStatus === 'pending'
      || (transaction.kind === 'transfer' && !transaction.analysisExcluded && !state.transactionAllocations.some((allocation) => allocation.transactionId === transaction.id))
    )).map((transaction) => ({
      transactionId: transaction.id,
      description: transaction.descriptionOriginal,
      currency: transaction.currency,
      reportingDate: transaction.reportingDate,
      technicalType: transaction.technicalType,
      categoryReviewStatus: transaction.categoryReviewStatus,
      reviewReasons: transaction.reviewReasons,
    })),
    rules: state.rules,
  };
}

export function downloadContextDiagnostic(state: AppState) {
  const diagnostic = buildContextDiagnostic(state);
  const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `japa-finance-diagnostico-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
