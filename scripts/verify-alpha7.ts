import { readFileSync } from 'node:fs';
import { initialState } from '../src/data/defaults';
import { previewSmartBankCsv } from '../src/core/csv';
import { normalizeState } from '../src/core/storage';
import { buildReviewGroups } from '../src/classification/grouping';
import { buildFinancialRelationships, buildRelationshipTimeline, relationshipContextSuggestions } from '../src/application/financialRelationships';
import { buildAnalytics } from '../src/analytics/metrics';
import { buildImpactInsights } from '../src/insights/impactEngine';
import { buildContextDiagnostic } from '../src/application/contextDiagnostic';
import { buildDeterministicAuditProposals, buildFinancialAuditContext } from '../src/application/smartAudit';
import type { AppState, Transaction } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mergeAccounts(state: AppState, accounts: AppState['accounts']): AppState['accounts'] {
  const map = new Map(state.accounts.map((item) => [item.id, item]));
  for (const account of accounts) map.set(account.id, { ...(map.get(account.id) ?? {}), ...account, active: true });
  return [...map.values()];
}

async function importCsv(state: AppState, path: string): Promise<AppState> {
  const preview = await previewSmartBankCsv(readFileSync(path, 'utf8'), path.split('/').at(-1)!, state);
  return {
    ...state,
    accounts: mergeAccounts(state, [...(preview.accounts ?? []), ...(preview.createdAccounts ?? [])]),
    transactions: [...state.transactions, ...preview.newTransactions],
    imports: [...state.imports, preview.batch],
    importIssues: [...state.importIssues, ...preview.issues],
  };
}

