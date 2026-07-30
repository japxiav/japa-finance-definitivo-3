
import { addCents, MonetaryArithmeticError } from './arithmetic';
import { addCivilDays, CivilDateArithmeticError, civilDaysBetween, isCivilDate } from './dates';
import { pendingMovementsThroughLogicalDate } from './flows';
import { expandPlannedEventOccurrences } from './recurrence';
import type {
  AccountForecast,
  CivilDate,
  CurrencyForecast,
  EvidenceLevel,
  FinancialState,
  ForecastPoint,
  ForecastPointComposition,
  ForecastResult,
  PlannedEvent,
} from './model';
import { validateFinancialState } from './validation';

interface Movement {
  id: string;
  accountId: string;
  currency: string;
  date: CivilDate;
  amountCents: number;
  direction: 'inflow' | 'outflow';
  evidenceLevel: EvidenceLevel;
}

function emptyComposition(): ForecastPointComposition {
  return {
    confirmedInflowCents: 0,
    confirmedOutflowCents: 0,
    plannedInflowCents: 0,
    plannedOutflowCents: 0,
    estimatedInflowCents: 0,
    estimatedOutflowCents: 0,
  };
}

function addToComposition(
  composition: ForecastPointComposition,
  movement: Movement,
): ForecastPointComposition {
  const next = { ...composition };
  const key = `${movement.evidenceLevel}${movement.direction === 'inflow' ? 'InflowCents' : 'OutflowCents'}` as keyof ForecastPointComposition;
  next[key] = addCents(next[key], movement.amountCents);
  return next;
}


function expandEvents(
  state: FinancialState,
  logicalDate: CivilDate,
  horizonStart: CivilDate,
  horizonEnd: CivilDate,
): { movements: Movement[]; overdueEventIds: Array<{ id: string; dueDate: CivilDate }> } {
  const movements: Movement[] = [];
  const overdueEventIds: Array<{ id: string; dueDate: CivilDate }> = [];

  for (const event of state.plannedEvents) {
    if (event.status === 'overdue' || (!event.recurrence && event.status === 'active' && event.dueDate < horizonStart)) {
      overdueEventIds.push({ id: event.id, dueDate: event.dueDate });
    }
  }

  for (const pending of pendingMovementsThroughLogicalDate(state, logicalDate)) {
    movements.push({
      id: pending.id,
      accountId: pending.accountId,
      currency: pending.currency,
      date: horizonStart,
      amountCents: pending.amountCents,
      direction: pending.direction,
      evidenceLevel: pending.evidenceLevel,
    });
  }

  for (const occurrence of expandPlannedEventOccurrences(state.plannedEvents, horizonStart, horizonEnd)) {
    const event = occurrence.event;
    movements.push({
      id: occurrence.occurrenceId,
      accountId: event.accountId,
      currency: event.currency,
      date: occurrence.date,
      amountCents: event.amountCents,
      direction: event.kind === 'income' ? 'inflow' : 'outflow',
      evidenceLevel: event.evidenceLevel,
    });
  }

  const accounts = new Map(state.accounts.map((account) => [account.id, account]));
  for (const transfer of state.plannedTransfers) {
    if (transfer.status !== 'active' || transfer.dueDate <= logicalDate || transfer.dueDate < horizonStart || transfer.dueDate > horizonEnd) continue;
    const source = accounts.get(transfer.sourceAccountId)!;
    movements.push({
      id: `${transfer.id}:source`,
      accountId: transfer.sourceAccountId,
      currency: source.currency,
      date: transfer.dueDate,
      amountCents: addCents(transfer.amountCents, transfer.feeCents),
      direction: 'outflow',
      evidenceLevel: transfer.evidenceLevel,
    });
    movements.push({
      id: `${transfer.id}:destination`,
      accountId: transfer.destinationAccountId,
      currency: source.currency,
      date: transfer.dueDate,
      amountCents: transfer.amountCents,
      direction: 'inflow',
      evidenceLevel: transfer.evidenceLevel,
    });
  }

  return { movements, overdueEventIds };
}

function buildAccountForecast(
  accountId: string,
  currency: string,
  openingBalanceCents: number,
  movements: Movement[],
  openingDate: CivilDate,
  horizonStart: CivilDate,
  horizonEnd: CivilDate,
): AccountForecast {
  let balance = openingBalanceCents;
  let minimum = openingBalanceCents;
  let minimumDate = openingDate;
  const projectedPoints: ForecastPoint[] = [];

  let date = horizonStart;
  while (date <= horizonEnd) {
    let composition = emptyComposition();
    for (const movement of movements) {
      if (movement.accountId === accountId && movement.date === date) {
        composition = addToComposition(composition, movement);
      }
    }
    const inflow = addCents(composition.confirmedInflowCents, composition.plannedInflowCents, composition.estimatedInflowCents);
    const outflow = addCents(composition.confirmedOutflowCents, composition.plannedOutflowCents, composition.estimatedOutflowCents);
    balance = addCents(balance, inflow, -outflow);
    if (balance < minimum) {
      minimum = balance;
      minimumDate = date;
    }
    projectedPoints.push({ date, balanceCents: balance, composition });
    if (date === horizonEnd) break;
    date = addCivilDays(date, 1);
  }

  return {
    accountId,
    currency,
    openingBalanceCents,
    minimumProjectedBalanceCents: minimum,
    minimumProjectedBalanceDate: minimumDate,
    closingBalanceCents: balance,
    projectedPoints,
  };
}

