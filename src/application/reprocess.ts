import type { AppState, Transaction } from '../core/types';
import { applyOwnerIdentityContext } from './ownerIdentity';
import { applyFinancialMemory } from './financialMemory';
import { withFriendlyDescription } from './transactionPresentation';
import { linkCompoundEvents } from './compoundEvents';
import { withRebuiltReviewGroups } from '../classification/grouping';
import {
  identifyTechnicalMovement,
  isCategoryReviewApplicable,
  kindForTechnicalType,
} from '../classification/technicalClassifier';
import { extractMerchantIdentity, matchRule } from '../core/merchant';
import { isCategoryCompatible } from '../classification/categoryCompatibility';

function isManualTechnical(transaction: Transaction): boolean {
  return transaction.kindSource === 'manual'
    || transaction.manualEditLog.some((edit) => edit.field === 'technicalType');
}

function reprocessOne(state: AppState, transaction: Transaction, now: string): Transaction {
  if (transaction.status === 'voided' || transaction.status === 'merged') return transaction;
  const identified = identifyTechnicalMovement({
    bankType: `${transaction.bankType ?? ''} ${transaction.originalData?.['Transaction Details Type'] ?? ''} ${transaction.originalData?.['Transaction Type'] ?? ''}`,
    description: transaction.descriptionOriginal,
    direction: transaction.direction,
  });
  const technicalType = isManualTechnical(transaction) ? transaction.technicalType : identified.technicalType;
  const kind = isManualTechnical(transaction) ? transaction.kind : kindForTechnicalType(technicalType);
  const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
  let categoryId = transaction.categoryId;
  let categorySource = transaction.categorySource;
  if (analysisExcluded) {
    categoryId = undefined;
    categorySource = 'none';
  } else if (!categoryId && transaction.status === 'completed' && isCategoryReviewApplicable(technicalType)) {
    const rule = matchRule(transaction.descriptionOriginal, state.rules, {
      currency: transaction.currency,
      direction: transaction.direction,
      kind,
      technicalType,
    });
    const category = rule ? state.categories.find((item) => item.id === rule.categoryId) : undefined;
    if (rule && category && isCategoryCompatible(category, { ...transaction, kind, technicalType })) {
      categoryId = category.id;
      categorySource = 'rule';
    }
  }
  const reviewReasons = [...new Set(transaction.reviewReasons ?? [])]
    .filter((reason) => reason !== 'uncategorized' && reason !== 'ambiguous_transfer');
  const unknownIndex = reviewReasons.indexOf('unknown_kind');
  if (technicalType === 'unknown' && transaction.status === 'completed') {
    if (unknownIndex < 0) reviewReasons.push('unknown_kind');
  } else if (unknownIndex >= 0) reviewReasons.splice(unknownIndex, 1);
  const categoryReviewStatus = transaction.status !== 'completed'
    ? 'not_applicable' as const
    : analysisExcluded
      ? 'not_applicable' as const
      : categoryId
        ? 'resolved' as const
        : isCategoryReviewApplicable(technicalType)
          ? (transaction.categoryReviewStatus === 'deferred' ? 'deferred' as const : 'pending' as const)
          : 'not_applicable' as const;
  let next: Transaction = {
    ...transaction,
    technicalType,
    kind,
    kindSource: isManualTechnical(transaction) ? transaction.kindSource : technicalType === 'unknown' ? 'unknown' : 'bank',
    analysisExcluded,
    categoryId,
    categorySource,
    categoryReviewStatus,
    merchantNormalized: extractMerchantIdentity(transaction.descriptionOriginal),
    reviewReasons,
    needsReview: reviewReasons.length > 0,
    updatedAt: transaction.updatedAt || now,
  };
  next = applyOwnerIdentityContext(next, state.ownerIdentity);
  next = applyFinancialMemory(state, next);
  next = withFriendlyDescription(next);
  return next;
}

export interface ReprocessPreview {
  total: number;
  changed: number;
  technicalResolved: number;
  feesResolved: number;
  internalResolved: number;
  categoriesResolved: number;
  reviewRemoved: number;
  manualPreserved: number;
}

export function previewReprocess(state: AppState): ReprocessPreview {
  const now = new Date().toISOString();
  let changed = 0;
  let technicalResolved = 0;
  let feesResolved = 0;
  let internalResolved = 0;
  let categoriesResolved = 0;
  let reviewRemoved = 0;
  let manualPreserved = 0;
  for (const transaction of state.transactions) {
    const next = reprocessOne(state, transaction, now);
    if (isManualTechnical(transaction)) manualPreserved += 1;
    if (transaction.technicalType === 'unknown' && next.technicalType !== 'unknown') technicalResolved += 1;
    if (transaction.technicalType !== 'bank_fee' && next.technicalType === 'bank_fee') feesResolved += 1;
    if (!transaction.analysisExcluded && next.analysisExcluded) internalResolved += 1;
    if (!transaction.categoryId && next.categoryId) categoriesResolved += 1;
    if (transaction.needsReview && !next.needsReview) reviewRemoved += 1;
    if (JSON.stringify(next) !== JSON.stringify(transaction)) changed += 1;
  }
  return { total: state.transactions.length, changed, technicalResolved, feesResolved, internalResolved, categoriesResolved, reviewRemoved, manualPreserved };
}

export function reprocessFinancialState(state: AppState, now = new Date().toISOString()): AppState {
  let next: AppState = {
    ...state,
    transactions: state.transactions.map((transaction) => reprocessOne(state, transaction, now)),
  };
  next = linkCompoundEvents(next);
  next = {
    ...next,
    transactions: next.transactions.map((transaction) => withFriendlyDescription(applyFinancialMemory(next, transaction))),
  };
  return withRebuiltReviewGroups(next, now);
}
