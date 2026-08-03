import type { AppState, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { buildCompoundEventSummaries } from './compoundEvents';

export type FinancialEventType = 'conversion' | 'internal_transfer' | 'refund_cycle' | 'internal_product' | 'single';

export interface FinancialEventSummary {
  id: string;
  type: FinancialEventType;
  title: string;
  reportingDate: string;
  transactionIds: string[];
  currencies: string[];
  accountIds: string[];
  totalFeeCents: number;
  sourceAmountCents?: number;
  targetAmountCents?: number;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export function buildFinancialEvents(state: AppState): FinancialEventSummary[] {
  const events: FinancialEventSummary[] = [];
  for (const compound of buildCompoundEventSummaries(state)) {
    const rows = state.transactions.filter((item) => compound.transactionIds.includes(item.id));
    events.push({
      id: compound.id,
      type: compound.kind === 'conversion' ? 'conversion' : compound.kind === 'internal_product' ? 'internal_product' : 'single',
      title: compound.kind === 'conversion' ? 'Conversão de moeda' : compound.kind === 'internal_product' ? 'Movimento para produto interno' : 'Evento composto',
      reportingDate: compound.reportingDate,
      transactionIds: compound.transactionIds,
      currencies: unique(rows.map((item) => item.currency)),
      accountIds: unique(rows.map((item) => item.accountId)),
      totalFeeCents: compound.fees.reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0),
      sourceAmountCents: compound.source ? Math.abs(signedNetMovement(compound.source)) : undefined,
      targetAmountCents: compound.target ? Math.abs(signedNetMovement(compound.target)) : undefined,
      confidence: compound.kind === 'conversion' && compound.source && compound.target ? 'high' : 'medium',
      explanation: compound.kind === 'conversion'
        ? 'Linhas de origem, destino e taxa permanecem no livro, mas são apresentadas como um único acontecimento.'
        : 'As linhas pertencem ao mesmo acontecimento bancário e não devem ser lidas como renda e despesa independentes.',
    });
  }

  const internalGroups = new Map<string, Transaction[]>();
  for (const row of state.transactions.filter((item) => item.status === 'completed' && item.technicalType === 'internal_transfer' && item.transferGroupId && !item.compoundEventId)) {
    const list = internalGroups.get(row.transferGroupId!) ?? [];
    list.push(row);
    internalGroups.set(row.transferGroupId!, list);
  }
  for (const [id, rows] of internalGroups) {
    events.push({
      id: `internal:${id}`,
      type: 'internal_transfer',
      title: 'Transferência entre contas próprias',
      reportingDate: rows.map((item) => item.reportingDate).sort()[0]!,
      transactionIds: rows.map((item) => item.id),
      currencies: unique(rows.map((item) => item.currency)),
      accountIds: unique(rows.map((item) => item.accountId)),
      totalFeeCents: 0,
      sourceAmountCents: rows.filter((item) => item.direction === 'outflow').reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0),
      targetAmountCents: rows.filter((item) => item.direction === 'inflow').reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0),
      confidence: rows.some((item) => item.ownerIdentityMatched) || rows.length >= 2 ? 'high' : 'medium',
      explanation: 'O dinheiro mudou de conta, mas não representa renda nem gasto externo.',
    });
  }

  for (const refund of state.transactions.filter((item) => item.status === 'completed' && item.kind === 'refund' && item.refundOfTransactionId)) {
    const purchase = state.transactions.find((item) => item.id === refund.refundOfTransactionId);
    if (!purchase) continue;
    events.push({
      id: `refund:${purchase.id}:${refund.id}`,
      type: 'refund_cycle',
      title: 'Compra e reembolso',
      reportingDate: purchase.reportingDate,
      transactionIds: [purchase.id, refund.id],
      currencies: unique([purchase.currency, refund.currency]),
      accountIds: unique([purchase.accountId, refund.accountId]),
      totalFeeCents: 0,
      sourceAmountCents: Math.abs(signedNetMovement(purchase)),
      targetAmountCents: Math.abs(signedNetMovement(refund)),
      confidence: 'high',
      explanation: 'A compra bruta e o reembolso são preservados; a análise usa o impacto líquido.',
    });
  }

  return events.sort((a, b) => b.reportingDate.localeCompare(a.reportingDate)).slice(0, 120);
}
