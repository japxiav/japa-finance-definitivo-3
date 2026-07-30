
const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected) throw new Error(message ?? `Esperado ${String(expected)}, recebido ${String(actual)}`);
  },
  ok(value: unknown, message?: string) {
    if (!value) throw new Error(message ?? 'Condição esperada não foi satisfeita');
  },
};
import { buildConsolidatedForecast } from '../src/domain/forecast';
import { evaluatePurchase, availableUntilNextIncome } from '../src/domain/decisions';
import { validateFinancialState } from '../src/domain/validation';
import {
  calculateReconciliation,
  normalizeImportedMovement,
} from '../src/domain/imports';
import type { FinancialState } from '../src/domain/model';
import { previewBankCsv } from '../src/core/csv';
import type { AppState } from '../src/core/types';
declare const require: (id: string) => { readFileSync(path: string, encoding: string): string };
const { readFileSync } = require('node:fs');

function baseState(): FinancialState {
  return {
    accounts: [
      { id: 'revolut', name: 'Revolut', currency: 'EUR', active: true },
      { id: 'wise', name: 'Wise', currency: 'EUR', active: true },
      { id: 'brl', name: 'BRL', currency: 'BRL', active: true },
    ],
    reconciliationBatches: [{
      id: 'batch-1',
      logicalDate: '2026-07-27',
      logicalAsOf: '2026-07-27T18:00:00.000Z',
      createdAt: '2026-07-27T18:01:00.000Z',
      source: 'manual',
      status: 'COMPLETE',
    }],
    balanceSnapshots: [
      { id: 's1', accountId: 'revolut', currency: 'EUR', balanceCents: 40_000, reconciliationBatchId: 'batch-1', reconciled: true },
      { id: 's2', accountId: 'wise', currency: 'EUR', balanceCents: 146_000, reconciliationBatchId: 'batch-1', reconciled: true },
      { id: 's3', accountId: 'brl', currency: 'BRL', balanceCents: 25_000, reconciliationBatchId: 'batch-1', reconciled: true },
    ],
    reservePolicies: [
      { id: 'r1', currency: 'EUR', minimumCents: 20_000, updatedAt: '2026-07-27T18:00:00.000Z' },
      { id: 'r2', currency: 'BRL', minimumCents: 10_000, updatedAt: '2026-07-27T18:00:00.000Z' },
    ],
    plannedEvents: [
      {
        id: 'rent',
        title: 'Aluguel',
        kind: 'expense',
        accountId: 'revolut',
        currency: 'EUR',
        amountCents: 90_000,
        dueDate: '2026-08-01',
        evidenceLevel: 'planned',
        status: 'active',
      },
      {
        id: 'salary',
        title: 'Salário',
        kind: 'income',
        accountId: 'revolut',
        currency: 'EUR',
        amountCents: 120_000,
        dueDate: '2026-08-05',
        evidenceLevel: 'planned',
        status: 'active',
      },
    ],
    plannedTransfers: [{
      id: 'move',
      title: 'Cobrir Revolut',
      sourceAccountId: 'wise',
      destinationAccountId: 'revolut',
      amountCents: 60_000,
      feeCents: 100,
      dueDate: '2026-07-31',
      evidenceLevel: 'planned',
      status: 'active',
    }],
  };
}

let passed = 0;
function test(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('estado-base é válido', () => {
  assert.equal(validateFinancialState(baseState()).length, 0);
});

test('snapshot ausente torna forecast INCOMPLETE e não retorna projeção', () => {
  const state = baseState();
  state.balanceSnapshots = state.balanceSnapshots.filter((item) => item.accountId !== 'wise');
  const result = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.byAccount.length, 0);
  assert.equal(result.blockers[0]?.code, 'ACTIVE_ACCOUNT_SNAPSHOT_MISSING');
});

test('snapshots de outro lote nunca completam o lote selecionado', () => {
  const state = baseState();
  state.reconciliationBatches.push({
    id: 'batch-2',
    logicalDate: '2026-07-28',
    logicalAsOf: '2026-07-28T18:00:00.000Z',
    createdAt: '2026-07-28T18:01:00.000Z',
    source: 'manual',
    status: 'COMPLETE',
  });
  state.balanceSnapshots = state.balanceSnapshots.map((item) =>
    item.accountId === 'wise' ? { ...item, id: 's2b', reconciliationBatchId: 'batch-2' } : item,
  );
  const result = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  assert.equal(result.status, 'INCOMPLETE');
});

