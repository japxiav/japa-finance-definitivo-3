import { addCivilDays, addCivilMonths, addCivilYears, civilDaysBetween, isCivilDate } from './dates';
import type { CivilDate, PlannedEvent } from './model';

const MAX_EXPANDED_OCCURRENCES_PER_EVENT = 10_000;

function occurrenceAt(event: PlannedEvent, index: number): CivilDate | undefined {
  const recurrence = event.recurrence!;
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const step = recurrence.interval * index;
  if (!Number.isSafeInteger(step)) return undefined;
  try {
    const date = recurrence.frequency === 'weekly'
      ? addCivilDays(event.dueDate, step * 7)
      : recurrence.frequency === 'monthly'
        ? addCivilMonths(event.dueDate, step)
        : addCivilYears(event.dueDate, step);
    return isCivilDate(date) ? date : undefined;
  } catch {
    // Uma ocorrência além do intervalo civil suportado jamais poderá cair
    // dentro de um horizonte válido de quatro dígitos. Encerramos a expansão
    // em vez de permitir que Date/ISO lance RangeError e derrube a decisão.
    return undefined;
  }
}

function estimatedStartIndex(event: PlannedEvent, horizonStart: CivilDate): number {
  if (!event.recurrence || event.dueDate >= horizonStart) return 0;
  const interval = event.recurrence.interval;
  if (event.recurrence.frequency === 'weekly') {
    return Math.max(0, Math.floor(civilDaysBetween(event.dueDate, horizonStart) / (interval * 7)));
  }

  const [dueYear, dueMonth] = event.dueDate.split('-').map(Number);
  const [startYear, startMonth] = horizonStart.split('-').map(Number);
  const units = event.recurrence.frequency === 'monthly'
    ? (startYear! - dueYear!) * 12 + (startMonth! - dueMonth!)
    : startYear! - dueYear!;
  return Math.max(0, Math.floor(units / interval));
}

/**
 * Localiza a primeira ocorrência que não antecede o horizonte sem percorrer
 * toda a história do evento. A implementação anterior limitava o índice total
 * a 10.000 e podia simplesmente apagar um salário mensal antigo do forecast.
 */
function firstIndexOnOrAfter(event: PlannedEvent, horizonStart: CivilDate): number | undefined {
  const recurrence = event.recurrence!;
  const totalLimit = recurrence.maxOccurrences;
  let index = estimatedStartIndex(event, horizonStart);
  if (totalLimit !== undefined && index >= totalLimit) return undefined;

  // A estimativa pode cair uma ocorrência antes por causa de meses curtos.
  while (index > 0) {
    const previous = occurrenceAt(event, index - 1);
    if (!previous || previous < horizonStart) break;
    index -= 1;
  }

  while (true) {
    if (totalLimit !== undefined && index >= totalLimit) return undefined;
    const date = occurrenceAt(event, index);
    if (!date) return undefined;
    if (date >= horizonStart) return index;
    index += 1;
  }
}

export interface ExpandedOccurrence {
  event: PlannedEvent;
  occurrenceId: string;
  date: CivilDate;
}

export function expandPlannedEventOccurrences(
  events: PlannedEvent[],
  horizonStart: CivilDate,
  horizonEnd: CivilDate,
): ExpandedOccurrence[] {
  const result: ExpandedOccurrence[] = [];
  for (const event of events) {
    if (event.status === 'cancelled' || event.status === 'completed') continue;
    if (!event.recurrence) {
      if (event.dueDate >= horizonStart && event.dueDate <= horizonEnd) {
        result.push({ event, occurrenceId: `${event.id}@${event.dueDate}`, date: event.dueDate });
      }
      continue;
    }

    const firstIndex = firstIndexOnOrAfter(event, horizonStart);
    if (firstIndex === undefined) continue;
    const totalLimit = event.recurrence.maxOccurrences;
    let emitted = 0;
    for (let index = firstIndex; emitted < MAX_EXPANDED_OCCURRENCES_PER_EVENT; index += 1) {
      if (totalLimit !== undefined && index >= totalLimit) break;
      const date = occurrenceAt(event, index);
      if (!date) break;
      if (event.recurrence.until && date > event.recurrence.until) break;
      if (date > horizonEnd) break;
      result.push({ event, occurrenceId: `${event.id}@${date}`, date });
      emitted += 1;
    }
  }
  return result.sort((left, right) =>
    left.date.localeCompare(right.date) || left.occurrenceId.localeCompare(right.occurrenceId));
}
