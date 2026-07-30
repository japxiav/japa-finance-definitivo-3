
import { canAddCents } from './arithmetic';
import { civilDateFromUtcInstant, civilDaysBetween, isCivilDate, isInstantTimestamp } from './dates';
import type {
  DomainViolation,
  FinancialState,
  PlannedEvent,
  RecurrenceRule,
} from './model';

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function schemaViolation(violations: DomainViolation[], entityType: string, entityId: string | undefined, field: string, message: string) {
  violations.push({ code: 'SCHEMA_INVALID', entityType, entityId, field, message });
}

function pushDuplicateViolations(
  values: Array<{ id: string }>,
  entityType: string,
  violations: DomainViolation[],
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!nonEmptyString(value.id)) {
      schemaViolation(violations, entityType, undefined, 'id', `ID ausente ou vazio em ${entityType}.`);
      continue;
    }
    if (seen.has(value.id)) {
      violations.push({
        code: 'DUPLICATE_ID',
        entityType,
        entityId: value.id,
        message: `ID duplicado em ${entityType}: ${value.id}`,
      });
    }
    seen.add(value.id);
  }
}

function validMoney(value: number, allowZero: boolean): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function validateRecurrence(
  event: PlannedEvent,
  recurrence: RecurrenceRule,
  violations: DomainViolation[],
) {
  if (!oneOf(recurrence.frequency, ['weekly', 'monthly', 'yearly'] as const)) {
    violations.push({
      code: 'RECURRENCE_INVALID',
      entityType: 'plannedEvent',
      entityId: event.id,
      field: 'recurrence.frequency',
      message: 'Frequência de recorrência é inválida.',
    });
  }
  if (!Number.isSafeInteger(recurrence.interval) || recurrence.interval <= 0 || recurrence.interval > 10_000) {
    violations.push({
      code: 'RECURRENCE_INVALID',
      entityType: 'plannedEvent',
      entityId: event.id,
      field: 'recurrence.interval',
      message: 'Intervalo de recorrência deve ser inteiro positivo e não exceder 10.000.',
    });
  }
  if (recurrence.until && !isCivilDate(recurrence.until)) {
    violations.push({
      code: 'DATE_INVALID',
      entityType: 'plannedEvent',
      entityId: event.id,
      field: 'recurrence.until',
      message: 'Data final de recorrência inválida.',
    });
  }
  if (recurrence.until && recurrence.until < event.dueDate) {
    violations.push({
      code: 'RECURRENCE_INVALID',
      entityType: 'plannedEvent',
      entityId: event.id,
      field: 'recurrence.until',
      message: 'Data final de recorrência não pode preceder o primeiro vencimento.',
    });
  }
  if (
    recurrence.maxOccurrences !== undefined &&
    (!Number.isSafeInteger(recurrence.maxOccurrences) ||
      recurrence.maxOccurrences <= 0 ||
      recurrence.maxOccurrences > 10_000)
  ) {
    violations.push({
      code: 'RECURRENCE_INVALID',
      entityType: 'plannedEvent',
      entityId: event.id,
      field: 'recurrence.maxOccurrences',
      message: 'Limite de ocorrências deve estar entre 1 e 10.000.',
    });
  }
}

