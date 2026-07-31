import type { AppState, InternalTransferDecision, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { civilDaysBetween } from '../domain/dates';
import { withRebuiltReviewGroups } from '../classification/grouping';

export interface InternalTransferSuggestion {
  key: string;
  outflow: Transaction;
  inflow: Transaction;
  amountCents: number;
  dateDistance: number;
  confidence: 'high' | 'medium';
  evidence: string[];
}

function candidate(transaction: Transaction): boolean {
  return transaction.status === 'completed'
    && transaction.kind === 'transfer'
    && !transaction.analysisExcluded
    && transaction.sourceComponent !== 'fee';
}

function keyFor(outflow: Transaction, inflow: Transaction): string {
  return `internal:${outflow.id}:${inflow.id}`;
}

function accountHint(transaction: Transaction): boolean {
  return /wise|revolut|my account|minha conta|own account|top up|bank transfer/i.test(
    `${transaction.descriptionOriginal} ${transaction.bankType ?? ''}`,
  );
}

export function findInternalTransferSuggestions(state: AppState, currency?: string): InternalTransferSuggestion[] {
  const decisions = new Set(state.internalTransferDecisions.map((decision) => decision.suggestionKey));
  const allocatedTransactionIds = new Set(state.transactionAllocations.map((allocation) => allocation.transactionId));
  const outflows = state.transactions.filter((transaction) => candidate(transaction)
    && !allocatedTransactionIds.has(transaction.id)
    && transaction.direction === 'outflow'
    && (!currency || transaction.currency === currency));
  const inflows = state.transactions.filter((transaction) => candidate(transaction)
    && !allocatedTransactionIds.has(transaction.id)
    && transaction.direction === 'inflow'
    && (!currency || transaction.currency === currency));
  const usedInflows = new Set<string>();
  const suggestions: InternalTransferSuggestion[] = [];

  const rankedOutflows = [...outflows].sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
  for (const outflow of rankedOutflows) {
    const matches = inflows
      .filter((inflow) => inflow.accountId !== outflow.accountId
        && inflow.currency === outflow.currency
        && !usedInflows.has(inflow.id)
        && Math.abs(signedNetMovement(inflow)) === Math.abs(signedNetMovement(outflow)))
      .map((inflow) => ({ inflow, distance: Math.abs(civilDaysBetween(outflow.reportingDate, inflow.reportingDate)) }))
      .filter((match) => match.distance <= 3)
      .sort((a, b) => a.distance - b.distance
        || Number(accountHint(b.inflow)) - Number(accountHint(a.inflow))
        || a.inflow.id.localeCompare(b.inflow.id));
    const best = matches[0];
    if (!best) continue;
    const key = keyFor(outflow, best.inflow);
    if (decisions.has(key)) continue;
    usedInflows.add(best.inflow.id);
    const hinted = accountHint(outflow) || accountHint(best.inflow);
    suggestions.push({
      key,
      outflow,
      inflow: best.inflow,
      amountCents: Math.abs(signedNetMovement(outflow)),
      dateDistance: best.distance,
      confidence: best.distance <= 1 && hinted ? 'high' : 'medium',
      evidence: [
        'Mesmo valor e mesma moeda',
        best.distance === 0 ? 'Mesma data contábil' : `Datas separadas por ${best.distance} dia${best.distance === 1 ? '' : 's'}`,
        'Contas diferentes',
        ...(hinted ? ['Descrição sugere movimentação entre instituições'] : []),
      ],
    });
  }
  return suggestions.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1)
    || a.dateDistance - b.dateDistance
    || b.amountCents - a.amountCents);
}

function decisionFor(suggestion: InternalTransferSuggestion, status: InternalTransferDecision['status'], now: string): InternalTransferDecision {
  return {
    id: crypto.randomUUID(),
    suggestionKey: suggestion.key,
    outflowTransactionId: suggestion.outflow.id,
    inflowTransactionId: suggestion.inflow.id,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export function rejectInternalTransferSuggestion(state: AppState, suggestion: InternalTransferSuggestion): AppState {
  const now = new Date().toISOString();
  return {
    ...state,
    internalTransferDecisions: [
      decisionFor(suggestion, 'rejected', now),
      ...state.internalTransferDecisions.filter((decision) => decision.suggestionKey !== suggestion.key),
    ],
  };
}

export function confirmInternalTransferSuggestion(state: AppState, suggestion: InternalTransferSuggestion): AppState {
  const now = new Date().toISOString();
  const ids = new Set([suggestion.outflow.id, suggestion.inflow.id]);
  const transferGroupId = `confirmed:${suggestion.key}`;
  const transactions = state.transactions.map((transaction) => {
    if (!ids.has(transaction.id)) return transaction;
    return {
      ...transaction,
      kind: 'transfer' as const,
      technicalType: 'internal_transfer' as const,
      kindSource: 'manual' as const,
      analysisExcluded: true,
      transferGroupId,
      categoryId: undefined,
      categorySource: 'none' as const,
      categoryReviewStatus: 'not_applicable' as const,
      reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'ambiguous_transfer' && reason !== 'uncategorized'),
      needsReview: false,
      manualEditLog: [
        ...transaction.manualEditLog,
        { field: 'technicalType', oldValue: transaction.technicalType, newValue: 'internal_transfer', editedAt: now },
        { field: 'transferGroupId', oldValue: transaction.transferGroupId, newValue: transferGroupId, editedAt: now },
      ],
      updatedAt: now,
    };
  });
  return withRebuiltReviewGroups({
    ...state,
    transactions,
    internalTransferDecisions: [
      decisionFor(suggestion, 'confirmed', now),
      ...state.internalTransferDecisions.filter((decision) => decision.suggestionKey !== suggestion.key),
    ],
  });
}
