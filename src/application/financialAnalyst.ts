import type { AppState } from '../core/types';
import { buildAnalytics } from '../analytics/metrics';
import { buildCurrencyAnalytics } from '../analytics/currencyAnalytics';
import { buildDataHealthReport } from './dataHealth';
import { buildFinancialHistory, buildMonthlyFinancialStories } from './financialHistory';
import { buildFinancialRelationships } from './financialRelationships';
import { buildRelationshipIntelligence } from './relationshipIntelligence';
import { buildKnowledgeSnapshot } from './knowledgeEngine';
import { buildChangeSignals } from './changeDetection';
import { buildContinuousAudit } from './continuousAudit';
import { buildBehaviorObservations } from './behaviorMemory';
import { buildFinancialEvents } from './financialEvents';

export interface FinancialAnalystContext {
  generatedAt: string;
  currency: string;
  principles: string[];
  integrity: {
    score: number;
    confidenceLabel: string;
    criticalCount: number;
    warningCount: number;
    checks: Array<{ id: string; label: string; status: string; value: string; detail: string }>;
  };
  period: {
    start: string;
    end: string;
    complete: boolean;
    externalInflowCents: number;
    externalOutflowCents: number;
    netExternalCents: number;
    purchasesAndExpensesCents: number;
    transferSentCents: number;
    transferReceivedCents: number;
    uncategorizedExpenseCount: number;
    unknownTechnicalCount: number;
  };
  comparison: {
    previousStart: string;
    previousEnd: string;
    purchasesChangeCents: number;
    transferSentChangeCents: number;
    transferReceivedChangeCents: number;
  };
  categories: Array<{ id: string; name: string; amountCents: number; share: number; transactionCount: number }>;
  merchants: Array<{ name: string; amountCents: number; share: number; transactionCount: number }>;
  relationships: Array<{
    name: string;
    sentCents: number;
    receivedCents: number;
    sentCount: number;
    receivedCount: number;
    firstDate: string;
    lastDate: string;
    sentShare: number;
    receivedShare: number;
    cadence: string;
    note?: string;
  }>;
  exchange: {
    conversionCount: number;
    convertedOutflowCents: number;
    explicitFeeCents: number;
    unpairedCount: number;
  };
  monthlyStories: ReturnType<typeof buildMonthlyFinancialStories>;
  history: Array<{ date: string; type: string; title: string; detail: string; evidence: string[] }>;
  planned: Array<{ title: string; amountCents: number; dueDate: string; direction: string; active: boolean }>;
  memory: Array<{ name: string; relationship: string; note?: string; validFrom?: string; validUntil?: string }>;
  knowledge: { nodeCounts: Record<string, number>; edgeCount: number; unresolvedEntityCount: number };
  changes: Array<{ title: string; explanation: string; impactCents?: number; direction: string; confidence: string; evidence: string[] }>;
  financialObjects: Array<{ type: string; title: string; status: string; transactionCount: number; plannedEventCount: number; expectedCents?: number }>;
  behaviorMemory: Array<{ title: string; summary: string; confidence: string; confirmed: boolean; evidence: string[] }>;
  financialEvents: Array<{ type: string; title: string; date: string; confidence: string; lineCount: number; feeCents: number }>;
  continuousAudit: { status: string; criticalCount: number; warningCount: number; issues: Array<{ severity: string; title: string; explanation: string; evidence: string[] }> };
}

