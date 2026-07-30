declare function require(name: string): any;
declare const process: { exitCode?: number };
const { readFileSync } = require('node:fs');
const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) throw new Error(message ?? `Esperado ${String(expected)}, recebido ${String(actual)}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? 'Condição esperada como verdadeira');
  },
  throws(run: () => unknown, expectedMessage?: string) {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    if (!thrown) throw new Error('Era esperado que a operação lançasse um erro');
    if (expectedMessage && (!(thrown instanceof Error) || !thrown.message.includes(expectedMessage))) {
      throw new Error(`Erro esperado contendo "${expectedMessage}", recebido ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    }
  },
};
import { previewBankCsv } from '../src/core/csv';
import type { AppState } from '../src/core/types';
import { adaptAppStateToFinancialState } from '../src/application/appStateAdapter';
import { DefaultFinancialDecisionFacade } from '../src/application/FinancialDecisionFacade';
import { createReconciliationSnapshotBatch } from '../src/application/reconciliation';
import { createPlannedEventForAccount } from '../src/application/plannedEvents';
import { cashflowSummary, expenseByCategory, monthDateRange, netMovementByAccount } from '../src/core/finance';
import { availableUntilNextIncome } from '../src/domain/decisions';
import { buildConsolidatedForecast } from '../src/domain/forecast';
import { calculateReconciliation, confirmImportBatch, createImportBatch, normalizeImportedMovement, revertImportBatch } from '../src/domain/imports';
import { expandPlannedEventOccurrences } from '../src/domain/recurrence';
import { normalizeState } from '../src/core/storage';
import { localCivilDate, localDateTimeToInstant } from '../src/core/date';
import { formatMoney } from '../src/core/money';

function baseAppState(): AppState {
  const logicalAsOf = '2026-07-27T18:00:00.000Z';
  const batch = 'batch-operational';
  return {
    schemaVersion: 6,
    accounts: [
      { id: 'revolut', name: 'Revolut', currency: 'EUR', institution: 'revolut', active: true },
      { id: 'wise', name: 'Wise', currency: 'EUR', institution: 'wise', active: true },
    ],
    transactions: [],
    imports: [],
    importIssues: [],
    categories: [{ id: 'other', name: 'Outros', active: true, type: 'both' }],
    rules: [],
    balanceSnapshots: [
      { id: 's1', accountId: 'revolut', currency: 'EUR', balanceCents: 120_000, asOf: logicalAsOf, logicalAsOf, reconciliationBatchId: batch, source: 'manual', reconciled: true, createdAt: logicalAsOf },
      { id: 's2', accountId: 'wise', currency: 'EUR', balanceCents: 80_000, asOf: logicalAsOf, logicalAsOf, reconciliationBatchId: batch, source: 'manual', reconciled: true, createdAt: logicalAsOf },
    ],
    reservePolicies: [{ currency: 'EUR', minimumCents: 20_000, updatedAt: logicalAsOf }],
    reconciliationBatches: [{
      id: batch,
      logicalDate: '2026-07-27',
      logicalAsOf,
      createdAt: logicalAsOf,
      source: 'manual',
      status: 'COMPLETE',
    }],
    plannedTransfers: [],
    insightFeedback: [],
    reviewGroups: [],
    reviewDecisions: [],
    plannedEvents: [
      { id: 'salary', title: 'Salário', kind: 'income', direction: 'inflow', amountCents: 250_000, currency: 'EUR', dueDate: '2026-08-05', accountId: 'revolut', active: true, createdAt: logicalAsOf, updatedAt: logicalAsOf },
      { id: 'rent', title: 'Aluguel', kind: 'expense', direction: 'outflow', amountCents: 90_000, currency: 'EUR', dueDate: '2026-08-01', accountId: 'revolut', active: true, createdAt: logicalAsOf, updatedAt: logicalAsOf },
    ],
  };
}

let passed = 0;
function test(name: string, run: () => void | Promise<void>) {
  return Promise.resolve(run()).then(() => {
    passed += 1;
    console.log(`✓ ${name}`);
  });
}

