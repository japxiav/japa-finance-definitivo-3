import type { AppState, Institution, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { buildFinancialRelationships } from './financialRelationships';

export type FinancialHistoryEventType = 'account' | 'relationship' | 'spending' | 'income' | 'conversion' | 'position';

export interface FinancialHistoryEvent {
  id: string;
  date: string;
  month: string;
  type: FinancialHistoryEventType;
  title: string;
  detail: string;
  evidence: string[];
  transactionIds: string[];
  accountIds: string[];
  importance: number;
}

function completed(state: AppState, currency: string): Transaction[] {
  return state.transactions.filter((item) => item.status === 'completed' && item.currency === currency)
    .sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
}

function institutionLabel(institution: Institution): string {
  if (institution === 'revolut') return 'Revolut';
  if (institution === 'wise') return 'Wise';
  if (institution === 'cash') return 'Dinheiro';
  return 'Outra instituição';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

export function buildFinancialHistory(state: AppState, currency: string): FinancialHistoryEvent[] {
  const rows = completed(state, currency);
  if (!rows.length) return [];
  const events: FinancialHistoryEvent[] = [];
  const accountById = new Map(state.accounts.map((item) => [item.id, item]));

  const firstByInstitution = new Map<Institution, Transaction>();
  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account || firstByInstitution.has(account.institution)) continue;
    firstByInstitution.set(account.institution, row);
    events.push({
      id: `first-institution:${currency}:${account.institution}`,
      date: row.reportingDate,
      month: row.reportingDate.slice(0, 7),
      type: 'account',
      title: `Primeiro movimento reconhecido na ${institutionLabel(account.institution)}`,
      detail: `O histórico em ${currency} começa a usar ${account.name} nesta data.`,
      evidence: [`Movimentação ${row.id}`, row.friendlyDescription ?? row.descriptionOriginal],
      transactionIds: [row.id],
      accountIds: [row.accountId],
      importance: 70,
    });
  }

  const monthlyInstitutions = new Map<string, Map<Institution, { count: number; volume: number; ids: string[]; accounts: Set<string> }>>();
  for (const row of rows) {
    const account = accountById.get(row.accountId);
    if (!account) continue;
    const month = row.reportingDate.slice(0, 7);
    const monthMap = monthlyInstitutions.get(month) ?? new Map();
    const current = monthMap.get(account.institution) ?? { count: 0, volume: 0, ids: [], accounts: new Set<string>() };
    current.count += 1;
    current.volume += Math.abs(signedNetMovement(row));
    current.ids.push(row.id);
    current.accounts.add(row.accountId);
    monthMap.set(account.institution, current);
    monthlyInstitutions.set(month, monthMap);
  }
  let previousLeader: Institution | undefined;
  for (const month of [...monthlyInstitutions.keys()].sort()) {
    const leader = [...monthlyInstitutions.get(month)!.entries()]
      .filter(([, value]) => value.count >= 5)
      .sort((a, b) => b[1].count - a[1].count || b[1].volume - a[1].volume)[0];
    if (!leader) continue;
    if (previousLeader && leader[0] !== previousLeader) {
      events.push({
        id: `institution-shift:${currency}:${month}:${leader[0]}`,
        date: `${month}-01`,
        month,
        type: 'account',
        title: `${institutionLabel(leader[0])} virou a instituição mais usada`,
        detail: `${leader[1].count} movimentos foram registrados nela no mês. A mudança descreve uso, não presume o motivo.`,
        evidence: [`Instituição anterior: ${institutionLabel(previousLeader)}`, `Instituição atual: ${institutionLabel(leader[0])}`],
        transactionIds: leader[1].ids.slice(0, 20),
        accountIds: [...leader[1].accounts],
        importance: 88,
      });
    }
    previousLeader = leader[0];
  }

  const relationships = buildFinancialRelationships(state, currency);
  const incomingByMonth = new Map<string, Map<string, { name: string; cents: number; ids: string[] }>>();
  const relationshipByTransaction = new Map<string, typeof relationships[number]>();
  for (const relationship of relationships) for (const id of relationship.transactionIds) relationshipByTransaction.set(id, relationship);
  for (const row of rows.filter((item) => item.technicalType === 'incoming_transfer')) {
    const relationship = relationshipByTransaction.get(row.id);
    if (!relationship) continue;
    const month = row.reportingDate.slice(0, 7);
    const monthMap = incomingByMonth.get(month) ?? new Map();
    const current = monthMap.get(relationship.key) ?? { name: relationship.displayName, cents: 0, ids: [] };
    current.cents += Math.abs(signedNetMovement(row));
    current.ids.push(row.id);
    monthMap.set(relationship.key, current);
    incomingByMonth.set(month, monthMap);
  }
  let previousIncomingKey: string | undefined;
  let previousIncomingName: string | undefined;
  for (const month of [...incomingByMonth.keys()].sort()) {
    const leader = [...incomingByMonth.get(month)!.entries()].sort((a, b) => b[1].cents - a[1].cents)[0];
    if (!leader) continue;
    if (previousIncomingKey && leader[0] !== previousIncomingKey && leader[1].ids.length >= 2) {
      events.push({
        id: `incoming-source-shift:${currency}:${month}:${leader[0]}`,
        date: `${month}-01`,
        month,
        type: 'relationship',
        title: `${leader[1].name} passou a ser a principal origem de transferências recebidas`,
        detail: `No mês anterior, a principal origem era ${previousIncomingName}. O app registra a troca e deixa o significado para uma anotação opcional.`,
        evidence: [`Origem anterior: ${previousIncomingName}`, `Nova origem: ${leader[1].name}`],
        transactionIds: leader[1].ids,
        accountIds: [],
        importance: 90,
      });
    }
    previousIncomingKey = leader[0];
    previousIncomingName = leader[1].name;
  }

  const expenses = rows.filter((item) => !item.analysisExcluded && ['card_payment', 'direct_debit', 'other_expense'].includes(item.technicalType));
  const expenseAmounts = expenses.map((item) => Math.abs(signedNetMovement(item))).filter((value) => value > 0);
  const typical = median(expenseAmounts);
  const largeThreshold = Math.max(currency === 'EUR' ? 25_000 : 100_000, typical * 6);
  for (const row of expenses.filter((item) => Math.abs(signedNetMovement(item)) >= largeThreshold).sort((a, b) => Math.abs(signedNetMovement(b)) - Math.abs(signedNetMovement(a))).slice(0, 6)) {
    events.push({
      id: `large-expense:${row.id}`,
      date: row.reportingDate,
      month: row.reportingDate.slice(0, 7),
      type: 'spending',
      title: 'Despesa muito acima do valor habitual',
      detail: row.friendlyDescription ?? row.descriptionOriginal,
      evidence: [`Valor ${Math.abs(signedNetMovement(row))} centavos`, `Mediana das despesas ${typical} centavos`],
      transactionIds: [row.id],
      accountIds: [row.accountId],
      importance: 82,
    });
  }

  const firstConversion = rows.find((item) => item.technicalType === 'currency_conversion');
  if (firstConversion) {
    events.push({
      id: `first-conversion:${currency}`,
      date: firstConversion.reportingDate,
      month: firstConversion.reportingDate.slice(0, 7),
      type: 'conversion',
      title: `Primeira conversão reconhecida envolvendo ${currency}`,
      detail: firstConversion.friendlyDescription ?? firstConversion.descriptionOriginal,
      evidence: [`Movimentação ${firstConversion.id}`],
      transactionIds: [firstConversion.id],
      accountIds: [firstConversion.accountId],
      importance: 62,
    });
  }

  const snapshots = state.balanceSnapshots.filter((item) => item.currency === currency && item.reconciled)
    .sort((a, b) => (a.logicalAsOf ?? a.asOf).localeCompare(b.logicalAsOf ?? b.asOf));
  if (snapshots.length) {
    const first = snapshots[0]!;
    events.push({
      id: `first-position:${currency}:${first.id}`,
      date: (first.logicalAsOf ?? first.asOf).slice(0, 10),
      month: (first.logicalAsOf ?? first.asOf).slice(0, 7),
      type: 'position',
      title: `Primeira posição de saldo confirmada em ${currency}`,
      detail: 'A partir daqui o app consegue distinguir saldo informado de saldo apenas estimado.',
      evidence: [`Snapshot ${first.id}`],
      transactionIds: [],
      accountIds: [first.accountId],
      importance: 65,
    });
  }

  return events
    .sort((a, b) => b.date.localeCompare(a.date) || b.importance - a.importance)
    .filter((event, index, all) => all.findIndex((other) => other.id === event.id) === index)
    .slice(0, 40);
}

