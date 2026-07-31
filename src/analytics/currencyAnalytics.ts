import type { AppState, Institution, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { addCents } from '../domain/arithmetic';

export interface InstitutionCurrencySummary {
  institution: Institution;
  accountCount: number;
  transactionCount: number;
  inflowCents: number;
  outflowCents: number;
  feeCents: number;
  conversionCount: number;
  convertedOutflowCents: number;
}

export interface EffectiveConversion {
  groupId: string;
  reportingDate: string;
  institution: Institution;
  sourceCurrency: string;
  sourceAmountCents: number;
  targetCurrency: string;
  targetAmountCents: number;
  effectiveRate: number;
  explicitFeeCents: number;
}

export interface CurrencyAnalytics {
  currency: string;
  institutions: InstitutionCurrencySummary[];
  explicitFeeCents: number;
  conversionCount: number;
  convertedOutflowCents: number;
  effectiveConversions: EffectiveConversion[];
}

function institutionFor(state: AppState, transaction: Transaction): Institution {
  return state.accounts.find((account) => account.id === transaction.accountId)?.institution ?? 'other';
}

export function buildCurrencyAnalytics(state: AppState, currency: string): CurrencyAnalytics {
  const accountCounts = new Map<Institution, number>();
  for (const account of state.accounts.filter((account) => account.active && account.currency === currency)) {
    accountCounts.set(account.institution, (accountCounts.get(account.institution) ?? 0) + 1);
  }
  const map = new Map<Institution, InstitutionCurrencySummary>();
  const get = (institution: Institution) => {
    const current = map.get(institution) ?? {
      institution,
      accountCount: accountCounts.get(institution) ?? 0,
      transactionCount: 0,
      inflowCents: 0,
      outflowCents: 0,
      feeCents: 0,
      conversionCount: 0,
      convertedOutflowCents: 0,
    };
    map.set(institution, current);
    return current;
  };
  const transactions = state.transactions.filter((transaction) =>
    transaction.status === 'completed' && transaction.currency === currency);
  for (const transaction of transactions) {
    const summary = get(institutionFor(state, transaction));
    const movement = signedNetMovement(transaction);
    summary.transactionCount += 1;
    if (movement > 0) summary.inflowCents = addCents(summary.inflowCents, movement);
    if (movement < 0) summary.outflowCents = addCents(summary.outflowCents, Math.abs(movement));
    if (transaction.technicalType === 'bank_fee') summary.feeCents = addCents(summary.feeCents, Math.abs(movement));
    if (transaction.technicalType === 'currency_conversion' && transaction.sourceComponent !== 'fee') {
      summary.conversionCount += 1;
      if (movement < 0) summary.convertedOutflowCents = addCents(summary.convertedOutflowCents, Math.abs(movement));
    }
  }

  const grouped = new Map<string, Transaction[]>();
  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed' || transaction.technicalType !== 'currency_conversion' || !transaction.transferGroupId) continue;
    const current = grouped.get(transaction.transferGroupId) ?? [];
    current.push(transaction);
    grouped.set(transaction.transferGroupId, current);
  }
  const effectiveConversions: EffectiveConversion[] = [];
  for (const [groupId, group] of grouped) {
    const source = group.find((transaction) => signedNetMovement(transaction) < 0);
    const target = group.find((transaction) => signedNetMovement(transaction) > 0 && transaction.currency !== source?.currency);
    if (!source || !target || (source.currency !== currency && target.currency !== currency)) continue;
    const sourceAmountCents = Math.abs(signedNetMovement(source));
    const targetAmountCents = Math.abs(signedNetMovement(target));
    const feeParentIds = new Set(group.map((transaction) => transaction.id));
    const explicitFeeCents = state.transactions
      .filter((transaction) => transaction.sourceComponent === 'fee' && transaction.feeOfTransactionId && feeParentIds.has(transaction.feeOfTransactionId))
      .reduce((total, transaction) => addCents(total, Math.abs(signedNetMovement(transaction))), 0);
    effectiveConversions.push({
      groupId,
      reportingDate: source.reportingDate,
      institution: institutionFor(state, source),
      sourceCurrency: source.currency,
      sourceAmountCents,
      targetCurrency: target.currency,
      targetAmountCents,
      effectiveRate: sourceAmountCents > 0 ? targetAmountCents / sourceAmountCents : 0,
      explicitFeeCents,
    });
  }

  const institutions = [...map.values()].sort((a, b) => b.transactionCount - a.transactionCount || a.institution.localeCompare(b.institution));
  return {
    currency,
    institutions,
    explicitFeeCents: institutions.reduce((total, item) => addCents(total, item.feeCents), 0),
    conversionCount: institutions.reduce((total, item) => total + item.conversionCount, 0),
    convertedOutflowCents: institutions.reduce((total, item) => addCents(total, item.convertedOutflowCents), 0),
    effectiveConversions: effectiveConversions.sort((a, b) => b.reportingDate.localeCompare(a.reportingDate)),
  };
}