test('transferência interna conserva consolidado exceto taxa', () => {
  const result = buildConsolidatedForecast({
    state: baseState(),
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-07-31',
  });
  assert.equal(result.status, 'COMPLETE');
  const eur = result.consolidatedByCurrency.find((item) => item.currency === 'EUR')!;
  assert.equal(eur.openingBalanceCents, 186_000);
  assert.equal(eur.closingBalanceCents, 185_900);
});

test('soma das contas reproduz consolidado em cada data', () => {
  const result = buildConsolidatedForecast({
    state: baseState(),
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const eur = result.consolidatedByCurrency.find((item) => item.currency === 'EUR')!;
  for (const point of eur.projectedPoints) {
    const sum = result.byAccount
      .filter((item) => item.currency === 'EUR')
      .map((item) => item.projectedPoints.find((candidate) => candidate.date === point.date)!.balanceCents)
      .reduce((a, b) => a + b, 0);
    assert.equal(sum, point.balanceCents);
  }
});

test('conta negativa gera warning mesmo com consolidado positivo', () => {
  const state = baseState();
  state.plannedTransfers = [];
  const result = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-03',
  });
  assert.equal(result.status, 'COMPLETE');
  assert.ok(result.warnings.some((warning) => warning.code === 'ACCOUNT_PROJECTED_NEGATIVE'));
  const eur = result.consolidatedByCurrency.find((item) => item.currency === 'EUR')!;
  assert.ok(eur.minimumProjectedBalanceCents > 0);
});

test('evidências permanecem separadas', () => {
  const state = baseState();
  state.plannedEvents.push({
    id: 'estimate',
    title: 'Mercado estimado',
    kind: 'expense',
    accountId: 'wise',
    currency: 'EUR',
    amountCents: 10_000,
    dueDate: '2026-08-02',
    evidenceLevel: 'estimated',
    status: 'active',
  });
  const result = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-02',
  });
  const point = result.consolidatedByCurrency.find((item) => item.currency === 'EUR')!.projectedPoints.find((item) => item.date === '2026-08-02')!;
  assert.equal(point.composition.estimatedOutflowCents, 10_000);
  assert.equal(point.composition.plannedOutflowCents, 0);
});

test('data impossível torna estado INVALID', () => {
  const state = baseState();
  state.plannedEvents[0] = { ...state.plannedEvents[0]!, dueDate: '2026-99-99' };
  const result = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  assert.equal(result.status, 'INVALID');
  assert.ok(result.violations.some((item) => item.code === 'DATE_INVALID'));
});

test('transferência cambial é rejeitada', () => {
  const state = baseState();
  state.plannedTransfers[0] = { ...state.plannedTransfers[0]!, destinationAccountId: 'brl' };
  const violations = validateFinancialState(state);
  assert.ok(violations.some((item) => item.code === 'FX_TRANSFER_UNSUPPORTED'));
});

test('decisão exige forecast COMPLETE', () => {
  const state = baseState();
  state.balanceSnapshots = [];
  const forecast = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const decision = evaluatePurchase({
    state,
    forecast,
    accountId: 'revolut',
    amountCents: 1_000,
    purchaseDate: '2026-07-29',
  });
  assert.equal(decision.status, 'INCOMPLETE');
});

test('decisão exige reserva', () => {
  const state = baseState();
  state.reservePolicies = state.reservePolicies.filter((item) => item.currency !== 'EUR');
  const forecast = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const decision = evaluatePurchase({
    state,
    forecast,
    accountId: 'wise',
    amountCents: 1_000,
    purchaseDate: '2026-07-29',
  });
  assert.equal(decision.status, 'INCOMPLETE');
  assert.ok(decision.blockers.includes('RESERVE_POLICY_REQUIRED'));
});

test('limite até receita também exige reserva', () => {
  const state = baseState();
  state.reservePolicies = state.reservePolicies.filter((item) => item.currency !== 'EUR');
  const forecast = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const decision = availableUntilNextIncome({ state, forecast, accountId: 'revolut', decisionDate: '2026-07-28' });
  assert.equal(decision.status, 'INCOMPLETE');
});


