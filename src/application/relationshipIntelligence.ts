import type { AppState, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import type { FinancialRelationshipSummary } from './financialRelationships';

export interface RelationshipMonthlyPoint {
  month: string;
  sentCents: number;
  receivedCents: number;
  count: number;
}

export interface RelationshipIntelligence {
  relationshipKey: string;
  currency: string;
  totalPersonSentCents: number;
  totalPersonReceivedCents: number;
  sentShare: number;
  receivedShare: number;
  averageSentCents: number;
  averageReceivedCents: number;
  largestSentMonth?: RelationshipMonthlyPoint;
  largestReceivedMonth?: RelationshipMonthlyPoint;
  activeMonths: number;
  cadenceLabel: string;
  monthly: RelationshipMonthlyPoint[];
  facts: string[];
}

function monthsBetween(first: string, last: string): number {
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  if (![fy, fm, ly, lm].every(Number.isFinite)) return 1;
  return Math.max(1, (ly! - fy!) * 12 + lm! - fm! + 1);
}

function cadenceLabel(item: FinancialRelationshipSummary, activeMonths: number): string {
  const spanMonths = monthsBetween(item.firstDate, item.lastDate);
  const perActiveMonth = item.totalCount / Math.max(1, activeMonths);
  const activeRatio = activeMonths / spanMonths;
  if (item.totalCount <= 1) return 'pontual';
  if (perActiveMonth >= 4 && activeRatio >= 0.6) return 'frequente';
  if (perActiveMonth >= 1.5 && activeRatio >= 0.45) return 'recorrente';
  if (activeRatio >= 0.6) return 'regular';
  return 'ocasional';
}

function amount(transaction: Transaction): number {
  return Math.abs(signedNetMovement(transaction));
}

export function buildRelationshipIntelligence(
  state: AppState,
  relationship: FinancialRelationshipSummary,
  allRelationships: FinancialRelationshipSummary[],
): RelationshipIntelligence {
  const ids = new Set(relationship.transactionIds);
  const rows = state.transactions.filter((transaction) => ids.has(transaction.id));
  const buckets = new Map<string, RelationshipMonthlyPoint>();
  for (const row of rows) {
    const month = row.reportingDate.slice(0, 7);
    const current = buckets.get(month) ?? { month, sentCents: 0, receivedCents: 0, count: 0 };
    const cents = amount(row);
    if (row.direction === 'outflow') current.sentCents += cents;
    else current.receivedCents += cents;
    current.count += 1;
    buckets.set(month, current);
  }
  const monthly = [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  const totalPersonSentCents = allRelationships.reduce((sum, item) => sum + item.sentCents, 0);
  const totalPersonReceivedCents = allRelationships.reduce((sum, item) => sum + item.receivedCents, 0);
  const largestSentMonth = [...monthly].filter((item) => item.sentCents > 0).sort((a, b) => b.sentCents - a.sentCents)[0];
  const largestReceivedMonth = [...monthly].filter((item) => item.receivedCents > 0).sort((a, b) => b.receivedCents - a.receivedCents)[0];
  const activeMonths = monthly.length;
  const facts: string[] = [];
  const sentShare = totalPersonSentCents > 0 ? relationship.sentCents / totalPersonSentCents : 0;
  const receivedShare = totalPersonReceivedCents > 0 ? relationship.receivedCents / totalPersonReceivedCents : 0;
  if (relationship.sentCents > 0 && sentShare >= 0.15) facts.push(`Representa ${Math.round(sentShare * 100)}% do dinheiro enviado para pessoas nesta moeda.`);
  if (relationship.receivedCents > 0 && receivedShare >= 0.15) facts.push(`Representa ${Math.round(receivedShare * 100)}% do dinheiro recebido de pessoas nesta moeda.`);
  if (relationship.sentCount > 0 && relationship.receivedCount > 0) facts.push('Há dinheiro nos dois sentidos, então a relação não é apenas de pagamento ou recebimento.');
  if (largestSentMonth && monthly.length >= 2) facts.push(`O maior mês de envio foi ${largestSentMonth.month}.`);
  if (largestReceivedMonth && monthly.length >= 2) facts.push(`O maior mês de recebimento foi ${largestReceivedMonth.month}.`);
  return {
    relationshipKey: relationship.key,
    currency: relationship.currency,
    totalPersonSentCents,
    totalPersonReceivedCents,
    sentShare,
    receivedShare,
    averageSentCents: relationship.sentCount ? Math.round(relationship.sentCents / relationship.sentCount) : 0,
    averageReceivedCents: relationship.receivedCount ? Math.round(relationship.receivedCents / relationship.receivedCount) : 0,
    largestSentMonth,
    largestReceivedMonth,
    activeMonths,
    cadenceLabel: cadenceLabel(relationship, activeMonths),
    monthly,
    facts,
  };
}

export interface RelationshipOverviewInsight {
  id: string;
  tone: 'neutral' | 'positive' | 'attention';
  title: string;
  explanation: string;
  relationshipKey?: string;
}

export function buildRelationshipOverviewInsights(
  state: AppState,
  relationships: FinancialRelationshipSummary[],
): RelationshipOverviewInsight[] {
  if (!relationships.length) return [];
  const results: RelationshipOverviewInsight[] = [];
  const sent = [...relationships].filter((item) => item.sentCents > 0).sort((a, b) => b.sentCents - a.sentCents);
  const received = [...relationships].filter((item) => item.receivedCents > 0).sort((a, b) => b.receivedCents - a.receivedCents);
  const totalSent = sent.reduce((sum, item) => sum + item.sentCents, 0);
  const totalReceived = received.reduce((sum, item) => sum + item.receivedCents, 0);
  const topSent = sent[0];
  const topReceived = received[0];
  if (topSent && totalSent > 0 && topSent.sentCents / totalSent >= 0.25) {
    const share = Math.round(topSent.sentCents / totalSent * 100);
    results.push({ id: `top-sent:${topSent.key}`, tone: 'neutral', title: `${topSent.displayName} concentra ${share}% dos envios para pessoas`, explanation: `${topSent.sentCount} transferências formam essa participação. Isso descreve a concentração, sem presumir a finalidade.`, relationshipKey: topSent.key });
  }
  if (topReceived && totalReceived > 0 && topReceived.receivedCents / totalReceived >= 0.25) {
    const share = Math.round(topReceived.receivedCents / totalReceived * 100);
    results.push({ id: `top-received:${topReceived.key}`, tone: 'positive', title: `${topReceived.displayName} concentra ${share}% do recebido de pessoas`, explanation: `${topReceived.receivedCount} transferências formam essa participação. O motivo pode ser anotado apenas quando fizer diferença.`, relationshipKey: topReceived.key });
  }
  const bidirectional = relationships
    .filter((item) => item.sentCount >= 2 && item.receivedCount >= 2)
    .sort((a, b) => b.totalCount - a.totalCount)[0];
  if (bidirectional) {
    const intelligence = buildRelationshipIntelligence(state, bidirectional, relationships);
    results.push({ id: `two-way:${bidirectional.key}`, tone: 'neutral', title: `${bidirectional.displayName} tem fluxo nos dois sentidos`, explanation: `${bidirectional.sentCount} envios e ${bidirectional.receivedCount} recebimentos, com padrão ${intelligence.cadenceLabel}. Isso pode representar divisão de despesas, empréstimos ou reembolsos, mas o app não inventa qual deles.`, relationshipKey: bidirectional.key });
  }
  return results.slice(0, 4);
}
