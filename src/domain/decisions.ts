import { addCents, MonetaryArithmeticError, subtractCents } from './arithmetic';
import { addCivilDays, isCivilDate } from './dates';
import { pendingAccountFlowsThroughLogicalDate, pendingMovementsThroughLogicalDate } from './flows';
import { expandPlannedEventOccurrences } from './recurrence';
import type {
  CivilDate,
  DecisionEvidence,
  DecisionResult,
  FinancialState,
  ForecastResult,
} from './model';

function invalidFromForecast(forecast: ForecastResult): DecisionResult {
  return {
    status: forecast.status === 'INVALID' ? 'INVALID' : 'INCOMPLETE',
    forecastStatus: forecast.status,
    blockers: [
      ...forecast.blockers.map((item) => item.code),
      ...forecast.violations.map((item) => item.code),
    ],
    guarantees: [],
    evidence: [],
    appliedRules: ['FORECAST_MUST_BE_COMPLETE'],
  };
}

function pointOutflows(point: ForecastResult['byAccount'][number]['projectedPoints'][number]): number {
  return addCents(
    point.composition.confirmedOutflowCents,
    point.composition.plannedOutflowCents,
    point.composition.estimatedOutflowCents,
  );
}

function buildFlowEvidence(input: {
  state: FinancialState;
  accountId: string;
  startDate: CivilDate;
  endDate: CivilDate;
  includePendingBeforeStart?: boolean;
  excludeOccurrenceId?: string;
  excludeInflowsOnDates?: readonly CivilDate[];
}): DecisionEvidence[] {
  const evidence: DecisionEvidence[] = [];
  const seen = new Set<string>();
  const excludedInflowDates = new Set(input.excludeInflowsOnDates ?? []);

  for (const occurrence of expandPlannedEventOccurrences(
    input.state.plannedEvents,
    input.startDate,
    input.endDate,
  )) {
    if (occurrence.event.accountId !== input.accountId || occurrence.occurrenceId === input.excludeOccurrenceId) continue;
    if (occurrence.event.kind === 'income' && excludedInflowDates.has(occurrence.date)) continue;
    const referenceId = occurrence.event.recurrence ? occurrence.occurrenceId : occurrence.event.id;
    const key = `event:${referenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      kind: 'PLANNED_EVENT',
      referenceId,
      title: occurrence.event.title,
      dueAt: occurrence.date,
      impactCents: occurrence.event.kind === 'income'
        ? occurrence.event.amountCents
        : -occurrence.event.amountCents,
      accountId: input.accountId,
      evidenceLevel: occurrence.event.evidenceLevel,
    });
  }

  for (const transfer of input.state.plannedTransfers) {
    if (
      transfer.status !== 'active' ||
      transfer.dueDate < input.startDate ||
      transfer.dueDate > input.endDate ||
      (transfer.sourceAccountId !== input.accountId && transfer.destinationAccountId !== input.accountId)
    ) continue;
    const incoming = transfer.destinationAccountId === input.accountId;
    if (incoming && excludedInflowDates.has(transfer.dueDate)) continue;
    const key = `transfer:${transfer.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({
      kind: 'TRANSFER',
      referenceId: transfer.id,
      title: transfer.title,
      dueAt: transfer.dueDate,
      impactCents: transfer.sourceAccountId === input.accountId
        ? -addCents(transfer.amountCents, transfer.feeCents)
        : transfer.amountCents,
      accountId: input.accountId,
      evidenceLevel: transfer.evidenceLevel,
    });
  }

  if (input.includePendingBeforeStart) {
    for (const pending of pendingMovementsThroughLogicalDate(input.state, input.startDate)) {
      if (pending.accountId !== input.accountId || pending.dueDate >= input.startDate) continue;
      const key = `${pending.kind}:${pending.referenceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push({
        kind: pending.kind,
        referenceId: pending.referenceId,
        title: pending.title,
        dueAt: pending.dueDate,
        impactCents: -pending.amountCents,
        accountId: input.accountId,
        evidenceLevel: pending.evidenceLevel,
      });
    }
  }

  return evidence.sort((left, right) =>
    (left.dueAt ?? '').localeCompare(right.dueAt ?? '') || left.referenceId.localeCompare(right.referenceId));
}

function buildPurchaseEvidence(input: {
  state: FinancialState;
  accountId: string;
  purchaseDate: string;
  minimumBalanceDate: string;
  amountCents: number;
  openingBalanceCents: number;
  reserveMinimumCents: number;
  conservativeAtReconciliationDate: boolean;
}): DecisionEvidence[] {
  const {
    state,
    accountId,
    purchaseDate,
    minimumBalanceDate,
    amountCents,
    openingBalanceCents,
    reserveMinimumCents,
    conservativeAtReconciliationDate,
  } = input;

  const evidence: DecisionEvidence[] = [
    {
      kind: 'OPENING_BALANCE',
      referenceId: `opening:${accountId}`,
      title: 'Saldo inicial reconciliado',
      impactCents: openingBalanceCents,
      accountId,
    },
    {
      kind: 'PROPOSED_PURCHASE',
      referenceId: 'proposed-purchase',
      title: 'Compra simulada',
      dueAt: purchaseDate,
      impactCents: -amountCents,
      accountId,
    },
  ];

  for (const occurrence of expandPlannedEventOccurrences(
    state.plannedEvents,
    purchaseDate,
    minimumBalanceDate,
  )) {
    const event = occurrence.event;
    if (event.accountId !== accountId || event.status !== 'active') continue;
    if (conservativeAtReconciliationDate && event.kind === 'income' && occurrence.date === purchaseDate) continue;
    evidence.push({
      kind: 'PLANNED_EVENT',
      referenceId: event.recurrence ? occurrence.occurrenceId : event.id,
      title: event.title,
      dueAt: occurrence.date,
      impactCents: event.kind === 'income' ? event.amountCents : -event.amountCents,
      accountId,
      evidenceLevel: event.evidenceLevel,
    });
  }

  for (const transfer of state.plannedTransfers) {
    if (
      transfer.status === 'active' &&
      transfer.dueDate >= purchaseDate &&
      transfer.dueDate <= minimumBalanceDate &&
      (transfer.sourceAccountId === accountId || transfer.destinationAccountId === accountId)
    ) {
      if (
        conservativeAtReconciliationDate &&
        transfer.dueDate === purchaseDate &&
        transfer.destinationAccountId === accountId
      ) continue;
      evidence.push({
        kind: 'TRANSFER',
        referenceId: transfer.id,
        title: transfer.title,
        dueAt: transfer.dueDate,
        impactCents: transfer.sourceAccountId === accountId
          ? -addCents(transfer.amountCents, transfer.feeCents)
          : transfer.amountCents,
        accountId,
        evidenceLevel: transfer.evidenceLevel,
      });
    }
  }


  for (const pending of pendingMovementsThroughLogicalDate(state, purchaseDate as CivilDate)) {
    if (pending.accountId !== accountId || pending.dueDate >= purchaseDate) continue;
    evidence.push({
      kind: pending.kind,
      referenceId: pending.referenceId,
      title: pending.title,
      dueAt: pending.dueDate,
      impactCents: -pending.amountCents,
      accountId,
      evidenceLevel: pending.evidenceLevel,
    });
  }

  evidence.push({
    kind: 'RESERVE_POLICY',
    referenceId: `reserve:${accountId}`,
    title: 'Reserva mínima',
    impactCents: -reserveMinimumCents,
    accountId,
  });

  return evidence;
}

function evaluatePurchaseInternal(input: {
  state: FinancialState;
  forecast: ForecastResult;
  accountId: string;
  amountCents: number;
  purchaseDate: string;
}): DecisionResult {
  const { state, forecast, accountId, amountCents, purchaseDate } = input;
  if (forecast.status !== 'COMPLETE') return invalidFromForecast(forecast);

  if (!isCivilDate(purchaseDate)) {
    return {
      status: 'INVALID',
      forecastStatus: forecast.status,
      accountId,
      amountCents,
      blockers: ['DATE_INVALID'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['PURCHASE_DATE_MUST_BE_VALID'],
    };
  }

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return {
      status: 'INVALID',
      forecastStatus: forecast.status,
      accountId,
      amountCents,
      blockers: ['AMOUNT_INVALID'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['AMOUNT_MUST_BE_POSITIVE_SAFE_INTEGER'],
    };
  }

  const immediateAfterReconciliation =
    forecast.logicalDate === purchaseDate &&
    purchaseDate < forecast.horizonStart;
  if ((!immediateAfterReconciliation && purchaseDate < forecast.horizonStart) || purchaseDate > forecast.horizonEnd) {
    return {
      status: 'INCOMPLETE',
      forecastStatus: forecast.status,
      accountId,
      amountCents,
      blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['PURCHASE_DATE_WITHIN_HORIZON'],
    };
  }

  const accountForecast = forecast.byAccount.find((item) => item.accountId === accountId);
  const account = state.accounts.find((item) => item.id === accountId);
  if (!accountForecast || !account) {
    return {
      status: 'INVALID',
      forecastStatus: forecast.status,
      accountId,
      amountCents,
      blockers: ['ACCOUNT_REFERENCE_INVALID'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['ACCOUNT_REFERENCE_MUST_EXIST'],
    };
  }

  const activeReserves = state.reservePolicies.filter(
    (policy) => policy.currency === account.currency,
  );
  const reserve = activeReserves[0];
  if (!reserve) {
    return {
      status: 'INCOMPLETE',
      forecastStatus: forecast.status,
      accountId,
      currency: account.currency,
      amountCents,
      blockers: ['RESERVE_POLICY_REQUIRED'],
      guarantees: ['FORECAST_COMPLETE', 'DECISION_WITHIN_HORIZON'],
      evidence: [],
      appliedRules: ['RESERVE_POLICY_REQUIRED'],
    };
  }

  const projected: Array<{ date: string; balanceCents: number }> = [];
  if (immediateAfterReconciliation) {
    const pending = pendingAccountFlowsThroughLogicalDate(state, accountId, purchaseDate as CivilDate);

    // No instante da compra, nenhuma entrada sem horário pode ser presumida
    // antes da compra e das saídas do dia. Depois do fechamento civil, porém,
    // entradas e saídas do dia precisam voltar à trajetória; omitir a renda
    // para sempre produzia falsos UNSAFE nos dias seguintes.
    projected.push({
      date: purchaseDate,
      balanceCents: subtractCents(accountForecast.openingBalanceCents, pending.outflowCents, amountCents),
    });
    projected.push(...accountForecast.projectedPoints.map((point) => ({
      date: point.date,
      balanceCents: subtractCents(point.balanceCents, amountCents),
    })));
  } else {
    const purchasePointIndex = accountForecast.projectedPoints.findIndex(
      (point) => point.date === purchaseDate,
    );
    if (purchasePointIndex < 0) {
      return {
        status: 'INCOMPLETE',
        forecastStatus: forecast.status,
        accountId,
        amountCents,
        blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
        guarantees: ['FORECAST_COMPLETE'],
        evidence: [],
        appliedRules: ['PURCHASE_DATE_WITHIN_HORIZON'],
      };
    }

    const purchasePoint = accountForecast.projectedPoints[purchasePointIndex]!;
    const balanceBeforePurchaseDate = purchasePointIndex === 0
      ? accountForecast.openingBalanceCents
      : accountForecast.projectedPoints[purchasePointIndex - 1]!.balanceCents;
    const sameDayOutflows = pointOutflows(purchasePoint);

    // A granularidade é diária, portanto não sabemos se uma receita do mesmo
    // dia entra antes da compra. A decisão usa a ordem conservadora: primeiro
    // compra e saídas conhecidas; somente depois as entradas do dia.
    projected.push({
      date: purchaseDate,
      balanceCents: subtractCents(balanceBeforePurchaseDate, sameDayOutflows, amountCents),
    });
    projected.push(...accountForecast.projectedPoints
      .slice(purchasePointIndex)
      .map((point) => ({
        date: point.date,
        balanceCents: subtractCents(point.balanceCents, amountCents),
      })));
  }
  const minimumPoint = projected.reduce((current, point) =>
    point.balanceCents < current.balanceCents ? point : current,
  );
  const marginCents = subtractCents(minimumPoint.balanceCents, reserve.minimumCents);
  const evidence = buildPurchaseEvidence({
    state,
    accountId,
    purchaseDate,
    minimumBalanceDate: minimumPoint.date,
    amountCents,
    openingBalanceCents: accountForecast.openingBalanceCents,
    reserveMinimumCents: reserve.minimumCents,
    conservativeAtReconciliationDate: immediateAfterReconciliation,
  });

  return {
    status: marginCents >= 0 ? 'SAFE' : 'UNSAFE',
    forecastStatus: forecast.status,
    accountId,
    currency: account.currency,
    amountCents,
    marginCents,
    minimumBalanceDate: minimumPoint.date,
    minimumProjectedBalanceCents: minimumPoint.balanceCents,
    reserveMinimumCents: reserve.minimumCents,
    blockers: marginCents >= 0 ? [] : ['TARGET_ACCOUNT_BELOW_RESERVE'],
    guarantees: [
      'FORECAST_COMPLETE',
      'RESERVE_POLICY_PRESENT',
      'DECISION_WITHIN_HORIZON',
      ...(marginCents >= 0 ? ['TARGET_ACCOUNT_SOLVENT' as const] : []),
    ],
    evidence,
    appliedRules: [
      'FORECAST_MUST_BE_COMPLETE',
      'TARGET_ACCOUNT_REQUIRED',
      'RESERVE_POLICY_REQUIRED',
      'MINIMUM_BALANCE_AFTER_PURCHASE_MINUS_RESERVE',
      ...(immediateAfterReconciliation
        ? ['IMMEDIATE_PURCHASE_AFTER_RECONCILIATION', 'SAME_DAY_OUTFLOWS_NOT_ASSUMED_ALREADY_PAID']
        : ['SAME_DAY_INCOME_NOT_ASSUMED_BEFORE_PURCHASE']),
    ],
  };
}


export function evaluatePurchase(input: {
  state: FinancialState;
  forecast: ForecastResult;
  accountId: string;
  amountCents: number;
  purchaseDate: string;
}): DecisionResult {
  try {
    return evaluatePurchaseInternal(input);
  } catch (error) {
    if (!(error instanceof MonetaryArithmeticError)) throw error;
    return {
      status: 'INVALID',
      forecastStatus: input.forecast.status,
      accountId: input.accountId,
      amountCents: input.amountCents,
      blockers: ['ARITHMETIC_OVERFLOW'],
      guarantees: input.forecast.status === 'COMPLETE' ? ['FORECAST_COMPLETE'] : [],
      evidence: [],
      appliedRules: ['MONETARY_ARITHMETIC_MUST_REMAIN_SAFE'],
    };
  }
}

function availableUntilNextIncomeInternal(input: {
  state: FinancialState;
  forecast: ForecastResult;
  accountId: string;
  decisionDate: CivilDate;
}): DecisionResult {
  const { state, forecast, accountId, decisionDate } = input;
  if (forecast.status !== 'COMPLETE') return invalidFromForecast(forecast);
  if (!isCivilDate(decisionDate)) {
    return {
      status: 'INVALID',
      forecastStatus: forecast.status,
      accountId,
      blockers: ['DATE_INVALID'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['DECISION_DATE_MUST_BE_VALID'],
    };
  }

  const account = state.accounts.find((item) => item.id === accountId);
  const accountForecast = forecast.byAccount.find((item) => item.accountId === accountId);
  if (!account || !accountForecast) {
    return {
      status: 'INVALID',
      forecastStatus: forecast.status,
      accountId,
      blockers: ['ACCOUNT_REFERENCE_INVALID'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['ACCOUNT_REFERENCE_MUST_EXIST'],
    };
  }

  const reserve = state.reservePolicies.find((policy) => policy.currency === account.currency);
  if (!reserve) {
    return {
      status: 'INCOMPLETE',
      forecastStatus: forecast.status,
      accountId,
      currency: account.currency,
      blockers: ['RESERVE_POLICY_REQUIRED'],
      guarantees: ['FORECAST_COMPLETE'],
      evidence: [],
      appliedRules: ['RESERVE_POLICY_REQUIRED'],
    };
  }

  const logicalDate = forecast.logicalDate;
  if (!logicalDate || decisionDate < logicalDate || decisionDate > forecast.horizonEnd) {
    return {
      status: 'INCOMPLETE',
      forecastStatus: forecast.status,
      accountId,
      currency: account.currency,
      blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
      guarantees: ['FORECAST_COMPLETE', 'RESERVE_POLICY_PRESENT'],
      evidence: [],
      appliedRules: ['DECISION_DATE_WITHIN_HORIZON'],
    };
  }

  const incomeSearchStart = decisionDate === logicalDate ? forecast.horizonStart : decisionDate;
  const incomeOccurrences = expandPlannedEventOccurrences(
    state.plannedEvents,
    incomeSearchStart,
    forecast.horizonEnd,
  )
    .filter(({ event }) =>
      event.kind === 'income' &&
      event.accountId === accountId,
    )
    .sort((left, right) => left.date.localeCompare(right.date));

  const nextIncome = incomeOccurrences[0];
  if (!nextIncome) {
    return {
      status: 'INCOMPLETE',
      forecastStatus: forecast.status,
      accountId,
      currency: account.currency,
      blockers: ['NEXT_INCOME_NOT_FOUND'],
      guarantees: ['FORECAST_COMPLETE', 'RESERVE_POLICY_PRESENT'],
      evidence: [],
      appliedRules: ['NEXT_INCOME_MUST_BE_KNOWN'],
    };
  }

  const nextIncomeDate = nextIncome.date;
  const immediateAfterReconciliation = decisionDate === logicalDate;
  const pendingLogicalFlows = immediateAfterReconciliation
    ? pendingAccountFlowsThroughLogicalDate(state, accountId, logicalDate)
    : { inflowCents: 0, outflowCents: 0 };
  const effectiveBalance = (date: CivilDate): number | undefined => {
    if (date === logicalDate) return subtractCents(accountForecast.openingBalanceCents, pendingLogicalFlows.outflowCents);
    const point = accountForecast.projectedPoints.find((item) => item.date === date);
    return point?.balanceCents;
  };

  let balanceBeforeDecisionDay: number;
  let decisionDayOutflows: number;
  if (immediateAfterReconciliation) {
    balanceBeforeDecisionDay = accountForecast.openingBalanceCents;
    decisionDayOutflows = pendingLogicalFlows.outflowCents;
  } else {
    const decisionPointIndex = accountForecast.projectedPoints.findIndex((point) => point.date === decisionDate);
    if (decisionPointIndex < 0) {
      return {
        status: 'INCOMPLETE',
        forecastStatus: forecast.status,
        accountId,
        currency: account.currency,
        blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
        guarantees: ['FORECAST_COMPLETE', 'RESERVE_POLICY_PRESENT'],
        evidence: [],
        appliedRules: ['DECISION_DATE_WITHIN_HORIZON'],
      };
    }
    balanceBeforeDecisionDay = decisionPointIndex === 0
      ? accountForecast.openingBalanceCents
      : accountForecast.projectedPoints[decisionPointIndex - 1]!.balanceCents;
    decisionDayOutflows = pointOutflows(accountForecast.projectedPoints[decisionPointIndex]!);
  }

  const candidates: Array<{ date: CivilDate; balanceCents: number }> = [{
    date: decisionDate,
    balanceCents: subtractCents(balanceBeforeDecisionDay, decisionDayOutflows),
  }];

  if (nextIncomeDate > decisionDate) {
    let date = decisionDate;
    while (date < nextIncomeDate) {
      const endOfDay = effectiveBalance(date);
      if (endOfDay !== undefined) candidates.push({ date, balanceCents: endOfDay });
      date = addCivilDays(date, 1);
    }

    const incomeDayPoint = accountForecast.projectedPoints.find((point) => point.date === nextIncomeDate);
    if (!incomeDayPoint) {
      return {
        status: 'INCOMPLETE',
        forecastStatus: forecast.status,
        accountId,
        currency: account.currency,
        blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
        guarantees: ['FORECAST_COMPLETE', 'RESERVE_POLICY_PRESENT'],
        evidence: [],
        appliedRules: ['NEXT_INCOME_WITHIN_FORECAST'],
      };
    }
    const previousDate = addCivilDays(nextIncomeDate, -1);
    const balanceBeforeIncomeDay = previousDate === logicalDate
      ? subtractCents(accountForecast.openingBalanceCents, pendingLogicalFlows.outflowCents)
      : effectiveBalance(previousDate);
    if (balanceBeforeIncomeDay === undefined) {
      return {
        status: 'INCOMPLETE',
        forecastStatus: forecast.status,
        accountId,
        currency: account.currency,
        blockers: ['DECISION_OUTSIDE_FORECAST_HORIZON'],
        guarantees: ['FORECAST_COMPLETE', 'RESERVE_POLICY_PRESENT'],
        evidence: [],
        appliedRules: ['NEXT_INCOME_WITHIN_FORECAST'],
      };
    }
    const carriedPendingOutflows = immediateAfterReconciliation && nextIncomeDate === forecast.horizonStart
      ? pendingLogicalFlows.outflowCents
      : 0;
    const incomeDayOutflows = subtractCents(pointOutflows(incomeDayPoint), carriedPendingOutflows);
    candidates.push({
      date: nextIncomeDate,
      balanceCents: subtractCents(balanceBeforeIncomeDay, incomeDayOutflows),
    });
  }

  const minimumPoint = candidates.reduce((current, candidate) =>
    candidate.balanceCents < current.balanceCents ? candidate : current,
  );
  const marginCents = subtractCents(minimumPoint.balanceCents, reserve.minimumCents);
  const flowEvidence = buildFlowEvidence({
    state,
    accountId,
    startDate: decisionDate,
    endDate: minimumPoint.date,
    includePendingBeforeStart: immediateAfterReconciliation,
    excludeOccurrenceId: nextIncome.occurrenceId,
    // O limite é calculado antes de qualquer entrada sem horário no dia da
    // decisão e no dia da próxima renda. A evidência precisa obedecer à mesma
    // fronteira, ou explicaria dinheiro que o cálculo deliberadamente ignorou.
    excludeInflowsOnDates: [
      ...(immediateAfterReconciliation ? [decisionDate] : []),
      nextIncomeDate,
    ],
  });

  return {
    status: marginCents >= 0 ? 'SAFE' : 'UNSAFE',
    forecastStatus: forecast.status,
    accountId,
    currency: account.currency,
    marginCents,
    minimumProjectedBalanceCents: minimumPoint.balanceCents,
    minimumBalanceDate: minimumPoint.date,
    reserveMinimumCents: reserve.minimumCents,
    blockers: marginCents >= 0 ? [] : ['TARGET_ACCOUNT_BELOW_RESERVE'],
    guarantees: [
      'FORECAST_COMPLETE',
      'RESERVE_POLICY_PRESENT',
      'DECISION_WITHIN_HORIZON',
      ...(marginCents >= 0 ? ['TARGET_ACCOUNT_SOLVENT' as const] : []),
    ],
    evidence: [
      {
        kind: 'OPENING_BALANCE',
        referenceId: `decision-opening:${accountId}:${decisionDate}`,
        title: 'Saldo antes das saídas do dia da decisão',
        dueAt: decisionDate,
        impactCents: balanceBeforeDecisionDay,
        accountId,
      },
      ...flowEvidence,
      {
        kind: 'PLANNED_EVENT',
        referenceId: nextIncome.occurrenceId,
        title: nextIncome.event.title,
        dueAt: nextIncome.date,
        impactCents: nextIncome.event.amountCents,
        accountId,
        evidenceLevel: nextIncome.event.evidenceLevel,
      },
      {
        kind: 'RESERVE_POLICY',
        referenceId: `reserve:${accountId}`,
        title: 'Reserva mínima',
        impactCents: -reserve.minimumCents,
        accountId,
      },
    ],
    appliedRules: [
      'FORECAST_MUST_BE_COMPLETE',
      'RESERVE_POLICY_REQUIRED',
      'LIMIT_STARTS_ON_DECISION_DATE',
      'LIMIT_USES_MINIMUM_BALANCE_BEFORE_NEXT_INCOME',
      'SAME_DAY_OUTFLOWS_NOT_ASSUMED_AFTER_INCOME',
      ...(immediateAfterReconciliation ? ['PENDING_RECONCILIATION_DAY_OUTFLOWS_INCLUDED'] : []),
    ],
  };
}



export function availableUntilNextIncome(input: {
  state: FinancialState;
  forecast: ForecastResult;
  accountId: string;
  decisionDate: CivilDate;
}): DecisionResult {
  try {
    return availableUntilNextIncomeInternal(input);
  } catch (error) {
    if (!(error instanceof MonetaryArithmeticError)) throw error;
    return {
      status: 'INVALID',
      forecastStatus: input.forecast.status,
      accountId: input.accountId,
      blockers: ['ARITHMETIC_OVERFLOW'],
      guarantees: input.forecast.status === 'COMPLETE' ? ['FORECAST_COMPLETE'] : [],
      evidence: [],
      appliedRules: ['MONETARY_ARITHMETIC_MUST_REMAIN_SAFE'],
    };
  }
}