export function validateFinancialState(state: FinancialState): DomainViolation[] {
  const violations: DomainViolation[] = [];
  const entityGroups = [
    ['account', state.accounts],
    ['reconciliationBatch', state.reconciliationBatches],
    ['snapshot', state.balanceSnapshots],
    ['reservePolicy', state.reservePolicies],
    ['plannedEvent', state.plannedEvents],
    ['plannedTransfer', state.plannedTransfers],
  ] as const;

  for (const [name, values] of entityGroups) pushDuplicateViolations(values, name, violations);

  for (const account of state.accounts) {
    if (!nonEmptyString(account.name)) schemaViolation(violations, 'account', account.id, 'name', 'Conta precisa ter nome.');
    if (!nonEmptyString(account.currency)) schemaViolation(violations, 'account', account.id, 'currency', 'Conta precisa ter moeda.');
    if (typeof account.active !== 'boolean') schemaViolation(violations, 'account', account.id, 'active', 'Estado ativo da conta precisa ser booleano.');
  }

  const accounts = new Map(state.accounts.map((account) => [account.id, account]));
  const batches = new Map(state.reconciliationBatches.map((batch) => [batch.id, batch]));

  for (const batch of state.reconciliationBatches) {
    if (!oneOf(batch.source, ['manual', 'import', 'system'] as const)) {
      schemaViolation(violations, 'reconciliationBatch', batch.id, 'source', 'Origem do lote é inválida.');
    }
    if (!oneOf(batch.status, ['COMPLETE', 'INVALIDATED'] as const)) {
      schemaViolation(violations, 'reconciliationBatch', batch.id, 'status', 'Estado do lote é inválido.');
    }
    if (!isCivilDate(batch.logicalDate)) {
      violations.push({
        code: 'DATE_INVALID',
        entityType: 'reconciliationBatch',
        entityId: batch.id,
        field: 'logicalDate',
        message: 'Data civil da reconciliação é inválida.',
      });
    }
    if (!isInstantTimestamp(batch.logicalAsOf)) {
      violations.push({
        code: 'TIMESTAMP_INVALID',
        entityType: 'reconciliationBatch',
        entityId: batch.id,
        field: 'logicalAsOf',
        message: 'logicalAsOf precisa ser timestamp ISO UTC canônico.',
      });
    }
    if (!isInstantTimestamp(batch.createdAt)) {
      violations.push({
        code: 'TIMESTAMP_INVALID',
        entityType: 'reconciliationBatch',
        entityId: batch.id,
        field: 'createdAt',
        message: 'createdAt precisa ser timestamp ISO UTC canônico.',
      });
    }
    if (
      isInstantTimestamp(batch.logicalAsOf) &&
      isInstantTimestamp(batch.createdAt) &&
      batch.logicalAsOf > batch.createdAt
    ) {
      violations.push({
        code: 'TIMESTAMP_INVALID',
        entityType: 'reconciliationBatch',
        entityId: batch.id,
        field: 'logicalAsOf',
        message: 'logicalAsOf não pode estar depois de createdAt.',
      });
    }
    if (isCivilDate(batch.logicalDate) && isInstantTimestamp(batch.logicalAsOf)) {
      const utcDate = civilDateFromUtcInstant(batch.logicalAsOf);
      if (Math.abs(civilDaysBetween(utcDate, batch.logicalDate)) > 1) {
        violations.push({
          code: 'DATE_INVALID',
          entityType: 'reconciliationBatch',
          entityId: batch.id,
          field: 'logicalDate',
          message: 'Data civil da reconciliação é incoerente com o instante lógico.',
        });
      }
    }
  }

  const snapshotKeys = new Set<string>();
  for (const snapshot of state.balanceSnapshots) {
    if (!nonEmptyString(snapshot.accountId)) schemaViolation(violations, 'snapshot', snapshot.id, 'accountId', 'Snapshot precisa referenciar conta.');
    if (!nonEmptyString(snapshot.currency)) schemaViolation(violations, 'snapshot', snapshot.id, 'currency', 'Snapshot precisa ter moeda.');
    if (!nonEmptyString(snapshot.reconciliationBatchId)) schemaViolation(violations, 'snapshot', snapshot.id, 'reconciliationBatchId', 'Snapshot precisa referenciar lote.');
    const account = accounts.get(snapshot.accountId);
    const batch = batches.get(snapshot.reconciliationBatchId);
    if (!account) {
      violations.push({
        code: 'ACCOUNT_REFERENCE_INVALID',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'accountId',
        message: 'Snapshot referencia conta inexistente.',
      });
    } else if (account.currency !== snapshot.currency) {
      violations.push({
        code: 'ACCOUNT_CURRENCY_MISMATCH',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'currency',
        message: 'Moeda do snapshot difere da moeda da conta.',
      });
    }
    if (!batch) {
      violations.push({
        code: 'BATCH_REFERENCE_INVALID',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'reconciliationBatchId',
        message: 'Snapshot referencia lote inexistente.',
      });
    } else if (batch.status === 'INVALIDATED') {
      violations.push({
        code: 'BATCH_INVALIDATED',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'reconciliationBatchId',
        message: 'Snapshot pertence a lote invalidado.',
      });
    }
    if ((snapshot as { reconciled?: unknown }).reconciled !== true) {
      violations.push({
        code: 'SNAPSHOT_NOT_RECONCILED',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'reconciled',
        message: 'Snapshot precisa estar explicitamente reconciliado.',
      });
    }
    if (!Number.isSafeInteger(snapshot.balanceCents)) {
      violations.push({
        code: 'AMOUNT_INVALID',
        entityType: 'snapshot',
        entityId: snapshot.id,
        field: 'balanceCents',
        message: 'Saldo precisa ser inteiro seguro; saldos negativos são permitidos.',
      });
    }
    const key = `${snapshot.reconciliationBatchId}:${snapshot.accountId}`;
    if (snapshotKeys.has(key)) {
      violations.push({
        code: 'DUPLICATE_BATCH_SNAPSHOT',
        entityType: 'snapshot',
        entityId: snapshot.id,
        message: 'Existe mais de um snapshot da mesma conta no mesmo lote.',
      });
    }
    snapshotKeys.add(key);
  }

  const policyCurrencies = new Set<string>();
  for (const policy of state.reservePolicies) {
    if (!nonEmptyString(policy.currency)) schemaViolation(violations, 'reservePolicy', policy.id, 'currency', 'Política de reserva precisa ter moeda.');
    if (!isInstantTimestamp(policy.updatedAt)) {
      violations.push({ code: 'TIMESTAMP_INVALID', entityType: 'reservePolicy', entityId: policy.id, field: 'updatedAt', message: 'Atualização da reserva precisa ser timestamp ISO UTC canônico.' });
    }
    if (policyCurrencies.has(policy.currency)) {
      violations.push({
        code: 'DUPLICATE_RESERVE_POLICY',
        entityType: 'reservePolicy',
        entityId: policy.id,
        message: `Existe mais de uma política de reserva para ${policy.currency}.`,
      });
    }
    policyCurrencies.add(policy.currency);
    if (!validMoney(policy.minimumCents, true) ||
      (policy.targetCents !== undefined && !validMoney(policy.targetCents, true))) {
      violations.push({
        code: 'AMOUNT_INVALID',
        entityType: 'reservePolicy',
        entityId: policy.id,
        message: 'Valores de reserva precisam ser inteiros seguros não negativos.',
      });
    }
    if (policy.targetCents !== undefined && policy.targetCents < policy.minimumCents) {
      violations.push({
        code: 'AMOUNT_INVALID',
        entityType: 'reservePolicy',
        entityId: policy.id,
        field: 'targetCents',
        message: 'Reserva alvo não pode ser inferior à reserva mínima.',
      });
    }
  }

  for (const event of state.plannedEvents) {
    if (!nonEmptyString(event.title)) schemaViolation(violations, 'plannedEvent', event.id, 'title', 'Evento precisa ter título.');
    if (!nonEmptyString(event.accountId)) schemaViolation(violations, 'plannedEvent', event.id, 'accountId', 'Evento precisa referenciar conta.');
    if (!nonEmptyString(event.currency)) schemaViolation(violations, 'plannedEvent', event.id, 'currency', 'Evento precisa ter moeda.');
    if (!oneOf(event.kind, ['income', 'expense', 'installment'] as const)) schemaViolation(violations, 'plannedEvent', event.id, 'kind', 'Tipo de evento é inválido.');
    if (!oneOf(event.status, ['active', 'completed', 'cancelled', 'overdue'] as const)) schemaViolation(violations, 'plannedEvent', event.id, 'status', 'Estado de evento é inválido.');
    if (!oneOf(event.evidenceLevel, ['confirmed', 'planned', 'estimated'] as const)) schemaViolation(violations, 'plannedEvent', event.id, 'evidenceLevel', 'Nível de evidência é inválido.');
    const account = accounts.get(event.accountId);
    if (!account) {
      violations.push({
        code: 'ACCOUNT_REFERENCE_INVALID',
        entityType: 'plannedEvent',
        entityId: event.id,
        field: 'accountId',
        message: 'Evento referencia conta inexistente.',
      });
    } else if (account.currency !== event.currency) {
      violations.push({
        code: 'ACCOUNT_CURRENCY_MISMATCH',
        entityType: 'plannedEvent',
        entityId: event.id,
        field: 'currency',
        message: 'Moeda do evento difere da moeda da conta.',
      });
    }
    if (!validMoney(event.amountCents, false)) {
      violations.push({
        code: 'AMOUNT_INVALID',
        entityType: 'plannedEvent',
        entityId: event.id,
        field: 'amountCents',
        message: 'Evento precisa ter valor inteiro positivo.',
      });
    }
    if (!isCivilDate(event.dueDate)) {
      violations.push({
        code: 'DATE_INVALID',
        entityType: 'plannedEvent',
        entityId: event.id,
        field: 'dueDate',
        message: 'Vencimento do evento é inválido.',
      });
    }
    if (event.recurrence) validateRecurrence(event, event.recurrence, violations);
  }

  for (const transfer of state.plannedTransfers) {
    if (!nonEmptyString(transfer.title)) schemaViolation(violations, 'plannedTransfer', transfer.id, 'title', 'Transferência precisa ter título.');
    if (!nonEmptyString(transfer.sourceAccountId) || !nonEmptyString(transfer.destinationAccountId)) schemaViolation(violations, 'plannedTransfer', transfer.id, 'accountId', 'Transferência precisa ter origem e destino.');
    if (!oneOf(transfer.status, ['active', 'cancelled'] as const)) schemaViolation(violations, 'plannedTransfer', transfer.id, 'status', 'Estado da transferência é inválido.');
    if (!oneOf(transfer.evidenceLevel, ['confirmed', 'planned', 'estimated'] as const)) schemaViolation(violations, 'plannedTransfer', transfer.id, 'evidenceLevel', 'Nível de evidência da transferência é inválido.');
    const source = accounts.get(transfer.sourceAccountId);
    const destination = accounts.get(transfer.destinationAccountId);
    if (!source || !destination) {
      violations.push({
        code: 'ACCOUNT_REFERENCE_INVALID',
        entityType: 'plannedTransfer',
        entityId: transfer.id,
        message: 'Transferência referencia conta inexistente.',
      });
    } else {
      if (source.id === destination.id) {
        violations.push({
          code: 'TRANSFER_SAME_ACCOUNT',
          entityType: 'plannedTransfer',
          entityId: transfer.id,
          message: 'Origem e destino da transferência precisam ser diferentes.',
        });
      }
      if (source.currency !== destination.currency) {
        violations.push({
          code: 'FX_TRANSFER_UNSUPPORTED',
          entityType: 'plannedTransfer',
          entityId: transfer.id,
          message: 'Transferência cambial não é suportada nesta release.',
        });
      }
    }
    if (!validMoney(transfer.amountCents, false) || !validMoney(transfer.feeCents, true)) {
      violations.push({
        code: 'AMOUNT_INVALID',
        entityType: 'plannedTransfer',
        entityId: transfer.id,
        message: 'Valor precisa ser positivo e taxa não negativa.',
      });
    } else if (!canAddCents(transfer.amountCents, transfer.feeCents)) {
      violations.push({
        code: 'ARITHMETIC_OVERFLOW',
        entityType: 'plannedTransfer',
        entityId: transfer.id,
        message: 'Valor somado à taxa excede o limite monetário seguro.',
      });
    }
    if (!isCivilDate(transfer.dueDate)) {
      violations.push({
        code: 'DATE_INVALID',
        entityType: 'plannedTransfer',
        entityId: transfer.id,
        field: 'dueDate',
        message: 'Data da transferência é inválida.',
      });
    }
  }

  return violations;
}
