import { addCents } from './arithmetic';
import { expandPlannedEventOccurrences } from './recurrence';
import type {
  CivilDate,
  EvidenceLevel,
  FinancialState,
} from './model';

export interface PendingMovement {
  id: string;
  referenceId: string;
  title: string;
  kind: 'PLANNED_EVENT' | 'TRANSFER';
  accountId: string;
  currency: string;
  dueDate: CivilDate;
  amountCents: number;
  direction: 'outflow';
  evidenceLevel: EvidenceLevel;
}

/**
 * Obrigações ainda ativas vencidas até o dia lógico reconciliado.
 *
 * O snapshot é autoritativo para tudo que já entrou na conta. Como eventos
 * não possuem horário nem confirmação por ocorrência, uma receita do mesmo
 * dia ou vencida jamais pode ser reaplicada depois da reconciliação: isso
 * criaria dinheiro fantasma. Saídas ainda ativas são mantidas de forma
 * conservadora, pois representam obrigações que o usuário ainda não marcou
 * como concluídas/canceladas.
 *
 * Para transferências vencidas, somente a saída da origem é presumida. A
 * entrada no destino não é usada para aprovar decisões enquanto não houver
 * confirmação de execução.
 */
export function pendingMovementsThroughLogicalDate(
  state: FinancialState,
  logicalDate: CivilDate,
): PendingMovement[] {
  const movements: PendingMovement[] = [];

  // Ocorrências exatamente no dia reconciliado. Rendas são excluídas por
  // política conservadora; despesas/parcelas ainda ativas permanecem devidas.
  for (const occurrence of expandPlannedEventOccurrences(
    state.plannedEvents,
    logicalDate,
    logicalDate,
  )) {
    const event = occurrence.event;
    if (event.kind === 'income') continue;
    movements.push({
      id: occurrence.occurrenceId,
      referenceId: event.recurrence ? occurrence.occurrenceId : event.id,
      title: event.title,
      kind: 'PLANNED_EVENT',
      accountId: event.accountId,
      currency: event.currency,
      dueDate: occurrence.date,
      amountCents: event.amountCents,
      direction: 'outflow',
      evidenceLevel: event.evidenceLevel,
    });
  }

  // Compromissos não recorrentes vencidos antes do dia reconciliado.
  for (const event of state.plannedEvents) {
    if (
      event.recurrence ||
      (event.status !== 'active' && event.status !== 'overdue') ||
      event.kind === 'income' ||
      event.dueDate >= logicalDate
    ) continue;

    movements.push({
      id: `${event.id}@overdue:${event.dueDate}`,
      referenceId: event.id,
      title: event.title,
      kind: 'PLANNED_EVENT',
      accountId: event.accountId,
      currency: event.currency,
      dueDate: event.dueDate,
      amountCents: event.amountCents,
      direction: 'outflow',
      evidenceLevel: event.evidenceLevel,
    });
  }

  const accounts = new Map(state.accounts.map((account) => [account.id, account]));
  for (const transfer of state.plannedTransfers) {
    if (transfer.status !== 'active' || transfer.dueDate > logicalDate) continue;
    const source = accounts.get(transfer.sourceAccountId);
    if (!source) continue;
    movements.push({
      id: `${transfer.id}:source:pending`,
      referenceId: transfer.id,
      title: transfer.title,
      kind: 'TRANSFER',
      accountId: transfer.sourceAccountId,
      currency: source.currency,
      dueDate: transfer.dueDate,
      amountCents: addCents(transfer.amountCents, transfer.feeCents),
      direction: 'outflow',
      evidenceLevel: transfer.evidenceLevel,
    });
  }

  return movements;
}

export function pendingAccountFlowsThroughLogicalDate(
  state: FinancialState,
  accountId: string,
  logicalDate: CivilDate,
): { inflowCents: 0; outflowCents: number } {
  let outflowCents = 0;
  for (const movement of pendingMovementsThroughLogicalDate(state, logicalDate)) {
    if (movement.accountId !== accountId) continue;
    outflowCents = addCents(outflowCents, movement.amountCents);
  }
  return { inflowCents: 0, outflowCents };
}