test('taxa adicional produz movimento líquido correto e reconciliação zero', () => {
  const movements = [
    normalizeImportedMovement({
      id: 'm1',
      importBatchId: 'ib1',
      accountId: 'revolut',
      currency: 'EUR',
      sourceRowNumber: 1,
      occurredAt: '2026-07-01T09:00:00.000Z',
      reportedAmountCents: 10_000,
      feeCents: 0,
      feeTreatment: 'ADDITIONAL_TO_REPORTED_AMOUNT',
      sourceFingerprint: 'file:1',
      semanticFingerprint: 'semantic:1',
    }),
    normalizeImportedMovement({
      id: 'm2',
      importBatchId: 'ib1',
      accountId: 'revolut',
      currency: 'EUR',
      sourceRowNumber: 2,
      occurredAt: '2026-07-02T10:00:00.000Z',
      reportedAmountCents: -10_000,
      feeCents: 220,
      feeTreatment: 'ADDITIONAL_TO_REPORTED_AMOUNT',
      sourceFingerprint: 'file:2',
      semanticFingerprint: 'semantic:2',
    }),
  ];
  assert.equal(movements[1]?.netMovementCents, -10_220);
  const reconciliation = calculateReconciliation({
    openingBalanceCents: 100_000,
    closingBalanceCents: 99_780,
    movements,
  });
  assert.equal(reconciliation.reconciliationDifferenceCents, 0);
});

test('decisão insegura expõe aluguel como evidência estruturada', () => {
  const state = baseState();
  state.plannedTransfers = [];
  const forecast = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const decision = evaluatePurchase({
    state,
    forecast,
    accountId: 'revolut',
    amountCents: 5_000,
    purchaseDate: '2026-07-29',
  });
  assert.equal(decision.status, 'UNSAFE');
  assert.ok(decision.evidence.some((item) =>
    item.kind === 'PLANNED_EVENT' &&
    item.referenceId === 'rent' &&
    item.impactCents === -90_000,
  ));
  assert.equal(decision.minimumBalanceDate, '2026-08-01');
});

test('decisão mantém valor monetário estruturado sem depender de formatação textual', () => {
  const state = baseState();
  const forecast = buildConsolidatedForecast({
    state,
    reconciliationBatchId: 'batch-1',
    horizonStart: '2026-07-28',
    horizonEnd: '2026-08-10',
  });
  const decision = evaluatePurchase({
    state,
    forecast,
    accountId: 'wise',
    amountCents: 10_000,
    purchaseDate: '2026-07-29',
  });
  assert.equal(decision.amountCents, 10_000);
});


async function verifyCsvFixture() {
  const fixture = readFileSync('examples/revolut-fee-regression.csv', 'utf8');
  const appState: AppState = {
    schemaVersion: 6,
    accounts: [{ id: 'revolut', name: 'Revolut', currency: 'EUR', institution: 'revolut', active: true }],
    transactions: [],
    imports: [],
    importIssues: [],
    categories: [{ id: 'other', name: 'Outros', active: true, type: 'both' }],
    rules: [],
    balanceSnapshots: [],
    reservePolicies: [],
    plannedEvents: [],
    reconciliationBatches: [],
    plannedTransfers: [],
    insightFeedback: [],
    reviewGroups: [],
    reviewDecisions: [],
  };
  const preview = await previewBankCsv(fixture, 'revolut-fee-regression.csv', appState, 'revolut');
  const feeMovement = preview.newTransactions.find((item) => item.feeCents === 220);
  assert.ok(feeMovement, 'A linha da fixture com taxa de € 2,20 não foi encontrada');
  assert.equal(feeMovement?.netMovementCents, -10_220);
  const eur = preview.currencies.find((item) => item.currency === 'EUR');
  assert.equal(eur?.reconciliationDifferenceCents, 0);
  passed += 1;
  console.log('✓ fixture CSV real passa por previewBankCsv e reconcilia diferença zero');
}

verifyCsvFixture()
  .then(() => console.log(`\n${passed}/16 invariantes aprovados`))
  .catch((error) => {
    console.error(error);
    throw error;
  });

