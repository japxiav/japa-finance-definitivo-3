declare const process: { exitCode?: number };

import { addCivilDays } from '../src/domain/dates';
import { evaluatePurchase } from '../src/domain/decisions';
import { buildConsolidatedForecast } from '../src/domain/forecast';
import type { CivilDate, FinancialState, ForecastPointComposition } from '../src/domain/model';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: esperado ${String(expected)}, recebido ${String(actual)}`);
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function integer(next: () => number, minimum: number, maximum: number) {
  return minimum + Math.floor(next() * (maximum - minimum + 1));
}

function movement(point: { composition: ForecastPointComposition }) {
  const c = point.composition;
  return c.confirmedInflowCents + c.plannedInflowCents + c.estimatedInflowCents
    - c.confirmedOutflowCents - c.plannedOutflowCents - c.estimatedOutflowCents;
}

function outflows(point: { composition: ForecastPointComposition }) {
  const c = point.composition;
  return c.confirmedOutflowCents + c.plannedOutflowCents + c.estimatedOutflowCents;
}

function makeState(seed: number): { state: FinancialState; start: CivilDate; end: CivilDate; logicalDate: CivilDate } {
  const next = random(seed);
  const logicalDate = '2026-07-27' as CivilDate;
  const start = '2026-07-28' as CivilDate;
  const end = '2026-08-20' as CivilDate;
  const createdAt = '2026-07-27T18:01:00.000Z';
  const batchId = `batch-${seed}`;
  const accounts = [
    { id: `a-${seed}`, name: 'Conta A', currency: 'EUR', active: true },
    { id: `b-${seed}`, name: 'Conta B', currency: 'EUR', active: true },
  ];
  const plannedEvents: FinancialState['plannedEvents'] = [];
  for (let index = 0; index < 18; index += 1) {
    const kind = next() < 0.38 ? 'income' as const : 'expense' as const;
    plannedEvents.push({
      id: `e-${seed}-${index}`,
      title: `Evento ${index}`,
      kind,
      accountId: accounts[integer(next, 0, 1)]!.id,
      currency: 'EUR',
      amountCents: integer(next, 1, 250_000),
      dueDate: addCivilDays(start, integer(next, 0, 23)),
      evidenceLevel: next() < 0.2 ? 'estimated' : 'planned',
      status: 'active',
    });
  }
  // Uma recorrência curta por cenário força a expansão a participar do teste.
  plannedEvents.push({
    id: `rec-${seed}`,
    title: 'Recorrente',
    kind: next() < 0.5 ? 'income' : 'expense',
    accountId: accounts[integer(next, 0, 1)]!.id,
    currency: 'EUR',
    amountCents: integer(next, 1, 80_000),
    dueDate: start,
    evidenceLevel: 'planned',
    status: 'active',
    recurrence: { frequency: 'weekly', interval: integer(next, 1, 3), maxOccurrences: 5 },
  });

  const plannedTransfers: FinancialState['plannedTransfers'] = [];
  for (let index = 0; index < 5; index += 1) {
    const reverse = next() < 0.5;
    plannedTransfers.push({
      id: `t-${seed}-${index}`,
      title: `Transferência ${index}`,
      sourceAccountId: reverse ? accounts[1]!.id : accounts[0]!.id,
      destinationAccountId: reverse ? accounts[0]!.id : accounts[1]!.id,
      amountCents: integer(next, 1, 100_000),
      feeCents: integer(next, 0, 500),
      dueDate: addCivilDays(start, integer(next, 0, 23)),
      evidenceLevel: 'planned',
      status: 'active',
    });
  }

  return {
    start,
    end,
    logicalDate,
    state: {
      accounts,
      reconciliationBatches: [{
        id: batchId,
        logicalDate,
        logicalAsOf: `${logicalDate}T18:00:00.000Z`,
        createdAt,
        source: 'manual',
        status: 'COMPLETE',
      }],
      balanceSnapshots: accounts.map((account, index) => ({
        id: `s-${seed}-${index}`,
        accountId: account.id,
        currency: 'EUR',
        balanceCents: integer(next, -50_000, 600_000),
        reconciliationBatchId: batchId,
        reconciled: true,
      })),
      reservePolicies: [{
        id: `r-${seed}`,
        currency: 'EUR',
        minimumCents: integer(next, 0, 200_000),
        updatedAt: createdAt,
      }],
      plannedEvents,
      plannedTransfers,
    },
  };
}

function verifyScenario(seed: number) {
  const { state, start, end, logicalDate } = makeState(seed);
  const batchId = state.reconciliationBatches[0]!.id;
  const forecast = buildConsolidatedForecast({ state, reconciliationBatchId: batchId, horizonStart: start, horizonEnd: end });
  equal(forecast.status, 'COMPLETE', `forecast completo no cenário ${seed}`);
  equal(forecast.byAccount.length, 2, `duas contas preservadas no cenário ${seed}`);

  for (const accountForecast of forecast.byAccount) {
    let expected = accountForecast.openingBalanceCents;
    let expectedMinimum = expected;
    let expectedMinimumDate = logicalDate;
    for (const point of accountForecast.projectedPoints) {
      expected += movement(point);
      equal(point.balanceCents, expected, `conservação diária da conta ${accountForecast.accountId}, cenário ${seed}`);
      if (expected < expectedMinimum) {
        expectedMinimum = expected;
        expectedMinimumDate = point.date;
      }
    }
    equal(accountForecast.closingBalanceCents, expected, `fechamento da conta ${accountForecast.accountId}, cenário ${seed}`);
    equal(accountForecast.minimumProjectedBalanceCents, expectedMinimum, `mínimo da conta ${accountForecast.accountId}, cenário ${seed}`);
    equal(accountForecast.minimumProjectedBalanceDate, expectedMinimumDate, `data do mínimo da conta ${accountForecast.accountId}, cenário ${seed}`);
  }

  const consolidated = forecast.consolidatedByCurrency[0]!;
  for (const point of consolidated.projectedPoints) {
    const accountTotal = forecast.byAccount.reduce((sum, account) =>
      sum + account.projectedPoints.find((candidate) => candidate.date === point.date)!.balanceCents, 0);
    equal(point.balanceCents, accountTotal, `consolidação por moeda no cenário ${seed}`);
  }
  equal(
    consolidated.closingBalanceCents,
    forecast.byAccount.reduce((sum, account) => sum + account.closingBalanceCents, 0),
    `fechamento consolidado no cenário ${seed}`,
  );

  const next = random(seed ^ 0x9e3779b9);
  const account = forecast.byAccount[integer(next, 0, forecast.byAccount.length - 1)]!;
  const purchaseDate = addCivilDays(start, integer(next, 0, 23));
  const smaller = integer(next, 1, 100_000);
  const larger = smaller + integer(next, 1, 150_000);
  const smallDecision = evaluatePurchase({ state, forecast, accountId: account.accountId, amountCents: smaller, purchaseDate });
  const largeDecision = evaluatePurchase({ state, forecast, accountId: account.accountId, amountCents: larger, purchaseDate });
  assert(smallDecision.status === 'SAFE' || smallDecision.status === 'UNSAFE', `decisão pequena completa no cenário ${seed}`);
  assert(largeDecision.status === 'SAFE' || largeDecision.status === 'UNSAFE', `decisão grande completa no cenário ${seed}`);
  assert((largeDecision.marginCents ?? Infinity) <= (smallDecision.marginCents ?? -Infinity), `monotonicidade da compra no cenário ${seed}`);
  if (largeDecision.status === 'SAFE') equal(smallDecision.status, 'SAFE', `compra menor não pode ser pior no cenário ${seed}`);
  equal(smallDecision.status === 'SAFE', (smallDecision.marginCents ?? -1) >= 0, `status e margem coerentes no cenário ${seed}`);

  const purchaseIndex = account.projectedPoints.findIndex((point) => point.date === purchaseDate);
  const before = purchaseIndex === 0 ? account.openingBalanceCents : account.projectedPoints[purchaseIndex - 1]!.balanceCents;
  const conservativeSameDay = before - outflows(account.projectedPoints[purchaseIndex]!) - smaller;
  const expectedAdjustedMinimum = Math.min(
    conservativeSameDay,
    ...account.projectedPoints.slice(purchaseIndex).map((point) => point.balanceCents - smaller),
  );
  equal(smallDecision.minimumProjectedBalanceCents, expectedAdjustedMinimum, `ordem conservadora intradiária no cenário ${seed}`);

  const immediateForecast = buildConsolidatedForecast({ state, reconciliationBatchId: batchId, horizonStart: start, horizonEnd: end });
  const immediate = evaluatePurchase({
    state,
    forecast: immediateForecast,
    accountId: account.accountId,
    amountCents: smaller,
    purchaseDate: logicalDate,
  });
  assert(immediate.status === 'SAFE' || immediate.status === 'UNSAFE', `compra imediata completa no cenário ${seed}`);
  const immediateSameDayEventOutflows = state.plannedEvents
    .filter((event) => event.accountId === account.accountId && event.kind !== 'income' && event.dueDate === logicalDate && event.status !== 'cancelled' && event.status !== 'completed')
    .reduce((sum, event) => sum + event.amountCents, 0);
  const immediateSameDayTransferOutflows = state.plannedTransfers
    .filter((transfer) => transfer.sourceAccountId === account.accountId && transfer.dueDate === logicalDate && transfer.status === 'active')
    .reduce((sum, transfer) => sum + transfer.amountCents + transfer.feeCents, 0);
  const immediateOffset = smaller + immediateSameDayEventOutflows + immediateSameDayTransferOutflows;
  equal(
    immediate.minimumProjectedBalanceCents,
    Math.min(account.openingBalanceCents - immediateOffset, ...account.projectedPoints.map((point) => point.balanceCents - immediateOffset)),
    `compra imediata parte do snapshot e preserva saídas pendentes no cenário ${seed}`,
  );
}

try {
  for (let seed = 1; seed <= 500; seed += 1) verifyScenario(seed);
  console.log('✓ 500 cenários determinísticos de conservação, consolidação e monotonicidade');
  console.log('✓ 1.000 decisões de compra aleatórias com ordem intradiária conservadora');
  console.log('✓ 500 decisões imediatas ancoradas no snapshot e saídas pendentes do dia');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
