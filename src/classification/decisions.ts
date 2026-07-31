import type {
  AppState,
  CategoryRule,
  CategorySource,
  RuleKind,
  ReviewDecision,
  ReviewDecisionKind,
  Transaction,
  TransactionClassificationSnapshot,
} from '../core/types';
import { normalizeMerchant } from '../core/merchant';
import { withRebuiltReviewGroups } from './grouping';

function snapshot(transaction: Transaction): TransactionClassificationSnapshot {
  return {
    transactionId: transaction.id,
    categoryId: transaction.categoryId,
    categorySource: transaction.categorySource,
    categoryReviewStatus: transaction.categoryReviewStatus,
    needsReview: transaction.needsReview,
    reviewReasons: [...transaction.reviewReasons],
    manualEditLog: transaction.manualEditLog.map((edit) => ({ ...edit })),
    updatedAt: transaction.updatedAt,
  };
}

function sameRuleScope(
  rule: CategoryRule,
  scope: {
    currency?: string;
    direction?: Transaction['direction'];
    transactionKind?: Transaction['kind'];
    technicalType?: Transaction['technicalType'];
  },
): boolean {
  return rule.currency === scope.currency
    && rule.direction === scope.direction
    && rule.transactionKind === scope.transactionKind
    && rule.technicalType === scope.technicalType;
}

function ruleMatchesTransaction(rule: CategoryRule, transaction: Transaction): boolean {
  if (rule.source !== 'learned' || rule.active === false) return false;
  if (rule.currency && rule.currency !== transaction.currency) return false;
  if (rule.direction && rule.direction !== transaction.direction) return false;
  if (rule.transactionKind && rule.transactionKind !== transaction.kind) return false;
  if (rule.technicalType && rule.technicalType !== transaction.technicalType) return false;
  const merchant = normalizeMerchant(transaction.descriptionOriginal);
  const pattern = normalizeMerchant(rule.pattern);
  if (!pattern) return false;
  if (rule.kind === 'exact') return merchant === pattern;
  if (rule.kind === 'starts_with') return merchant.startsWith(pattern);
  return merchant.includes(pattern);
}

function cloneRule(rule: CategoryRule): CategoryRule {
  return { ...rule, exceptionTransactionIds: [...(rule.exceptionTransactionIds ?? [])] };
}

