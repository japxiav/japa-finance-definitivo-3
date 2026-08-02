import type { AppState, FinancialMemoryEntity, Transaction } from '../core/types';
import { signedNetMovement, type DateRange } from '../core/finance';
import { extractCounterpartyName } from './transactionPresentation';
import { matchMemoryEntity, normalizeEntityAlias } from './financialMemory';

export interface FinancialRelationshipSummary {
  key: string;
  displayName: string;
  normalizedAlias: string;
  /** Todos os nomes bancários agrupados nesta relação. */
  normalizedAliases: string[];
  currency: string;
  transactionIds: string[];
  sentCents: number;
  receivedCents: number;
  netCents: number;
  sentCount: number;
  receivedCount: number;
  totalCount: number;
  firstDate: string;
  lastDate: string;
  memoryEntityId?: string;
  relationship?: FinancialMemoryEntity['relationship'];
  contextLabel?: string;
  relevanceScore: number;
  needsContextSuggestion: boolean;
}

function looksLikeGenericTransferDescription(value: string): boolean {
  const normalized = normalizeEntityAlias(value);
  if (!normalized) return true;
  return /^(?:bank transfer|transfer|transferencia|transferência|international transfer|scheduled transfer|card to card transfer|incoming transfer|outgoing transfer|recebido|enviado|received|sent)$/.test(normalized)
    || /^(?:wise|revolut)(?: transfer)?$/.test(normalized)
    || /^balance[- ]?\d+$/i.test(normalized);
}

/**
 * Extrai a contraparte sem transformar descrições técnicas genéricas em pessoas.
 * Para Revolut, a descrição frequentemente já é apenas o nome da contraparte.
 */
export function relationshipCounterparty(transaction: Transaction): string | undefined {
  const direct = extractCounterpartyName(transaction);
  if (direct?.trim()) return direct.trim();
  if (!['incoming_transfer', 'outgoing_transfer'].includes(transaction.technicalType)) return undefined;
  const description = transaction.descriptionOriginal
    .replace(/\s+(?:com a referência|with (?:the )?reference).*$/i, '')
    .replace(/\s+(?:sent from|received from)\s+(?:wise|revolut).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!description || description.length > 100 || looksLikeGenericTransferDescription(description)) return undefined;
  return description;
}

function inRange(transaction: Transaction, range?: DateRange): boolean {
  if (range?.start && transaction.reportingDate < range.start) return false;
  if (range?.end && transaction.reportingDate > range.end) return false;
  return true;
}

function relevanceScore(input: {
  totalCount: number;
  sentCents: number;
  receivedCents: number;
  spanDays: number;
}): number {
  const totalCents = input.sentCents + input.receivedCents;
  const countScore = Math.min(45, input.totalCount * 5);
  const amountScore = Math.min(40, Math.log10(Math.max(100, totalCents)) * 10 - 15);
  const spanScore = input.spanDays >= 90 ? 15 : input.spanDays >= 30 ? 9 : input.spanDays >= 7 ? 4 : 0;
  return Math.max(0, Math.min(100, Math.round(countScore + amountScore + spanScore)));
}

function civilSpanDays(first: string, last: string): number {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function comparableNameTokens(value: string): string[] {
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return normalizeEntityAlias(value).split(' ').filter((token) => token.length > 1 && !stop.has(token));
}

function aliasesLikelySame(a: string, b: string): boolean {
  if (a === b) return true;
  const left = comparableNameTokens(a);
  const right = comparableNameTokens(b);
  if (left.length < 2 || right.length < 2) return false;
  const [small, large] = left.length <= right.length ? [left, right] : [right, left];
  const largeSet = new Set(large);
  // Um nome abreviado pode omitir nomes do meio, mas nunca pode contradizê-los.
  // Não basta compartilhar primeiro e último nome: isso fundiria pessoas diferentes.
  return small.every((token) => largeSet.has(token));
}

export function buildFinancialRelationships(
  state: AppState,
  currency?: string,
  range?: DateRange,
): FinancialRelationshipSummary[] {
  const buckets: Array<{
    displayName: string;
    aliases: Set<string>;
    currency: string;
    transactions: Transaction[];
    memory?: FinancialMemoryEntity;
  }> = [];

  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed'
      || transaction.analysisExcluded
      || !['incoming_transfer', 'outgoing_transfer'].includes(transaction.technicalType)
      || (currency && transaction.currency !== currency)
      || !inRange(transaction, range)) continue;
    const displayName = relationshipCounterparty(transaction);
    if (!displayName) continue;
    const alias = normalizeEntityAlias(displayName);
    if (!alias) continue;
    const memory = matchMemoryEntity(state, transaction);
    const knownAliases = new Set(memory?.normalizedAliases ?? []);
    knownAliases.add(alias);
    const bucket = buckets.find((candidate) => {
      if (candidate.currency !== transaction.currency) return false;
      if (candidate.memory?.id && memory?.id) return candidate.memory.id === memory.id;
      if (candidate.memory?.id || memory?.id) {
        const memoryAliases = candidate.memory?.normalizedAliases ?? memory?.normalizedAliases ?? [];
        return [...knownAliases].some((known) => memoryAliases.some((saved) => aliasesLikelySame(known, saved)));
      }
      return [...candidate.aliases].some((saved) => [...knownAliases].some((known) => aliasesLikelySame(saved, known)));
    });
    if (bucket) {
      bucket.transactions.push(transaction);
      for (const known of knownAliases) bucket.aliases.add(known);
      if (!bucket.memory && memory) bucket.memory = memory;
      if (!bucket.memory && displayName.length > bucket.displayName.length) bucket.displayName = displayName;
      continue;
    }
    buckets.push({
      displayName: memory?.displayName || displayName,
      aliases: knownAliases,
      currency: transaction.currency,
      transactions: [transaction],
      memory,
    });
  }

  return buckets.map((bucket) => {
    const rows = bucket.transactions.sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
    let sentCents = 0;
    let receivedCents = 0;
    let sentCount = 0;
    let receivedCount = 0;
    for (const row of rows) {
      const amount = Math.abs(signedNetMovement(row));
      if (row.direction === 'outflow') {
        sentCents += amount;
        sentCount += 1;
      } else {
        receivedCents += amount;
        receivedCount += 1;
      }
    }
    const firstDate = rows[0]!.reportingDate;
    const lastDate = rows.at(-1)!.reportingDate;
    const totalCount = rows.length;
    const score = relevanceScore({
      totalCount,
      sentCents,
      receivedCents,
      spanDays: civilSpanDays(firstDate, lastDate),
    });
    const aliases = [...bucket.aliases].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const normalizedAlias = bucket.memory?.normalizedAliases[0] || aliases[0]!;
    const key = `${bucket.currency}|${normalizedAlias}`;
    return {
      key,
      displayName: bucket.memory?.displayName || bucket.displayName,
      normalizedAlias,
      normalizedAliases: aliases,
      currency: bucket.currency,
      transactionIds: rows.map((row) => row.id),
      sentCents,
      receivedCents,
      netCents: receivedCents - sentCents,
      sentCount,
      receivedCount,
      totalCount,
      firstDate,
      lastDate,
      memoryEntityId: bucket.memory?.id,
      relationship: bucket.memory?.relationship,
      contextLabel: bucket.memory?.contextLabel,
      relevanceScore: score,
      needsContextSuggestion: !bucket.memory && (score >= 58 || totalCount >= 5),
    } satisfies FinancialRelationshipSummary;
  }).sort((a, b) => {
    const amountA = a.sentCents + a.receivedCents;
    const amountB = b.sentCents + b.receivedCents;
    return b.relevanceScore - a.relevanceScore || amountB - amountA || b.totalCount - a.totalCount;
  });
}