async function main() {
  let state: AppState = structuredClone(initialState);
  state = await importCsv(state, '/mnt/data/account-statement_2026-05-22_2026-08-01_pt_03ba8a.csv');
  state = await importCsv(state, '/mnt/data/jf_statement_audit/statement_124381219_BRL_2025-10-07_2026-08-01.csv');
  state = await importCsv(state, '/mnt/data/jf_statement_audit/statement_124381221_EUR_2025-10-07_2026-08-01.csv');
  state = normalizeState(state, initialState);

  const personTransfers = state.transactions.filter((item) => ['incoming_transfer', 'outgoing_transfer'].includes(item.technicalType));
  assert(personTransfers.length > 0, 'Nenhuma transferência entre pessoas foi reconhecida.');
  assert(personTransfers.every((item) => item.categoryReviewStatus === 'not_applicable'), 'Transferência ainda virou revisão de categoria.');
  assert(personTransfers.every((item) => !item.reviewReasons.includes('uncategorized') && !item.reviewReasons.includes('ambiguous_transfer')), 'Transferência manteve razão de revisão antiga.');

  const reviewGroups = buildReviewGroups(state);
  assert(reviewGroups.every((group) => !['incoming_transfer', 'outgoing_transfer'].includes(group.technicalType)), 'ReviewGroup ainda inclui transferências entre pessoas.');

  const eurRelationships = buildFinancialRelationships(state, 'EUR');
  const brlRelationships = buildFinancialRelationships(state, 'BRL');
  assert(eurRelationships.length > 0, 'Nenhum relacionamento EUR foi derivado.');
  assert(brlRelationships.length > 0, 'Nenhum relacionamento BRL foi derivado.');
  assert(eurRelationships.some((item) => item.sentCount > 0 || item.receivedCount > 0), 'Relacionamentos não somaram os sentidos.');
  assert(relationshipContextSuggestions([...eurRelationships, ...brlRelationships]).length <= 6, 'Sugestões de contexto viraram nova fila infinita.');
  const hannah = eurRelationships.find((item) => item.displayName.toLocaleLowerCase('pt-BR').includes('hannah'));
  assert(hannah && hannah.totalCount >= 60, 'Aliases bancários da Hannah não foram consolidados.');
  assert(hannah.normalizedAliases.length >= 2, 'Relacionamento consolidado não preservou os aliases bancários.');

  const timeline = buildRelationshipTimeline(state, 'EUR');
  assert(timeline.length > 0, 'Linha do tempo de relacionamentos ficou vazia.');

  const analytics = buildAnalytics(state, 'EUR', { start: '2026-05-22', end: '2026-08-01' });
  const uncategorizedPersonTransfers = analytics.current.transactions.filter((item) =>
    ['incoming_transfer', 'outgoing_transfer'].includes(item.technicalType)
    && !item.categoryId,
  ).length;
  assert(uncategorizedPersonTransfers > 0, 'Cenário não contém transferências sem categoria para validar.');
  assert(analytics.current.uncategorizedTransactionCount < uncategorizedPersonTransfers + analytics.current.expenseTransactionCount, 'Contador de sem categoria parece incluir todo o conjunto de transferências.');
  assert(analytics.current.categorizedExpenseCents <= analytics.current.summary.expenseCents, 'Despesas categorizáveis ultrapassaram todas as saídas.');
  assert(analytics.current.byCategory.reduce((sum, item) => sum + item.amountCents, 0) === analytics.current.categorizedExpenseCents, 'Categorias não fecham com compras e despesas.');
  assert(analytics.current.transferOutflowCents > 0 && analytics.current.transferInflowCents > 0, 'Fluxo não separou transferências entre pessoas.');

  const recurringBase = state.transactions.find((item) => item.currency === 'EUR')!;
  const stateWithRecurring: AppState = {
    ...state,
    transactionAllocations: [
      {
        id: 'recurring-old', transactionId: recurringBase.id, label: 'Assinatura dividida', amountCents: 3_000,
        relatedPerson: 'Hannah', recurring: true, recurrenceFrequency: 'monthly', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'recurring-new', transactionId: recurringBase.id, label: 'Assinatura dividida', amountCents: 7_000,
        relatedPerson: 'Hannah', recurring: true, recurrenceFrequency: 'monthly', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
      },
    ],
  };
  const impact = buildImpactInsights({
    state: stateWithRecurring,
    currency: 'EUR',
    position: { confidence: 'ready' } as any,
    freeMoney: { status: 'incomplete', commitmentsCents: 0, reserveCents: 0 } as any,
    analytics,
    currencyAnalytics: { explicitFeeCents: 0, institutions: [] } as any,
    internalSuggestions: [],
    formatMoney: (amountCents) => String(amountCents),
  });
  assert(!impact.some((item) => item.id === 'unknown-transfer-contexts'), 'Contexto opcional ainda virou alerta de insight.');
  assert(impact.find((item) => item.id === 'shared-recurring')?.impactValue === '84000', 'Recorrência histórica foi anualizada mais de uma vez.');

  const diagnostic = buildContextDiagnostic(state);
  assert(!(diagnostic.unknowns as Array<{ technicalType: string }>).some((item) => ['incoming_transfer', 'outgoing_transfer'].includes(item.technicalType)), 'Diagnóstico ainda chama transferência sem contexto de desconhecida.');
  assert(!buildDeterministicAuditProposals(state).some((item) => item.type === 'create_memory_entity'), 'Auditoria determinística ainda cria fila de contexto pessoal.');
  assert(buildFinancialAuditContext(state).relationshipSummary.length > 0, 'Panorama da auditoria perdeu os relacionamentos derivados.');

  const transfer = personTransfers[0]!;
  const legacy: Record<string, unknown> = {
    ...state,
    schemaVersion: 12,
    transactions: state.transactions.map((item): Transaction => item.id === transfer.id ? {
      ...item,
      categoryReviewStatus: 'pending',
      reviewReasons: [...item.reviewReasons, 'uncategorized'],
      needsReview: true,
    } : item),
  };
  const migrated = normalizeState(legacy, initialState);
  const migratedTransfer = migrated.transactions.find((item) => item.id === transfer.id)!;
  assert(migrated.schemaVersion === 13, 'Schema não migrou para 13.');
  assert(migratedTransfer.categoryReviewStatus === 'not_applicable', 'Migração não tornou contexto de transferência opcional.');
  assert(!migratedTransfer.needsReview, 'Migração manteve revisão apenas por falta de categoria.');

  console.log(JSON.stringify({
    schemaVersion: migrated.schemaVersion,
    transactions: state.transactions.length,
    personTransfers: personTransfers.length,
    reviewGroups: reviewGroups.length,
    transferGroups: reviewGroups.filter((group) => ['incoming_transfer', 'outgoing_transfer'].includes(group.technicalType)).length,
    eurRelationships: eurRelationships.length,
    brlRelationships: brlRelationships.length,
    contextSuggestions: relationshipContextSuggestions([...eurRelationships, ...brlRelationships]).length,
    timelineEvents: timeline.length,
    categorizedExpenseCents: analytics.current.categorizedExpenseCents,
    transferOutflowCents: analytics.current.transferOutflowCents,
    transferInflowCents: analytics.current.transferInflowCents,
    topEur: eurRelationships.slice(0, 5).map((item) => ({ name: item.displayName, sent: item.sentCents, received: item.receivedCents, count: item.totalCount })),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