export interface MonthlyFinancialStory {
  month: string;
  externalInflowCents: number;
  externalOutflowCents: number;
  purchaseCents: number;
  transferSentCents: number;
  transferReceivedCents: number;
  feeCents: number;
  conversionCount: number;
  transactionCount: number;
}

export function buildMonthlyFinancialStories(state: AppState, currency: string): MonthlyFinancialStory[] {
  const buckets = new Map<string, MonthlyFinancialStory>();
  for (const transaction of completed(state, currency)) {
    const month = transaction.reportingDate.slice(0, 7);
    const current = buckets.get(month) ?? { month, externalInflowCents: 0, externalOutflowCents: 0, purchaseCents: 0, transferSentCents: 0, transferReceivedCents: 0, feeCents: 0, conversionCount: 0, transactionCount: 0 };
    const value = signedNetMovement(transaction);
    current.transactionCount += 1;
    if (!transaction.analysisExcluded) {
      if (value > 0) current.externalInflowCents += value;
      if (value < 0) current.externalOutflowCents += Math.abs(value);
    }
    if (['card_payment', 'direct_debit', 'other_expense'].includes(transaction.technicalType) && value < 0) current.purchaseCents += Math.abs(value);
    if (transaction.technicalType === 'outgoing_transfer' && value < 0) current.transferSentCents += Math.abs(value);
    if (transaction.technicalType === 'incoming_transfer' && value > 0) current.transferReceivedCents += value;
    if (transaction.technicalType === 'bank_fee' && value < 0) current.feeCents += Math.abs(value);
    if (transaction.technicalType === 'currency_conversion') current.conversionCount += 1;
    buckets.set(month, current);
  }
  return [...buckets.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
}