export function topRelationshipSenders(items: FinancialRelationshipSummary[], limit = 5) {
  return items.filter((item) => item.sentCents > 0)
    .sort((a, b) => b.sentCents - a.sentCents || b.sentCount - a.sentCount)
    .slice(0, limit);
}

export function topRelationshipReceivers(items: FinancialRelationshipSummary[], limit = 5) {
  return items.filter((item) => item.receivedCents > 0)
    .sort((a, b) => b.receivedCents - a.receivedCents || b.receivedCount - a.receivedCount)
    .slice(0, limit);
}

export function relationshipContextSuggestions(items: FinancialRelationshipSummary[], limit = 6) {
  return items.filter((item) => item.needsContextSuggestion)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export interface RelationshipTimelineEvent {
  id: string;
  month: string;
  direction: 'sent' | 'received';
  title: string;
  detail: string;
  relationshipKey: string;
}

/**
 * Narra mudanças observáveis sem inventar motivo. Ex.: a principal origem de
 * transferências recebidas mudou de uma pessoa para outra.
 */
export function buildRelationshipTimeline(state: AppState, currency: string): RelationshipTimelineEvent[] {
  const relationships = buildFinancialRelationships(state, currency);
  const transactionById = new Map(state.transactions.map((item) => [item.id, item]));
  const monthBuckets = new Map<string, Map<string, { item: FinancialRelationshipSummary; sent: number; received: number }>>();
  for (const item of relationships) {
    for (const id of item.transactionIds) {
      const transaction = transactionById.get(id);
      if (!transaction) continue;
      const month = transaction.reportingDate.slice(0, 7);
      const byRelationship = monthBuckets.get(month) ?? new Map();
      const current = byRelationship.get(item.key) ?? { item, sent: 0, received: 0 };
      const amount = Math.abs(signedNetMovement(transaction));
      if (transaction.direction === 'outflow') current.sent += amount;
      else current.received += amount;
      byRelationship.set(item.key, current);
      monthBuckets.set(month, byRelationship);
    }
  }
  const events: RelationshipTimelineEvent[] = [];
  let previousSentKey: string | undefined;
  let previousReceivedKey: string | undefined;
  for (const month of [...monthBuckets.keys()].sort()) {
    const rows = [...monthBuckets.get(month)!.values()];
    const sent = rows.filter((row) => row.sent > 0).sort((a, b) => b.sent - a.sent)[0];
    const received = rows.filter((row) => row.received > 0).sort((a, b) => b.received - a.received)[0];
    if (sent && sent.item.key !== previousSentKey) {
      events.push({
        id: `${month}:sent:${sent.item.key}`,
        month,
        direction: 'sent',
        title: `${sent.item.displayName} virou o principal destino do mês`,
        detail: `${formatCompactAmount(sent.sent, currency)} enviados em ${month}. Isso descreve o fluxo, não presume a finalidade.`,
        relationshipKey: sent.item.key,
      });
      previousSentKey = sent.item.key;
    }
    if (received && received.item.key !== previousReceivedKey) {
      events.push({
        id: `${month}:received:${received.item.key}`,
        month,
        direction: 'received',
        title: `${received.item.displayName} virou a principal origem do mês`,
        detail: `${formatCompactAmount(received.received, currency)} recebidos em ${month}. O motivo continua sendo contexto opcional.`,
        relationshipKey: received.item.key,
      });
      previousReceivedKey = received.item.key;
    }
  }
  return events.slice(-12).reverse();
}

function formatCompactAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}