function consolidateCurrency(
  currency: string,
  accountForecasts: AccountForecast[],
  openingDate: CivilDate,
  horizonStart: CivilDate,
  horizonEnd: CivilDate,
): CurrencyForecast {
  const relevant = accountForecasts.filter((forecast) => forecast.currency === currency);
  const points: ForecastPoint[] = [];
  let minimum = relevant.reduce((sum, item) => addCents(sum, item.openingBalanceCents), 0);
  let minimumDate = openingDate;

  let date = horizonStart;
  while (date <= horizonEnd) {
    const accountPoints = relevant.map((forecast) => forecast.projectedPoints.find((point) => point.date === date)!);
    const composition = accountPoints.reduce((sum, point) => ({
      confirmedInflowCents: addCents(sum.confirmedInflowCents, point.composition.confirmedInflowCents),
      confirmedOutflowCents: addCents(sum.confirmedOutflowCents, point.composition.confirmedOutflowCents),
      plannedInflowCents: addCents(sum.plannedInflowCents, point.composition.plannedInflowCents),
      plannedOutflowCents: addCents(sum.plannedOutflowCents, point.composition.plannedOutflowCents),
      estimatedInflowCents: addCents(sum.estimatedInflowCents, point.composition.estimatedInflowCents),
      estimatedOutflowCents: addCents(sum.estimatedOutflowCents, point.composition.estimatedOutflowCents),
    }), emptyComposition());
    const balanceCents = accountPoints.reduce((sum, point) => addCents(sum, point.balanceCents), 0);
    if (balanceCents < minimum) {
      minimum = balanceCents;
      minimumDate = date;
    }
    points.push({ date, balanceCents, composition });
    if (date === horizonEnd) break;
    date = addCivilDays(date, 1);
  }

  return {
    currency,
    openingBalanceCents: relevant.reduce((sum, item) => addCents(sum, item.openingBalanceCents), 0),
    minimumProjectedBalanceCents: minimum,
    minimumProjectedBalanceDate: minimumDate,
    closingBalanceCents: relevant.reduce((sum, item) => addCents(sum, item.closingBalanceCents), 0),
    accountIds: relevant.map((item) => item.accountId),
    projectedPoints: points,
  };
}

