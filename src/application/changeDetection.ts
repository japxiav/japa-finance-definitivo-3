import type { AppState, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { formatMoney } from '../core/money';
import { addCivilDays, civilDaysBetween } from '../domain/dates';
import { localCivilDate } from '../core/date';
import { normalizeEntityAlias } from './financialMemory';
import { buildFinancialRelationships } from './financialRelationships';

export type ChangeSignalType = 'spending' | 'income' | 'relationship' | 'merchant' | 'account' | 'recurrence';

export interface ChangeSignal {
  id: string;
  type: ChangeSignalType;
  title: string;
  explanation: string;
  impactCents?: number;
  currency: string;
  direction: 'up' | 'down' | 'started' | 'stopped' | 'changed';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  transactionIds: string[];
  actionable: boolean;
}

function completed(state: AppState, currency: string) {
  return state.transactions.filter((item) => item.status === 'completed' && item.currency === currency);
}

function sum(rows: Transaction[]) {
  return rows.reduce((total, item) => total + Math.abs(signedNetMovement(item)), 0);
}

function rangeRows(rows: Transaction[], start: string, end: string) {
  return rows.filter((item) => item.reportingDate >= start && item.reportingDate <= end);
}

function changeEnough(current: number, previous: number, floor: number) {
  const delta = current - previous;
  if (Math.abs(delta) < floor) return false;
  if (previous === 0) return current >= floor;
  return Math.abs(delta) / previous >= 0.35;
}

export function buildChangeSignals(state: AppState, currency: string, today = localCivilDate()): ChangeSignal[] {
  const rows = completed(state, currency);
  if (!rows.length) return [];
  const currentEnd = today;
  const currentStart = addCivilDays(currentEnd, -29);
  const previousEnd = addCivilDays(currentStart, -1);
  const previousStart = addCivilDays(previousEnd, -29);
  const current = rangeRows(rows, currentStart, currentEnd);
  const previous = rangeRows(rows, previousStart, previousEnd);
  const signals: ChangeSignal[] = [];
  const floor = currency === 'EUR' ? 5_000 : 30_000;

  const currentPurchases = current.filter((item) => !item.analysisExcluded && item.direction === 'outflow' && ['card_payment', 'direct_debit', 'other_expense'].includes(item.technicalType));
  const previousPurchases = previous.filter((item) => !item.analysisExcluded && item.direction === 'outflow' && ['card_payment', 'direct_debit', 'other_expense'].includes(item.technicalType));
  const currentSpend = sum(currentPurchases);
  const previousSpend = sum(previousPurchases);
  if (changeEnough(currentSpend, previousSpend, floor)) {
    const delta = currentSpend - previousSpend;
    signals.push({
      id: `spending:${currency}:${currentStart}`,
      type: 'spending',
      title: delta > 0 ? 'Compras e despesas aumentaram' : 'Compras e despesas diminuíram',
      explanation: `A comparação usa dois períodos completos de 30 dias e separa transferências entre pessoas do consumo.`,
      impactCents: Math.abs(delta),
      currency,
      direction: delta > 0 ? 'up' : 'down',
      confidence: 'high',
      evidence: [`Período atual: ${currentPurchases.length} movimentos.`, `Período anterior: ${previousPurchases.length} movimentos.`, `Variação absoluta: ${formatMoney(Math.abs(delta), currency)}.`],
      transactionIds: currentPurchases.map((item) => item.id),
      actionable: true,
    });
  }

  const currentIncome = current.filter((item) => !item.analysisExcluded && item.direction === 'inflow' && ['salary', 'other_income'].includes(item.technicalType));
  const previousIncome = previous.filter((item) => !item.analysisExcluded && item.direction === 'inflow' && ['salary', 'other_income'].includes(item.technicalType));
  const currentIncomeTotal = sum(currentIncome);
  const previousIncomeTotal = sum(previousIncome);
  if (changeEnough(currentIncomeTotal, previousIncomeTotal, floor)) {
    const delta = currentIncomeTotal - previousIncomeTotal;
    signals.push({
      id: `income:${currency}:${currentStart}`,
      type: 'income',
      title: delta > 0 ? 'Entradas reconhecidas aumentaram' : 'Entradas reconhecidas diminuíram',
      explanation: 'A mudança considera apenas entradas externas concluídas classificadas como renda.',
      impactCents: Math.abs(delta),
      currency,
      direction: delta > 0 ? 'up' : 'down',
      confidence: currentIncome.some((item) => item.technicalType === 'other_income') ? 'medium' : 'high',
      evidence: [`Atual: ${currentIncome.length} entrada(s).`, `Anterior: ${previousIncome.length} entrada(s).`],
      transactionIds: currentIncome.map((item) => item.id),
      actionable: true,
    });
  }

  const relationships = buildFinancialRelationships(state, currency);
  for (const relationship of relationships.slice(0, 20)) {
    const relationshipRows = rows.filter((item) => relationship.transactionIds.includes(item.id));
    const currentAmount = sum(rangeRows(relationshipRows, currentStart, currentEnd));
    const previousAmount = sum(rangeRows(relationshipRows, previousStart, previousEnd));
    if (!changeEnough(currentAmount, previousAmount, floor)) continue;
    const delta = currentAmount - previousAmount;
    signals.push({
      id: `relationship:${relationship.key}:${currentStart}`,
      type: 'relationship',
      title: `${relationship.displayName}: volume ${delta > 0 ? 'maior' : 'menor'} que no período anterior`,
      explanation: 'O app detectou mudança no volume da relação, sem presumir o motivo.',
      impactCents: Math.abs(delta),
      currency,
      direction: delta > 0 ? 'up' : 'down',
      confidence: 'high',
      evidence: [`Atual: ${formatMoney(currentAmount, currency)}.`, `Anterior: ${formatMoney(previousAmount, currency)}.`],
      transactionIds: rangeRows(relationshipRows, currentStart, currentEnd).map((item) => item.id),
      actionable: false,
    });
  }

  const merchantBuckets = new Map<string, { label: string; current: Transaction[]; previous: Transaction[] }>();
  for (const item of rows.filter((row) => !row.analysisExcluded && ['card_payment', 'direct_debit', 'other_expense'].includes(row.technicalType))) {
    const key = normalizeEntityAlias(item.merchantNormalized || item.friendlyDescription || item.descriptionOriginal);
    if (!key) continue;
    const bucket = merchantBuckets.get(key) ?? { label: item.friendlyDescription || item.merchantNormalized || item.descriptionOriginal, current: [], previous: [] };
    if (item.reportingDate >= currentStart && item.reportingDate <= currentEnd) bucket.current.push(item);
    if (item.reportingDate >= previousStart && item.reportingDate <= previousEnd) bucket.previous.push(item);
    merchantBuckets.set(key, bucket);
  }
  for (const [key, bucket] of merchantBuckets) {
    const currentAmount = sum(bucket.current);
    const previousAmount = sum(bucket.previous);
    if (!changeEnough(currentAmount, previousAmount, floor)) continue;
    const delta = currentAmount - previousAmount;
    signals.push({
      id: `merchant:${key}:${currentStart}`,
      type: 'merchant',
      title: `${bucket.label}: gasto ${delta > 0 ? 'subiu' : 'caiu'}`,
      explanation: 'A mudança é específica deste comerciante e não inclui transferências.',
      impactCents: Math.abs(delta),
      currency,
      direction: delta > 0 ? 'up' : 'down',
      confidence: 'high',
      evidence: [`Atual: ${bucket.current.length} movimento(s).`, `Anterior: ${bucket.previous.length} movimento(s).`],
      transactionIds: bucket.current.map((item) => item.id),
      actionable: true,
    });
  }

  const recurringSubjects = new Map<string, Transaction[]>();
  for (const item of rows.filter((row) => ['direct_debit', 'card_payment'].includes(row.technicalType))) {
    const key = normalizeEntityAlias(item.merchantNormalized || item.friendlyDescription || item.descriptionOriginal);
    if (!key) continue;
    const list = recurringSubjects.get(key) ?? [];
    list.push(item);
    recurringSubjects.set(key, list);
  }
  for (const [key, subjectRows] of recurringSubjects) {
    if (subjectRows.length < 3) continue;
    const sorted = [...subjectRows].sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
    const last = sorted.at(-1)!;
    const beforeLast = sorted.at(-2)!;
    const typicalGap = civilDaysBetween(beforeLast.reportingDate, last.reportingDate);
    const daysSinceLast = civilDaysBetween(last.reportingDate, today);
    if (typicalGap >= 20 && typicalGap <= 40 && daysSinceLast > typicalGap + 15) {
      signals.push({
        id: `recurrence-stopped:${key}:${last.reportingDate}`,
        type: 'recurrence',
        title: `${last.friendlyDescription || last.merchantNormalized || last.descriptionOriginal} pode ter parado`,
        explanation: 'Havia um padrão aproximadamente mensal, mas o intervalo esperado já passou.',
        currency,
        direction: 'stopped',
        confidence: 'medium',
        evidence: [`Último movimento: ${last.reportingDate}.`, `Intervalo anterior observado: ${typicalGap} dias.`, `Dias desde o último: ${daysSinceLast}.`],
        transactionIds: sorted.slice(-4).map((item) => item.id),
        actionable: true,
      });
    }
  }

  return signals
    .sort((a, b) => (b.actionable ? 1 : 0) - (a.actionable ? 1 : 0) || (b.impactCents ?? 0) - (a.impactCents ?? 0))
    .slice(0, 20);
}
