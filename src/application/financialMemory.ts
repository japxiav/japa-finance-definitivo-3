import { normalizeMerchant } from '../core/merchant';
import type { AppState, FinancialMemoryEntity, Transaction } from '../core/types';
import { extractCounterpartyName } from './transactionPresentation';
import { isCategoryReviewApplicable, kindForTechnicalType } from '../classification/technicalClassifier';

export function normalizeEntityAlias(value: string): string {
  return normalizeMerchant(value)
    .replace(/\b(?:mr|mrs|ms|miss|sr|sra|senhor|senhora)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validFor(entity: FinancialMemoryEntity, transaction: Transaction): boolean {
  if (entity.validFrom && transaction.reportingDate < entity.validFrom) return false;
  if (entity.validUntil && transaction.reportingDate > entity.validUntil) return false;
  if (entity.direction && entity.direction !== transaction.direction) return false;
  return true;
}

export function matchMemoryEntity(state: Pick<AppState, 'financialMemory'>, transaction: Transaction): FinancialMemoryEntity | undefined {
  const counterparty = extractCounterpartyName(transaction);
  const candidates = [counterparty, transaction.merchantNormalized, transaction.descriptionOriginal]
    .filter((item): item is string => Boolean(item?.trim()))
    .map(normalizeEntityAlias);
  return state.financialMemory.find((entity) => validFor(entity, transaction)
    && entity.normalizedAliases.some((alias) => candidates.some((candidate) => candidate === alias || candidate.includes(alias) || alias.includes(candidate))));
}

export function applyFinancialMemory(state: AppState, transaction: Transaction): Transaction {
  const entity = matchMemoryEntity(state, transaction);
  if (!entity) return transaction;
  const manualType = transaction.kindSource === 'manual' || transaction.manualEditLog.some((edit) => edit.field === 'technicalType');
  const manualCategory = transaction.categorySource === 'manual';
  const technicalType = !manualType && entity.technicalType ? entity.technicalType : transaction.technicalType;
  const categoryId = !manualCategory && entity.categoryId && isCategoryReviewApplicable(technicalType)
    ? entity.categoryId
    : transaction.categoryId;
  const reasons = transaction.reviewReasons.filter((reason) => !(reason === 'unknown_kind' && technicalType !== 'unknown'));
  return {
    ...transaction,
    counterpartyEntityId: entity.id,
    technicalType,
    kind: technicalType !== transaction.technicalType ? kindForTechnicalType(technicalType) : transaction.kind,
    kindSource: technicalType !== transaction.technicalType ? 'rule' : transaction.kindSource,
    categoryId,
    categorySource: categoryId && categoryId !== transaction.categoryId ? 'rule' : transaction.categorySource,
    categoryReviewStatus: categoryId ? 'resolved' : transaction.categoryReviewStatus,
    reviewReasons: reasons,
    needsReview: reasons.length > 0,
    contextEvidence: [...new Set([...(transaction.contextEvidence ?? []), `Memória financeira: ${entity.displayName}${entity.contextLabel ? ` · ${entity.contextLabel}` : ''}`])],
    contextConfidence: 'high',
  };
}

export interface MemorySuggestion {
  key: string;
  displayName: string;
  normalizedAlias: string;
  transactionIds: string[];
  direction: Transaction['direction'];
  firstDate: string;
  lastDate: string;
  count: number;
  amountMinCents: number;
  amountMaxCents: number;
  evidence: string[];
}

export function buildMemorySuggestions(state: AppState, currency?: string): MemorySuggestion[] {
  const knownIds = new Set(state.transactions.filter((item) => item.counterpartyEntityId).map((item) => item.id));
  const buckets = new Map<string, { name: string; transactions: Transaction[] }>();
  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed' || knownIds.has(transaction.id) || transaction.sourceComponent === 'fee') continue;
    if (currency && transaction.currency !== currency) continue;
    if (!['incoming_transfer', 'outgoing_transfer'].includes(transaction.technicalType)) continue;
    const name = extractCounterpartyName(transaction);
    if (!name) continue;
    const alias = normalizeEntityAlias(name);
    if (!alias || state.financialMemory.some((entity) => entity.normalizedAliases.includes(alias))) continue;
    const key = `${alias}|${transaction.direction}|${transaction.currency}`;
    const current = buckets.get(key) ?? { name, transactions: [] };
    current.transactions.push(transaction);
    buckets.set(key, current);
  }
  return [...buckets.entries()]
    .filter(([, item]) => item.transactions.length >= 2)
    .map(([key, item]) => {
      const rows = item.transactions.sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
      const amounts = rows.map((row) => row.amountCents);
      return {
        key,
        displayName: item.name,
        normalizedAlias: normalizeEntityAlias(item.name),
        transactionIds: rows.map((row) => row.id),
        direction: rows[0]!.direction,
        firstDate: rows[0]!.reportingDate,
        lastDate: rows.at(-1)!.reportingDate,
        count: rows.length,
        amountMinCents: Math.min(...amounts),
        amountMaxCents: Math.max(...amounts),
        evidence: [
          `${rows.length} transferências no mesmo sentido`,
          `Padrão entre ${rows[0]!.reportingDate} e ${rows.at(-1)!.reportingDate}`,
          `Mesma contraparte em ${rows[0]!.currency}`,
        ],
      };
    })
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
}

export function createMemoryEntity(input: Omit<FinancialMemoryEntity, 'id' | 'createdAt' | 'updatedAt' | 'normalizedAliases'> & { aliases: string[] }): FinancialMemoryEntity {
  const now = new Date().toISOString();
  return {
    ...input,
    id: crypto.randomUUID(),
    normalizedAliases: [...new Set(input.aliases.map(normalizeEntityAlias).filter(Boolean))],
    createdAt: now,
    updatedAt: now,
  };
}