export function buildFinancialAnalystContext(state: AppState, currency: string): FinancialAnalystContext {
  const analytics = buildAnalytics(state, currency);
  const currencyAnalytics = buildCurrencyAnalytics(state, currency);
  const relationships = buildFinancialRelationships(state, currency);
  const unpairedConversionCount = state.transactions.filter((item) => item.status === 'completed'
    && item.currency === currency
    && item.technicalType === 'currency_conversion'
    && !item.transferGroupId).length;
  const categoryById = new Map(state.categories.map((item) => [item.id, item.name]));
  const health = buildDataHealthReport(state);
  const knowledge = buildKnowledgeSnapshot(state);
  const changes = buildChangeSignals(state, currency);
  const continuousAudit = buildContinuousAudit(state);
  const behavior = buildBehaviorObservations(state, currency);
  const financialEvents = buildFinancialEvents(state).filter((event) => event.currencies.includes(currency));
  return {
    generatedAt: new Date().toISOString(),
    currency,
    principles: [
      'O extrato bancário é a fonte oficial dos fatos.',
      'Transferências internas e conversões não são receita nem despesa.',
      'Transferências entre pessoas já estão completas sem categoria ou finalidade.',
      'Categoria e anotação são opcionais e nunca mudam saldo, valor, data ou moeda.',
      'A IA interpreta o panorama; ela não recalcula o livro nem aplica correções.',
    ],
    integrity: {
      score: health.score,
      confidenceLabel: health.confidenceLabel,
      criticalCount: health.criticalCount,
      warningCount: health.warningCount,
      checks: health.checks.map(({ id, label, status, value, detail }) => ({ id, label, status, value, detail })),
    },
    period: {
      start: analytics.current.range.start,
      end: analytics.current.range.end,
      complete: analytics.current.isComplete,
      externalInflowCents: analytics.current.summary.incomeCents,
      externalOutflowCents: analytics.current.summary.expenseCents,
      netExternalCents: analytics.current.summary.netCashflowCents,
      purchasesAndExpensesCents: analytics.current.categorizedExpenseCents,
      transferSentCents: analytics.current.transferOutflowCents,
      transferReceivedCents: analytics.current.transferInflowCents,
      uncategorizedExpenseCount: analytics.current.uncategorizedTransactionCount,
      unknownTechnicalCount: analytics.current.unknownTransactionCount,
    },
    comparison: {
      previousStart: analytics.previous.range.start,
      previousEnd: analytics.previous.range.end,
      purchasesChangeCents: analytics.current.categorizedExpenseCents - analytics.previous.categorizedExpenseCents,
      transferSentChangeCents: analytics.current.transferOutflowCents - analytics.previous.transferOutflowCents,
      transferReceivedChangeCents: analytics.current.transferInflowCents - analytics.previous.transferInflowCents,
    },
    categories: analytics.current.byCategory.slice(0, 12).map((item) => ({
      id: item.key,
      name: item.key === 'uncategorized' ? 'Sem categoria' : categoryById.get(item.key) ?? item.key,
      amountCents: item.amountCents,
      share: item.share,
      transactionCount: item.transactionCount,
    })),
    merchants: analytics.current.byMerchant.slice(0, 15).map((item) => ({
      name: item.key,
      amountCents: item.amountCents,
      share: item.share,
      transactionCount: item.transactionCount,
    })),
    relationships: relationships.slice(0, 25).map((item) => {
      const intelligence = buildRelationshipIntelligence(state, item, relationships);
      return {
        name: item.displayName,
        sentCents: item.sentCents,
        receivedCents: item.receivedCents,
        sentCount: item.sentCount,
        receivedCount: item.receivedCount,
        firstDate: item.firstDate,
        lastDate: item.lastDate,
        sentShare: intelligence.sentShare,
        receivedShare: intelligence.receivedShare,
        cadence: intelligence.cadenceLabel,
        note: item.contextLabel,
      };
    }),
    exchange: {
      conversionCount: currencyAnalytics.conversionCount,
      convertedOutflowCents: currencyAnalytics.convertedOutflowCents,
      explicitFeeCents: currencyAnalytics.explicitFeeCents,
      unpairedCount: unpairedConversionCount,
    },
    monthlyStories: buildMonthlyFinancialStories(state, currency),
    history: buildFinancialHistory(state, currency).slice(0, 25).map((item) => ({
      date: item.date,
      type: item.type,
      title: item.title,
      detail: item.detail,
      evidence: item.evidence.filter((entry) => !/^(?:Movimentação|Snapshot)\s/i.test(entry)),
    })),
    planned: state.plannedEvents.filter((item) => item.currency === currency).slice(0, 30).map((item) => ({
      title: item.title,
      amountCents: item.amountCents,
      dueDate: item.dueDate,
      direction: item.direction,
      active: item.active,
    })),
    memory: state.financialMemory.slice(0, 50).map((item) => ({
      name: item.displayName,
      relationship: item.relationship,
      note: item.notes ?? item.contextLabel,
      validFrom: item.validFrom,
      validUntil: item.validUntil,
    })),
    knowledge: { nodeCounts: knowledge.counts, edgeCount: knowledge.edges.length, unresolvedEntityCount: knowledge.unresolvedEntityCount },
    changes: changes.slice(0, 15).map((item) => ({ title: item.title, explanation: item.explanation, impactCents: item.impactCents, direction: item.direction, confidence: item.confidence, evidence: item.evidence })),
    financialObjects: state.financialObjects.filter((item) => item.currency === currency && item.status !== 'archived').slice(0, 30).map((item) => ({ type: item.type, title: item.title, status: item.status, transactionCount: item.transactionIds.length, plannedEventCount: item.plannedEventIds.length, expectedCents: item.expectedCents })),
    behaviorMemory: behavior.slice(0, 20).map((item) => ({ title: item.title, summary: item.summary, confidence: item.confidence, confirmed: item.saved, evidence: item.evidence })),
    financialEvents: financialEvents.slice(0, 30).map((item) => ({ type: item.type, title: item.title, date: item.reportingDate, confidence: item.confidence, lineCount: item.transactionIds.length, feeCents: item.totalFeeCents })),
    continuousAudit: { status: continuousAudit.status, criticalCount: continuousAudit.criticalCount, warningCount: continuousAudit.warningCount, issues: continuousAudit.issues.slice(0, 20).map((item) => ({ severity: item.severity, title: item.title, explanation: item.explanation, evidence: item.evidence })) },
  };
}