export function buildConsolidatedForecast(input: {
  state: FinancialState;
  reconciliationBatchId: string;
  horizonStart: CivilDate;
  horizonEnd: CivilDate;
}): ForecastResult {
  const { state, reconciliationBatchId, horizonStart, horizonEnd } = input;

  if (!isCivilDate(horizonStart) || !isCivilDate(horizonEnd) || horizonEnd < horizonStart) {
    return {
      status: 'INVALID',
      reconciliationBatchId,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [],
      violations: [{
        code: 'DATE_INVALID',
        entityType: 'forecast',
        field: 'horizon',
        message: 'Horizonte do forecast é inválido.',
      }],
      warnings: [],
      guarantees: [],
    };
  }

  if (civilDaysBetween(horizonStart, horizonEnd) > 3_660) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'FORECAST_HORIZON_TOO_LARGE',
        reconciliationBatchId,
        message: 'O horizonte diário não pode exceder 3.660 dias.',
      }],
      violations: [],
      warnings: [],
      guarantees: [],
    };
  }

  const violations = validateFinancialState(state);
  if (violations.length > 0) {
    return {
      status: 'INVALID',
      reconciliationBatchId,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [],
      violations,
      warnings: [],
      guarantees: [],
    };
  }

  const batch = state.reconciliationBatches.find((candidate) => candidate.id === reconciliationBatchId);
  if (!batch) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'RECONCILIATION_BATCH_NOT_FOUND',
        reconciliationBatchId,
        message: 'Lote de reconciliação não encontrado.',
      }],
      violations: [],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }
  if (batch.status !== 'COMPLETE') {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate: batch.logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'RECONCILIATION_BATCH_INVALIDATED',
        reconciliationBatchId,
        message: 'Lote de reconciliação está invalidado.',
      }],
      violations: [],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }

  const logicalDate = batch.logicalDate;
  let expectedHorizonStart: CivilDate;
  try {
    expectedHorizonStart = addCivilDays(logicalDate, 1);
  } catch {
    return {
      status: 'INVALID',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [],
      violations: [{
        code: 'DATE_INVALID',
        entityType: 'reconciliationBatch',
        entityId: batch.id,
        field: 'logicalDate',
        message: 'Não existe dia civil representável após a data reconciliada.',
      }],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }
  if (horizonStart <= logicalDate) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'FORECAST_START_NOT_AFTER_RECONCILIATION',
        reconciliationBatchId,
        message: 'Com granularidade diária, o forecast deve começar no dia posterior ao instante reconciliado.',
      }],
      violations: [],
      warnings: [{ code: 'DAILY_GRANULARITY_ONLY' }],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }
  if (horizonStart !== expectedHorizonStart) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'FORECAST_START_NOT_CONTIGUOUS_WITH_RECONCILIATION',
        reconciliationBatchId,
        message: `O forecast precisa começar em ${expectedHorizonStart} para não pular movimentos entre a reconciliação e o horizonte.`,
      }],
      violations: [],
      warnings: [{ code: 'DAILY_GRANULARITY_ONLY' }],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }

  const activeAccounts = state.accounts.filter((account) => account.active);
  if (activeAccounts.length === 0) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'ACTIVE_ACCOUNT_NOT_FOUND',
        reconciliationBatchId,
        message: 'Não há conta ativa para projetar.',
      }],
      violations: [],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }
  const snapshots = state.balanceSnapshots.filter((snapshot) => snapshot.reconciliationBatchId === batch.id);
  const snapshotByAccount = new Map(snapshots.map((snapshot) => [snapshot.accountId, snapshot]));
  const missingAccountIds = activeAccounts
    .filter((account) => !snapshotByAccount.has(account.id))
    .map((account) => account.id);

  if (missingAccountIds.length > 0) {
    return {
      status: 'INCOMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate: batch.logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [{
        code: 'ACTIVE_ACCOUNT_SNAPSHOT_MISSING',
        accountIds: missingAccountIds,
        reconciliationBatchId,
        message: 'Há contas ativas sem snapshot no lote selecionado.',
      }],
      violations: [],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }

  try {
    const { movements, overdueEventIds } = expandEvents(state, logicalDate, horizonStart, horizonEnd);
  const byAccount = activeAccounts.map((account) => buildAccountForecast(
    account.id,
    account.currency,
    snapshotByAccount.get(account.id)!.balanceCents,
    movements,
    logicalDate,
    horizonStart,
    horizonEnd,
  ));

  const currencies = [...new Set(activeAccounts.map((account) => account.currency))];
  const consolidatedByCurrency = currencies.map((currency) =>
    consolidateCurrency(currency, byAccount, logicalDate, horizonStart, horizonEnd),
  );

  const warnings: ForecastResult['warnings'] = [{ code: 'DAILY_GRANULARITY_ONLY' }];
  for (const overdue of overdueEventIds) {
    warnings.push({ code: 'OVERDUE_PLANNED_EVENT', eventId: overdue.id, dueDate: overdue.dueDate });
  }
  for (const account of byAccount) {
    if (account.minimumProjectedBalanceCents < 0) {
      warnings.push({
        code: 'ACCOUNT_PROJECTED_NEGATIVE',
        accountId: account.accountId,
        date: account.minimumProjectedBalanceDate,
        balanceCents: account.minimumProjectedBalanceCents,
      });
    }
  }

    return {
      status: 'COMPLETE',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate: batch.logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency,
      byAccount,
      blockers: [],
      violations: [],
      warnings,
      guarantees: [
        'STATE_SCHEMA_VALID',
        'DOMAIN_INVARIANTS_VALID',
        'ALL_ACTIVE_ACCOUNTS_RECONCILED',
        'SNAPSHOTS_SHARE_RECONCILIATION_BATCH',
        'ACCOUNT_CURRENCIES_MATCH',
        'EVENT_DATES_VALID',
        'EVENT_ACCOUNT_REFERENCES_VALID',
        'RECURRENCES_VALID_AND_BOUNDED',
        'TRANSFERS_BALANCED',
        'CURRENCIES_NOT_AGGREGATED',
        'ACCOUNT_FORECASTS_PRESERVED',
      ],
    };
  } catch (error) {
    if (!(error instanceof MonetaryArithmeticError) && !(error instanceof CivilDateArithmeticError)) throw error;
    const arithmetic = error instanceof MonetaryArithmeticError;
    return {
      status: 'INVALID',
      reconciliationBatchId,
      logicalAsOf: batch.logicalAsOf,
      logicalDate: batch.logicalDate,
      horizonStart,
      horizonEnd,
      consolidatedByCurrency: [],
      byAccount: [],
      blockers: [],
      violations: [{
        code: arithmetic ? 'ARITHMETIC_OVERFLOW' : 'DATE_INVALID',
        entityType: 'forecast',
        message: arithmetic
          ? 'A projeção excedeu o limite monetário seguro.'
          : 'A projeção excedeu o intervalo de datas civis suportado.',
      }],
      warnings: [],
      guarantees: ['STATE_SCHEMA_VALID', 'DOMAIN_INVARIANTS_VALID'],
    };
  }
}
