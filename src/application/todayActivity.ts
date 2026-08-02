import type { AppState, Transaction } from '../core/types';
import { addCents } from '../domain/arithmetic';
import { signedNetMovement } from '../core/finance';

export interface TodayActivityBucket {
  key: 'external_inflow' | 'external_outflow' | 'internal' | 'conversion' | 'fees' | 'pending';
  label: string;
  amountCents: number;
  transactionIds: string[];
}

export interface TodayActivity {
  date: string;
  currency: string;
  externalNetCents: number;
  pendingNetCents: number;
  buckets: TodayActivityBucket[];
  latestImportedDate?: string;
  hasDataForToday: boolean;
}

function add(map: Map<TodayActivityBucket['key'], TodayActivityBucket>, key: TodayActivityBucket['key'], label: string, transaction: Transaction, amount: number) {
  const current = map.get(key) ?? { key, label, amountCents: 0, transactionIds: [] };
  current.amountCents = addCents(current.amountCents, amount);
  current.transactionIds.push(transaction.id);
  map.set(key, current);
}

export function buildTodayActivity(state: AppState, currency: string, date: string): TodayActivity {
  const rows = state.transactions.filter((transaction) => transaction.currency === currency
    && transaction.reportingDate === date
    && transaction.status !== 'voided'
    && transaction.status !== 'merged');
  const map = new Map<TodayActivityBucket['key'], TodayActivityBucket>();

  for (const transaction of rows) {
    const movement = transaction.status === 'pending'
      ? (transaction.availableImpactCents ?? transaction.reportedAmountCents ?? (transaction.direction === 'inflow' ? transaction.amountCents : -transaction.amountCents))
      : signedNetMovement(transaction);
    if (transaction.status === 'pending') {
      add(map, 'pending', 'Pendentes', transaction, movement);
      continue;
    }
    if (transaction.status !== 'completed') continue;
    if (transaction.technicalType === 'bank_fee') add(map, 'fees', 'Taxas', transaction, movement);
    else if (transaction.technicalType === 'currency_conversion') add(map, 'conversion', 'Conversões', transaction, movement);
    else if (transaction.technicalType === 'internal_transfer' || transaction.analysisExcluded) add(map, 'internal', 'Transferências internas', transaction, movement);
    else if (movement >= 0) add(map, 'external_inflow', 'Entradas externas', transaction, movement);
    else add(map, 'external_outflow', 'Saídas externas', transaction, movement);
  }

  const buckets = [...map.values()];
  const externalNetCents = buckets
    .filter((bucket) => bucket.key === 'external_inflow' || bucket.key === 'external_outflow')
    .reduce((sum, bucket) => addCents(sum, bucket.amountCents), 0);
  const pendingNetCents = map.get('pending')?.amountCents ?? 0;
  const latestImportedDate = state.transactions
    .filter((transaction) => transaction.currency === currency && transaction.status !== 'voided')
    .map((transaction) => transaction.reportingDate)
    .sort()
    .at(-1);
  return { date, currency, externalNetCents, pendingNetCents, buckets, latestImportedDate, hasDataForToday: rows.length > 0 };
}
