import type { AppState, Category, ImportIssue, InternalTransferDecision, OwnerIdentityProfile, ReviewDecision, ReviewGroup, SyncMetadata, TechnicalMovementType, Transaction, TransactionAllocation } from './types';
import { canAddCents } from '../domain/arithmetic';
import { civilDateFromUtcInstant, civilDaysBetween, isCivilDate } from '../domain/dates';
import { localCivilDateFromInstant } from './date';
import { isTransactionKindDirectionCompatible, signedNetMovement } from './finance';
import { buildReviewGroups } from '../classification/grouping';
import { isCategoryCompatible } from '../classification/categoryCompatibility';
import { applyOwnerIdentityContext } from '../application/ownerIdentity';
import { extractMerchantIdentity, matchRule, normalizeMerchant } from './merchant';
import { parseMoneyToCents } from './money';
import { stableHash } from './hash';
import { accountBookId, accountBookName, normalizeProductName, sameAccountBook } from '../application/accountBooks';
import { withFriendlyDescription } from '../application/transactionPresentation';
import { linkCompoundEvents } from '../application/compoundEvents';
import {
  identifyTechnicalMovement,
  isCategoryReviewApplicable,
  isTechnicalTypeDirectionCompatible,
  kindForTechnicalType,
} from '../classification/technicalClassifier';

const CACHE_PREFIX = 'japa-finance-v0.3';
const CHECKPOINT_PREFIX = 'japa-finance-checkpoints-v0.3';
const SYNC_METADATA_PREFIX = 'japa-finance-sync-v0.4';

function cacheKey(userId: string) {
  return `${CACHE_PREFIX}:${userId}`;
}

function checkpointKey(userId: string) {
  return `${CHECKPOINT_PREFIX}:${userId}`;
}

function syncMetadataKey(userId: string) {
  return `${SYNC_METADATA_PREFIX}:${userId}`;
}

function migrateV2(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const transactions = Array.isArray(candidate.transactions)
    ? (candidate.transactions as Transaction[]).map((transaction) => ({
      ...transaction,
      source: transaction.source === 'manual'
        ? 'manual' as const
        : transaction.source === 'wise_csv'
          ? 'wise_csv' as const
          : 'revolut_csv' as const,
      categorySource: transaction.categorySource === 'manual'
        ? 'manual' as const
        : transaction.categorySource === 'rule'
          ? 'rule' as const
          : transaction.categoryId === 'income'
            ? 'system' as const
            : 'none' as const,
    }))
    : [];

  const oldAccounts = Array.isArray(candidate.accounts)
    ? candidate.accounts as AppState['accounts']
    : [];
  const accounts = [
    ...fallback.accounts.map((defaultAccount) => {
      const old = oldAccounts.find((item) => item.id === defaultAccount.id);
      return old ? { ...defaultAccount, ...old, institution: defaultAccount.institution } : defaultAccount;
    }),
    ...oldAccounts.filter((old) => !fallback.accounts.some((item) => item.id === old.id)),
  ];

  return {
    schemaVersion: 4,
    accounts,
    transactions,
    imports: Array.isArray(candidate.imports) ? candidate.imports : [],
    importIssues: [],
    categories: Array.isArray(candidate.categories) ? candidate.categories : fallback.categories,
    rules: Array.isArray(candidate.rules) ? candidate.rules : fallback.rules,
    balanceSnapshots: [],
    reservePolicies: [],
    plannedEvents: [],
    reconciliationBatches: [],
    plannedTransfers: [],
  };
}

const CATEGORY_REMAP: Record<string, string> = {
  clothing: 'shopping',
  games: 'shopping',
};

function mergeCategories(current: Category[], fallback: Category[]): Category[] {
  const migrated: Category[] = current
    .filter((category) => !(category.id in CATEGORY_REMAP))
    .map((category) => ({
      ...category,
      type: category.type ?? (category.id === 'income' ? 'income' : 'expense'),
      system: category.system ?? fallback.some((item) => item.id === category.id && item.system),
    }));
  const ids = new Set(migrated.map((item) => item.id));
  for (const category of fallback) {
    if (!ids.has(category.id)) migrated.push({ ...category });
  }
  return migrated;
}

function migrateV4(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const categories = mergeCategories(
    Array.isArray(candidate.categories) ? candidate.categories as Category[] : [],
    fallback.categories,
  );
  const categoryIds = new Set(categories.map((item) => item.id));
  const now = new Date().toISOString();
  const rules: AppState['rules'] = (Array.isArray(candidate.rules) ? candidate.rules as AppState['rules'] : [])
    .map((rule) => ({
      ...rule,
      categoryId: CATEGORY_REMAP[rule.categoryId] ?? rule.categoryId,
      source: rule.source ?? ('default' as const),
    }))
    .filter((rule) => categoryIds.has(rule.categoryId));
  const rulePatterns = new Set(rules.map((rule) => `${rule.kind}:${rule.pattern.toLocaleLowerCase('en-IE')}`));
  for (const rule of fallback.rules) {
    const key = `${rule.kind}:${rule.pattern.toLocaleLowerCase('en-IE')}`;
    if (!rulePatterns.has(key)) rules.push({ ...rule, createdAt: rule.createdAt ?? now, updatedAt: rule.updatedAt ?? now });
  }
  return {
    ...(candidate as unknown as Omit<AppState, 'schemaVersion' | 'categories' | 'rules' | 'transactions' | 'insightFeedback'>),
    schemaVersion: 5,
    categories,
    rules,
    transactions: (Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : []).map((transaction) => ({
      ...transaction,
      categoryId: transaction.categoryId ? (CATEGORY_REMAP[transaction.categoryId] ?? transaction.categoryId) : transaction.categoryId,
    })),
    insightFeedback: [],
  };
}

function migrateV5(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const categories = mergeCategories(
    (Array.isArray(candidate.categories) ? candidate.categories as Category[] : [])
      .filter((category) => category.id !== 'uncategorized'),
    fallback.categories,
  ).filter((category) => category.id !== 'uncategorized');
  const categoryIds = new Set(categories.map((category) => category.id));
  const transactions = oldTransactions.map((transaction) => {
    const remapped = transaction.categoryId ? (CATEGORY_REMAP[transaction.categoryId] ?? transaction.categoryId) : undefined;
    const categoryId = transaction.kind === 'transfer' || remapped === 'uncategorized' || !remapped || !categoryIds.has(remapped) ? undefined : remapped;
    const reviewReasons = Array.isArray(transaction.reviewReasons)
      ? transaction.reviewReasons.filter((reason) => reason !== 'uncategorized')
      : [];
    return {
      ...transaction,
      categoryId,
      categorySource: categoryId
        ? transaction.categorySource === 'manual'
          ? 'manual' as const
          : transaction.categorySource === 'rule'
            ? 'rule' as const
            : 'system' as const
        : 'none' as const,
      reviewReasons,
      needsReview: reviewReasons.length > 0,
    };
  });
  const rules = (Array.isArray(candidate.rules) ? candidate.rules as AppState['rules'] : [])
    .filter((rule) => rule.categoryId !== 'uncategorized' && categoryIds.has(rule.categoryId))
    .map((rule) => ({ ...rule, active: rule.active ?? true, exceptionTransactionIds: rule.exceptionTransactionIds ?? [] }));
  return {
    ...(candidate as unknown as Omit<AppState, 'schemaVersion' | 'transactions' | 'categories' | 'rules' | 'reviewGroups' | 'reviewDecisions'>),
    schemaVersion: 6,
    transactions,
    categories,
    rules,
    reviewGroups: [],
    reviewDecisions: [],
  };
}


const TECHNICAL_TYPES: TechnicalMovementType[] = [
  'salary', 'other_income', 'card_payment', 'cash_withdrawal', 'direct_debit', 'bank_fee',
  'other_expense', 'refund', 'incoming_transfer', 'outgoing_transfer', 'internal_transfer',
  'currency_conversion', 'adjustment', 'unknown',
];

function inferTechnicalType(transaction: Transaction): TechnicalMovementType {
  const identified = identifyTechnicalMovement({
    bankType: transaction.bankType,
    description: transaction.descriptionOriginal,
    direction: transaction.direction,
  }).technicalType;
  if (identified === 'internal_transfer' || identified === 'currency_conversion') return identified;
  if (transaction.kind === 'transfer') {
    return transaction.direction === 'inflow' ? 'incoming_transfer' : 'outgoing_transfer';
  }
  if (transaction.kind === 'income') return identified === 'salary' ? 'salary' : 'other_income';
  if (transaction.kind === 'expense') {
    return ['card_payment', 'cash_withdrawal', 'direct_debit', 'bank_fee', 'other_expense'].includes(identified)
      ? identified
      : 'other_expense';
  }
  if (transaction.kind === 'refund') return 'refund';
  if (transaction.kind === 'adjustment') return 'adjustment';
  // Versões antigas podiam deixar como desconhecido algo cujo tipo bancário
  // já contém informação suficiente. A migração aproveita essa evidência em
  // vez de obrigar o usuário a corrigir linha por linha outra vez.
  if (identified !== 'unknown') return identified;
  return 'unknown';
}

function migrateV6(candidate: Record<string, unknown>): Record<string, unknown> {
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const categories = (Array.isArray(candidate.categories) ? candidate.categories as Category[] : [])
    .map((category) => category.id === 'family' && category.system
      ? { ...category, type: 'both' as const }
      : category);
  const deferredIds = new Set(
    (Array.isArray(candidate.reviewGroups) ? candidate.reviewGroups as ReviewGroup[] : [])
      .filter((group) => group.status === 'deferred')
      .flatMap((group) => group.transactionIds),
  );
  const transactions = oldTransactions.map((transaction) => {
    const technicalType = inferTechnicalType(transaction);
    const kind = kindForTechnicalType(technicalType);
    const reviewReasons = Array.isArray(transaction.reviewReasons)
      ? transaction.reviewReasons.filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer')
      : [];
    if (technicalType === 'unknown' && !reviewReasons.includes('unknown_kind')) reviewReasons.push('unknown_kind');
    if (technicalType !== 'unknown') {
      const index = reviewReasons.indexOf('unknown_kind');
      if (index >= 0) reviewReasons.splice(index, 1);
    }
    const categoryId = isCategoryReviewApplicable(technicalType) ? transaction.categoryId : undefined;
    const categoryReviewStatus = categoryId
      ? 'resolved' as const
      : !isCategoryReviewApplicable(technicalType)
        ? 'not_applicable' as const
        : deferredIds.has(transaction.id)
          ? 'deferred' as const
          : 'pending' as const;
    const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
    return {
      ...transaction,
      kind,
      technicalType,
      analysisExcluded,
      transferGroupId: analysisExcluded ? (transaction.transferGroupId ?? `migrated-internal:${transaction.id}`) : undefined,
      categoryId,
      categorySource: categoryId ? transaction.categorySource : 'none' as const,
      categoryReviewStatus,
      reviewReasons,
      needsReview: reviewReasons.length > 0,
    };
  });
  const transactionById = new Map(transactions.map((item) => [item.id, item]));
  const reviewDecisions = (Array.isArray(candidate.reviewDecisions) ? candidate.reviewDecisions as ReviewDecision[] : []).map((decision) => ({
    ...decision,
    before: decision.before.map((item) => ({
      ...item,
      categoryReviewStatus: item.categoryId
        ? 'resolved' as const
        : (transactionById.get(item.transactionId)?.categoryReviewStatus ?? 'pending'),
    })),
    after: decision.after.map((item) => ({
      ...item,
      categoryReviewStatus: item.categoryId
        ? 'resolved' as const
        : (transactionById.get(item.transactionId)?.categoryReviewStatus ?? 'pending'),
    })),
  }));
  return {
    ...(candidate as unknown as Omit<AppState, 'schemaVersion' | 'transactions' | 'categories' | 'reviewGroups' | 'reviewDecisions'>),
    schemaVersion: 7,
    transactions,
    categories,
    reviewGroups: [],
    reviewDecisions,
  };
}


