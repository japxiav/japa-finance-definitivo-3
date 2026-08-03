import type { AppState, BehaviorMemoryEntry, SuggestionConfidence, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { formatMoney } from '../core/money';
import { normalizeEntityAlias } from './financialMemory';
import { buildFinancialRelationships } from './financialRelationships';

export interface BehaviorObservation {
  id: string;
  currency: string;
  kind: BehaviorMemoryEntry['kind'];
  subjectKey: string;
  title: string;
  summary: string;
  evidence: string[];
  confidence: SuggestionConfidence;
  observedFrom: string;
  observedUntil: string;
  transactionIds: string[];
  saved: boolean;
  dismissed: boolean;
}

function completed(state: AppState, currency: string) {
  return state.transactions.filter((item) => item.status === 'completed' && item.currency === currency);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function weekdayLabel(day: number): string {
  return ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][day] ?? 'dia variável';
}

function persistedStatus(state: AppState, id: string) {
  const current = state.behaviorMemory.find((item) => item.id === id);
  return { saved: Boolean(current), dismissed: Boolean(current?.dismissedAt) };
}

export function buildBehaviorObservations(state: AppState, currency: string): BehaviorObservation[] {
  const rows = completed(state, currency);
  if (!rows.length) return [];
  const observations: BehaviorObservation[] = [];

  const salaries = rows.filter((item) => !item.analysisExcluded && item.direction === 'inflow' && item.technicalType === 'salary');
  if (salaries.length >= 3) {
    const days = salaries.map((item) => new Date(`${item.reportingDate}T12:00:00Z`).getUTCDay());
    const dayCounts = new Map<number, number>();
    for (const day of days) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    const common = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const amounts = salaries.map((item) => Math.abs(signedNetMovement(item)));
    const id = `behavior:${currency}:income-cadence`;
    const status = persistedStatus(state, id);
    observations.push({
      id,
      currency,
      kind: 'income_cadence',
      subjectKey: 'salary',
      title: 'Ritmo típico de renda',
      summary: common ? `A renda reconhecida aparece com mais frequência na ${weekdayLabel(common[0])}, com valor mediano de ${formatMoney(median(amounts), currency)}.` : `A renda reconhecida tem valor mediano de ${formatMoney(median(amounts), currency)}.`,
      evidence: [`${salaries.length} entradas classificadas como salário.`, common ? `${common[1]} delas ocorreram no mesmo dia da semana.` : 'Dia da semana variável.'],
      confidence: salaries.length >= 8 ? 'high' : 'medium',
      observedFrom: salaries.map((item) => item.reportingDate).sort()[0]!,
      observedUntil: salaries.map((item) => item.reportingDate).sort().at(-1)!,
      transactionIds: salaries.map((item) => item.id),
      ...status,
    });
  }

  const expenses = rows.filter((item) => !item.analysisExcluded && item.direction === 'outflow' && ['card_payment', 'direct_debit', 'other_expense'].includes(item.technicalType));
  const monthly = new Map<string, Transaction[]>();
  for (const item of expenses) {
    const month = item.reportingDate.slice(0, 7);
    const current = monthly.get(month) ?? [];
    current.push(item);
    monthly.set(month, current);
  }
  if (monthly.size >= 3) {
    const totals = [...monthly.values()].map((items) => items.reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0));
    const id = `behavior:${currency}:spending-baseline`;
    const status = persistedStatus(state, id);
    observations.push({
      id,
      currency,
      kind: 'spending_baseline',
      subjectKey: 'purchases',
      title: 'Faixa normal de compras e despesas',
      summary: `A mediana mensal observada é ${formatMoney(median(totals), currency)}, calculada sem transferências entre pessoas, conversões e movimentações internas.`,
      evidence: [`${monthly.size} meses comparáveis.`, `${expenses.length} compras e despesas concluídas.`],
      confidence: monthly.size >= 6 ? 'high' : 'medium',
      observedFrom: expenses.map((item) => item.reportingDate).sort()[0]!,
      observedUntil: expenses.map((item) => item.reportingDate).sort().at(-1)!,
      transactionIds: expenses.map((item) => item.id),
      ...status,
    });
  }

  const relationships = buildFinancialRelationships(state, currency).filter((item) => item.totalCount >= 4).slice(0, 12);
  for (const relationship of relationships) {
    const id = `behavior:${currency}:relationship:${relationship.key}`;
    const status = persistedStatus(state, id);
    observations.push({
      id,
      currency,
      kind: 'relationship_pattern',
      subjectKey: relationship.key,
      title: `Padrão com ${relationship.displayName}`,
      summary: `${relationship.totalCount} transferências entre ${relationship.firstDate} e ${relationship.lastDate}. Enviado: ${formatMoney(relationship.sentCents, currency)}; recebido: ${formatMoney(relationship.receivedCents, currency)}.`,
      evidence: [`${relationship.sentCount} envio(s).`, `${relationship.receivedCount} recebimento(s).`, `${relationship.normalizedAliases.length} alias(es) bancários consolidados.`],
      confidence: relationship.totalCount >= 10 ? 'high' : 'medium',
      observedFrom: relationship.firstDate,
      observedUntil: relationship.lastDate,
      transactionIds: relationship.transactionIds,
      ...status,
    });
  }

  const merchants = new Map<string, Transaction[]>();
  for (const item of expenses) {
    const key = normalizeEntityAlias(item.merchantNormalized || item.friendlyDescription || item.descriptionOriginal);
    if (!key) continue;
    const current = merchants.get(key) ?? [];
    current.push(item);
    merchants.set(key, current);
  }
  for (const [key, items] of [...merchants.entries()].filter(([, list]) => list.length >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const id = `behavior:${currency}:merchant:${key}`;
    const status = persistedStatus(state, id);
    const amounts = items.map((item) => Math.abs(signedNetMovement(item)));
    observations.push({
      id,
      currency,
      kind: 'merchant_pattern',
      subjectKey: key,
      title: `Padrão em ${items[0]!.friendlyDescription || items[0]!.merchantNormalized || items[0]!.descriptionOriginal}`,
      summary: `${items.length} compras, com valor mediano de ${formatMoney(median(amounts), currency)}.`,
      evidence: [`Primeira: ${items.map((item) => item.reportingDate).sort()[0]}.`, `Última: ${items.map((item) => item.reportingDate).sort().at(-1)}.`],
      confidence: items.length >= 8 ? 'high' : 'medium',
      observedFrom: items.map((item) => item.reportingDate).sort()[0]!,
      observedUntil: items.map((item) => item.reportingDate).sort().at(-1)!,
      transactionIds: items.map((item) => item.id),
      ...status,
    });
  }

  return observations.filter((item) => !item.dismissed).sort((a, b) => (b.confidence === 'high' ? 2 : 1) - (a.confidence === 'high' ? 2 : 1)).slice(0, 30);
}

export function saveBehaviorObservation(state: AppState, observation: BehaviorObservation): AppState {
  const now = new Date().toISOString();
  const entry: BehaviorMemoryEntry = {
    id: observation.id,
    currency: observation.currency,
    kind: observation.kind,
    subjectKey: observation.subjectKey,
    title: observation.title,
    summary: observation.summary,
    evidence: observation.evidence,
    confidence: observation.confidence,
    observedFrom: observation.observedFrom,
    observedUntil: observation.observedUntil,
    confirmed: true,
    createdAt: state.behaviorMemory.find((item) => item.id === observation.id)?.createdAt ?? now,
    updatedAt: now,
  };
  return { ...state, behaviorMemory: [entry, ...state.behaviorMemory.filter((item) => item.id !== entry.id)] };
}

export function dismissBehaviorObservation(state: AppState, observation: BehaviorObservation): AppState {
  const now = new Date().toISOString();
  const existing = state.behaviorMemory.find((item) => item.id === observation.id);
  const entry: BehaviorMemoryEntry = {
    id: observation.id,
    currency: observation.currency,
    kind: observation.kind,
    subjectKey: observation.subjectKey,
    title: observation.title,
    summary: observation.summary,
    evidence: observation.evidence,
    confidence: observation.confidence,
    observedFrom: observation.observedFrom,
    observedUntil: observation.observedUntil,
    confirmed: existing?.confirmed ?? false,
    dismissedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return { ...state, behaviorMemory: [entry, ...state.behaviorMemory.filter((item) => item.id !== entry.id)] };
}