export function applyCategoryDecision(input: {
  state: AppState;
  transactionIds: string[];
  categoryId?: string;
  categorySource?: CategorySource;
  kind: ReviewDecisionKind;
  label: string;
  groupKey?: string;
  createRule?: {
    pattern: string;
    merchantLabel: string;
    kind?: RuleKind;
    currency?: string;
    direction?: Transaction['direction'];
    transactionKind?: Transaction['kind'];
    technicalType?: Transaction['technicalType'];
    exceptionTransactionIds?: string[];
  };
  now?: string;
}): AppState {
  const now = input.now ?? new Date().toISOString();
  const selectedIds = new Set(input.transactionIds);
  const beforeTransactions = input.state.transactions.filter((item) => selectedIds.has(item.id));
  if (beforeTransactions.length === 0 && !input.createRule) return input.state;
  const categorySource = input.categoryId ? (input.categorySource ?? 'manual') : 'none';

  const before = beforeTransactions.map(snapshot);
  const transactions = input.state.transactions.map((transaction) => {
    if (!selectedIds.has(transaction.id)) return transaction;
    const reviewReasons = transaction.reviewReasons.filter((reason) => reason !== 'uncategorized');
    return {
      ...transaction,
      categoryId: input.categoryId,
      categorySource,
      categoryReviewStatus: 'resolved' as const,
      reviewReasons,
      needsReview: reviewReasons.length > 0,
      manualEditLog: [...transaction.manualEditLog, {
        field: 'categoryId',
        oldValue: transaction.categoryId,
        newValue: input.categoryId,
        editedAt: now,
      }],
      updatedAt: now,
    };
  });

  let rules = input.state.rules.map(cloneRule);
  const changesById = new Map<string, ReviewDecision['ruleChanges'][number]>();
  const rememberRuleChange = (beforeRule: CategoryRule | undefined, afterRule: CategoryRule | undefined) => {
    const id = afterRule?.id ?? beforeRule?.id;
    if (!id) return;
    const existing = changesById.get(id);
    changesById.set(id, {
      before: existing?.before ?? (beforeRule ? cloneRule(beforeRule) : undefined),
      after: afterRule ? cloneRule(afterRule) : undefined,
    });
  };

  // Uma escolha manual vira exceção quando contradiz uma regra aprendida.
  // Quando volta a coincidir com a regra, a exceção é removida.
  if (input.categorySource !== 'rule' && !input.createRule) {
    for (const transaction of beforeTransactions) {
      rules = rules.map((rule) => {
        if (!ruleMatchesTransaction(rule, transaction)) return rule;
        const beforeRule = cloneRule(rule);
        const exceptions = new Set(rule.exceptionTransactionIds ?? []);
        if (input.categoryId === rule.categoryId) exceptions.delete(transaction.id);
        else exceptions.add(transaction.id);
        const afterRule = { ...rule, exceptionTransactionIds: [...exceptions], updatedAt: now };
        rememberRuleChange(beforeRule, afterRule);
        return afterRule;
      });
    }
  }

  if (input.createRule && input.categoryId) {
    const normalizedPattern = normalizeMerchant(input.createRule.pattern);
    const ruleKind = input.createRule.kind ?? 'exact';
    const scope = {
      currency: input.createRule.currency,
      direction: input.createRule.direction,
      transactionKind: input.createRule.transactionKind,
      technicalType: input.createRule.technicalType,
    };
    const existing = rules.find((rule) =>
      rule.source === 'learned'
      && rule.kind === ruleKind
      && normalizeMerchant(rule.pattern) === normalizedPattern
      && sameRuleScope(rule, scope));
    const exceptionIds = new Set([
      ...(existing?.exceptionTransactionIds ?? []),
      ...(input.createRule.exceptionTransactionIds ?? []),
    ]);
    selectedIds.forEach((id) => exceptionIds.delete(id));
    const learnedRule: CategoryRule = {
      id: existing?.id ?? `learned-${crypto.randomUUID()}`,
      pattern: normalizedPattern,
      kind: ruleKind,
      categoryId: input.categoryId,
      order: existing?.order ?? 0,
      source: 'learned',
      merchantLabel: input.createRule.merchantLabel,
      active: true,
      exceptionTransactionIds: [...exceptionIds],
      currency: scope.currency,
      direction: scope.direction,
      transactionKind: scope.transactionKind,
      technicalType: scope.technicalType,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    rules = [learnedRule, ...rules.filter((rule) => rule.id !== learnedRule.id)];
    rememberRuleChange(existing, learnedRule);
  }

  const afterTransactions = transactions.filter((item) => selectedIds.has(item.id));
  const decision: ReviewDecision = {
    id: crypto.randomUUID(),
    kind: input.kind,
    label: input.label,
    groupKey: input.groupKey,
    transactionIds: [...selectedIds],
    before,
    after: afterTransactions.map(snapshot),
    ruleChanges: [...changesById.values()],
    createdAt: now,
  };
  return withRebuiltReviewGroups({
    ...input.state,
    transactions,
    rules,
    reviewDecisions: [decision, ...input.state.reviewDecisions],
  }, now);
}

function changeGroupReviewStatus(
  state: AppState,
  groupKey: string,
  from: Transaction['categoryReviewStatus'],
  to: Transaction['categoryReviewStatus'],
  kind: ReviewDecisionKind,
  labelPrefix: string,
  now: string,
): AppState {
  const group = state.reviewGroups.find((item) => item.key === groupKey);
  if (!group) return state;
  const ids = new Set(group.transactionIds);
  const beforeTransactions = state.transactions.filter((item) => ids.has(item.id) && item.categoryReviewStatus === from);
  if (!beforeTransactions.length) return state;
  const before = beforeTransactions.map(snapshot);
  const transactions = state.transactions.map((transaction) => ids.has(transaction.id) && transaction.categoryReviewStatus === from
    ? { ...transaction, categoryReviewStatus: to, updatedAt: now }
    : transaction);
  const after = transactions.filter((item) => ids.has(item.id) && before.some((old) => old.transactionId === item.id)).map(snapshot);
  const decision: ReviewDecision = {
    id: crypto.randomUUID(),
    kind,
    label: `${labelPrefix}: ${group.merchantLabel}`,
    groupKey,
    transactionIds: beforeTransactions.map((item) => item.id),
    before,
    after,
    ruleChanges: [],
    createdAt: now,
  };
  return withRebuiltReviewGroups({
    ...state,
    transactions,
    reviewDecisions: [decision, ...state.reviewDecisions],
  }, now);
}

export function deferReviewGroup(state: AppState, groupKey: string, now = new Date().toISOString()): AppState {
  return changeGroupReviewStatus(state, groupKey, 'pending', 'deferred', 'defer_group', 'Resolver depois', now);
}

export function reopenReviewGroup(state: AppState, groupKey: string, now = new Date().toISOString()): AppState {
  return changeGroupReviewStatus(state, groupKey, 'deferred', 'pending', 'reopen_group', 'Reabrir revisão', now);
}

export function undoLatestReviewDecision(state: AppState, now = new Date().toISOString()): AppState {
  const decision = state.reviewDecisions.find((item) => !item.undoneAt);
  if (!decision) return state;
  const beforeById = new Map(decision.before.map((item) => [item.transactionId, item]));
  const transactions = state.transactions.map((transaction) => {
    const previous = beforeById.get(transaction.id);
    if (!previous) return transaction;
    return {
      ...transaction,
      categoryId: previous.categoryId,
      categorySource: previous.categorySource,
      categoryReviewStatus: previous.categoryReviewStatus,
      needsReview: previous.needsReview,
      reviewReasons: [...previous.reviewReasons],
      manualEditLog: previous.manualEditLog.map((edit) => ({ ...edit })),
      updatedAt: previous.updatedAt,
    };
  });

  let rules = [...state.rules];
  for (const change of decision.ruleChanges) {
    if (change.after) rules = rules.filter((rule) => rule.id !== change.after!.id);
    if (change.before) rules = [cloneRule(change.before), ...rules.filter((rule) => rule.id !== change.before!.id)];
  }

  return withRebuiltReviewGroups({
    ...state,
    transactions,
    rules,
    reviewDecisions: state.reviewDecisions.map((item) => item.id === decision.id ? { ...item, undoneAt: now } : item),
  }, now);
}