async function main() {
  await test('duas contas compartilham o mesmo batch e logicalAsOf', () => {
    const state = baseAppState();
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    assert.equal(adapted.blockers.length, 0);
    assert.equal(adapted.state?.balanceSnapshots.length, 2);
    assert.ok(adapted.state?.balanceSnapshots.every((item) => item.reconciliationBatchId === 'batch-operational'));
  });

  await test('snapshots registrados em momentos diferentes são bloqueados', () => {
    const state = baseAppState();
    state.balanceSnapshots[1] = { ...state.balanceSnapshots[1]!, logicalAsOf: '2026-07-27T19:00:00.000Z', asOf: '2026-07-27T19:00:00.000Z' };
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    assert.ok(adapted.blockers.includes('SNAPSHOT_BATCH_MISMATCH'));
  });

  await test('decisão sem conta alvo retorna TARGET_ACCOUNT_REQUIRED', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(),
      currency: 'EUR',
      question: 'Posso comprar € 100?',
      today: '2026-07-28',
    });
    assert.ok(result.evidence.includes('TARGET_ACCOUNT_REQUIRED'));
  });

  await test('decisão fica vinculada à conta correta', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(),
      currency: 'EUR',
      targetAccountId: 'wise',
      question: 'Posso comprar € 100?',
      today: '2026-07-28',
    });
    assert.ok(result.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE' && item.accountId === 'wise'));
    assert.ok(!result.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE' && item.accountId === 'revolut'));
  });

  await test('fluxo importação → reconciliação → forecast → decisão', async () => {
    const csv = readFileSync('examples/revolut-fee-regression.csv', 'utf8');
    const initial = baseAppState();
    initial.transactions = [];
    initial.balanceSnapshots = [];
    const preview = await previewBankCsv(csv, 'revolut-fee-regression.csv', initial, 'revolut');
    assert.equal(preview.currencies.find((item) => item.currency === 'EUR')?.reconciliationDifferenceCents, 0);

    const snapshots = createReconciliationSnapshotBatch({
      accounts: initial.accounts,
      balances: [
        { accountId: 'revolut', balanceCents: 99_780 },
        { accountId: 'wise', balanceCents: 80_000 },
      ],
      currency: 'EUR',
      logicalDate: '2026-07-27',
      logicalAsOf: '2026-07-27T18:00:00.000Z',
      reconciliationBatchId: 'batch-e2e',
      createdAt: '2026-07-27T18:01:00.000Z',
      source: 'import',
    });
    initial.balanceSnapshots = snapshots.snapshots;
    initial.reconciliationBatches = [snapshots.batch];

    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: initial,
      currency: 'EUR',
      targetAccountId: 'revolut',
      question: 'Posso comprar € 50?',
      today: '2026-07-28',
    });
    assert.ok(result.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE' && item.accountId === 'revolut'));
  });


  await test('evento criado pelo fluxo da interface mantém accountId e entra no domínio', () => {
    const state = baseAppState();
    state.plannedEvents = [];
    const event = createPlannedEventForAccount({
      accounts: state.accounts,
      accountId: 'revolut',
      title: 'Aluguel',
      kind: 'expense',
      amountCents: 90_000,
      currency: 'EUR',
      dueDate: '2026-08-01',
      now: '2026-07-28T10:00:00.000Z',
      id: 'ui-rent',
    });
    state.plannedEvents.push(event);
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    assert.equal(adapted.state?.plannedEvents.length, 1);
    assert.equal(adapted.state?.plannedEvents[0]?.accountId, 'revolut');
  });

  await test('forecast bloqueia horizonte no mesmo dia ou antes da reconciliação', () => {
    const adapted = adaptAppStateToFinancialState(baseAppState(), 'EUR');
    assert.ok(adapted.state && adapted.reconciliationBatchId);
    const forecast = buildConsolidatedForecast({
      state: adapted.state!,
      reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-27',
      horizonEnd: '2026-08-05',
    });
    assert.equal(forecast.status, 'INCOMPLETE');
    assert.ok(forecast.blockers.some((item) => item.code === 'FORECAST_START_NOT_AFTER_RECONCILIATION'));
  });

  await test('resumos usam netMovementCents incluindo taxa adicional', () => {
    const state = baseAppState();
    state.transactions = [{
      id: 'fee-tx',
      accountId: 'revolut',
      importId: 'batch',
      dedupFingerprint: 'dedup',
      source: 'revolut_csv',
      sourceRowNumber: 1,
      sourceFingerprint: 'source',
      semanticFingerprint: 'semantic',
      reportingDate: '2026-07-28',
      descriptionOriginal: 'Compra',
      merchantNormalized: 'compra',
      direction: 'outflow',
      kind: 'expense',
      kindSource: 'system',
      status: 'completed',
      amountCents: 10_000,
      reportedAmountCents: -10_000,
      feeCents: 220,
      netMovementCents: -10_220,
      feeTreatment: 'ADDITIONAL_TO_REPORTED_AMOUNT',
      currency: 'EUR',
      categoryId: undefined,
      categorySource: 'none',
      needsReview: false,
      reviewReasons: [],
      manualEditLog: [],
      originalData: {},
      analysisExcluded: false,
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    }];
    assert.equal(cashflowSummary(state.transactions, 'EUR').expenseCents, 10_220);
    assert.equal(netMovementByAccount(state.transactions)[0]?.amountCents, -10_220);
  });

  await test('decisão encontra próxima ocorrência de salário recorrente', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'salary-recurring',
      title: 'Salário',
      kind: 'income',
      direction: 'inflow',
      amountCents: 200_000,
      currency: 'EUR',
      dueDate: '2026-07-01',
      accountId: 'revolut',
      recurrence: { frequency: 'monthly', interval: 1 },
      active: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().calculateSpendingLimit({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      horizonStart: '2026-07-28',
      horizonEnd: '2026-08-10',
    });
    assert.ok(!result.evidence.includes('NEXT_INCOME_NOT_FOUND'));
  });


  await test('compra no dia da reconciliação usa snapshot e projeta apenas a partir de amanhã', () => {
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: baseAppState(),
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 10_000,
      purchaseDate: '2026-07-27',
      horizonEnd: '2026-08-10',
    });
    assert.ok(!result.evidence.includes('FORECAST_START_NOT_AFTER_RECONCILIATION'));
    assert.ok(result.structuredEvidence?.some((item) =>
      item.kind === 'PROPOSED_PURCHASE' && item.dueAt === '2026-07-27'));
  });

  await test('consulta de saldo lê posição reconciliada sem forecast', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(),
      currency: 'EUR',
      question: 'Quanto tenho?',
      today: '2026-07-27',
    });
    assert.equal(result.confidence, 'high');
    assert.ok(result.answer.includes('2.000,00') || result.answer.includes('2000'));
    assert.equal(result.dataScope, 'posição reconciliada; sem eventos futuros');
  });

  await test('despesa por categoria inclui taxa adicional no movimento líquido', () => {
    const state = baseAppState();
    state.transactions = [{
      id: 'fee-category', accountId: 'revolut', importId: 'batch',
      dedupFingerprint: 'dedup-category', source: 'revolut_csv', sourceRowNumber: 1,
      sourceFingerprint: 'source-category', semanticFingerprint: 'semantic-category',
      reportingDate: '2026-07-28', descriptionOriginal: 'Compra', merchantNormalized: 'compra',
      direction: 'outflow', kind: 'expense', kindSource: 'system', status: 'completed',
      amountCents: 10_000, reportedAmountCents: -10_000, feeCents: 220,
      netMovementCents: -10_220, feeTreatment: 'ADDITIONAL_TO_REPORTED_AMOUNT',
      currency: 'EUR', categoryId: undefined, categorySource: 'none',
      needsReview: false, reviewReasons: [], manualEditLog: [], originalData: {},
      analysisExcluded: false, createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    }];
    assert.equal(expenseByCategory(state.transactions, 'EUR')[0]?.amountCents, 10_220);
  });

  await test('evento legado sem conta é migrado sem rejeitar o estado inteiro', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.plannedEvents = [{
      id: 'legacy-rent', title: 'Aluguel', kind: 'expense', direction: 'outflow',
      amountCents: 90_000, currency: 'EUR', dueDate: '2026-08-01',
      active: true, createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const migrated = normalizeState(state, baseAppState());
    assert.equal(migrated.plannedEvents[0]?.accountId, 'revolut');
    assert.equal(migrated.plannedEvents[0]?.needsAccountReview, false);
  });

  await test('intervalo mensal usa último dia civil real', () => {
    assert.equal(monthDateRange('2026-02').end, '2026-02-28');
    assert.equal(monthDateRange('2028-02').end, '2028-02-29');
    assert.equal(monthDateRange('2026-04').end, '2026-04-30');
  });


  await test('evento legado ambíguo permanece visível para revisão de conta', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'legacy-ambiguous', title: 'Aluguel antigo', kind: 'expense', direction: 'outflow',
      amountCents: 90_000, currency: 'EUR', dueDate: '2026-08-01',
      active: true, createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const migrated = normalizeState(state, baseAppState());
    assert.equal(migrated.plannedEvents[0]?.accountId, undefined);
    assert.equal(migrated.plannedEvents[0]?.active, false);
    assert.equal(migrated.plannedEvents[0]?.needsAccountReview, true);
  });

  await test('evidência de compra inclui ocorrência recorrente expandida', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'rent-recurring', title: 'Aluguel recorrente', kind: 'expense', direction: 'outflow',
      amountCents: 90_000, currency: 'EUR', dueDate: '2026-07-01',
      accountId: 'revolut', recurrence: { frequency: 'monthly', interval: 1, until: '2026-12-31' },
      active: true, createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 1_000,
      purchaseDate: '2026-07-27',
      horizonEnd: '2026-08-10',
    });
    assert.ok(result.structuredEvidence?.some((item) =>
      item.kind === 'PLANNED_EVENT' &&
      item.title === 'Aluguel recorrente' &&
      item.dueAt === '2026-08-01'));
  });


  await test('compra imediata considera saldo logo após a compra antes da renda futura', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [{
      ...state.balanceSnapshots[0]!,
      balanceCents: 100_000,
    }];
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 50_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedEvents = [{
      id: 'salary-tomorrow', title: 'Salário', kind: 'income', direction: 'inflow',
      amountCents: 200_000, currency: 'EUR', dueDate: '2026-07-28',
      accountId: 'revolut', active: true, createdAt: '2026-07-27T18:00:00.000Z',
      updatedAt: '2026-07-27T18:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 90_000,
      purchaseDate: '2026-07-27',
      horizonEnd: '2026-08-10',
    });
    assert.ok(result.answer.includes('não é segura'));
    assert.ok(result.answer.includes('400,00') || result.answer.includes('400'));
  });

  await test('recorrência mensal sem término produz decisão e expõe próxima renda', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'salary-indefinite', title: 'Salário mensal', kind: 'income', direction: 'inflow',
      amountCents: 200_000, currency: 'EUR', dueDate: '2026-07-01',
      accountId: 'revolut', recurrence: { frequency: 'monthly', interval: 1 },
      active: true, createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().calculateSpendingLimit({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      horizonStart: '2026-07-28',
      horizonEnd: '2026-08-10',
    });
    assert.equal(result.confidence, 'high');
    assert.ok(!result.answer.includes('Não consigo calcular'));
    assert.ok(result.structuredEvidence?.some((item) =>
      item.kind === 'PLANNED_EVENT' &&
      item.title === 'Salário mensal' &&
      item.dueAt === '2026-08-01'));
  });

  await test('forecast BRL ignora transferência pertencente apenas a contas EUR', () => {
    const state = baseAppState();
    state.accounts.push(
      { id: 'brl-a', name: 'BRL A', currency: 'BRL', institution: 'other', active: true },
      { id: 'brl-b', name: 'BRL B', currency: 'BRL', institution: 'other', active: true },
    );
    state.balanceSnapshots.push(
      { id: 'brl-s1', accountId: 'brl-a', currency: 'BRL', balanceCents: 100_000, asOf: '2026-07-27T18:00:00.000Z', logicalAsOf: '2026-07-27T18:00:00.000Z', reconciliationBatchId: 'batch-brl', source: 'manual', reconciled: true, createdAt: '2026-07-27T18:00:00.000Z' },
      { id: 'brl-s2', accountId: 'brl-b', currency: 'BRL', balanceCents: 50_000, asOf: '2026-07-27T18:00:00.000Z', logicalAsOf: '2026-07-27T18:00:00.000Z', reconciliationBatchId: 'batch-brl', source: 'manual', reconciled: true, createdAt: '2026-07-27T18:00:00.000Z' },
    );
    state.reconciliationBatches.push({
      id: 'batch-brl', logicalDate: '2026-07-27', logicalAsOf: '2026-07-27T18:00:00.000Z',
      createdAt: '2026-07-27T18:00:00.000Z', source: 'manual', status: 'COMPLETE',
    });
    state.reservePolicies.push({ currency: 'BRL', minimumCents: 10_000, updatedAt: '2026-07-27T18:00:00.000Z' });
    state.plannedTransfers = [{
      id: 'eur-transfer', title: 'Transferência EUR', sourceAccountId: 'revolut',
      destinationAccountId: 'wise', amountCents: 10_000, feeCents: 0,
      dueDate: '2026-07-29', evidenceLevel: 'planned', status: 'active',
    }];
    const adapted = adaptAppStateToFinancialState(state, 'BRL');
    assert.equal(adapted.blockers.length, 0);
    assert.equal(adapted.state?.plannedTransfers.length, 0);
    const forecast = buildConsolidatedForecast({
      state: adapted.state!,
      reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28',
      horizonEnd: '2026-08-10',
    });
    assert.equal(forecast.status, 'COMPLETE');
  });


  await test('compra futura não usa renda do mesmo dia antes de ela existir', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [{ ...state.balanceSnapshots[0]!, balanceCents: 10_000 }];
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 5_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedEvents = [{
      id: 'salary-same-day', title: 'Salário', kind: 'income', direction: 'inflow',
      amountCents: 100_000, currency: 'EUR', dueDate: '2026-07-31',
      accountId: 'revolut', active: true, createdAt: '2026-07-27T18:00:00.000Z',
      updatedAt: '2026-07-27T18:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 90_000,
      purchaseDate: '2026-07-31',
      horizonEnd: '2026-08-10',
    });
    assert.ok(result.answer.includes('não é segura'));
    assert.ok(result.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE'));
  });

  await test('evento de valor zero é rejeitado antes de persistir', () => {
    const state = baseAppState();
    assert.throws(() => createPlannedEventForAccount({
      accounts: state.accounts,
      accountId: 'revolut',
      title: 'Evento zero',
      kind: 'expense',
      amountCents: 0,
      currency: 'EUR',
      dueDate: '2026-08-01',
      now: '2026-07-28T10:00:00.000Z',
      id: 'zero-event',
    }), 'PLANNED_EVENT_AMOUNT_INVALID');
  });

  await test('data civil impossível é rejeitada antes de persistir', () => {
    const state = baseAppState();
    assert.throws(() => createPlannedEventForAccount({
      accounts: state.accounts,
      accountId: 'revolut',
      title: 'Data impossível',
      kind: 'expense',
      amountCents: 1_000,
      currency: 'EUR',
      dueDate: '2026-02-31',
      now: '2026-07-28T10:00:00.000Z',
      id: 'bad-date-event',
    }), 'PLANNED_EVENT_DATE_INVALID');
  });

  await test('adaptador usa o batch completo mais recente, não um batch parcial posterior', () => {
    const state = baseAppState();
    state.reconciliationBatches.push({
      id: 'batch-partial',
      logicalDate: '2026-07-28',
      logicalAsOf: '2026-07-28T18:00:00.000Z',
      createdAt: '2026-07-28T18:00:00.000Z',
      source: 'manual',
      status: 'COMPLETE',
    });
    state.balanceSnapshots.push({
      id: 'partial-revolut', accountId: 'revolut', currency: 'EUR', balanceCents: 150_000,
      asOf: '2026-07-28T18:00:00.000Z', logicalAsOf: '2026-07-28T18:00:00.000Z',
      reconciliationBatchId: 'batch-partial', source: 'manual', reconciled: true,
      createdAt: '2026-07-28T18:00:00.000Z',
    });
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    assert.equal(adapted.blockers.length, 0);
    assert.equal(adapted.reconciliationBatchId, 'batch-operational');
    assert.equal(adapted.state?.balanceSnapshots.length, 2);
  });


  await test('normalização não transfere evento de conta inativa para outra conta', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.plannedEvents = [{
      id: 'wise-disabled-event', title: 'Compromisso da Wise', kind: 'expense', direction: 'outflow',
      amountCents: 1_000, currency: 'EUR', dueDate: '2026-08-01', accountId: 'wise',
      active: true, createdAt: '2026-07-27T18:00:00.000Z', updatedAt: '2026-07-27T18:00:00.000Z',
    }];
    const normalized = normalizeState(state, baseAppState());
    assert.equal(normalized.plannedEvents[0]?.accountId, 'wise');
    assert.equal(normalized.plannedEvents[0]?.active, false);
    assert.equal(normalized.plannedEvents[0]?.needsAccountReview, true);
  });

  await test('evento de conta inativa não contamina forecast da moeda ativa', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [state.balanceSnapshots[0]!];
    state.plannedEvents.push({
      id: 'inactive-account-event', title: 'Evento Wise inativo', kind: 'expense', direction: 'outflow',
      amountCents: 1_000, currency: 'EUR', dueDate: '2026-07-29', accountId: 'wise',
      active: true, createdAt: '2026-07-27T18:00:00.000Z', updatedAt: '2026-07-27T18:00:00.000Z',
    });
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    assert.equal(adapted.blockers.length, 0);
    assert.ok(!adapted.state?.plannedEvents.some((item) => item.id === 'inactive-account-event'));
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-10',
    });
    assert.equal(forecast.status, 'COMPLETE');
  });

  await test('reconciliação aceita saldo negativo e rejeita timestamp não canônico', () => {
    const state = baseAppState();
    const signed = createReconciliationSnapshotBatch({
      accounts: state.accounts,
      balances: [
        { accountId: 'revolut', balanceCents: -1_000 },
        { accountId: 'wise', balanceCents: 2_000 },
      ],
      currency: 'EUR',
      logicalDate: '2026-07-27',
      logicalAsOf: '2026-07-27T18:00:00.000Z',
      reconciliationBatchId: 'signed-batch',
      createdAt: '2026-07-27T18:01:00.000Z',
      source: 'manual',
    });
    assert.equal(signed.snapshots[0]?.balanceCents, -1_000);
    assert.throws(() => createReconciliationSnapshotBatch({
      accounts: state.accounts,
      balances: [
        { accountId: 'revolut', balanceCents: 1_000 },
        { accountId: 'wise', balanceCents: 2_000 },
      ],
      currency: 'EUR',
      logicalDate: '2026-07-27',
      logicalAsOf: '2026-07-27T18:00:00Z',
      reconciliationBatchId: 'bad-time-batch',
      createdAt: '2026-07-27T18:01:00.000Z',
      source: 'manual',
    }), 'LOGICAL_AS_OF_INVALID');
  });

  await test('intervalo mensal rejeita mês fora de 1 a 12', () => {
    assert.throws(() => monthDateRange('2026-00'));
    assert.throws(() => monthDateRange('2026-13'));
  });

  await test('salário recorrente anterior ao horizonte não é marcado falsamente como atrasado', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'old-base-recurring', title: 'Salário mensal', kind: 'income', direction: 'inflow',
      amountCents: 200_000, currency: 'EUR', dueDate: '2026-01-01', accountId: 'revolut',
      recurrence: { frequency: 'monthly', interval: 1 }, active: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }];
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-10',
    });
    assert.ok(!forecast.warnings.some((item) => item.code === 'OVERDUE_PLANNED_EVENT'));
  });


  await test('limite até renda considera despesas do mesmo dia antes do crédito', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [{ ...state.balanceSnapshots[0]!, balanceCents: 100_000 }];
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 50_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedEvents = [
      {
        id: 'salary-limit-day', title: 'Salário', kind: 'income', direction: 'inflow',
        amountCents: 200_000, currency: 'EUR', dueDate: '2026-08-01', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T18:00:00.000Z', updatedAt: '2026-07-27T18:00:00.000Z',
      },
      {
        id: 'rent-limit-day', title: 'Aluguel', kind: 'expense', direction: 'outflow',
        amountCents: 70_000, currency: 'EUR', dueDate: '2026-08-01', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T18:00:00.000Z', updatedAt: '2026-07-27T18:00:00.000Z',
      },
    ];
    const result = new DefaultFinancialDecisionFacade().calculateSpendingLimit({
      appState: state, currency: 'EUR', accountId: 'revolut',
      horizonStart: '2026-07-28', horizonEnd: '2026-08-10',
    });
    assert.ok(result.answer.includes('abaixo da reserva'));
    assert.ok(result.answer.includes('200,00') || result.answer.includes('200'));
  });

  await test('assistente prioriza valor monetário explícito quando há outro número na pergunta', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Daqui 2 dias posso comprar uma TV de €600?', today: '2026-07-28',
    });
    assert.ok(result.structuredEvidence?.some((item) =>
      item.kind === 'PROPOSED_PURCHASE' && item.impactCents === -60_000 && item.dueAt === '2026-07-30'));
  });


  await test('datetime-local impossível é rejeitado sem normalizar para outro dia', () => {
    assert.throws(() => localDateTimeToInstant('2026-02-31T10:30'), 'Instante local inválido');
    const instant = localDateTimeToInstant('2026-07-29T10:30');
    assert.ok(!Number.isNaN(Date.parse(instant)));
  });

  await test('reconciliação não aceita instante lógico no futuro', () => {
    const state = baseAppState();
    assert.throws(() => createReconciliationSnapshotBatch({
      accounts: state.accounts,
      balances: [
        { accountId: 'revolut', balanceCents: 1_000 },
        { accountId: 'wise', balanceCents: 2_000 },
      ],
      currency: 'EUR',
      logicalDate: '2026-07-29',
      logicalAsOf: '2026-07-29T11:00:00.000Z',
      reconciliationBatchId: 'future-batch',
      createdAt: '2026-07-29T10:00:00.000Z',
      source: 'manual',
    }), 'LOGICAL_AS_OF_IN_FUTURE');
  });

  await test('backup rejeita tipo de transação incompatível com sua direção', () => {
    const state = baseAppState();
    state.transactions = [{
      id: 'bad-kind', accountId: 'revolut', dedupFingerprint: 'bad-kind',
      amountCents: 1_000, currency: 'EUR', direction: 'outflow', source: 'manual',
      status: 'completed', kind: 'income', kindSource: 'manual', analysisExcluded: false,
      descriptionOriginal: 'Incompatível', merchantNormalized: 'incompativel', reportingDate: '2026-07-28',
      categoryId: undefined, categorySource: 'none', needsReview: false,
      reviewReasons: [], manualEditLog: [], originalData: {},
      createdAt: '2026-07-28T10:00:00.000Z', updatedAt: '2026-07-28T10:00:00.000Z',
    }];
    assert.throws(() => normalizeState(state, baseAppState()), 'tipo incompatível');
  });

  await test('recorrência com intervalo absurdo vira estado inválido sem derrubar o motor', () => {
    const state = baseAppState();
    state.plannedEvents = [{
      id: 'huge-recurrence', title: 'Recorrência absurda', kind: 'expense', direction: 'outflow',
      amountCents: 1_000, currency: 'EUR', dueDate: '2026-08-01', accountId: 'revolut',
      recurrence: { frequency: 'yearly', interval: Number.MAX_SAFE_INTEGER }, active: true,
      createdAt: '2026-07-27T18:00:00.000Z', updatedAt: '2026-07-27T18:00:00.000Z',
    }];
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-10',
    });
    assert.equal(forecast.status, 'INVALID');
    assert.ok(forecast.violations.some((item) => item.code === 'RECURRENCE_INVALID'));
  });

  await test('data civil local não depende de corte UTC por string ISO', () => {
    const local = new Date(2026, 6, 29, 0, 30, 0);
    assert.equal(localCivilDate(local), '2026-07-29');
  });


  await test('compra imediata considera despesa ativa do mesmo dia ainda não paga', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [{ ...state.balanceSnapshots[0]!, balanceCents: 100_000 }];
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 50_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedEvents = [{
      id: 'rent-today', title: 'Aluguel hoje', kind: 'expense', direction: 'outflow',
      amountCents: 40_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
      active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 20_000,
      purchaseDate: '2026-07-27',
      horizonEnd: '2026-08-10',
    });
    assert.ok(result.answer.includes('não é segura'));
    assert.ok(result.structuredEvidence?.some((item) => item.referenceId === 'rent-today'));
  });

  await test('compra imediata considera transferência de saída do mesmo dia e sua taxa', () => {
    const state = baseAppState();
    state.balanceSnapshots = state.balanceSnapshots.map((snapshot) => ({ ...snapshot, balanceCents: snapshot.accountId === 'revolut' ? 100_000 : 0 }));
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 50_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedTransfers = [{
      id: 'transfer-today', title: 'Wise hoje', sourceAccountId: 'revolut', destinationAccountId: 'wise',
      amountCents: 30_000, feeCents: 1_000, dueDate: '2026-07-27', evidenceLevel: 'planned', status: 'active',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state,
      currency: 'EUR',
      accountId: 'revolut',
      amountCents: 20_000,
      purchaseDate: '2026-07-27',
      horizonEnd: '2026-08-10',
    });
    assert.ok(result.answer.includes('não é segura'));
  });

  await test('recorrência extrema além do ano 9999 encerra sem RangeError', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.reconciliationBatches = [{
      id: 'far-batch', logicalDate: '9998-12-30', logicalAsOf: '9998-12-30T10:00:00.000Z', createdAt: '9998-12-30T10:01:00.000Z',
      source: 'manual', status: 'COMPLETE',
    }];
    state.balanceSnapshots = [{
      id: 'far-snapshot', accountId: 'revolut', currency: 'EUR', balanceCents: 100_000,
      asOf: '9998-12-30T10:00:00.000Z', logicalAsOf: '9998-12-30T10:00:00.000Z',
      reconciliationBatchId: 'far-batch', source: 'manual', reconciled: true,
      createdAt: '9998-12-30T10:01:00.000Z',
    }];
    state.plannedEvents = [{
      id: 'far-recurring', title: 'Recorrência extrema', kind: 'expense', direction: 'outflow', amountCents: 100,
      currency: 'EUR', dueDate: '9998-12-31', accountId: 'revolut', active: true,
      recurrence: { frequency: 'monthly', interval: 10_000 },
      createdAt: '9998-12-30T10:00:00.000Z', updatedAt: '9998-12-30T10:00:00.000Z',
    }];
    const forecast = new DefaultFinancialDecisionFacade().buildForecast({
      appState: state, currency: 'EUR', horizonStart: '9998-12-31', horizonEnd: '9999-12-31',
    });
    assert.equal(forecast?.status, 'COMPLETE');
  });

  await test('domínio rejeita lote cujo instante lógico está depois da criação', () => {
    const state = adaptAppStateToFinancialState(baseAppState(), 'EUR').state!;
    state.reconciliationBatches[0] = {
      ...state.reconciliationBatches[0]!,
      logicalAsOf: '2026-07-27T19:00:00.000Z',
      createdAt: '2026-07-27T18:00:00.000Z',
    };
    const forecast = buildConsolidatedForecast({
      state,
      reconciliationBatchId: state.reconciliationBatches[0]!.id,
      horizonStart: '2026-07-28',
      horizonEnd: '2026-08-05',
    });
    assert.equal(forecast.status, 'INVALID');
    assert.ok(forecast.violations.some((item) => item.code === 'TIMESTAMP_INVALID'));
  });


  await test('limite no dia reconciliado não desconta duas vezes obrigação carregada para amanhã', () => {
    const app = baseAppState();
    app.accounts[1] = { ...app.accounts[1]!, active: false };
    app.balanceSnapshots = [{ ...app.balanceSnapshots[0]!, balanceCents: 100_000 }];
    app.reservePolicies = [{ currency: 'EUR', minimumCents: 0, updatedAt: '2026-07-27T18:00:00.000Z' }];
    app.plannedEvents = [
      {
        id: 'pending-rent', title: 'Aluguel pendente', kind: 'expense', direction: 'outflow',
        amountCents: 20_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
      },
      {
        id: 'salary-tomorrow', title: 'Salário', kind: 'income', direction: 'inflow',
        amountCents: 100_000, currency: 'EUR', dueDate: '2026-07-28', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
      },
    ];
    const adapted = adaptAppStateToFinancialState(app, 'EUR');
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-05',
    });
    const decision = availableUntilNextIncome({
      state: adapted.state!, forecast, accountId: 'revolut', decisionDate: '2026-07-27',
    });
    assert.equal(decision.status, 'SAFE');
    assert.equal(decision.minimumProjectedBalanceCents, 80_000);
    assert.equal(decision.marginCents, 80_000);
  });

  await test('receita vencida ou do dia reconciliado não reaparece como dinheiro futuro', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.balanceSnapshots = [{ ...state.balanceSnapshots[0]!, balanceCents: 100_000 }];
    state.reservePolicies = [{ currency: 'EUR', minimumCents: 50_000, updatedAt: '2026-07-27T18:00:00.000Z' }];
    state.plannedEvents = [{
      id: 'salary-already-reflected', title: 'Salário do dia', kind: 'income', direction: 'inflow',
      amountCents: 100_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
      active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: state, currency: 'EUR', accountId: 'revolut', amountCents: 60_000,
      purchaseDate: '2026-07-29', horizonEnd: '2026-08-05',
    });
    assert.ok(result.answer.includes('não é segura'));
    assert.ok(!result.structuredEvidence?.some((item) => item.referenceId.includes('salary-already-reflected')));
  });

  await test('mínimo sem queda futura permanece datado no dia lógico do saldo inicial', () => {
    const state = baseAppState();
    state.accounts[1] = { ...state.accounts[1]!, active: false };
    state.plannedEvents = [{
      id: 'only-income', title: 'Entrada futura', kind: 'income', direction: 'inflow',
      amountCents: 10_000, currency: 'EUR', dueDate: '2026-07-29', accountId: 'revolut',
      active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
    }];
    const adapted = adaptAppStateToFinancialState(state, 'EUR');
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-01',
    });
    assert.equal(forecast.status, 'COMPLETE');
    assert.equal(forecast.byAccount[0]?.minimumProjectedBalanceDate, '2026-07-27');
    assert.equal(forecast.consolidatedByCurrency[0]?.minimumProjectedBalanceDate, '2026-07-27');
  });

  await test('overflow na soma de contas invalida o forecast em vez de arredondar dinheiro', () => {
    const state = adaptAppStateToFinancialState(baseAppState(), 'EUR').state!;
    state.balanceSnapshots[0] = { ...state.balanceSnapshots[0]!, balanceCents: Number.MAX_SAFE_INTEGER - 10 };
    state.balanceSnapshots[1] = { ...state.balanceSnapshots[1]!, balanceCents: 20 };
    state.plannedEvents = [];
    const forecast = buildConsolidatedForecast({
      state, reconciliationBatchId: state.reconciliationBatches[0]!.id,
      horizonStart: '2026-07-28', horizonEnd: '2026-07-29',
    });
    assert.equal(forecast.status, 'INVALID');
    assert.ok(forecast.violations.some((item) => item.code === 'ARITHMETIC_OVERFLOW'));
  });

  await test('data lógica máxima retorna INVALID sem escapar exceção', () => {
    const state = adaptAppStateToFinancialState(baseAppState(), 'EUR').state!;
    state.reconciliationBatches[0] = {
      ...state.reconciliationBatches[0]!, logicalDate: '9999-12-31',
      logicalAsOf: '9999-12-31T10:00:00.000Z', createdAt: '9999-12-31T10:01:00.000Z',
    };
    const forecast = buildConsolidatedForecast({
      state, reconciliationBatchId: state.reconciliationBatches[0]!.id,
      horizonStart: '9999-12-31', horizonEnd: '9999-12-31',
    });
    assert.equal(forecast.status, 'INVALID');
    assert.ok(forecast.violations.some((item) => item.code === 'DATE_INVALID'));
  });

  await test('reconciliação rejeita data civil distante do instante lógico', () => {
    const state = baseAppState();
    assert.throws(() => createReconciliationSnapshotBatch({
      accounts: state.accounts,
      balances: [{ accountId: 'revolut', balanceCents: 1_000 }, { accountId: 'wise', balanceCents: 2_000 }],
      currency: 'EUR', logicalDate: '2026-07-30', logicalAsOf: '2026-07-27T23:30:00.000Z',
      reconciliationBatchId: 'incoherent-date', createdAt: '2026-07-28T00:00:00.000Z', source: 'manual',
    }), 'LOGICAL_DATE_INCOHERENT');
  });

  await test('enum inválido no estado é bloqueado pela garantia de schema', () => {
    const state = adaptAppStateToFinancialState(baseAppState(), 'EUR').state!;
    state.plannedEvents[0] = { ...state.plannedEvents[0]!, evidenceLevel: 'certain' as never };
    const forecast = buildConsolidatedForecast({
      state, reconciliationBatchId: state.reconciliationBatches[0]!.id,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-10',
    });
    assert.equal(forecast.status, 'INVALID');
    assert.ok(forecast.violations.some((item) => item.code === 'SCHEMA_INVALID'));
  });

  await test('reconciliação de importação protege todas as somas contra overflow', () => {
    assert.throws(() => calculateReconciliation({
      openingBalanceCents: 1,
      closingBalanceCents: 0,
      movements: [{
        id: 'overflow-movement', importBatchId: 'batch', accountId: 'revolut', currency: 'EUR',
        sourceRowNumber: 1, occurredAt: '2026-07-27T10:00:00.000Z',
        reportedAmountCents: Number.MAX_SAFE_INTEGER, feeCents: 0,
        netMovementCents: Number.MAX_SAFE_INTEGER, feeTreatment: 'INCLUDED_IN_REPORTED_AMOUNT',
        sourceFingerprint: 'source', semanticFingerprint: 'semantic',
      }],
    }), 'ARITHMETIC_OVERFLOW');
  });

  await test('taxa maior que entrada redefine direção pelo movimento líquido real', async () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance,Reference',
      'CARD_PAYMENT,Current,2026-07-01 09:00:00,2026-07-01 09:01:00,Ajuste com taxa,0.50,1.00,EUR,COMPLETED,99.50,fee-flip',
    ].join('\n');
    const state = baseAppState();
    state.transactions = [];
    const preview = await previewBankCsv(csv, 'fee-flip.csv', state, 'revolut');
    const transaction = preview.newTransactions[0]!;
    assert.equal(transaction.netMovementCents, -50);
    assert.equal(transaction.direction, 'outflow');
    assert.equal(transaction.kind, 'expense');
  });

  await test('duplicata semântica independe do índice de ocorrência no arquivo', async () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance,Reference',
      'CARD_PAYMENT,Current,2026-07-01 09:00:00,2026-07-01 09:01:00,Compra repetível,-10.00,,EUR,COMPLETED,90.00,',
    ].join('\n');
    const state = baseAppState();
    state.transactions = [];
    const first = await previewBankCsv(csv, 'first.csv', state, 'revolut');
    const existing = first.newTransactions[0]!;
    state.transactions = [{
      ...existing,
      id: 'existing-semantic',
      bankTransactionId: undefined,
      sourceFileHash: undefined,
      sourceRowNumber: undefined,
      dedupFingerprint: `${existing.semanticFingerprint}:9`,
    }];
    const second = await previewBankCsv(csv, 'second.csv', state, 'revolut');
    assert.equal(second.possibleDuplicates.length, 1);
    assert.equal(second.newTransactions.length, 0);
  });


  await test('salário do dia reconciliado não é tratado como próxima receita no limite', () => {
    const app = baseAppState();
    app.accounts[1] = { ...app.accounts[1]!, active: false };
    app.plannedEvents = [{
      id: 'same-day-salary', title: 'Salário já refletido', kind: 'income', direction: 'inflow',
      amountCents: 100_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
      active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
    }];
    const adapted = adaptAppStateToFinancialState(app, 'EUR');
    const forecast = buildConsolidatedForecast({
      state: adapted.state!, reconciliationBatchId: adapted.reconciliationBatchId!,
      horizonStart: '2026-07-28', horizonEnd: '2026-08-05',
    });
    const decision = availableUntilNextIncome({
      state: adapted.state!, forecast, accountId: 'revolut', decisionDate: '2026-07-27',
    });
    assert.equal(decision.status, 'INCOMPLETE');
    assert.ok(decision.blockers.includes('NEXT_INCOME_NOT_FOUND'));
  });

  await test('evidência de compra imediata não promete receita ou transferência de entrada ainda incerta', () => {
    const app = baseAppState();
    app.balanceSnapshots = app.balanceSnapshots.map((snapshot) => ({ ...snapshot, balanceCents: 100_000 }));
    app.plannedEvents = [{
      id: 'same-day-income-evidence', title: 'Receita hoje', kind: 'income', direction: 'inflow',
      amountCents: 100_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
      active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
    }];
    app.plannedTransfers = [{
      id: 'same-day-transfer-in', title: 'Entrada Wise', sourceAccountId: 'wise', destinationAccountId: 'revolut',
      amountCents: 50_000, feeCents: 0, dueDate: '2026-07-27', evidenceLevel: 'planned', status: 'active',
    }];
    const result = new DefaultFinancialDecisionFacade().evaluatePurchase({
      appState: app, currency: 'EUR', accountId: 'revolut', amountCents: 10_000,
      purchaseDate: '2026-07-27', horizonEnd: '2026-08-05',
    });
    assert.ok(!result.structuredEvidence?.some((item) => item.referenceId.includes('same-day-income-evidence')));
    assert.ok(!result.structuredEvidence?.some((item) => item.referenceId === 'same-day-transfer-in' && item.impactCents > 0));
  });


  await test('assistente interpreta amanhã e data civil explícita na simulação', () => {
    const facade = new DefaultFinancialDecisionFacade();
    const tomorrow = facade.answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Amanhã posso comprar €100?', today: '2026-07-28',
    });
    assert.ok(tomorrow.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE' && item.dueAt === '2026-07-29'));

    const explicit = facade.answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Posso comprar €100 no dia 31/07/2026?', today: '2026-07-28',
    });
    assert.ok(explicit.structuredEvidence?.some((item) => item.kind === 'PROPOSED_PURCHASE' && item.dueAt === '2026-07-31'));
  });

  await test('assistente não finge entender data futura impossível', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Posso comprar €100 no dia 31/02/2026?', today: '2026-07-28',
    });
    assert.equal(result.confidence, 'low');
    assert.ok(result.evidence.includes('PURCHASE_DATE_INVALID_OR_UNSUPPORTED'));
  });



  await test('recorrência antiga é avançada até o horizonte sem desaparecer após 10.000 índices', () => {
    const app = baseAppState();
    const event = {
      id: 'old-monthly', title: 'Mensalidade histórica', kind: 'expense' as const,
      accountId: 'revolut', currency: 'EUR', amountCents: 1_000,
      dueDate: '1000-01-31', evidenceLevel: 'planned' as const, status: 'active' as const,
      recurrence: { frequency: 'monthly' as const, interval: 1 },
    };
    const occurrences = expandPlannedEventOccurrences([event], '2026-07-01', '2026-08-31');
    assert.equal(occurrences.length, 2);
    assert.equal(occurrences[0]?.date, '2026-07-31');
    assert.equal(occurrences[1]?.date, '2026-08-31');
    void app;
  });

  await test('assistente separa prazo relativo de valor sem moeda explícita', () => {
    const result = new DefaultFinancialDecisionFacade().answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Daqui 2 dias posso comprar 600?', today: '2026-07-28',
    });
    assert.ok(result.structuredEvidence?.some((item) =>
      item.kind === 'PROPOSED_PURCHASE' && item.dueAt === '2026-07-30' && item.impactCents === -60_000));
  });

  await test('lote de importação preserva ordem temporal e vínculo dos movimentos', () => {
    const movement = normalizeImportedMovement({
      id: 'movement-1', importBatchId: 'import-1', accountId: 'revolut', currency: 'EUR',
      sourceRowNumber: 1, occurredAt: '2026-07-28T10:00:00.000Z', reportedAmountCents: -1_000,
      feeCents: 0, feeTreatment: 'INCLUDED_IN_REPORTED_AMOUNT',
      sourceFingerprint: 'source-1', semanticFingerprint: 'semantic-1',
    });
    const preview = {
      status: 'READY' as const, importBatchId: 'import-1', fileHash: 'hash', sourceFormat: 'csv',
      acceptedRows: [movement], rejectedRows: [], exactDuplicates: [], possibleDuplicates: [], warnings: [],
      calculatedNetMovementCents: -1_000,
    };
    const batch = createImportBatch(preview, 'revolut', '2026-07-28T11:00:00.000Z');
    assert.throws(() => confirmImportBatch(batch, '2026-07-28T10:59:59.000Z'), 'confirmedAt');
    const confirmed = confirmImportBatch(batch, '2026-07-28T12:00:00.000Z');
    assert.throws(() => revertImportBatch(confirmed, '2026-07-28T11:59:59.000Z'), 'revertedAt');
    assert.equal(revertImportBatch(confirmed, '2026-07-28T13:00:00.000Z').status, 'REVERTED');

    assert.throws(() => createImportBatch({
      ...preview,
      acceptedRows: [{ ...movement, accountId: 'wise' }],
    }, 'revolut', '2026-07-28T11:00:00.000Z'), 'não pertence');
  });


  await test('evidência do limite não exibe entradas que a fronteira conservadora não contou', () => {
    const app = baseAppState();
    app.plannedEvents = [
      {
        id: 'income-on-logical-date', title: 'Entrada no dia reconciliado', kind: 'income', direction: 'inflow',
        amountCents: 40_000, currency: 'EUR', dueDate: '2026-07-27', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
      },
      {
        id: 'first-next-income', title: 'Salário principal', kind: 'income', direction: 'inflow',
        amountCents: 100_000, currency: 'EUR', dueDate: '2026-08-05', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
      },
      {
        id: 'second-income-same-boundary', title: 'Outra renda no mesmo dia', kind: 'income', direction: 'inflow',
        amountCents: 30_000, currency: 'EUR', dueDate: '2026-08-05', accountId: 'revolut',
        active: true, createdAt: '2026-07-27T10:00:00.000Z', updatedAt: '2026-07-27T10:00:00.000Z',
      },
    ];
    app.plannedTransfers = [
      {
        id: 'incoming-on-logical-date', title: 'Transferência hoje', sourceAccountId: 'wise', destinationAccountId: 'revolut',
        amountCents: 20_000, feeCents: 0, dueDate: '2026-07-27', evidenceLevel: 'planned', status: 'active',
      },
      {
        id: 'incoming-on-income-boundary', title: 'Transferência no pagamento', sourceAccountId: 'wise', destinationAccountId: 'revolut',
        amountCents: 15_000, feeCents: 0, dueDate: '2026-08-05', evidenceLevel: 'planned', status: 'active',
      },
    ];

    const result = new DefaultFinancialDecisionFacade().calculateSpendingLimit({
      appState: app, currency: 'EUR', accountId: 'revolut',
      horizonStart: '2026-07-27', horizonEnd: '2026-08-10',
    });
    const evidence = result.structuredEvidence ?? [];
    assert.ok(!evidence.some((item) => item.referenceId.includes('income-on-logical-date')));
    assert.ok(!evidence.some((item) => item.referenceId === 'incoming-on-logical-date'));
    assert.ok(!evidence.some((item) => item.referenceId.includes('second-income-same-boundary')));
    assert.ok(!evidence.some((item) => item.referenceId === 'incoming-on-income-boundary'));
    assert.ok(evidence.some((item) => item.referenceId.includes('first-next-income')));
  });

  await test('backup rejeita timestamp civil impossível em vez de normalizar silenciosamente', () => {
    const state = baseAppState();
    state.reservePolicies[0] = {
      ...state.reservePolicies[0]!,
      updatedAt: '2026-02-31T10:00:00.000Z',
    };
    assert.throws(() => normalizeState(state, baseAppState()), 'atualização de reserva inválida');

    const compatible = baseAppState();
    compatible.reservePolicies[0] = {
      ...compatible.reservePolicies[0]!,
      updatedAt: '2026-07-27T18:00:00Z',
    };
    assert.equal(
      normalizeState(compatible, baseAppState()).reservePolicies[0]?.updatedAt,
      '2026-07-27T18:00:00.000Z',
    );
  });



  await test('formatação monetária preserva centavos no limite inteiro seguro', () => {
    const formatted = formatMoney(Number.MAX_SAFE_INTEGER, 'EUR');
    assert.ok(formatted.endsWith('409,91'), formatted);
    const negative = formatMoney(-50, 'EUR');
    assert.ok(negative.startsWith('-€'));
    assert.ok(negative.endsWith('0,50'));
  });



  await test('assistente não trunca valores monetários com quatro ou mais dígitos', () => {
    const facade = new DefaultFinancialDecisionFacade();
    const explicit = facade.answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Posso comprar €1000?', today: '2026-07-28',
    });
    assert.ok(explicit.structuredEvidence?.some((item) =>
      item.kind === 'PROPOSED_PURCHASE' && item.impactCents === -100_000));

    const implicit = facade.answerQuestion({
      appState: baseAppState(), currency: 'EUR', targetAccountId: 'revolut',
      question: 'Posso comprar 1000?', today: '2026-07-28',
    });
    assert.ok(implicit.structuredEvidence?.some((item) =>
      item.kind === 'PROPOSED_PURCHASE' && item.impactCents === -100_000));
  });

  console.log(`\n${passed} testes operacionais aprovados`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
