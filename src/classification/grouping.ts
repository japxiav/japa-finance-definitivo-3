import { matchRule, normalizeMerchant } from '../core/merchant';
import { isCategoryCompatible } from './categoryCompatibility';
import { isCategoryReviewApplicable } from './technicalClassifier';
import type {
  AppState,
  Category,
  CategoryRule,
  ReviewGroup,
  SuggestionConfidence,
  Transaction,
} from '../core/types';

const NO_MERCHANT = 'movimentacao sem comerciante';

export function reviewGroupKey(transaction: Pick<Transaction, 'merchantNormalized' | 'descriptionOriginal' | 'currency' | 'direction' | 'kind' | 'technicalType'>): string {
  const merchant = transaction.merchantNormalized || normalizeMerchant(transaction.descriptionOriginal) || NO_MERCHANT;
  return [transaction.currency, transaction.direction, transaction.kind, transaction.technicalType, merchant].join('|');
}

function suggestionFromHistory(
  groupTransactions: Transaction[],
  allTransactions: Transaction[],
  categories: Category[],
): {
  categoryId?: string;
  confidence?: SuggestionConfidence;
  score?: number;
  explanation?: string;
  evidence: string[];
} {
  const sample = groupTransactions[0];
  if (!sample) return { evidence: [] };
  const groupIds = new Set(groupTransactions.map((item) => item.id));
  const counts = new Map<string, number>();
  for (const transaction of allTransactions) {
    if (groupIds.has(transaction.id)
      || transaction.status !== 'completed'
      || transaction.merchantNormalized !== sample.merchantNormalized
      || transaction.currency !== sample.currency
      || transaction.direction !== sample.direction
      || transaction.kind !== sample.kind
      || transaction.technicalType !== sample.technicalType
      || !transaction.categoryId) continue;
    const category = categories.find((item) => item.id === transaction.categoryId);
    if (!category || !isCategoryCompatible(category, sample)) continue;
    counts.set(transaction.categoryId, (counts.get(transaction.categoryId) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return { evidence: [] };
  const total = ranked.reduce((sum, item) => sum + item[1], 0);
  const ratio = top[1] / total;
  const confidence: SuggestionConfidence = top[1] >= 3 && ratio >= 0.8
    ? 'high'
    : top[1] >= 2 && ratio >= 0.6
      ? 'medium'
      : 'low';
  const categoryName = categories.find((item) => item.id === top[0])?.name ?? top[0];
  return {
    categoryId: top[0],
    confidence,
    score: Math.round(ratio * 100),
    explanation: `${top[1]} de ${total} movimentações anteriores deste padrão foram classificadas como ${categoryName}.`,
    evidence: [`Histórico: ${top[1]}/${total}`, `Consistência: ${Math.round(ratio * 100)}%`],
  };
}

function suggestionFromRule(
  transaction: Transaction,
  rules: CategoryRule[],
  categories: Category[],
): {
  categoryId?: string;
  confidence?: SuggestionConfidence;
  score?: number;
  explanation?: string;
  evidence: string[];
} {
  const rule = matchRule(transaction.descriptionOriginal, rules, {
    currency: transaction.currency,
    direction: transaction.direction,
    kind: transaction.kind,
    technicalType: transaction.technicalType,
  });
  if (!rule || rule.exceptionTransactionIds?.includes(transaction.id)) return { evidence: [] };
  const category = categories.find((item) => item.id === rule.categoryId);
  if (!category || !isCategoryCompatible(category, transaction)) return { evidence: [] };
  const confidence: SuggestionConfidence = rule.kind === 'exact' ? 'high' : 'medium';
  return {
    categoryId: category.id,
    confidence,
    score: rule.kind === 'exact' ? 99 : rule.kind === 'starts_with' ? 92 : 88,
    explanation: `A regra “${rule.merchantLabel ?? rule.pattern}” aponta para ${category.name}.`,
    evidence: [`Regra ${rule.kind === 'exact' ? 'exata' : 'por padrão de texto'}`],
  };
}

function buildSuggestion(
  transactions: Transaction[],
  state: Pick<AppState, 'transactions' | 'rules' | 'categories'>,
) {
  const first = transactions[0];
  if (!first) return { evidence: [] as string[] };
  const byRule = suggestionFromRule(first, state.rules, state.categories);
  if (byRule.categoryId) return byRule;
  return suggestionFromHistory(transactions, state.transactions, state.categories);
}

export function buildReviewGroups(
  state: Pick<AppState, 'transactions' | 'rules' | 'categories' | 'reviewGroups'>,
  now = new Date().toISOString(),
): ReviewGroup[] {
  const existingByKey = new Map(state.reviewGroups.map((group) => [group.key, group]));
  const candidates = state.transactions.filter((transaction) =>
    transaction.status === 'completed'
    && !transaction.categoryId
    && (transaction.categoryReviewStatus === 'pending' || transaction.categoryReviewStatus === 'deferred')
    && isCategoryReviewApplicable(transaction.technicalType),
  );
  const buckets = new Map<string, Transaction[]>();
  for (const transaction of candidates) {
    const key = reviewGroupKey(transaction);
    const bucket = buckets.get(key) ?? [];
    bucket.push(transaction);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([key, transactions]) => {
    transactions.sort((a, b) => b.reportingDate.localeCompare(a.reportingDate));
    const existing = existingByKey.get(key);
    const suggestion = buildSuggestion(transactions, state);
    const first = transactions[0]!;
    const transactionIds = transactions.map((item) => item.id);
    const status = transactions.some((item) => item.categoryReviewStatus === 'pending') ? 'pending' : 'deferred';
    const changed = !existing
      || existing.transactionIds.join('|') !== transactionIds.join('|')
      || existing.suggestedCategoryId !== suggestion.categoryId
      || existing.suggestionScore !== suggestion.score
      || existing.status !== status;
    return {
      id: existing?.id ?? crypto.randomUUID(),
      key,
      merchantNormalized: first.merchantNormalized || normalizeMerchant(first.descriptionOriginal) || NO_MERCHANT,
      merchantLabel: first.descriptionOriginal,
      currency: first.currency,
      direction: first.direction,
      kind: first.kind,
      technicalType: first.technicalType,
      transactionIds,
      suggestedCategoryId: suggestion.categoryId,
      suggestionConfidence: suggestion.confidence,
      suggestionScore: suggestion.score,
      suggestionExplanation: suggestion.explanation,
      suggestionEvidence: suggestion.evidence,
      status,
      deferredAt: status === 'deferred' ? (existing?.deferredAt ?? now) : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: changed ? now : existing.updatedAt,
    } satisfies ReviewGroup;
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return b.transactionIds.length - a.transactionIds.length || a.merchantLabel.localeCompare(b.merchantLabel);
  });
}

export function withRebuiltReviewGroups(state: AppState, now = new Date().toISOString()): AppState {
  return { ...state, reviewGroups: buildReviewGroups(state, now) };
}