export type AnalystConfidence = 'high' | 'medium' | 'low';

export interface AnalystHypothesis {
  title: string;
  explanation: string;
  evidence: string[];
  confidence: AnalystConfidence;
  confirmationQuestion?: string;
}

export interface FinancialAnalystResult {
  answer: string;
  evidence: string[];
  limitations: string[];
  confidence: AnalystConfidence;
  hypotheses: AnalystHypothesis[];
  model?: string;
}

function isConfidence(value: unknown): value is AnalystConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

export function parseFinancialAnalystResult(payload: unknown): FinancialAnalystResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Resposta inválida do analista.');
  const record = payload as Record<string, unknown>;
  const answer = typeof record.answer === 'string' ? record.answer.trim().slice(0, 8_000) : '';
  if (!answer) throw new Error('O analista não retornou uma resposta.');
  const evidence = Array.isArray(record.evidence) ? record.evidence.filter((item): item is string => typeof item === 'string').slice(0, 20) : [];
  const limitations = Array.isArray(record.limitations) ? record.limitations.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  const hypotheses = Array.isArray(record.hypotheses) ? record.hypotheses.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (typeof value.title !== 'string' || typeof value.explanation !== 'string') return [];
    return [{
      title: value.title.slice(0, 180),
      explanation: value.explanation.slice(0, 1_200),
      evidence: Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === 'string').slice(0, 10) : [],
      confidence: isConfidence(value.confidence) ? value.confidence : 'low',
      confirmationQuestion: typeof value.confirmationQuestion === 'string' && value.confirmationQuestion.trim() ? value.confirmationQuestion.slice(0, 300) : undefined,
    } satisfies AnalystHypothesis];
  }).slice(0, 8) : [];
  return {
    answer,
    evidence,
    limitations,
    confidence: isConfidence(record.confidence) ? record.confidence : 'low',
    hypotheses,
    model: typeof record.model === 'string' ? record.model : undefined,
  };
}
