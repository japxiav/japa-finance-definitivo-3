import type { AppState, RecurrenceFrequency, SuggestionConfidence, Transaction, TransactionAllocation, TransferPurpose } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { normalizeMerchant } from '../core/merchant';
import { civilDaysBetween } from '../domain/dates';
import { withRebuiltReviewGroups } from '../classification/grouping';

export interface TransferRecurrenceSuggestion {
  id: string;
  key: string;
  recipientNormalized: string;
  recipientLabel: string;
  transactionIds: string[];
  observedCount: number;
  currency: string;
  direction: Transaction['direction'];
  minAmountCents: number;
  maxAmountCents: number;
  medianAmountCents: number;
  frequency: RecurrenceFrequency | 'irregular';
  confidence: SuggestionConfidence;
  evidence: string[];
  suggestedPurpose?: TransferPurpose;
  suggestedCategoryId?: string;
  suggestedLabel?: string;
  suggestedRelatedPerson?: string;
}

function counterpartyLabel(description: string): string {
  return description
    .replace(/\b(?:bank\s+)?transfer(?:red)?\s+(?:to|from)\b/gi, '')
    .replace(/\b(?:sent|received)\s+(?:to|from)\b/gi, '')
    .replace(/\btransfer[eê]ncia\s+(?:para|de)\b/gi, '')
    .replace(/\b(?:enviado|enviada)\s+para\b/gi, '')
    .replace(/\b(?:recebido|recebida)\s+de\b/gi, '')
    .replace(/\b(?:payment|pagamento)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function recipientKey(transaction: Transaction): string {
  const label = counterpartyLabel(transaction.descriptionOriginal);
  return normalizeMerchant(label || transaction.descriptionOriginal);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function amountTolerance(center: number): number {
  return Math.max(500, Math.round(center * 0.2));
}

function splitByAmount(transactions: Transaction[]): Transaction[][] {
  const sorted = [...transactions].sort((a, b) => Math.abs(signedNetMovement(a)) - Math.abs(signedNetMovement(b)));
  const clusters: Transaction[][] = [];
  for (const transaction of sorted) {
    const amount = Math.abs(signedNetMovement(transaction));
    const cluster = clusters.find((candidate) => {
      const center = median(candidate.map((item) => Math.abs(signedNetMovement(item))));
      return Math.abs(amount - center) <= amountTolerance(center);
    });
    if (cluster) cluster.push(transaction);
    else clusters.push([transaction]);
  }
  return clusters;
}

function frequencyFor(transactions: Transaction[]): { frequency: TransferRecurrenceSuggestion['frequency']; evidence: string[]; stable: boolean } {
  const dates = [...new Set(transactions.map((item) => item.reportingDate))].sort();
  if (dates.length < 3) return { frequency: 'irregular', evidence: [], stable: false };
  const gaps = dates.slice(1).map((date, index) => civilDaysBetween(dates[index]!, date));
  const middle = median(gaps);
  const averageDeviation = gaps.reduce((sum, gap) => sum + Math.abs(gap - middle), 0) / gaps.length;
  if (middle >= 26 && middle <= 35 && averageDeviation <= 8) {
    return { frequency: 'monthly', evidence: [`Intervalo mensal aproximado: mediana de ${middle} dias`], stable: true };
  }
  if (middle >= 6 && middle <= 9 && averageDeviation <= 3) {
    return { frequency: 'weekly', evidence: [`Intervalo semanal aproximado: mediana de ${middle} dias`], stable: true };
  }
  const span = civilDaysBetween(dates[0]!, dates.at(-1)!);
  return {
    frequency: 'irregular',
    evidence: [`${dates.length} datas observadas ao longo de ${span} dias`],
    stable: span >= 28 && transactions.length >= 4,
  };
}

function priorPurpose(
  transactions: Transaction[],
  allocations: TransactionAllocation[],
): Pick<TransferRecurrenceSuggestion, 'suggestedPurpose' | 'suggestedCategoryId' | 'suggestedLabel' | 'suggestedRelatedPerson'> {
  const transactionIds = new Set(transactions.map((item) => item.id));
  const relevant = allocations.filter((allocation) => transactionIds.has(allocation.transactionId));
  if (!relevant.length) return {};
  const count = <T extends string | undefined>(selector: (allocation: TransactionAllocation) => T): T | undefined => {
    const values = new Map<T, number>();
    for (const allocation of relevant) {
      const value = selector(allocation);
      if (!value) continue;
      values.set(value, (values.get(value) ?? 0) + 1);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return {
    suggestedPurpose: count((item) => item.purpose),
    suggestedCategoryId: count((item) => item.categoryId),
    suggestedLabel: count((item) => item.label),
    suggestedRelatedPerson: count((item) => item.relatedPerson),
  };
}

export function findTransferRecurrenceSuggestions(state: AppState, currency?: string): TransferRecurrenceSuggestion[] {
  const allocated = new Set(state.transactionAllocations.map((allocation) => allocation.transactionId));
  const candidates = state.transactions.filter((transaction) =>
    transaction.status === 'completed'
    && transaction.sourceComponent !== 'fee'
    && transaction.kind === 'transfer'
    && !transaction.analysisExcluded
    && (!currency || transaction.currency === currency),
  );
  const buckets = new Map<string, Transaction[]>();
  for (const transaction of candidates) {
    const recipient = recipientKey(transaction);
    if (!recipient || recipient.length < 3 || /^(transfer|bank transfer|payment|unknown)$/.test(recipient)) continue;
    const key = `${transaction.currency}|${transaction.direction}|${recipient}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(transaction);
    buckets.set(key, bucket);
  }

  const suggestions: TransferRecurrenceSuggestion[] = [];
  for (const [bucketKey, transactions] of buckets) {
    for (const cluster of splitByAmount(transactions)) {
      if (cluster.length < 3) continue;
      const dates = cluster.map((item) => item.reportingDate).sort();
      if (civilDaysBetween(dates[0]!, dates.at(-1)!) < 14) continue;
      const pending = cluster.filter((item) => !allocated.has(item.id));
      if (!pending.length) continue;
      const amounts = cluster.map((item) => Math.abs(signedNetMovement(item)));
      const center = median(amounts);
      const range = Math.max(...amounts) - Math.min(...amounts);
      const timing = frequencyFor(cluster);
      if (!timing.stable) continue;
      const recipientLabel = counterpartyLabel(cluster[0]!.descriptionOriginal) || cluster[0]!.descriptionOriginal;
      const confidence: SuggestionConfidence = cluster.length >= 4 && timing.frequency !== 'irregular' && range <= amountTolerance(center)
        ? 'high'
        : 'medium';
      const prior = priorPurpose(cluster, state.transactionAllocations);
      const key = `${bucketKey}|${Math.round(center / 500) * 500}`;
      suggestions.push({
        id: `recurrence:${key}`,
        key,
        recipientNormalized: recipientKey(cluster[0]!),
        recipientLabel,
        transactionIds: pending.map((item) => item.id),
        observedCount: cluster.length,
        currency: cluster[0]!.currency,
        direction: cluster[0]!.direction,
        minAmountCents: Math.min(...amounts),
        maxAmountCents: Math.max(...amounts),
        medianAmountCents: center,
        frequency: timing.frequency,
        confidence,
        evidence: [
          `Mesmo destinatário em ${cluster.length} movimentações`,
          `Valores próximos: variação de ${(range / 100).toFixed(2)} ${cluster[0]!.currency}`,
          ...timing.evidence,
          ...(prior.suggestedPurpose ? ['Finalidade já usada em movimentações semelhantes'] : []),
        ],
        ...prior,
      });
    }
  }
  return suggestions.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1)
    || b.transactionIds.length - a.transactionIds.length
    || a.recipientLabel.localeCompare(b.recipientLabel));
}

export function applyPurposeToRecurrence(
  state: AppState,
  suggestion: TransferRecurrenceSuggestion,
  input: {
    label: string;
    purpose?: TransferPurpose;
    categoryId?: string;
    relatedPerson?: string;
    recurring?: boolean;
  },
): AppState {
  const now = new Date().toISOString();
  const transactionById = new Map(state.transactions.map((item) => [item.id, item]));
  const existingIds = new Set(state.transactionAllocations.map((allocation) => allocation.transactionId));
  const allocations: TransactionAllocation[] = suggestion.transactionIds.flatMap((transactionId) => {
    if (existingIds.has(transactionId)) return [];
    const transaction = transactionById.get(transactionId);
    if (!transaction) return [];
    return [{
      id: crypto.randomUUID(),
      transactionId,
      label: input.label.trim() || suggestion.recipientLabel,
      amountCents: Math.abs(signedNetMovement(transaction)),
      categoryId: input.categoryId,
      purpose: input.purpose,
      relatedPerson: input.relatedPerson?.trim() || undefined,
      recurring: input.recurring ?? true,
      recurrenceFrequency: suggestion.frequency === 'irregular' ? undefined : suggestion.frequency,
      createdAt: now,
      updatedAt: now,
    }];
  });
  const targetIds = new Set(allocations.map((allocation) => allocation.transactionId));
  const transactions = state.transactions.map((transaction) => {
    if (!targetIds.has(transaction.id)) return transaction;
    const reviewReasons = transaction.reviewReasons.filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer');
    return {
      ...transaction,
      categoryReviewStatus: 'resolved' as const,
      reviewReasons,
      needsReview: reviewReasons.length > 0,
      manualEditLog: [...transaction.manualEditLog, {
        field: 'transactionAllocations',
        oldValue: state.transactionAllocations.filter((allocation) => allocation.transactionId === transaction.id).map((allocation) => allocation.id),
        newValue: allocations.filter((allocation) => allocation.transactionId === transaction.id).map((allocation) => allocation.id),
        editedAt: now,
      }],
      updatedAt: now,
    };
  });
  return withRebuiltReviewGroups({
    ...state,
    transactions,
    transactionAllocations: [...allocations, ...state.transactionAllocations],
  });
}
