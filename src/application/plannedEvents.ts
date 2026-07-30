import type { Account, PlannedEvent } from '../core/types';
import { isCivilDate, isInstantTimestamp } from '../domain/dates';

export function createPlannedEventForAccount(input: {
  accounts: Account[];
  accountId: string;
  title: string;
  kind: 'income' | 'expense';
  amountCents: number;
  currency: string;
  dueDate: string;
  now: string;
  id: string;
}): PlannedEvent {
  const account = input.accounts.find((item) =>
    item.id === input.accountId && item.active && item.currency === input.currency,
  );
  if (!account) throw new Error('PLANNED_EVENT_ACCOUNT_REQUIRED');
  if (!input.id.trim()) throw new Error('PLANNED_EVENT_ID_REQUIRED');
  if (!input.title.trim()) throw new Error('PLANNED_EVENT_TITLE_REQUIRED');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('PLANNED_EVENT_AMOUNT_INVALID');
  }
  if (!isCivilDate(input.dueDate)) throw new Error('PLANNED_EVENT_DATE_INVALID');
  if (!isInstantTimestamp(input.now)) throw new Error('PLANNED_EVENT_TIMESTAMP_INVALID');

  return {
    id: input.id.trim(),
    title: input.title.trim(),
    kind: input.kind,
    direction: input.kind === 'income' ? 'inflow' : 'outflow',
    amountCents: input.amountCents,
    currency: input.currency,
    dueDate: input.dueDate,
    accountId: account.id,
    active: true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
