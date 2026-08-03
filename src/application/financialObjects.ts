import type { AppState, FinancialObject, FinancialObjectType, SuggestionConfidence, Transaction } from '../core/types';
import { normalizeEntityAlias } from './financialMemory';
import { buildFinancialRelationships } from './financialRelationships';
import { signedNetMovement } from '../core/finance';
import { formatMoney } from '../core/money';

export interface FinancialObjectSuggestion {
  id: string;
  type: FinancialObjectType;
  title: string;
  currency: string;
  confidence: SuggestionConfidence;
  explanation: string;
  evidence: string[];
  transactionIds: string[];
  plannedEventIds: string[];
  relationshipEntityId?: string;
  merchantNormalized?: string;
  expectedCents?: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function monthlyPattern(rows: Transaction[]): boolean {
  if (rows.length < 3) return false;
  const dates = [...rows].map((item) => item.reportingDate).sort();
  const months = new Set(dates.map((date) => date.slice(0, 7)));
  return months.size >= 3;
}

export function buildFinancialObjectSuggestions(state: AppState, currency: string): FinancialObjectSuggestion[] {
  const existingKeys = new Set(state.financialObjects.map((item) => `${item.type}|${item.currency}|${item.merchantNormalized ?? item.relationshipEntityId ?? normalizeEntityAlias(item.title)}`));
  const suggestions: FinancialObjectSuggestion[] = [];
  const completed = state.transactions.filter((item) => item.status === 'completed' && item.currency === currency);

  const merchants = new Map<string, Transaction[]>();
  for (const item of completed.filter((row) => !row.analysisExcluded && row.direction === 'outflow' && ['card_payment', 'direct_debit'].includes(row.technicalType))) {
    const key = normalizeEntityAlias(item.merchantNormalized || item.friendlyDescription || item.descriptionOriginal);
    if (!key) continue;
    const list = merchants.get(key) ?? [];
    list.push(item);
    merchants.set(key, list);
  }
  for (const [merchant, rows] of merchants) {
    const subscriptionLike = rows.some((item) => item.technicalType === 'direct_debit' || item.categoryId === 'subscriptions') && monthlyPattern(rows);
    if (!subscriptionLike) continue;
    const key = `subscription|${currency}|${merchant}`;
    if (existingKeys.has(key)) continue;
    const label = rows[0]!.friendlyDescription || rows[0]!.merchantNormalized || rows[0]!.descriptionOriginal;
    suggestions.push({
      id: `object-suggestion:${key}`,
      type: 'subscription',
      title: label,
      currency,
      confidence: rows.length >= 6 ? 'high' : 'medium',
      explanation: 'Pagamentos do mesmo comerciante aparecem em pelo menos três meses e têm natureza de assinatura ou débito direto.',
      evidence: [`${rows.length} pagamentos.`, `${new Set(rows.map((item) => item.reportingDate.slice(0, 7))).size} meses observados.`, `Valor mediano: ${formatMoney(median(rows.map((item) => Math.abs(signedNetMovement(item)))), currency)}.`],
      transactionIds: rows.map((item) => item.id),
      plannedEventIds: [],
      merchantNormalized: merchant,
      expectedCents: median(rows.map((item) => Math.abs(signedNetMovement(item)))),
    });
  }

  for (const relationship of buildFinancialRelationships(state, currency)) {
    const memory = relationship.memoryEntityId ? state.financialMemory.find((item) => item.id === relationship.memoryEntityId) : undefined;
    const label = `${memory?.contextLabel ?? ''} ${memory?.notes ?? ''}`.toLocaleLowerCase('pt-BR');
    let type: FinancialObjectType | undefined;
    if (/pensão|pensao|filha|ajuda familiar|support/.test(label)) type = 'family_support';
    else if (/empr[eé]stimo|loan|dívida|divida/.test(label)) type = 'loan';
    if (!type) continue;
    const identity = relationship.memoryEntityId ?? relationship.key;
    const key = `${type}|${currency}|${identity}`;
    if (existingKeys.has(key)) continue;
    suggestions.push({
      id: `object-suggestion:${key}`,
      type,
      title: type === 'family_support' ? `Apoio para ${relationship.displayName}` : `Empréstimos com ${relationship.displayName}`,
      currency,
      confidence: relationship.totalCount >= 6 ? 'high' : 'medium',
      explanation: 'A sugestão usa somente contexto já confirmado na Memória Financeira e o histórico de transferências relacionado.',
      evidence: [`${relationship.totalCount} transferências.`, `Enviado: ${formatMoney(relationship.sentCents, currency)}.`, `Recebido: ${formatMoney(relationship.receivedCents, currency)}.`],
      transactionIds: relationship.transactionIds,
      plannedEventIds: [],
      relationshipEntityId: relationship.memoryEntityId,
      expectedCents: relationship.sentCount ? Math.round(relationship.sentCents / relationship.sentCount) : undefined,
    });
  }

  for (const planned of state.plannedEvents.filter((item) => item.active && item.currency === currency)) {
    const type: FinancialObjectType = planned.kind === 'installment' ? 'loan' : planned.kind === 'transfer' ? 'commitment' : planned.direction === 'outflow' ? 'commitment' : 'goal';
    const key = `${type}|${currency}|planned:${planned.id}`;
    if (existingKeys.has(key)) continue;
    suggestions.push({
      id: `object-suggestion:${key}`,
      type,
      title: planned.title,
      currency,
      confidence: 'high',
      explanation: 'Este objeto vem de um compromisso planejado já confirmado no app.',
      evidence: [`Vencimento: ${planned.dueDate}.`, `Valor: ${formatMoney(planned.amountCents, currency)}.`],
      transactionIds: [],
      plannedEventIds: [planned.id],
      expectedCents: planned.amountCents,
    });
  }

  return suggestions.slice(0, 30);
}

export function createFinancialObject(state: AppState, input: {
  type: FinancialObjectType;
  title: string;
  currency: string;
  transactionIds?: string[];
  plannedEventIds?: string[];
  relationshipEntityId?: string;
  merchantNormalized?: string;
  expectedCents?: number;
  targetCents?: number;
  notes?: string;
  source?: FinancialObject['source'];
}): AppState {
  const now = new Date().toISOString();
  const object: FinancialObject = {
    id: crypto.randomUUID(),
    type: input.type,
    title: input.title.trim(),
    currency: input.currency,
    status: 'active',
    transactionIds: [...new Set(input.transactionIds ?? [])],
    plannedEventIds: [...new Set(input.plannedEventIds ?? [])],
    relationshipEntityId: input.relationshipEntityId,
    merchantNormalized: input.merchantNormalized,
    expectedCents: input.expectedCents,
    targetCents: input.targetCents,
    notes: input.notes?.trim() || undefined,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, financialObjects: [object, ...state.financialObjects] };
}

export function acceptFinancialObjectSuggestion(state: AppState, suggestion: FinancialObjectSuggestion): AppState {
  return createFinancialObject(state, {
    type: suggestion.type,
    title: suggestion.title,
    currency: suggestion.currency,
    transactionIds: suggestion.transactionIds,
    plannedEventIds: suggestion.plannedEventIds,
    relationshipEntityId: suggestion.relationshipEntityId,
    merchantNormalized: suggestion.merchantNormalized,
    expectedCents: suggestion.expectedCents,
    source: 'confirmed_suggestion',
  });
}

export function archiveFinancialObject(state: AppState, id: string): AppState {
  const now = new Date().toISOString();
  return { ...state, financialObjects: state.financialObjects.map((item) => item.id === id ? { ...item, status: 'archived', updatedAt: now } : item) };
}
