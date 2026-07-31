import type { AppState } from '../core/types';

export type ActivityKind = 'import' | 'classification' | 'reconciliation' | 'planning' | 'manual' | 'category';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  occurredAt: string;
  undone?: boolean;
}

export function buildActivityTimeline(
  state: AppState,
  currency: string,
  accountName: (accountId: string) => string,
  limit = 40,
): ActivityItem[] {
  const accountIds = new Set(state.accounts.filter((account) => account.currency === currency).map((account) => account.id));
  const items: ActivityItem[] = [];

  for (const batch of state.imports) {
    if (!accountIds.has(batch.accountId)) continue;
    items.push({
      id: `import-${batch.id}`,
      kind: 'import',
      title: batch.status === 'undone' ? 'Importação anulada' : 'Extrato importado',
      detail: `${batch.fileName} · ${accountName(batch.accountId)} · ${batch.imported} movimentações`,
      occurredAt: batch.createdAt,
      undone: batch.status === 'undone',
    });
  }

  for (const decision of state.reviewDecisions) {
    const belongs = decision.transactionIds.some((id) => state.transactions.some((transaction) => transaction.id === id && transaction.currency === currency));
    if (!belongs && decision.transactionIds.length > 0) continue;
    items.push({
      id: `decision-${decision.id}`,
      kind: 'classification',
      title: decision.undoneAt ? 'Classificação desfeita' : 'Classificação aplicada',
      detail: `${decision.label} · ${decision.transactionIds.length} movimentações`,
      occurredAt: decision.undoneAt ?? decision.createdAt,
      undone: Boolean(decision.undoneAt),
    });
  }

  for (const batch of state.reconciliationBatches) {
    const hasCurrency = state.balanceSnapshots.some((snapshot) => snapshot.reconciliationBatchId === batch.id && snapshot.currency === currency);
    if (!hasCurrency) continue;
    items.push({
      id: `reconciliation-${batch.id}`,
      kind: 'reconciliation',
      title: batch.status === 'INVALIDATED' ? 'Reconciliação invalidada' : 'Saldos reconciliados',
      detail: `Posição de ${batch.logicalDate ?? batch.logicalAsOf.slice(0, 10)}`,
      occurredAt: batch.createdAt,
      undone: batch.status === 'INVALIDATED',
    });
  }

  for (const event of state.plannedEvents) {
    if (event.currency !== currency) continue;
    items.push({
      id: `planned-${event.id}`,
      kind: 'planning',
      title: event.active ? 'Compromisso planejado' : 'Compromisso desativado',
      detail: `${event.title} · ${event.dueDate}`,
      occurredAt: event.updatedAt || event.createdAt,
      undone: !event.active,
    });
  }

  for (const transaction of state.transactions) {
    if (transaction.currency !== currency || transaction.source !== 'manual' || transaction.status === 'voided') continue;
    items.push({
      id: `manual-${transaction.id}`,
      kind: 'manual',
      title: 'Movimentação manual criada',
      detail: `${transaction.descriptionOriginal} · ${accountName(transaction.accountId)}`,
      occurredAt: transaction.createdAt,
    });
  }

  for (const category of state.categories) {
    if (!category.createdAt || category.system) continue;
    items.push({
      id: `category-${category.id}`,
      kind: 'category',
      title: category.active ? 'Categoria criada' : 'Categoria arquivada',
      detail: category.name,
      occurredAt: category.archivedAt ?? category.createdAt,
      undone: !category.active,
    });
  }

  return items
    .filter((item) => Boolean(Date.parse(item.occurredAt)))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit);
}
