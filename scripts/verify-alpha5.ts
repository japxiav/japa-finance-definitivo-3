import { normalizeState } from '../src/core/storage';
import { initialState } from '../src/data/defaults';
import type { AppState, Transaction, TransactionAllocation } from '../src/core/types';
import { buildCurrencyPosition, buildFreeMoneyPosition } from '../src/analytics/accountPositions';
import { buildCurrencyAnalytics } from '../src/analytics/currencyAnalytics';
import {
  confirmInternalTransferSuggestion,
  findInternalTransferSuggestions,
  rejectInternalTransferSuggestion,
} from '../src/application/internalTransfers';
import { buildAnalytics } from '../src/analytics/metrics';
import { filterTransactions } from '../src/application/transactionFilters';
import { previewBankCsv } from '../src/core/csv';

const assert = {
  equal<T>(actual: T, expected: T, message?: string) {
    if (actual !== expected) throw new Error(message ?? `Esperado ${String(expected)}, recebido ${String(actual)}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? 'Condição esperada não foi satisfeita');
  },
  throws(run: () => unknown, pattern: RegExp, message?: string) {
    try { run(); } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (!pattern.test(text)) throw new Error(message ?? `Erro inesperado: ${text}`);
      return;
    }
    throw new Error(message ?? 'Era esperado que a operação falhasse');
  },
};

declare const require: (id: string) => { readFileSync(path: string, encoding: string): string };
declare const process: { argv: string[]; exitCode?: number };
const { readFileSync } = require('node:fs');

function cloneInitial(): AppState {
  return JSON.parse(JSON.stringify(initialState)) as AppState;
}

function transaction(input: {
  id: string;
  accountId?: string;
  amountCents: number;
  direction: 'inflow' | 'outflow';
  reportingDate: string;
  description?: string;
  technicalType?: Transaction['technicalType'];
  kind?: Transaction['kind'];
  categoryId?: string;
  transferGroupId?: string;
}): Transaction {
  const signed = input.direction === 'inflow' ? input.amountCents : -input.amountCents;
  const technicalType = input.technicalType ?? (input.direction === 'inflow' ? 'incoming_transfer' : 'outgoing_transfer');
  const kind = input.kind ?? (technicalType === 'incoming_transfer' || technicalType === 'outgoing_transfer' || technicalType === 'internal_transfer' || technicalType === 'currency_conversion'
    ? 'transfer'
    : input.direction === 'inflow' ? 'income' : 'expense');
  const now = `${input.reportingDate}T12:00:00.000Z`;
  return {
    id: input.id,
    accountId: input.accountId ?? 'revolut-eur',
    dedupFingerprint: `fp:${input.id}`,
    amountCents: input.amountCents,
    reportedAmountCents: signed,
    netMovementCents: signed,
    sourceComponent: 'primary',
    currency: 'EUR',
    direction: input.direction,
    source: 'manual',
    status: 'completed',
    kind,
    technicalType,
    kindSource: 'manual',
    analysisExcluded: technicalType === 'internal_transfer' || technicalType === 'currency_conversion',
    descriptionOriginal: input.description ?? input.id,
    merchantNormalized: (input.description ?? input.id).toLocaleLowerCase('pt-BR'),
    reportingDate: input.reportingDate,
    completedAt: now,
    categoryId: input.categoryId,
    categorySource: input.categoryId ? 'manual' : 'none',
    categoryReviewStatus: technicalType === 'internal_transfer' || technicalType === 'currency_conversion'
      ? 'not_applicable'
      : input.categoryId ? 'resolved' : 'resolved',
    transferGroupId: input.transferGroupId,
    needsReview: false,
    reviewReasons: [],
    manualEditLog: [],
    originalData: {},
    createdAt: now,
    updatedAt: now,
  };
}

function normalizedSynthetic(): AppState {
  const state = cloneInitial();
  state.accounts = state.accounts.map((account) => account.id === 'wise-eur' ? { ...account, active: true } : account);
  return normalizeState(state, initialState);
}

const backupPath = process.argv[2];
if (backupPath) {
  const file = JSON.parse(readFileSync(backupPath, 'utf8')) as { state?: unknown } & Record<string, unknown>;
  const migrated = normalizeState(file.state ?? file, initialState);
  assert.equal(migrated.schemaVersion, 9, 'backup schema 8 deveria migrar para schema 9');
  assert.equal(migrated.transactions.length, 281, 'contagem de movimentações do backup real mudou');
  assert.equal(migrated.transactions.filter((item) => item.sourceComponent === 'fee').length, 10, 'taxas do backup real mudaram');
  assert.equal(migrated.transactions.filter((item) => item.status === 'reverted').length, 2, 'reversões do backup real mudaram');
  assert.equal(migrated.transactionAllocations.length, 0, 'migração deveria iniciar detalhamentos vazios');
  assert.equal(migrated.internalTransferDecisions.length, 0, 'migração deveria iniciar decisões vazias');
  const position = buildCurrencyPosition(migrated, 'EUR', '2026-07-31');
  assert.equal(position.confidence, 'missing', 'backup sem reconciliação deve declarar saldo desconhecido');
  const analytics = buildCurrencyAnalytics(migrated, 'EUR');
  assert.equal(analytics.explicitFeeCents, 1124, 'taxas explícitas do backup real divergiram');
  console.log('✓ backup schema 8 migra para 9 sem alterar 281 fatos, 10 taxas ou 2 reversões');
  console.log('✓ saldo sem reconciliação permanece honestamente marcado como ausente');
  console.log('✓ painel cambial preserva €11,24 de taxas explícitas');
}

{
  const state = normalizedSynthetic();
  state.reconciliationBatches = [{
    id: 'batch-position',
    logicalDate: '2026-07-20',
    logicalAsOf: '2026-07-20T23:00:00.000Z',
    createdAt: '2026-07-20T23:01:00.000Z',
    source: 'manual',
    status: 'COMPLETE',
  }];
  state.balanceSnapshots = [
    { id: 'snap-r', accountId: 'revolut-eur', currency: 'EUR', balanceCents: 10_000, asOf: '2026-07-20T23:00:00.000Z', source: 'manual', reconciled: true, createdAt: '2026-07-20T23:01:00.000Z', reconciliationBatchId: 'batch-position', logicalAsOf: '2026-07-20T23:00:00.000Z' },
    { id: 'snap-w', accountId: 'wise-eur', currency: 'EUR', balanceCents: 20_000, asOf: '2026-07-20T23:00:00.000Z', source: 'manual', reconciled: true, createdAt: '2026-07-20T23:01:00.000Z', reconciliationBatchId: 'batch-position', logicalAsOf: '2026-07-20T23:00:00.000Z' },
  ];
  state.transactions = [
    transaction({ id: 'salary-after', accountId: 'revolut-eur', amountCents: 5_000, direction: 'inflow', reportingDate: '2026-07-21', technicalType: 'other_income', kind: 'income', description: 'Receita após saldo' }),
    transaction({ id: 'expense-after', accountId: 'wise-eur', amountCents: 2_000, direction: 'outflow', reportingDate: '2026-07-21', technicalType: 'card_payment', kind: 'expense', description: 'Despesa após saldo' }),
  ];
  const normalized = normalizeState(state, initialState);
  const position = buildCurrencyPosition(normalized, 'EUR', '2026-07-22');
  assert.equal(position.currentBalanceCents, 33_000, 'saldo consolidado deveria somar snapshots e movimentos posteriores');
  assert.equal(position.positions.length, 2, 'Revolut e Wise devem permanecer contas separadas');
  assert.equal(position.bridge?.openingBalanceCents, 30_000);
  assert.equal(position.bridge?.externalFlowCents, 3_000);
  assert.equal(position.bridge?.closingBalanceCents, 33_000);
  normalized.reservePolicies = [{ currency: 'EUR', minimumCents: 5_000, updatedAt: '2026-07-22T10:00:00.000Z' }];
  normalized.plannedEvents = [
    { id: 'rent', title: 'Aluguel', kind: 'expense', direction: 'outflow', amountCents: 8_000, currency: 'EUR', dueDate: '2026-07-24', accountId: 'revolut-eur', active: true, createdAt: '2026-07-22T10:00:00.000Z', updatedAt: '2026-07-22T10:00:00.000Z' },
    { id: 'salary', title: 'Salário', kind: 'income', direction: 'inflow', amountCents: 50_000, currency: 'EUR', dueDate: '2026-07-19', accountId: 'revolut-eur', recurrence: { frequency: 'weekly', interval: 1 }, active: true, createdAt: '2026-07-19T10:00:00.000Z', updatedAt: '2026-07-19T10:00:00.000Z' },
  ];
  const free = buildFreeMoneyPosition(normalized, position, '2026-07-22');
  assert.equal(free.freeCents, 20_000, 'dinheiro livre deveria descontar compromisso e reserva');
  assert.equal(free.nextIncomeDate, '2026-07-26', 'renda recorrente com data-base passada deve gerar a próxima ocorrência');
  assert.equal(free.safeDailyCents, 5_000, 'limite diário deve considerar quatro dias até a receita recorrente');
  console.log('✓ saldo atual consolida contas separadas e explica a ponte até o valor final');
  console.log('✓ dinheiro livre desconta reserva e compromissos antes da próxima receita');
}

{
  const state = normalizedSynthetic();
  state.transactions = [
    transaction({ id: 'pair-out', accountId: 'revolut-eur', amountCents: 10_000, direction: 'outflow', reportingDate: '2026-07-22', description: 'Transfer to Wise' }),
    transaction({ id: 'pair-in', accountId: 'wise-eur', amountCents: 10_000, direction: 'inflow', reportingDate: '2026-07-23', description: 'Received from Revolut' }),
  ];
  const suggestions = findInternalTransferSuggestions(state, 'EUR');
  assert.equal(suggestions.length, 1, 'par Revolut/Wise deveria ser sugerido');
  assert.equal(suggestions[0]!.confidence, 'high', 'descrição e data próxima deveriam gerar confiança alta');
  const confirmed = confirmInternalTransferSuggestion(state, suggestions[0]!);
  assert.ok(confirmed.transactions.every((item) => item.technicalType === 'internal_transfer' && item.analysisExcluded), 'par confirmado deve ser interno e excluído do fluxo');
  assert.equal(new Set(confirmed.transactions.map((item) => item.transferGroupId)).size, 1, 'as duas pontas precisam compartilhar o mesmo grupo');
  assert.equal(confirmed.internalTransferDecisions[0]?.status, 'confirmed');
  const rejected = rejectInternalTransferSuggestion(state, suggestions[0]!);
  assert.equal(rejected.internalTransferDecisions[0]?.status, 'rejected');
  assert.equal(findInternalTransferSuggestions(rejected, 'EUR').length, 0, 'par rejeitado não deve reaparecer');
  console.log('✓ detecção vincula Revolut ↔ Wise sem contar transferência própria como renda ou despesa');
}

{
  const state = normalizedSynthetic();
  const detailed = transaction({ id: 'detail-transfer', accountId: 'revolut-eur', amountCents: 6_000, direction: 'outflow', reportingDate: '2026-07-24', description: 'Transferência compartilhada' });
  state.transactions = [detailed];
  const now = '2026-07-24T12:00:00.000Z';
  const allocations: TransactionAllocation[] = [
    { id: 'a1', transactionId: detailed.id, label: 'Netflix', amountCents: 1_499, categoryId: 'subscriptions', purpose: 'subscription', relatedPerson: 'Janaína', recurring: true, recurrenceFrequency: 'monthly', nextDueDate: '2026-08-24', createdAt: now, updatedAt: now },
    { id: 'a2', transactionId: detailed.id, label: 'Spotify', amountCents: 1_099, categoryId: 'subscriptions', purpose: 'subscription', relatedPerson: 'Janaína', createdAt: now, updatedAt: now },
    { id: 'a3', transactionId: detailed.id, label: 'Mercado', amountCents: 3_402, categoryId: 'groceries', purpose: 'groceries', createdAt: now, updatedAt: now },
  ];
  state.transactionAllocations = allocations;
  const normalized = normalizeState(state, initialState);
  const analytics = buildAnalytics(normalized, 'EUR', { start: '2026-07-24', end: '2026-07-24' });
  const subscriptions = analytics.current.byCategory.find((item) => item.key === 'subscriptions');
  const groceries = analytics.current.byCategory.find((item) => item.key === 'groceries');
  assert.equal(subscriptions?.amountCents, 2_598, 'assinaturas dentro da transferência devem aparecer no total real');
  assert.equal(groceries?.amountCents, 3_402, 'mercado dentro da transferência deve aparecer no total real');
  const institutionByAccountId = new Map(normalized.accounts.map((account) => [account.id, account.institution]));
  const filtered = filterTransactions(normalized.transactions, {
    currency: 'EUR', query: 'janaína', accountId: 'all', institution: 'revolut', institutionByAccountId,
    categoryId: 'subscriptions', allocations: normalized.transactionAllocations,
    direction: 'all', technicalType: 'all', source: 'all', reviewOnly: false,
  });
  assert.equal(filtered.length, 1, 'busca e categoria devem encontrar conteúdo dos itens detalhados');
  assert.equal(findInternalTransferSuggestions(normalized, 'EUR').length, 0, 'transferência detalhada pelo usuário não deve virar sugestão interna');

  const invalid = { ...state, transactionAllocations: allocations.map((item, index) => index === 2 ? { ...item, amountCents: 3_401 } : item) };
  assert.throws(() => normalizeState(invalid, initialState), /não fecha com o valor/, 'detalhamento incompleto deveria ser rejeitado');
  console.log('✓ transferências podem ser divididas por finalidade, pessoa e assinatura sem alterar o fato bancário');
  console.log('✓ filtros entendem os itens detalhados e somas que não fecham são bloqueadas');
}

async function verifyWiseImport() {
  const state = normalizedSynthetic();
  const csv = [
    'Date,Description,Amount,Currency,Direction,Status,Fee',
    '2026-07-01,Salary payment,1000.00,EUR,IN,COMPLETED,0',
    '2026-07-02,Transfer to family,-50.00,EUR,OUT,COMPLETED,0.80',
  ].join('\n');
  const preview = await previewBankCsv(csv, 'wise-eur.csv', state, 'wise-eur');
  assert.equal(preview.batch.parserName, 'wise_csv', 'conta Wise deve selecionar o parser Wise');
  assert.ok(preview.newTransactions.every((item) => item.accountId === 'wise-eur' && item.source === 'wise_csv'), 'origem e conta Wise devem ser preservadas');
  assert.equal(preview.newTransactions.filter((item) => item.sourceComponent === 'fee').length, 0, 'taxa Wise não deve ser duplicada como fato adicional quando o formato já é líquido');
  assert.equal(preview.newTransactions.length, 2, 'as duas linhas Wise deveriam ser reconhecidas');
  console.log('✓ importação Wise preserva instituição/conta e não duplica taxas já líquidas');
}

verifyWiseImport()
  .then(() => console.log('Alpha 5 smoke verification passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