function feeCentsFromLegacyTransaction(transaction: Transaction): number {
  if (Number.isSafeInteger(transaction.feeCents) && (transaction.feeCents ?? 0) > 0) return transaction.feeCents!;
  const original = transaction.originalData ?? {};
  const raw = original['Comissão'] ?? original['Commission'] ?? original['Fee'] ?? original['Taxa'] ?? '';
  if (!raw.trim()) return 0;
  try {
    return parseMoneyToCents(raw);
  } catch {
    return 0;
  }
}

function isBankReverted(raw?: string): boolean {
  return /revert|reversal|reversed|revertida|revertido|estornada|estornado/i.test(raw ?? '');
}

function migrateV7(candidate: Record<string, unknown>): Record<string, unknown> {
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const existingFeeParents = new Set(oldTransactions
    .filter((transaction) => transaction.sourceComponent === 'fee' && transaction.feeOfTransactionId)
    .map((transaction) => transaction.feeOfTransactionId!));
  const transactions: Transaction[] = [];

  for (const legacy of oldTransactions) {
    if (legacy.sourceComponent === 'fee') {
      transactions.push({ ...legacy, sourceComponent: 'fee' });
      continue;
    }

    const reverted = isBankReverted(legacy.bankState);
    const feeCents = feeCentsFromLegacyTransaction(legacy);
    const reportedAmountCents = Number.isSafeInteger(legacy.reportedAmountCents)
      ? legacy.reportedAmountCents!
      : (legacy.direction === 'inflow' ? legacy.amountCents : -legacy.amountCents);
    const primary: Transaction = {
      ...legacy,
      status: reverted ? 'reverted' : legacy.status,
      reportedAmountCents,
      netMovementCents: reverted ? 0 : reportedAmountCents,
      feeCents: feeCents || undefined,
      sourceComponent: 'primary',
      sourceFingerprint: legacy.sourceFingerprint
        ? legacy.sourceFingerprint.replace(/:(?:primary|fee)$/, '') + ':primary'
        : legacy.sourceFileHash && legacy.sourceRowNumber
          ? `${legacy.sourceFileHash}:${legacy.sourceRowNumber}:primary`
          : legacy.sourceFingerprint,
      categoryId: reverted ? undefined : legacy.categoryId,
      categorySource: reverted ? 'none' : legacy.categorySource,
      categoryReviewStatus: reverted ? 'not_applicable' : legacy.categoryReviewStatus,
      needsReview: reverted ? false : legacy.needsReview,
      reviewReasons: reverted ? [] : [...legacy.reviewReasons],
    };
    transactions.push(primary);

    if (reverted || feeCents <= 0 || legacy.feeTreatment === 'INCLUDED_IN_REPORTED_AMOUNT' || existingFeeParents.has(legacy.id)) continue;
    const feeBase = stableHash(`${legacy.semanticFingerprint ?? legacy.dedupFingerprint.replace(/:\d+$/, '')}|fee|${feeCents}`);
    const feeDescription = `Comissão de ${legacy.descriptionOriginal}`;
    transactions.push({
      id: `fee-${legacy.id}`,
      accountId: legacy.accountId,
      importId: legacy.importId,
      dedupFingerprint: `${feeBase}:1`,
      sourceFileHash: legacy.sourceFileHash,
      sourceRowNumber: legacy.sourceRowNumber,
      amountCents: feeCents,
      reportedAmountCents: -feeCents,
      netMovementCents: -feeCents,
      feeTreatment: 'INCLUDED_IN_REPORTED_AMOUNT',
      sourceFingerprint: legacy.sourceFileHash && legacy.sourceRowNumber
        ? `${legacy.sourceFileHash}:${legacy.sourceRowNumber}:fee`
        : legacy.sourceFingerprint ? `${legacy.sourceFingerprint}:fee` : undefined,
      sourceComponent: 'fee',
      feeOfTransactionId: legacy.id,
      semanticFingerprint: feeBase,
      currency: legacy.currency,
      direction: 'outflow',
      source: legacy.source,
      status: 'completed',
      kind: 'expense',
      technicalType: 'bank_fee',
      kindSource: 'bank',
      analysisExcluded: false,
      descriptionOriginal: feeDescription,
      merchantNormalized: normalizeMerchant(feeDescription),
      bankType: 'Comissão',
      bankProduct: legacy.bankProduct,
      bankState: legacy.bankState,
      startedAt: legacy.startedAt,
      completedAt: legacy.completedAt,
      reportingDate: legacy.reportingDate,
      categorySource: 'none',
      categoryReviewStatus: 'resolved',
      needsReview: false,
      reviewReasons: [],
      manualEditLog: [],
      originalData: { ...legacy.originalData },
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    });
  }

  return {
    ...(candidate as object),
    schemaVersion: 8,
    transactions,
    reviewGroups: [],
  };
}

function migrateV8(candidate: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(candidate as object),
    schemaVersion: 9,
    transactionAllocations: [],
    internalTransferDecisions: [],
  };
}

function migrateV9(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const identity = fallback.ownerIdentity;
  const categories = Array.isArray(candidate.categories) ? candidate.categories as AppState['categories'] : fallback.categories;
  const rules = Array.isArray(candidate.rules) ? candidate.rules as AppState['rules'] : fallback.rules;
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const transactions = oldTransactions.map((transaction) => {
    const manuallyTyped = transaction.kindSource === 'manual'
      || transaction.manualEditLog?.some((edit) => edit.field === 'technicalType');
    const identified = identifyTechnicalMovement({
      bankType: transaction.bankType,
      description: transaction.descriptionOriginal,
      direction: transaction.direction,
    });
    const technicalType = !manuallyTyped && transaction.technicalType === 'unknown' && identified.technicalType !== 'unknown'
      ? identified.technicalType
      : transaction.technicalType;
    const kind = technicalType !== transaction.technicalType ? kindForTechnicalType(technicalType) : transaction.kind;
    const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
    let next: Transaction = {
      ...transaction,
      merchantNormalized: extractMerchantIdentity(transaction.descriptionOriginal),
      technicalType,
      kind,
      kindSource: technicalType !== transaction.technicalType ? 'bank' : transaction.kindSource,
      analysisExcluded,
      transferGroupId: analysisExcluded
        ? (transaction.transferGroupId ?? `migrated-context:${transaction.semanticFingerprint ?? transaction.id}`)
        : transaction.transferGroupId,
    };

    if (!next.categoryId && next.status === 'completed' && isCategoryReviewApplicable(next.technicalType)) {
      const rule = matchRule(next.descriptionOriginal, rules, {
        currency: next.currency,
        direction: next.direction,
        kind: next.kind,
        technicalType: next.technicalType,
      });
      const category = rule ? categories.find((item) => item.id === rule.categoryId) : undefined;
      if (rule && category && isCategoryCompatible(category, next)) {
        next = {
          ...next,
          categoryId: category.id,
          categorySource: 'rule',
          categoryReviewStatus: 'resolved',
        };
      }
    }

    const reviewReasons = [...new Set(next.reviewReasons ?? [])]
      .filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer' && reason !== 'unlinked_refund');
    if (next.technicalType === 'unknown') {
      if (!reviewReasons.includes('unknown_kind')) reviewReasons.push('unknown_kind');
    } else {
      const index = reviewReasons.indexOf('unknown_kind');
      if (index >= 0) reviewReasons.splice(index, 1);
    }
    if (analysisExcluded) {
      next = {
        ...next,
        categoryId: undefined,
        categorySource: 'none',
        categoryReviewStatus: 'not_applicable',
      };
    } else if (next.categoryId) {
      next = { ...next, categoryReviewStatus: 'resolved' };
    } else if (next.categoryReviewStatus !== 'deferred' && isCategoryReviewApplicable(next.technicalType)) {
      next = { ...next, categoryReviewStatus: 'pending' };
    }
    next = { ...next, reviewReasons, needsReview: reviewReasons.length > 0 };
    return applyOwnerIdentityContext(next, identity);
  });

  return {
    ...(candidate as object),
    schemaVersion: 10,
    ownerIdentity: identity,
    transactions,
    reviewGroups: [],
    imports: (Array.isArray(candidate.imports) ? candidate.imports as AppState['imports'] : []).map((batch) => ({
      ...batch,
      accountIds: batch.accountIds ?? [batch.accountId],
    })),
  };
}

function migrateV10(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const profile = (candidate.ownerIdentity && typeof candidate.ownerIdentity === 'object'
    ? candidate.ownerIdentity
    : fallback.ownerIdentity) as OwnerIdentityProfile;
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const transactions = oldTransactions.map((transaction) => {
    const manuallyTyped = transaction.kindSource === 'manual'
      || transaction.manualEditLog?.some((edit) => edit.field === 'technicalType');
    const identified = identifyTechnicalMovement({
      bankType: transaction.bankType,
      description: transaction.descriptionOriginal,
      direction: transaction.direction,
    });
    const canReclassify = !manuallyTyped && transaction.technicalType === 'unknown' && identified.technicalType !== 'unknown';
    const technicalType = canReclassify ? identified.technicalType : transaction.technicalType;
    const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
    let next: Transaction = {
      ...transaction,
      merchantNormalized: extractMerchantIdentity(transaction.descriptionOriginal),
      technicalType,
      kind: canReclassify ? kindForTechnicalType(technicalType) : transaction.kind,
      kindSource: canReclassify ? 'bank' : transaction.kindSource,
      analysisExcluded,
      transferGroupId: analysisExcluded
        ? (transaction.transferGroupId ?? `migrated-context:${transaction.semanticFingerprint ?? transaction.id}`)
        : transaction.transferGroupId,
    };

    const reviewReasons = [...new Set(next.reviewReasons ?? [])];
    if (technicalType === 'unknown') {
      if (!reviewReasons.includes('unknown_kind')) reviewReasons.push('unknown_kind');
    } else {
      const unknownIndex = reviewReasons.indexOf('unknown_kind');
      if (unknownIndex >= 0) reviewReasons.splice(unknownIndex, 1);
    }
    if (analysisExcluded) {
      next = {
        ...next,
        categoryId: undefined,
        categorySource: 'none',
        categoryReviewStatus: 'not_applicable',
      };
    } else if (next.categoryId) {
      next = { ...next, categoryReviewStatus: 'resolved' };
    } else if (next.categoryReviewStatus !== 'deferred' && isCategoryReviewApplicable(technicalType)) {
      next = { ...next, categoryReviewStatus: 'pending' };
    }
    next = { ...next, reviewReasons, needsReview: reviewReasons.length > 0 };
    return applyOwnerIdentityContext(next, profile);
  });

  return {
    ...(candidate as object),
    schemaVersion: 11,
    transactions,
    reviewGroups: [],
  };
}

