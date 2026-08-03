import type { AppState, Transaction } from '../core/types';
import { signedNetMovement, type DateRange } from '../core/finance';
import { formatMoney } from '../core/money';
import { buildFinancialRelationships, type FinancialRelationshipSummary } from './financialRelationships';

export interface CalculationExplanation {
  id: string;
  title: string;
  resultLabel: string;
  formula: string;
  scope: string;
  confidence: 'high' | 'medium' | 'low';
  includedCount: number;
  excludedCount: number;
  includedTransactionIds: string[];
  excludedReasons: Array<{ reason: string; count: number }>;
  evidence: string[];
}

function within(transaction: Transaction, range?: DateRange): boolean {
  if (range?.start && transaction.reportingDate < range.start) return false;
  if (range?.end && transaction.reportingDate > range.end) return false;
  return true;
}

function reasonCounts(rows: Transaction[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reason = row.status !== 'completed'
      ? `status ${row.status}`
      : row.analysisExcluded
        ? row.technicalType === 'internal_transfer' ? 'transferência interna' : row.technicalType === 'currency_conversion' ? 'conversão' : 'fora da análise'
        : 'fora do critério';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export function explainExternalFlow(state: AppState, currency: string, range?: DateRange): CalculationExplanation {
  const relevant = state.transactions.filter((item) => item.currency === currency && within(item, range));
  const included = relevant.filter((item) => item.status === 'completed' && !item.analysisExcluded);
  const excluded = relevant.filter((item) => !included.includes(item));
  const inflow = included.reduce((sum, item) => sum + Math.max(0, signedNetMovement(item)), 0);
  const outflow = included.reduce((sum, item) => sum + Math.max(0, -signedNetMovement(item)), 0);
  return {
    id: `external-flow:${currency}:${range?.start ?? 'all'}:${range?.end ?? 'all'}`,
    title: 'Resultado do fluxo externo',
    resultLabel: `${formatMoney(inflow, currency)} - ${formatMoney(outflow, currency)} = ${formatMoney(inflow - outflow, currency)}`,
    formula: 'entradas externas concluídas − saídas externas concluídas',
    scope: `${range?.start ?? 'início do histórico'} até ${range?.end ?? 'último movimento'} · ${currency}`,
    confidence: included.some((item) => item.technicalType === 'unknown') ? 'medium' : 'high',
    includedCount: included.length,
    excludedCount: excluded.length,
    includedTransactionIds: included.map((item) => item.id),
    excludedReasons: reasonCounts(excluded),
    evidence: [
      `${included.filter((item) => signedNetMovement(item) > 0).length} entradas incluídas.`,
      `${included.filter((item) => signedNetMovement(item) < 0).length} saídas incluídas.`,
      'Transferências internas e conversões são preservadas no livro, mas excluídas do fluxo externo.',
    ],
  };
}

export function explainRelationship(relationship: FinancialRelationshipSummary): CalculationExplanation {
  return {
    id: `relationship:${relationship.key}`,
    title: `Relacionamento com ${relationship.displayName}`,
    resultLabel: `Enviado ${formatMoney(relationship.sentCents, relationship.currency)} · Recebido ${formatMoney(relationship.receivedCents, relationship.currency)} · Líquido ${formatMoney(relationship.netCents, relationship.currency)}`,
    formula: 'transferências recebidas − transferências enviadas',
    scope: `${relationship.firstDate} até ${relationship.lastDate} · ${relationship.currency}`,
    confidence: 'high',
    includedCount: relationship.totalCount,
    excludedCount: 0,
    includedTransactionIds: relationship.transactionIds,
    excludedReasons: [],
    evidence: [
      `${relationship.sentCount} envio(s).`,
      `${relationship.receivedCount} recebimento(s).`,
      `${relationship.normalizedAliases.length} variação(ões) de nome bancário consolidadas.`,
    ],
  };
}

export function explainMerchant(state: AppState, currency: string, merchantNormalized: string, range?: DateRange): CalculationExplanation {
  const normalized = merchantNormalized.trim().toLocaleLowerCase('pt-BR');
  const matching = state.transactions.filter((item) => item.currency === currency
    && item.status === 'completed'
    && within(item, range)
    && (item.merchantNormalized || '').toLocaleLowerCase('pt-BR').includes(normalized));
  const included = matching.filter((item) => !item.analysisExcluded && ['card_payment', 'direct_debit', 'other_expense', 'refund'].includes(item.technicalType));
  const gross = included.filter((item) => item.direction === 'outflow').reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0);
  const refunds = included.filter((item) => item.direction === 'inflow' || item.kind === 'refund').reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0);
  return {
    id: `merchant:${currency}:${normalized}`,
    title: `Impacto líquido de ${merchantNormalized}`,
    resultLabel: `${formatMoney(gross, currency)} − ${formatMoney(refunds, currency)} = ${formatMoney(gross - refunds, currency)}`,
    formula: 'compras concluídas − reembolsos concluídos',
    scope: `${range?.start ?? 'início do histórico'} até ${range?.end ?? 'último movimento'} · ${currency}`,
    confidence: 'high',
    includedCount: included.length,
    excludedCount: matching.length - included.length,
    includedTransactionIds: included.map((item) => item.id),
    excludedReasons: reasonCounts(matching.filter((item) => !included.includes(item))),
    evidence: [`${included.filter((item) => item.direction === 'outflow').length} compra(s).`, `${included.filter((item) => item.direction === 'inflow' || item.kind === 'refund').length} reembolso(s).`],
  };
}

export function explainTopRelationship(state: AppState, currency: string, direction: 'sent' | 'received'): CalculationExplanation | undefined {
  const relationships = buildFinancialRelationships(state, currency);
  const selected = [...relationships].sort((a, b) => direction === 'sent' ? b.sentCents - a.sentCents : b.receivedCents - a.receivedCents)[0];
  return selected ? explainRelationship(selected) : undefined;
}