function migrateV11(candidate: Record<string, unknown>, fallback: AppState): Record<string, unknown> {
  const now = new Date().toISOString();
  const oldAccounts = Array.isArray(candidate.accounts) ? candidate.accounts as AppState['accounts'] : [];
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const accounts: AppState['accounts'] = oldAccounts.map((account) => ({
    ...account,
    product: normalizeProductName(account.product || (account.institution === 'wise' ? 'Conta principal' : account.institution === 'revolut' ? 'Atual' : 'Conta principal')),
    source: account.source ?? 'manual',
  }));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const destinationByLegacyProduct = new Map<string, string>();

  for (const transaction of oldTransactions) {
    const legacy = accountById.get(transaction.accountId);
    if (!legacy || (legacy.institution !== 'wise' && legacy.institution !== 'revolut')) continue;
    const product = normalizeProductName(transaction.bankProduct || legacy.product || (legacy.institution === 'wise' ? 'Conta principal' : 'Atual'));
    const template = { ...legacy, product };
    let destination = accounts.find((account) => sameAccountBook(account, template.institution, template.currency, template.product));
    if (!destination) {
      destination = {
        id: accountBookId(legacy.institution, legacy.currency, product),
        name: accountBookName(legacy.institution, legacy.currency, product),
        currency: legacy.currency,
        institution: legacy.institution,
        product,
        source: 'import',
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      accounts.push(destination);
      accountById.set(destination.id, destination);
    }
    destinationByLegacyProduct.set(`${legacy.id}|${product}`, destination.id);
  }

  let transactions = oldTransactions.map((transaction) => {
    const legacy = accountById.get(transaction.accountId);
    const product = normalizeProductName(transaction.bankProduct || legacy?.product || (legacy?.institution === 'wise' ? 'Conta principal' : 'Atual'));
    const destinationId = destinationByLegacyProduct.get(`${transaction.accountId}|${product}`) ?? transaction.accountId;
    const manualTechnical = transaction.kindSource === 'manual' || transaction.manualEditLog?.some((edit) => edit.field === 'technicalType');
    const found = identifyTechnicalMovement({
      bankType: `${transaction.bankType ?? ''} ${transaction.originalData?.['Transaction Details Type'] ?? ''}`,
      description: transaction.descriptionOriginal,
      direction: transaction.direction,
    });
    const technicalType = !manualTechnical && (transaction.technicalType === 'unknown' || /wise charges for|rende\+/i.test(transaction.descriptionOriginal))
      ? found.technicalType
      : transaction.technicalType;
    const kind = manualTechnical ? transaction.kind : kindForTechnicalType(technicalType);
    const excluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
    let reviewReasons = [...new Set(transaction.reviewReasons ?? [])].filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer');
    if (technicalType === 'unknown' && !reviewReasons.includes('unknown_kind')) reviewReasons.push('unknown_kind');
    if (technicalType !== 'unknown') reviewReasons = reviewReasons.filter((reason) => reason !== 'unknown_kind');
    const next: Transaction = {
      ...transaction,
      accountId: destinationId,
      bankProduct: product,
      technicalType,
      kind,
      kindSource: manualTechnical ? transaction.kindSource : (technicalType === 'unknown' ? 'unknown' : 'bank'),
      analysisExcluded: excluded,
      transferGroupId: excluded ? (transaction.transferGroupId ?? `migrated-v12:${transaction.semanticFingerprint ?? transaction.id}`) : transaction.transferGroupId,
      categoryId: excluded && transaction.categorySource !== 'manual' ? undefined : transaction.categoryId,
      categorySource: excluded && transaction.categorySource !== 'manual' ? 'none' : transaction.categorySource,
      categoryReviewStatus: excluded && transaction.categorySource !== 'manual' ? 'not_applicable' : transaction.categoryReviewStatus,
      reviewReasons,
      needsReview: reviewReasons.length > 0,
      friendlyDescription: transaction.friendlyDescription,
      lifecycleFingerprint: transaction.lifecycleFingerprint ?? stableHash(JSON.stringify([
        destinationId, transaction.startedAt ?? transaction.reportingDate, transaction.amountCents,
        transaction.direction, normalizeMerchant(transaction.descriptionOriginal), transaction.currency, product,
        transaction.sourceComponent ?? 'primary',
      ])),
    };
    return withFriendlyDescription(next);
  });
  transactions = linkCompoundEvents({ ...(candidate as object), schemaVersion: 15, accounts, transactions } as AppState).transactions;

  const previousOwnerIdentity = (candidate.ownerIdentity ?? fallback.ownerIdentity) as OwnerIdentityProfile;
  const ownerIdentity: OwnerIdentityProfile = {
    ...previousOwnerIdentity,
    aliases: [...previousOwnerIdentity.aliases],
    emails: [...previousOwnerIdentity.emails],
    ibans: [...previousOwnerIdentity.ibans],
    ownAccountIds: [...previousOwnerIdentity.ownAccountIds],
  };
  ownerIdentity.ownAccountIds = [...new Set([
    ...ownerIdentity.ownAccountIds.filter((id) => accounts.some((account) => account.id === id)),
    ...transactions.filter((transaction) => ownerIdentity.ownAccountIds.includes(oldTransactions.find((old) => old.id === transaction.id)?.accountId ?? '')).map((transaction) => transaction.accountId),
  ])];
  ownerIdentity.updatedAt = now;

  const imports = (Array.isArray(candidate.imports) ? candidate.imports as AppState['imports'] : []).map((batch) => {
    const accountIds = [...new Set(transactions.filter((transaction) => transaction.importId === batch.id).map((transaction) => transaction.accountId))];
    return { ...batch, accountId: accountIds[0] ?? batch.accountId, accountIds: accountIds.length ? accountIds : (batch.accountIds ?? [batch.accountId]), updated: batch.updated ?? 0 };
  });

  const state = {
    ...(candidate as object),
    schemaVersion: 12,
    accounts,
    transactions,
    imports,
    ownerIdentity,
    financialMemory: [],
    knowledgeBase: [],
    auditProposals: [],
    aiAuditRuns: [],
    reviewGroups: [],
  } as unknown as AppState;
  state.reviewGroups = buildReviewGroups(state);
  return state as unknown as Record<string, unknown>;
}

function migrateV12(candidate: Record<string, unknown>): Record<string, unknown> {
  const transactions = (Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : []).map((transaction) => {
    if (!['incoming_transfer', 'outgoing_transfer', 'internal_transfer', 'currency_conversion'].includes(transaction.technicalType)) return transaction;
    const reviewReasons = [...new Set(transaction.reviewReasons ?? [])]
      .filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer');
    return withFriendlyDescription({
      ...transaction,
      // Transferência é um fato completo. Categoria e finalidade permanecem opcionais.
      categoryReviewStatus: 'not_applicable',
      reviewReasons,
      needsReview: reviewReasons.length > 0,
    });
  });
  const state = {
    ...(candidate as object),
    schemaVersion: 13,
    transactions,
    reviewGroups: [],
  } as unknown as AppState;
  state.reviewGroups = buildReviewGroups(state);
  return state as unknown as Record<string, unknown>;
}


function migrateV13(candidate: Record<string, unknown>): Record<string, unknown> {
  const oldTransactions = Array.isArray(candidate.transactions) ? candidate.transactions as Transaction[] : [];
  const transactionById = new Map(oldTransactions.map((transaction) => [transaction.id, transaction]));
  const transactions = oldTransactions.map((transaction) => {
    if (transaction.sourceComponent !== 'fee') return transaction;
    const parent = transaction.feeOfTransactionId ? transactionById.get(transaction.feeOfTransactionId) : undefined;
    const reviewReasons = [...new Set(transaction.reviewReasons ?? [])]
      .filter((reason) => reason !== 'unknown_kind' && reason !== 'ambiguous_transfer' && reason !== 'uncategorized');
    return withFriendlyDescription({
      ...transaction,
      // Alpha 6 podia reclassificar a linha sintética da comissão como conversão.
      // O componente continua sendo uma saída real, mas sua natureza é sempre taxa.
      technicalType: 'bank_fee',
      kind: 'expense',
      direction: 'outflow',
      kindSource: 'bank',
      analysisExcluded: false,
      transferGroupId: undefined,
      categoryId: undefined,
      categorySource: 'none',
      categoryReviewStatus: 'resolved',
      reviewReasons,
      needsReview: reviewReasons.length > 0,
      compoundEventId: transaction.compoundEventId ?? parent?.compoundEventId,
      friendlyDescription: 'Taxa de conversão',
    });
  });
  return {
    ...(candidate as object),
    schemaVersion: 14,
    transactions,
  } as Record<string, unknown>;
}

function migrateV14(candidate: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(candidate as object),
    schemaVersion: 15,
    financialObjects: Array.isArray(candidate.financialObjects) ? candidate.financialObjects : [],
    behaviorMemory: Array.isArray(candidate.behaviorMemory) ? candidate.behaviorMemory : [],
    onboarding: candidate.onboarding && typeof candidate.onboarding === 'object' && !Array.isArray(candidate.onboarding)
      ? candidate.onboarding
      : { completed: Array.isArray(candidate.transactions) && candidate.transactions.length > 0, completedAt: Array.isArray(candidate.transactions) && candidate.transactions.length > 0 ? new Date().toISOString() : undefined, lastStep: Array.isArray(candidate.transactions) && candidate.transactions.length > 0 ? 'done' : 'welcome' },
  } as Record<string, unknown>;
}

export function normalizeState(raw: unknown, fallback: AppState): AppState {
  if (!raw || typeof raw !== 'object') throw new Error('Backup não contém um estado válido');
  const candidate = raw as Record<string, unknown>;
  if (candidate.schemaVersion === 2) {
    return normalizeState(migrateV2(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 3) {
    return normalizeState({
      ...(candidate as object),
      schemaVersion: 4,
      balanceSnapshots: [],
      reservePolicies: [],
      plannedEvents: [],
      reconciliationBatches: [],
      plannedTransfers: [],
    }, fallback);
  }
  if (candidate.schemaVersion === 4) {
    return normalizeState(migrateV4(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 5) {
    return normalizeState(migrateV5(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 6) {
    return normalizeState(migrateV6(candidate), fallback);
  }
  if (candidate.schemaVersion === 7) {
    return normalizeState(migrateV7(candidate), fallback);
  }
  if (candidate.schemaVersion === 8) {
    return normalizeState(migrateV8(candidate), fallback);
  }
  if (candidate.schemaVersion === 9) {
    return normalizeState(migrateV9(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 10) {
    return normalizeState(migrateV10(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 11) {
    return normalizeState(migrateV11(candidate, fallback), fallback);
  }
  if (candidate.schemaVersion === 12) {
    return normalizeState(migrateV12(candidate), fallback);
  }
  if (candidate.schemaVersion === 13) {
    return normalizeState(migrateV13(candidate), fallback);
  }
  if (candidate.schemaVersion === 14) {
    return normalizeState(migrateV14(candidate), fallback);
  }
  if (candidate.schemaVersion !== 15) throw new Error(`Versão de backup não suportada: ${String(candidate.schemaVersion)}`);

  candidate.reconciliationBatches ??= [];
  candidate.plannedTransfers ??= [];
  candidate.insightFeedback ??= [];
  candidate.reviewGroups ??= [];
  candidate.reviewDecisions ??= [];
  candidate.transactionAllocations ??= [];
  candidate.internalTransferDecisions ??= [];
  candidate.ownerIdentity ??= fallback.ownerIdentity;
  candidate.financialMemory ??= [];
  candidate.knowledgeBase ??= [];
  candidate.auditProposals ??= [];
  candidate.aiAuditRuns ??= [];
  candidate.financialObjects ??= [];
  candidate.behaviorMemory ??= [];
  candidate.onboarding ??= { completed: false, lastStep: 'welcome' };
  const requiredArrays = ['accounts', 'transactions', 'imports', 'importIssues', 'categories', 'rules', 'balanceSnapshots', 'reservePolicies', 'plannedEvents', 'reconciliationBatches', 'plannedTransfers', 'insightFeedback', 'reviewGroups', 'reviewDecisions', 'transactionAllocations', 'internalTransferDecisions', 'financialMemory', 'knowledgeBase', 'auditProposals', 'aiAuditRuns', 'financialObjects', 'behaviorMemory'];
  for (const key of requiredArrays) {
    if (!Array.isArray(candidate[key])) throw new Error(`Backup inválido: ${key} não é uma lista`);
  }

  const state = candidate as unknown as AppState;
  if (!state.onboarding || typeof state.onboarding !== 'object' || Array.isArray(state.onboarding)) throw new Error('Backup inválido: onboarding ausente');
  state.onboarding = {
    completed: Boolean(state.onboarding.completed),
    completedAt: typeof state.onboarding.completedAt === 'string' ? state.onboarding.completedAt : undefined,
    dismissedAt: typeof state.onboarding.dismissedAt === 'string' ? state.onboarding.dismissedAt : undefined,
    lastStep: ['welcome','privacy','accounts','import','done'].includes(String(state.onboarding.lastStep)) ? state.onboarding.lastStep : 'welcome',
  };
  state.financialObjects = state.financialObjects.filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string').map((item) => ({
    ...item,
    transactionIds: Array.isArray(item.transactionIds) ? [...new Set(item.transactionIds.filter((id): id is string => typeof id === 'string'))] : [],
    plannedEventIds: Array.isArray(item.plannedEventIds) ? [...new Set(item.plannedEventIds.filter((id): id is string => typeof id === 'string'))] : [],
  }));
  state.behaviorMemory = state.behaviorMemory.filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string').map((item) => ({
    ...item,
    evidence: Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : [],
    confirmed: Boolean(item.confirmed),
  }));
  const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const canonicalTimestamp = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
    if (!match) return undefined;
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, millisecondRaw = '0'] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    const millisecond = Number(millisecondRaw.padEnd(3, '0'));
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute ||
      date.getUTCSeconds() !== second ||
      date.getUTCMilliseconds() !== millisecond
    ) return undefined;
    return date.toISOString();
  };
  const validTimestamp = (value: unknown) => canonicalTimestamp(value) !== undefined;
  const canonicalBankTimestamp = (value: unknown): string | undefined => {
    const utc = canonicalTimestamp(value);
    if (utc) return utc;
    if (typeof value !== 'string') return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) return undefined;
    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw);
    if (hour > 23 || minute > 59 || second > 59) return undefined;
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
    return value;
  };
  const validBankTimestamp = (value: unknown) => canonicalBankTimestamp(value) !== undefined;
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value);

  const accountIds = new Set<string>();
  for (const account of state.accounts) {
    if (!nonEmpty(account.id) || !nonEmpty(account.name) || !nonEmpty(account.currency)) {
      throw new Error('Backup contém conta inválida');
    }
    if (accountIds.has(account.id)) throw new Error('Backup contém contas duplicadas');
    accountIds.add(account.id);
    if (typeof account.active !== 'boolean') throw new Error('Backup contém estado de conta inválido');
    if (!oneOf(account.institution, ['revolut', 'wise', 'cash', 'other'] as const)) throw new Error('Backup contém instituição de conta inválida');
    if (account.product !== undefined && !nonEmpty(account.product)) throw new Error('Backup contém produto de conta inválido');
    if (account.source !== undefined && !oneOf(account.source, ['default', 'import', 'manual'] as const)) throw new Error('Backup contém origem de conta inválida');
    if (account.archivedAt !== undefined && !validTimestamp(account.archivedAt)) throw new Error('Backup contém arquivamento de conta inválido');
  }
  const accountById = new Map(state.accounts.map((account) => [account.id, account]));

  if (!state.ownerIdentity || typeof state.ownerIdentity !== 'object') throw new Error('Backup não contém perfil de identidade válido');
  if (!nonEmpty(state.ownerIdentity.displayName)) throw new Error('Backup contém nome próprio inválido');
  for (const field of ['aliases', 'emails', 'ibans', 'ownAccountIds'] as const) {
    const values = state.ownerIdentity[field];
    if (!Array.isArray(values) || values.some((value) => !nonEmpty(value))) throw new Error(`Backup contém ${field} inválidos`);
    state.ownerIdentity[field] = [...new Set(values.map((value) => value.trim()))];
  }
  if (state.ownerIdentity.ownAccountIds.some((id) => !accountById.has(id))) throw new Error('Backup contém conta própria inexistente');
  if (!validTimestamp(state.ownerIdentity.updatedAt)) throw new Error('Backup contém atualização de identidade inválida');
  state.ownerIdentity.updatedAt = canonicalTimestamp(state.ownerIdentity.updatedAt)!;

  const categoryIds = new Set<string>();
  for (const category of state.categories) {
    if (!nonEmpty(category.id) || categoryIds.has(category.id)) {
      throw new Error('Backup contém categorias duplicadas ou sem ID');
    }
    categoryIds.add(category.id);
    if (!nonEmpty(category.name) || typeof category.active !== 'boolean') {
      throw new Error('Backup contém categoria inválida');
    }
    if (category.type !== undefined && !oneOf(category.type, ['expense', 'income', 'both', 'system'] as const)) {
      throw new Error('Backup contém tipo de categoria inválido');
    }
    if (category.id === 'family' && category.system && category.type === 'expense') category.type = 'both';
    if (category.icon !== undefined && !nonEmpty(category.icon)) throw new Error('Backup contém ícone de categoria inválido');
    if (category.color !== undefined && !nonEmpty(category.color)) throw new Error('Backup contém cor de categoria inválida');
    if (category.system !== undefined && typeof category.system !== 'boolean') throw new Error('Backup contém categoria de sistema inválida');
    if (category.createdAt !== undefined) {
      if (!validTimestamp(category.createdAt)) throw new Error('Backup contém criação de categoria inválida');
      category.createdAt = canonicalTimestamp(category.createdAt)!;
    }
    if (category.archivedAt !== undefined) {
      if (!validTimestamp(category.archivedAt)) throw new Error('Backup contém arquivamento de categoria inválido');
      category.archivedAt = canonicalTimestamp(category.archivedAt)!;
    }
  }

  const ruleIds = new Set<string>();
  for (const rule of state.rules) {
    if (!nonEmpty(rule.id) || ruleIds.has(rule.id)) throw new Error('Backup contém regras duplicadas ou sem ID');
    ruleIds.add(rule.id);
    if (!nonEmpty(rule.pattern) || !oneOf(rule.kind, ['exact', 'contains', 'starts_with'] as const)) {
      throw new Error('Backup contém regra de categorização inválida');
    }
    if (!categoryIds.has(rule.categoryId)) throw new Error('Backup contém regra ligada a categoria inexistente');
    if (!Number.isSafeInteger(rule.order) || rule.order < 0) throw new Error('Backup contém ordem de regra inválida');
    if (rule.source !== undefined && !oneOf(rule.source, ['default', 'learned'] as const)) throw new Error('Backup contém origem de regra inválida');
    if (rule.active !== undefined && typeof rule.active !== 'boolean') throw new Error('Backup contém estado de regra inválido');
    rule.active ??= true;
    if (rule.exceptionTransactionIds !== undefined && (!Array.isArray(rule.exceptionTransactionIds) || rule.exceptionTransactionIds.some((id) => !nonEmpty(id)))) {
      throw new Error('Backup contém exceções de regra inválidas');
    }
    rule.exceptionTransactionIds ??= [];
    if (rule.currency !== undefined && !nonEmpty(rule.currency)) throw new Error('Backup contém moeda de regra inválida');
    if (rule.direction !== undefined && !oneOf(rule.direction, ['inflow', 'outflow'] as const)) throw new Error('Backup contém direção de regra inválida');
    if (rule.transactionKind !== undefined && !oneOf(rule.transactionKind, ['income', 'expense', 'transfer', 'refund', 'adjustment', 'unknown'] as const)) throw new Error('Backup contém natureza financeira de regra inválida');
    if (rule.technicalType !== undefined && !oneOf(rule.technicalType, TECHNICAL_TYPES)) throw new Error('Backup contém tipo técnico de regra inválido');
    if (rule.merchantLabel !== undefined && !nonEmpty(rule.merchantLabel)) throw new Error('Backup contém rótulo de comerciante inválido');
    if (rule.createdAt !== undefined) {
      if (!validTimestamp(rule.createdAt)) throw new Error('Backup contém criação de regra inválida');
      rule.createdAt = canonicalTimestamp(rule.createdAt)!;
    }
    if (rule.updatedAt !== undefined) {
      if (!validTimestamp(rule.updatedAt)) throw new Error('Backup contém atualização de regra inválida');
      rule.updatedAt = canonicalTimestamp(rule.updatedAt)!;
    }
  }

  const transactionIds = new Set<string>();
  for (const transaction of state.transactions) {
    if (!nonEmpty(transaction.id) || transactionIds.has(transaction.id)) throw new Error('Backup contém transações duplicadas ou sem ID');
    transactionIds.add(transaction.id);
    const transactionAccount = accountById.get(transaction.accountId);
    if (!transactionAccount) throw new Error(`Transação aponta para conta inexistente: ${transaction.accountId}`);
    if (transactionAccount.currency !== transaction.currency) throw new Error('Backup contém transação em moeda incompatível com a conta');
    if (!nonEmpty(transaction.dedupFingerprint) || !nonEmpty(transaction.descriptionOriginal) || !nonEmpty(transaction.merchantNormalized)) {
      throw new Error('Backup contém metadados obrigatórios de transação inválidos');
    }
    if (transaction.categoryId !== undefined && (!nonEmpty(transaction.categoryId) || !categoryIds.has(transaction.categoryId))) {
      throw new Error('Backup contém transação ligada a categoria inexistente');
    }
    if (!Number.isSafeInteger(transaction.amountCents) || transaction.amountCents < 0) throw new Error('Backup contém valor monetário inválido');
    if (transaction.availableImpactCents !== undefined && !Number.isSafeInteger(transaction.availableImpactCents)) throw new Error('Backup contém impacto disponível inválido');
    if (transaction.lifecycleFingerprint !== undefined && !nonEmpty(transaction.lifecycleFingerprint)) throw new Error('Backup contém identidade de ciclo inválida');
    if (transaction.friendlyDescription !== undefined && !nonEmpty(transaction.friendlyDescription)) throw new Error('Backup contém descrição amigável inválida');
    if (!oneOf(transaction.direction, ['inflow', 'outflow'] as const)) throw new Error('Backup contém direção de transação inválida');
    if (!oneOf(transaction.kind, ['income', 'expense', 'transfer', 'refund', 'adjustment', 'unknown'] as const)) throw new Error('Backup contém natureza financeira inválida');
    if (!oneOf(transaction.technicalType, TECHNICAL_TYPES)) throw new Error('Backup contém tipo técnico de transação inválido');
    if (transaction.kind !== kindForTechnicalType(transaction.technicalType)) throw new Error('Backup contém tipo técnico incoerente com a natureza financeira');
    if (!oneOf(transaction.status, ['completed', 'pending', 'reverted', 'voided', 'merged'] as const)) throw new Error('Backup contém status de transação inválido');
    if (!oneOf(transaction.source, ['revolut_csv', 'wise_csv', 'revolut_pdf', 'manual'] as const)) throw new Error('Backup contém origem de transação inválida');
    if (transaction.sourceComponent !== undefined && !oneOf(transaction.sourceComponent, ['primary', 'fee'] as const)) throw new Error('Backup contém componente de transação inválido');
    transaction.sourceComponent ??= 'primary';
    if (!oneOf(transaction.kindSource, ['bank', 'manual', 'rule', 'system', 'unknown'] as const)) throw new Error('Backup contém origem de classificação inválida');
    if (!oneOf(transaction.categorySource, ['manual', 'rule', 'system', 'none'] as const)) throw new Error('Backup contém origem de categoria inválida');
    if (!oneOf(transaction.categoryReviewStatus, ['pending', 'deferred', 'resolved', 'not_applicable'] as const)) throw new Error('Backup contém estado de revisão de categoria inválido');
    if (!transaction.categoryId && transaction.categorySource !== 'none') throw new Error('Backup contém categoria ausente com origem incompatível');
    if (transaction.categoryId && transaction.categorySource === 'none') throw new Error('Backup contém categoria definida sem origem');
    if (transaction.categoryId && transaction.categoryReviewStatus !== 'resolved') throw new Error('Backup contém categoria definida ainda pendente de revisão');
    if ((transaction.categoryReviewStatus === 'pending' || transaction.categoryReviewStatus === 'deferred') && transaction.categoryId) throw new Error('Backup contém revisão pendente já categorizada');
    if (!isCategoryReviewApplicable(transaction.technicalType)) {
      transaction.categoryId = undefined;
      transaction.categorySource = 'none';
      transaction.categoryReviewStatus = 'not_applicable';
    }
    if (transaction.status === 'reverted') {
      transaction.netMovementCents = 0;
      transaction.categoryId = undefined;
      transaction.categorySource = 'none';
      transaction.categoryReviewStatus = 'not_applicable';
      transaction.reviewReasons = [];
      transaction.needsReview = false;
    }
    const excludedByType = transaction.technicalType === 'internal_transfer' || transaction.technicalType === 'currency_conversion';
    transaction.analysisExcluded = excludedByType;
    if (excludedByType && !transaction.transferGroupId) transaction.transferGroupId = `restored-internal:${transaction.id}`;
    if (!excludedByType) transaction.transferGroupId = undefined;
    if (!isTransactionKindDirectionCompatible(transaction.kind, transaction.direction)
      || !isTechnicalTypeDirectionCompatible(transaction.technicalType, transaction.direction)) throw new Error('Backup contém tipo incompatível com a direção da transação');
    if (transaction.netMovementCents !== undefined && !Number.isSafeInteger(transaction.netMovementCents)) throw new Error('Backup contém movimento líquido inválido');
    if (transaction.netMovementCents !== undefined && ((transaction.direction === 'inflow' && transaction.netMovementCents < 0) || (transaction.direction === 'outflow' && transaction.netMovementCents > 0))) {
      throw new Error('Backup contém movimento líquido incompatível com a direção da transação');
    }
    if (transaction.feeCents !== undefined && (!Number.isSafeInteger(transaction.feeCents) || transaction.feeCents < 0)) throw new Error('Backup contém taxa inválida');
    if (!isCivilDate(transaction.reportingDate)) throw new Error('Backup contém data contábil inválida');
    if (transaction.startedAt !== undefined) {
      const normalized = canonicalBankTimestamp(transaction.startedAt);
      if (!normalized) throw new Error('Backup contém início de transação inválido');
      transaction.startedAt = normalized;
    }
    if (transaction.completedAt !== undefined) {
      const normalized = canonicalBankTimestamp(transaction.completedAt);
      if (!normalized) throw new Error('Backup contém conclusão de transação inválida');
      transaction.completedAt = normalized;
    }
    if (!validTimestamp(transaction.createdAt) || !validTimestamp(transaction.updatedAt)) throw new Error('Backup contém timestamps de transação inválidos');
    transaction.createdAt = canonicalTimestamp(transaction.createdAt)!;
    transaction.updatedAt = canonicalTimestamp(transaction.updatedAt)!;
    if (transaction.updatedAt < transaction.createdAt) throw new Error('Backup contém transação atualizada antes da criação');
    if (!Array.isArray(transaction.manualEditLog) || !transaction.originalData || typeof transaction.originalData !== 'object' || Array.isArray(transaction.originalData)) {
      throw new Error('Backup contém trilha de auditoria de transação inválida');
    }
    for (const edit of transaction.manualEditLog) {
      if (!nonEmpty(edit.field) || !validTimestamp(edit.editedAt)) throw new Error('Backup contém edição manual inválida');
      edit.editedAt = new Date(edit.editedAt).toISOString();
      if (edit.editedAt < transaction.createdAt || edit.editedAt > transaction.updatedAt) {
        throw new Error('Backup contém edição manual fora da linha temporal da transação');
      }
    }
    if (transaction.startedAt !== undefined && !validBankTimestamp(transaction.startedAt)) throw new Error('Backup contém início de transação inválido');
    if (transaction.completedAt !== undefined && !validBankTimestamp(transaction.completedAt)) throw new Error('Backup contém conclusão de transação inválida');
    if (transaction.startedAt && transaction.completedAt && Date.parse(transaction.completedAt) < Date.parse(transaction.startedAt)) {
      throw new Error('Backup contém transação concluída antes de começar');
    }
    if (transaction.feeTreatment !== undefined && !oneOf(transaction.feeTreatment, ['INCLUDED_IN_REPORTED_AMOUNT', 'ADDITIONAL_TO_REPORTED_AMOUNT'] as const)) {
      throw new Error('Backup contém tratamento de taxa inválido');
    }
    if (transaction.contextConfidence !== undefined && !oneOf(transaction.contextConfidence, ['high', 'medium', 'low'] as const)) {
      throw new Error('Backup contém confiança de contexto inválida');
    }
    if (transaction.contextEvidence !== undefined && (!Array.isArray(transaction.contextEvidence) || transaction.contextEvidence.some((item) => !nonEmpty(item)))) {
      throw new Error('Backup contém evidência de contexto inválida');
    }
    if (transaction.ownerIdentityMatched !== undefined && typeof transaction.ownerIdentityMatched !== 'boolean') {
      throw new Error('Backup contém correspondência de identidade inválida');
    }
    const allowedReviewReasons = new Set([
      'uncategorized', 'unknown_kind', 'possible_duplicate', 'zero_amount',
      'unverified_fee', 'ambiguous_transfer', 'unlinked_refund',
    ]);
    if (!Array.isArray(transaction.reviewReasons) || transaction.reviewReasons.some((reason) => !allowedReviewReasons.has(reason))) {
      throw new Error('Backup contém motivos de revisão inválidos');
    }
    transaction.reviewReasons = [...new Set(transaction.reviewReasons.filter((reason) => reason !== 'ambiguous_transfer' && reason !== 'uncategorized'))];
    if (transaction.technicalType === 'unknown' && !transaction.reviewReasons.includes('unknown_kind')) transaction.reviewReasons.push('unknown_kind');
    if (transaction.technicalType !== 'unknown') transaction.reviewReasons = transaction.reviewReasons.filter((reason) => reason !== 'unknown_kind');
    transaction.needsReview = transaction.reviewReasons.length > 0;
  }


  const transactionByIdForFees = new Map(state.transactions.map((transaction) => [transaction.id, transaction]));
  for (const transaction of state.transactions) {
    if (transaction.sourceComponent === 'fee') {
      const parent = transaction.feeOfTransactionId ? transactionByIdForFees.get(transaction.feeOfTransactionId) : undefined;
      if (!parent || parent.sourceComponent === 'fee') throw new Error('Backup contém taxa sem movimentação de origem');
      if (transaction.accountId !== parent.accountId
        || transaction.currency !== parent.currency
        || transaction.reportingDate !== parent.reportingDate
        || transaction.importId !== parent.importId) {
        throw new Error('Backup contém taxa incompatível com a movimentação de origem');
      }
      if (transaction.technicalType !== 'bank_fee' || transaction.kind !== 'expense' || transaction.direction !== 'outflow') {
        throw new Error('Backup contém componente de taxa com natureza inválida');
      }
    } else if (transaction.feeOfTransactionId !== undefined) {
      throw new Error('Backup contém vínculo de taxa em movimentação principal');
    }
  }


  const allocationIds = new Set<string>();
  const allocationTotals = new Map<string, number>();
  for (const allocation of state.transactionAllocations as TransactionAllocation[]) {
    if (!nonEmpty(allocation.id) || allocationIds.has(allocation.id)) throw new Error('Backup contém detalhamentos duplicados ou sem ID');
    allocationIds.add(allocation.id);
    const transaction = transactionByIdForFees.get(allocation.transactionId);
    if (!transaction || transaction.kind !== 'transfer' || transaction.status === 'reverted') {
      throw new Error('Backup contém detalhamento ligado a movimentação incompatível');
    }
    if (!nonEmpty(allocation.label) || !Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0) {
      throw new Error('Backup contém item de detalhamento inválido');
    }
    if (allocation.categoryId !== undefined && !categoryIds.has(allocation.categoryId)) throw new Error('Backup contém detalhamento ligado a categoria inexistente');
    if (allocation.purpose !== undefined && !oneOf(allocation.purpose, ['subscription', 'housing', 'family', 'support', 'debt', 'groceries', 'leisure', 'reimbursement', 'other'] as const)) {
      throw new Error('Backup contém finalidade de transferência inválida');
    }
    if (allocation.relatedPerson !== undefined && !nonEmpty(allocation.relatedPerson)) throw new Error('Backup contém pessoa relacionada inválida');
    if (allocation.recurring !== undefined && typeof allocation.recurring !== 'boolean') throw new Error('Backup contém recorrência inválida');
    if (allocation.recurrenceFrequency !== undefined && !oneOf(allocation.recurrenceFrequency, ['weekly', 'monthly', 'yearly'] as const)) throw new Error('Backup contém frequência de recorrência inválida');
    if (allocation.nextDueDate !== undefined && !isCivilDate(allocation.nextDueDate)) throw new Error('Backup contém próxima data de detalhamento inválida');
    if (allocation.plannedEventId !== undefined && !nonEmpty(allocation.plannedEventId)) throw new Error('Backup contém vínculo de compromisso inválido');
    if (allocation.note !== undefined && typeof allocation.note !== 'string') throw new Error('Backup contém nota de detalhamento inválida');
    if (!validTimestamp(allocation.createdAt) || !validTimestamp(allocation.updatedAt)) throw new Error('Backup contém timestamp de detalhamento inválido');
    allocation.createdAt = canonicalTimestamp(allocation.createdAt)!;
    allocation.updatedAt = canonicalTimestamp(allocation.updatedAt)!;
    if (allocation.updatedAt < allocation.createdAt) throw new Error('Backup contém detalhamento atualizado antes da criação');
    const current = allocationTotals.get(allocation.transactionId) ?? 0;
    if (!canAddCents(current, allocation.amountCents)) throw new Error('Backup contém detalhamento acima do limite monetário seguro');
    allocationTotals.set(allocation.transactionId, current + allocation.amountCents);
  }
  for (const [transactionId, allocatedCents] of allocationTotals) {
    const transaction = transactionByIdForFees.get(transactionId)!;
    if (allocatedCents !== Math.abs(signedNetMovement(transaction))) {
      throw new Error('Backup contém detalhamento que não fecha com o valor da movimentação');
    }
  }

  const internalDecisionIds = new Set<string>();
  const internalSuggestionKeys = new Set<string>();
  for (const decision of state.internalTransferDecisions as InternalTransferDecision[]) {
    if (!nonEmpty(decision.id) || internalDecisionIds.has(decision.id) || !nonEmpty(decision.suggestionKey) || internalSuggestionKeys.has(decision.suggestionKey)) {
      throw new Error('Backup contém decisão de transferência interna duplicada ou inválida');
    }
    internalDecisionIds.add(decision.id);
    internalSuggestionKeys.add(decision.suggestionKey);
    const outflow = transactionByIdForFees.get(decision.outflowTransactionId);
    const inflow = transactionByIdForFees.get(decision.inflowTransactionId);
    if (!outflow || !inflow || outflow.direction !== 'outflow' || inflow.direction !== 'inflow' || outflow.accountId === inflow.accountId || outflow.currency !== inflow.currency) {
      throw new Error('Backup contém decisão de transferência interna incompatível');
    }
    if (!oneOf(decision.status, ['confirmed', 'rejected'] as const)) throw new Error('Backup contém estado de transferência interna inválido');
    if (!validTimestamp(decision.createdAt) || !validTimestamp(decision.updatedAt)) throw new Error('Backup contém timestamp de transferência interna inválido');
    decision.createdAt = canonicalTimestamp(decision.createdAt)!;
    decision.updatedAt = canonicalTimestamp(decision.updatedAt)!;
  }

  const importIds = new Set<string>();
  for (const batch of state.imports) {
    if (!nonEmpty(batch.id) || importIds.has(batch.id)) throw new Error('Backup contém importações duplicadas ou sem ID');
    importIds.add(batch.id);
    const account = accountById.get(batch.accountId);
    if (!account) throw new Error('Backup contém importação ligada a conta inexistente');
    batch.accountIds ??= [batch.accountId];
    if (!Array.isArray(batch.accountIds) || batch.accountIds.length === 0 || batch.accountIds.some((id) => !nonEmpty(id) || !accountById.has(id))) {
      throw new Error('Backup contém destinos de importação inválidos');
    }
    batch.accountIds = [...new Set(batch.accountIds)];
    if (!nonEmpty(batch.fileName) || !nonEmpty(batch.fileHash) || !nonEmpty(batch.parserVersion)) {
      throw new Error('Backup contém metadados de importação inválidos');
    }
    if (!oneOf(batch.parserName, ['revolut_csv', 'wise_csv', 'revolut_pdf'] as const) || !oneOf(batch.status, ['active', 'undone'] as const)) {
      throw new Error('Backup contém estado de importação inválido');
    }
    if (!validTimestamp(batch.createdAt)) throw new Error('Backup contém data de importação inválida');
    batch.createdAt = canonicalTimestamp(batch.createdAt)!;
    batch.updated ??= 0;
    const counters = [batch.rowsRead, batch.imported, batch.updated, batch.confirmedDuplicates, batch.possibleDuplicates, batch.pendingRows, batch.rejected];
    if (counters.some((value) => !Number.isSafeInteger(value) || value < 0 || value > batch.rowsRead)) {
      throw new Error('Backup contém contadores de importação inválidos');
    }
    if (!Array.isArray(batch.currencies) || batch.currencies.some((currency) => !nonEmpty(currency)) || new Set(batch.currencies).size !== batch.currencies.length) {
      throw new Error('Backup contém moedas de importação inválidas');
    }
    const destinationCurrencies = new Set(batch.accountIds.map((id) => accountById.get(id)!.currency));
    if (batch.currencies.some((currency) => !destinationCurrencies.has(currency))) {
      throw new Error('Backup contém importação em moeda sem conta de destino');
    }
    if ((batch.firstReportingDate === undefined) !== (batch.lastReportingDate === undefined)) {
      throw new Error('Backup contém intervalo parcial de importação');
    }
    if (batch.firstReportingDate !== undefined) {
      if (!isCivilDate(batch.firstReportingDate) || !isCivilDate(batch.lastReportingDate) || batch.firstReportingDate > batch.lastReportingDate!) {
        throw new Error('Backup contém intervalo de importação inválido');
      }
    }
  }

  for (const transaction of state.transactions) {
    if (transaction.importId !== undefined && !importIds.has(transaction.importId)) {
      throw new Error('Backup contém transação ligada a importação inexistente');
    }
  }

  const issueIds = new Set<string>();
  for (const issue of state.importIssues) {
    if (!nonEmpty(issue.id) || issueIds.has(issue.id)) throw new Error('Backup contém pendências duplicadas ou sem ID');
    issueIds.add(issue.id);
    const batch = state.imports.find((item) => item.id === issue.importId);
    const account = accountById.get(issue.accountId);
    if (!batch || !account || !(batch.accountIds ?? [batch.accountId]).includes(issue.accountId)) throw new Error('Backup contém pendência ligada a importação ou conta inválida');
    if (!oneOf(issue.kind, ['row_error', 'pending', 'possible_duplicate', 'currency_mismatch', 'format_change'] as const)
      || !oneOf(issue.status, ['unresolved', 'accepted', 'ignored'] as const)
      || !nonEmpty(issue.message)) {
      throw new Error('Backup contém pendência de importação inválida');
    }
    if (issue.rowNumber !== undefined && (!Number.isSafeInteger(issue.rowNumber) || issue.rowNumber <= 0)) {
      throw new Error('Backup contém linha de pendência inválida');
    }
    if (!issue.originalData || typeof issue.originalData !== 'object' || Array.isArray(issue.originalData)) {
      throw new Error('Backup contém dados originais de pendência inválidos');
    }
    if (!validTimestamp(issue.createdAt)) throw new Error('Backup contém criação de pendência inválida');
    issue.createdAt = new Date(issue.createdAt).toISOString();
    if (issue.status === 'unresolved') {
      if (issue.resolvedAt !== undefined) throw new Error('Backup contém pendência não resolvida com data de resolução');
    } else {
      if (!validTimestamp(issue.resolvedAt) || new Date(issue.resolvedAt!).toISOString() < issue.createdAt) {
        throw new Error('Backup contém resolução de pendência inválida');
      }
      issue.resolvedAt = new Date(issue.resolvedAt!).toISOString();
    }
    if (issue.matchedTransactionIds !== undefined && (!Array.isArray(issue.matchedTransactionIds)
      || issue.matchedTransactionIds.some((id) => !nonEmpty(id)))) {
      throw new Error('Backup contém referências de duplicata inválidas');
    }
  }

  const batchIds = new Set<string>();
  for (const batch of state.reconciliationBatches) {
    if (!nonEmpty(batch.id) || batchIds.has(batch.id)) throw new Error('Backup contém lotes de reconciliação duplicados ou sem ID');
    batchIds.add(batch.id);
    if (!validTimestamp(batch.logicalAsOf) || !validTimestamp(batch.createdAt)) throw new Error('Backup contém instante de reconciliação inválido');
    if (!oneOf(batch.source, ['manual', 'import', 'system'] as const) || !oneOf(batch.status, ['COMPLETE', 'INVALIDATED'] as const)) {
      throw new Error('Backup contém lote de reconciliação com estado inválido');
    }
    batch.logicalAsOf = canonicalTimestamp(batch.logicalAsOf)!;
    batch.createdAt = canonicalTimestamp(batch.createdAt)!;
    if (batch.logicalDate === undefined) {
      // Backups antigos só guardavam o instante UTC. A migração captura o dia
      // civil no fuso do aparelho uma única vez e as novas gravações o preservam.
      batch.logicalDate = localCivilDateFromInstant(batch.logicalAsOf);
    } else if (!isCivilDate(batch.logicalDate)) {
      throw new Error('Backup contém data civil de reconciliação inválida');
    }
    if (batch.logicalAsOf > batch.createdAt) throw new Error('Backup contém lote reconciliado no futuro');
    const utcLogicalDate = civilDateFromUtcInstant(batch.logicalAsOf);
    if (Math.abs(civilDaysBetween(utcLogicalDate, batch.logicalDate)) > 1) {
      throw new Error('Backup contém data civil incoerente com o instante de reconciliação');
    }
  }

  const batchById = new Map(state.reconciliationBatches.map((batch) => [batch.id, batch]));
  const snapshotIds = new Set<string>();
  const snapshotBatchAccounts = new Set<string>();
  for (const snapshot of state.balanceSnapshots) {
    if (!nonEmpty(snapshot.id) || snapshotIds.has(snapshot.id)) throw new Error('Backup contém snapshots duplicados ou sem ID');
    snapshotIds.add(snapshot.id);
    const account = accountById.get(snapshot.accountId);
    if (!account) throw new Error(`Saldo aponta para conta inexistente: ${snapshot.accountId}`);
    if (account.currency !== snapshot.currency) throw new Error('Backup contém snapshot em moeda incompatível com a conta');
    if (!Number.isSafeInteger(snapshot.balanceCents)) throw new Error('Backup contém snapshot de saldo inválido');
    if (!oneOf(snapshot.source, ['import', 'manual'] as const)) throw new Error('Backup contém origem de snapshot inválida');
    if (!validTimestamp(snapshot.asOf) || !validTimestamp(snapshot.createdAt)) throw new Error('Backup contém data de saldo inválida');
    snapshot.asOf = canonicalTimestamp(snapshot.asOf)!;
    snapshot.createdAt = canonicalTimestamp(snapshot.createdAt)!;
    if (snapshot.asOf > snapshot.createdAt) throw new Error('Backup contém snapshot criado antes do saldo observado');
    if (snapshot.reconciled !== true) throw new Error('Backup contém snapshot não reconciliado na coleção de saldos');
    if (snapshot.logicalAsOf) {
      if (!validTimestamp(snapshot.logicalAsOf)) throw new Error('Backup contém instante lógico de saldo inválido');
      snapshot.logicalAsOf = canonicalTimestamp(snapshot.logicalAsOf)!;
    }
    if (snapshot.reconciliationBatchId) {
      const linkedBatch = batchById.get(snapshot.reconciliationBatchId);
      if (!linkedBatch) throw new Error('Backup contém snapshot ligado a lote inexistente');
      if ((snapshot.logicalAsOf ?? snapshot.asOf) !== linkedBatch.logicalAsOf) {
        throw new Error('Backup contém snapshot com instante diferente do lote de reconciliação');
      }
      const key = `${snapshot.reconciliationBatchId}:${snapshot.accountId}`;
      if (snapshotBatchAccounts.has(key)) throw new Error('Backup contém mais de um snapshot da conta no mesmo lote');
      snapshotBatchAccounts.add(key);
    }
  }

  const policyCurrencies = new Set<string>();
  for (const policy of state.reservePolicies) {
    if (!nonEmpty(policy.currency) || policyCurrencies.has(policy.currency)) throw new Error('Backup contém políticas de reserva duplicadas ou sem moeda');
    policyCurrencies.add(policy.currency);
    if (!Number.isSafeInteger(policy.minimumCents) || policy.minimumCents < 0) throw new Error('Backup contém reserva mínima inválida');
    if (policy.targetCents !== undefined && (!Number.isSafeInteger(policy.targetCents) || policy.targetCents < policy.minimumCents)) {
      throw new Error('Backup contém reserva alvo inválida');
    }
    if (!validTimestamp(policy.updatedAt)) throw new Error('Backup contém atualização de reserva inválida');
    policy.updatedAt = canonicalTimestamp(policy.updatedAt)!;
  }

  const eventIds = new Set<string>();
  state.plannedEvents = state.plannedEvents.map((event) => {
    if (!nonEmpty(event.id) || eventIds.has(event.id)) throw new Error('Backup contém compromissos duplicados ou sem ID');
    eventIds.add(event.id);
    if (!nonEmpty(event.title)) throw new Error('Backup contém compromisso sem título');
    if (!nonEmpty(event.currency)) throw new Error('Backup contém compromisso sem moeda');
    if (event.needsAccountReview !== undefined && typeof event.needsAccountReview !== 'boolean') throw new Error('Backup contém flag de revisão de compromisso inválida');
    if (!oneOf(event.kind, ['income', 'expense', 'transfer', 'installment', 'recurring'] as const)) throw new Error('Backup contém tipo de compromisso inválido');
    if (!oneOf(event.direction, ['inflow', 'outflow'] as const)) throw new Error('Backup contém direção de compromisso inválida');
    if (typeof event.active !== 'boolean') throw new Error('Backup contém estado de compromisso inválido');
    if (event.kind === 'income' && event.direction !== 'inflow') throw new Error('Backup contém receita planejada com direção inválida');
    if (event.kind !== 'income' && event.direction !== 'outflow') throw new Error('Backup contém saída planejada com direção inválida');
    if (!Number.isSafeInteger(event.amountCents) || event.amountCents <= 0) throw new Error('Backup contém compromisso inválido');
    if (!isCivilDate(event.dueDate)) throw new Error('Backup contém vencimento inválido');
    if (!validTimestamp(event.createdAt) || !validTimestamp(event.updatedAt)) throw new Error('Backup contém timestamp de compromisso inválido');
    event.createdAt = canonicalTimestamp(event.createdAt)!;
    event.updatedAt = canonicalTimestamp(event.updatedAt)!;
    if (event.updatedAt < event.createdAt) throw new Error('Backup contém compromisso atualizado antes da criação');
    if (event.recurrence) {
      if (!oneOf(event.recurrence.frequency, ['weekly', 'monthly', 'yearly'] as const)) throw new Error('Backup contém frequência de recorrência inválida');
      if (!Number.isSafeInteger(event.recurrence.interval) || event.recurrence.interval <= 0 || event.recurrence.interval > 10_000) throw new Error('Backup contém recorrência inválida');
      if (event.recurrence.until && (!isCivilDate(event.recurrence.until) || event.recurrence.until < event.dueDate)) throw new Error('Backup contém fim de recorrência inválido');
      if (event.recurrence.maxOccurrences !== undefined && (!Number.isSafeInteger(event.recurrence.maxOccurrences) || event.recurrence.maxOccurrences <= 0 || event.recurrence.maxOccurrences > 10_000)) {
        throw new Error('Backup contém limite de recorrência inválido');
      }
    }

    if (event.accountId) {
      const linked = accountById.get(event.accountId);
      if (linked && linked.active && linked.currency === event.currency) {
        return { ...event, needsAccountReview: false };
      }
      // Um vínculo explícito nunca é transferido silenciosamente para outra
      // conta. Conta inativa, removida ou com moeda divergente exige revisão.
      return { ...event, active: false, needsAccountReview: true };
    }

    const candidates = state.accounts.filter((account) =>
      account.active && account.currency === event.currency);
    if (candidates.length === 1) {
      return { ...event, accountId: candidates[0]!.id, needsAccountReview: false };
    }

    // Estados anteriores podiam conter eventos sem conta. O evento é
    // preservado, mas fica suspenso quando a migração não é inequívoca.
    return { ...event, accountId: undefined, active: false, needsAccountReview: true };
  });

  const transferIds = new Set<string>();
  for (const transfer of state.plannedTransfers) {
    if (!nonEmpty(transfer.id) || transferIds.has(transfer.id)) throw new Error('Backup contém transferências planejadas duplicadas ou sem ID');
    transferIds.add(transfer.id);
    const source = accountById.get(transfer.sourceAccountId);
    const destination = accountById.get(transfer.destinationAccountId);
    if (!source || !destination || source.id === destination.id) throw new Error('Backup contém transferência com conta inválida');
    if (source.currency !== destination.currency) throw new Error('Backup contém transferência cambial não suportada');
    if (!oneOf(transfer.status, ['active', 'cancelled'] as const) || !oneOf(transfer.evidenceLevel, ['confirmed', 'planned', 'estimated'] as const)) {
      throw new Error('Backup contém estado de transferência inválido');
    }
    if (!nonEmpty(transfer.title)) throw new Error('Backup contém transferência sem título');
    if (!Number.isSafeInteger(transfer.amountCents) || transfer.amountCents <= 0 || !Number.isSafeInteger(transfer.feeCents) || transfer.feeCents < 0) {
      throw new Error('Backup contém valor de transferência inválido');
    }
    if (!canAddCents(transfer.amountCents, transfer.feeCents)) throw new Error('Backup contém transferência acima do limite monetário seguro');
    if (!isCivilDate(transfer.dueDate)) throw new Error('Backup contém data de transferência inválida');
  }

  const feedbackKeys = new Set<string>();
  for (const feedback of state.insightFeedback) {
    if (!nonEmpty(feedback.insightKey) || feedbackKeys.has(feedback.insightKey)) throw new Error('Backup contém feedback de insight duplicado ou inválido');
    feedbackKeys.add(feedback.insightKey);
    if (feedback.useful !== undefined && typeof feedback.useful !== 'boolean') throw new Error('Backup contém avaliação de insight inválida');
    for (const key of ['lastShownAt', 'dismissedAt'] as const) {
      const value = feedback[key];
      if (value !== undefined) {
        if (!validTimestamp(value)) throw new Error('Backup contém data de insight inválida');
        feedback[key] = canonicalTimestamp(value)!;
      }
    }
  }

  const reviewGroupIds = new Set<string>();
  const reviewGroupKeys = new Set<string>();
  for (const group of state.reviewGroups as ReviewGroup[]) {
    if (!nonEmpty(group.id) || reviewGroupIds.has(group.id) || !nonEmpty(group.key) || reviewGroupKeys.has(group.key)) {
      throw new Error('Backup contém grupos de revisão duplicados ou inválidos');
    }
    reviewGroupIds.add(group.id);
    reviewGroupKeys.add(group.key);
    if (!nonEmpty(group.merchantNormalized) || !nonEmpty(group.merchantLabel) || !nonEmpty(group.currency)) throw new Error('Backup contém grupo de revisão incompleto');
    if (!oneOf(group.direction, ['inflow', 'outflow'] as const)
      || !oneOf(group.kind, ['income', 'expense', 'transfer', 'refund', 'adjustment', 'unknown'] as const)
      || !oneOf(group.technicalType, TECHNICAL_TYPES)
      || group.kind !== kindForTechnicalType(group.technicalType)
      || !oneOf(group.status, ['pending', 'deferred'] as const)) throw new Error('Backup contém estado de grupo de revisão inválido');
    if (!Array.isArray(group.transactionIds) || group.transactionIds.some((id) => !transactionIds.has(id))) throw new Error('Backup contém grupo ligado a transação inexistente');
    if (group.suggestedCategoryId !== undefined && !categoryIds.has(group.suggestedCategoryId)) throw new Error('Backup contém sugestão ligada a categoria inexistente');
    if (group.suggestionConfidence !== undefined && !oneOf(group.suggestionConfidence, ['high', 'medium', 'low'] as const)) throw new Error('Backup contém confiança de sugestão inválida');
    if (!Array.isArray(group.suggestionEvidence) || group.suggestionEvidence.some((item) => !nonEmpty(item))) throw new Error('Backup contém evidência de sugestão inválida');
    if (!validTimestamp(group.createdAt) || !validTimestamp(group.updatedAt)) throw new Error('Backup contém timestamp de grupo inválido');
    group.createdAt = canonicalTimestamp(group.createdAt)!;
    group.updatedAt = canonicalTimestamp(group.updatedAt)!;
    if (group.deferredAt !== undefined) {
      if (!validTimestamp(group.deferredAt)) throw new Error('Backup contém adiamento de grupo inválido');
      group.deferredAt = canonicalTimestamp(group.deferredAt)!;
    }
  }

  const reviewDecisionIds = new Set<string>();
  for (const decision of state.reviewDecisions as ReviewDecision[]) {
    if (!nonEmpty(decision.id) || reviewDecisionIds.has(decision.id) || !nonEmpty(decision.label)) throw new Error('Backup contém decisão de revisão inválida');
    reviewDecisionIds.add(decision.id);
    if (!oneOf(decision.kind, ['apply_group_category', 'apply_transaction_category', 'defer_group', 'create_rule', 'resolve_without_category', 'reopen_group'] as const)) throw new Error('Backup contém tipo de decisão inválido');
    if (!Array.isArray(decision.transactionIds) || decision.transactionIds.some((id) => !nonEmpty(id) || !transactionIds.has(id))) throw new Error('Backup contém transações de decisão inválidas');
    if (!Array.isArray(decision.before) || !Array.isArray(decision.after) || !Array.isArray(decision.ruleChanges)) throw new Error('Backup contém histórico de decisão incompleto');
    for (const classification of [...decision.before, ...decision.after]) {
      if (!nonEmpty(classification.transactionId) || !transactionIds.has(classification.transactionId)) throw new Error('Backup contém snapshot de decisão inválido');
      if (classification.categoryId !== undefined && (!nonEmpty(classification.categoryId) || !categoryIds.has(classification.categoryId))) throw new Error('Backup contém categoria de snapshot inválida');
      if (!oneOf(classification.categorySource, ['manual', 'rule', 'system', 'none'] as const)) throw new Error('Backup contém origem de snapshot inválida');
      if (!oneOf(classification.categoryReviewStatus, ['pending', 'deferred', 'resolved', 'not_applicable'] as const)) throw new Error('Backup contém estado de revisão do snapshot inválido');
      if ((!classification.categoryId && classification.categorySource !== 'none') || (classification.categoryId && classification.categorySource === 'none')) throw new Error('Backup contém snapshot de categoria inconsistente');
      if (classification.categoryId && classification.categoryReviewStatus !== 'resolved') throw new Error('Backup contém snapshot categorizado ainda pendente');
      if (typeof classification.needsReview !== 'boolean' || !Array.isArray(classification.reviewReasons) || !Array.isArray(classification.manualEditLog)) throw new Error('Backup contém snapshot de revisão incompleto');
      if (!validTimestamp(classification.updatedAt)) throw new Error('Backup contém atualização de snapshot inválida');
      classification.updatedAt = canonicalTimestamp(classification.updatedAt)!;
    }
    for (const change of decision.ruleChanges) {
      if (!change || typeof change !== 'object' || (!change.before && !change.after)) throw new Error('Backup contém alteração de regra inválida');
      for (const rule of [change.before, change.after]) {
        if (!rule) continue;
        if (!nonEmpty(rule.id) || !nonEmpty(rule.pattern) || !categoryIds.has(rule.categoryId)) throw new Error('Backup contém snapshot de regra inválido');
      }
    }
    if (!validTimestamp(decision.createdAt)) throw new Error('Backup contém data de decisão inválida');
    decision.createdAt = canonicalTimestamp(decision.createdAt)!;
    if (decision.undoneAt !== undefined) {
      if (!validTimestamp(decision.undoneAt)) throw new Error('Backup contém data de desfazer inválida');
      decision.undoneAt = canonicalTimestamp(decision.undoneAt)!;
    }
  }

  state.reviewGroups = buildReviewGroups(state);
  return state;
}

export function loadLocalState(userId: string, fallback: AppState): AppState | undefined {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (raw) return normalizeState(JSON.parse(raw), fallback);

    return undefined;
  } catch {
    return undefined;
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && (
    error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014
  );
}

function releaseRecoverableLocalSpace(userId: string) {
  try {
    // Checkpoints are only a convenience copy. The current state and the
    // Supabase copy are more important, so old checkpoints are the first
    // thing removed when Safari reaches its localStorage quota.
    clearCheckpoints(userId);
  } catch {
    // Storage may be unavailable entirely (private mode / browser policy).
  }
}

function writeLocalValueWithQuotaRecovery(userId: string, key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
  }

  releaseRecoverableLocalSpace(userId);

  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    // Local cache is optional. Failing it must not take the React tree down;
    // remote persistence can continue and the UI remains usable.
    console.warn('Japa Finance: cache local cheio; estado mantido em memória e sincronização remota preservada.');
    return false;
  }
}

export function saveLocalState(userId: string, state: AppState) {
  writeLocalValueWithQuotaRecovery(userId, cacheKey(userId), JSON.stringify(state));
}

export function loadSyncMetadata(userId: string): SyncMetadata | undefined {
  try {
    const raw = localStorage.getItem(syncMetadataKey(userId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<SyncMetadata>;
    if (!Number.isSafeInteger(parsed.remoteRevision) || (parsed.remoteRevision ?? -1) < 1) return undefined;
    if (typeof parsed.remoteUpdatedAt !== 'string' || typeof parsed.lastSyncedStateHash !== 'string') return undefined;
    return parsed as SyncMetadata;
  } catch {
    return undefined;
  }
}

export function saveSyncMetadata(userId: string, metadata: SyncMetadata) {
  writeLocalValueWithQuotaRecovery(userId, syncMetadataKey(userId), JSON.stringify(metadata));
}

export interface RecoveryCheckpoint {
  label: string;
  createdAt: string;
  transactionCount: number;
  schemaVersion: number;
  format: 'gzip' | 'plain' | 'legacy';
}

interface StoredCheckpointIndex extends RecoveryCheckpoint {
  payloadKey?: string;
}

interface LegacyRecoveryCheckpoint {
  label: string;
  createdAt: string;
  state: AppState;
}

const CHECKPOINT_INDEX_PREFIX = 'japa-finance-checkpoint-index-v0.5';
const CHECKPOINT_PAYLOAD_PREFIX = 'japa-finance-checkpoint-payload-v0.5';
const checkpointQueues = new Map<string, Promise<void>>();

function checkpointIndexKey(userId: string) {
  return `${CHECKPOINT_INDEX_PREFIX}:${userId}`;
}

function compressedCheckpointKey(userId: string, createdAt: string) {
  return `${CHECKPOINT_PAYLOAD_PREFIX}:${userId}:${createdAt}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function compressState(state: AppState): Promise<{ format: 'gzip' | 'plain'; payload: string }> {
  const json = JSON.stringify(state);
  if (typeof CompressionStream === 'undefined') return { format: 'plain', payload: json };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { format: 'gzip', payload: bytesToBase64(bytes) };
}

async function decodeCheckpoint(format: 'gzip' | 'plain', payload: string): Promise<unknown> {
  if (format === 'plain') return JSON.parse(payload);
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não consegue descompactar o ponto de recuperação. Use um backup JSON exportado.');
  const bytes = base64ToBytes(payload);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function checkpointIndex(userId: string): StoredCheckpointIndex[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(checkpointIndexKey(userId)) ?? '[]') as StoredCheckpointIndex[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.label === 'string' && typeof item.createdAt === 'string') : [];
  } catch {
    return [];
  }
}

function legacyCheckpoints(userId: string): LegacyRecoveryCheckpoint[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(checkpointKey(userId)) ?? '[]') as LegacyRecoveryCheckpoint[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.label === 'string' && typeof item.createdAt === 'string' && item.state) : [];
  } catch {
    return [];
  }
}

export function listCheckpoints(userId: string): RecoveryCheckpoint[] {
  const modern = checkpointIndex(userId);
  const legacy: RecoveryCheckpoint[] = legacyCheckpoints(userId).map((item) => ({
    label: item.label,
    createdAt: item.createdAt,
    transactionCount: item.state.transactions.length,
    schemaVersion: item.state.schemaVersion,
    format: 'legacy',
  }));
  const seen = new Set(modern.map((item) => item.createdAt));
  return [...modern, ...legacy.filter((item) => !seen.has(item.createdAt))]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
}

export function clearCheckpoints(userId: string) {
  try {
    for (const item of checkpointIndex(userId)) {
      if (item.payloadKey) localStorage.removeItem(item.payloadKey);
    }
    localStorage.removeItem(checkpointIndexKey(userId));
    localStorage.removeItem(checkpointKey(userId));
  } catch { /* armazenamento opcional */ }
}

export async function restoreCheckpoint(userId: string, createdAt: string, fallback: AppState): Promise<AppState> {
  const modern = checkpointIndex(userId).find((item) => item.createdAt === createdAt);
  if (modern?.payloadKey) {
    const payload = localStorage.getItem(modern.payloadKey);
    if (!payload) throw new Error('O conteúdo deste ponto de recuperação não está mais disponível.');
    const raw = await decodeCheckpoint(modern.format === 'gzip' ? 'gzip' : 'plain', payload);
    return normalizeState(raw, fallback);
  }
  const legacy = legacyCheckpoints(userId).find((item) => item.createdAt === createdAt);
  if (!legacy) throw new Error('Ponto de recuperação não encontrado.');
  return normalizeState(legacy.state, fallback);
}

async function persistCompressedCheckpoint(userId: string, state: AppState, label: string) {
  const createdAt = new Date().toISOString();
  const encoded = await compressState(state);
  // Um checkpoint comprimido acima deste limite provavelmente disputará espaço
  // com o cache principal no Safari. O arquivo JSON exportado continua sendo a
  // recuperação de longo prazo.
  if (encoded.payload.length > 1_500_000) return;
  const payloadKey = compressedCheckpointKey(userId, createdAt);
  const newest: StoredCheckpointIndex = {
    label,
    createdAt,
    transactionCount: state.transactions.length,
    schemaVersion: state.schemaVersion,
    format: encoded.format,
    payloadKey,
  };
  const previous = checkpointIndex(userId);
  const next = [newest, ...previous].slice(0, 2);
  try {
    localStorage.setItem(payloadKey, encoded.payload);
    localStorage.setItem(checkpointIndexKey(userId), JSON.stringify(next));
    for (const removed of previous.filter((item) => !next.some((kept) => kept.createdAt === item.createdAt))) {
      if (removed.payloadKey) localStorage.removeItem(removed.payloadKey);
    }
    // A versão comprimida substitui os checkpoints completos legados, que eram
    // grandes demais para estados com centenas de movimentos.
    localStorage.removeItem(checkpointKey(userId));
  } catch (error) {
    try { localStorage.removeItem(payloadKey); } catch { /* opcional */ }
    if (isQuotaExceededError(error)) {
      const oldest = previous.at(-1);
      if (oldest?.payloadKey) {
        try {
          localStorage.removeItem(oldest.payloadKey);
          localStorage.setItem(payloadKey, encoded.payload);
          localStorage.setItem(checkpointIndexKey(userId), JSON.stringify([newest, ...previous.filter((item) => item.createdAt !== oldest.createdAt)].slice(0, 2)));
          return;
        } catch { /* sem espaço mesmo após remover o mais antigo */ }
      }
    }
  }
}

export function createCheckpoint(userId: string, state: AppState, label: string) {
  const previous = checkpointQueues.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => persistCompressedCheckpoint(userId, state, label));
  let queued: Promise<void>;
  queued = next.finally(() => {
    if (checkpointQueues.get(userId) === queued) checkpointQueues.delete(userId);
  });
  checkpointQueues.set(userId, queued);
}

export async function exportState(state: AppState): Promise<'shared' | 'downloaded'> {
  try { localStorage.setItem('japa-finance-last-export-at', new Date().toISOString()); } catch { /* metadado opcional */ }
  const payload = { schemaVersion: state.schemaVersion, exportedAt: new Date().toISOString(), state };
  const fileName = `japa-finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const contents = JSON.stringify(payload, null, 2);
  const file = new File([contents], fileName, { type: 'application/json' });
  const shareNavigator = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (navigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title: 'Backup do Japa Finance', files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  return 'downloaded';
}

export async function parseBackupFile(file: File, fallback: AppState): Promise<AppState> {
  const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
  const state = 'state' in parsed ? parsed.state : parsed;
  return normalizeState(state, fallback);
}

export function resolveIssues(
  issues: ImportIssue[],
  issueIds: string[],
  status: ImportIssue['status'],
): ImportIssue[] {
  const idSet = new Set(issueIds);
  const resolvedAt = status === 'unresolved' ? undefined : new Date().toISOString();
  return issues.map((item) => idSet.has(item.id) ? { ...item, status, resolvedAt } : item);
}
