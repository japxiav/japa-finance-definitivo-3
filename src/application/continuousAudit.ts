import type { AppState, AuditIssueSeverity, CategoryRule, Transaction } from '../core/types';
import { stableHash } from '../core/hash';
import { buildDataHealthReport } from './dataHealth';
import { buildFinancialEvents } from './financialEvents';
import { findInternalTransferSuggestions } from './internalTransfers';

export interface ContinuousAuditIssue {
  id: string;
  severity: AuditIssueSeverity;
  title: string;
  explanation: string;
  evidence: string[];
  transactionIds: string[];
  accountIds: string[];
  suggestedAction?: 'review' | 'reprocess' | 'link' | 'backup' | 'inspect_rule';
}

export interface ContinuousAuditSnapshot {
  generatedAt: string;
  fingerprint: string;
  status: 'healthy' | 'attention' | 'critical';
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  issues: ContinuousAuditIssue[];
}

function overlap(a: CategoryRule, b: CategoryRule): boolean {
  if (a.id === b.id || a.active === false || b.active === false) return false;
  if (a.categoryId === b.categoryId) return false;
  if (a.currency && b.currency && a.currency !== b.currency) return false;
  if (a.direction && b.direction && a.direction !== b.direction) return false;
  if (a.technicalType && b.technicalType && a.technicalType !== b.technicalType) return false;
  const left = a.pattern.trim().toLocaleLowerCase('pt-BR');
  const right = b.pattern.trim().toLocaleLowerCase('pt-BR');
  if (!left || !right) return false;
  if (a.kind === 'exact' && b.kind === 'exact') return left === right;
  return left.includes(right) || right.includes(left);
}

function unmatchedRefunds(state: AppState): Transaction[] {
  return state.transactions.filter((item) => item.status === 'completed'
    && item.kind === 'refund'
    && !item.refundOfTransactionId);
}

export function buildContinuousAudit(state: AppState): ContinuousAuditSnapshot {
  const issues: ContinuousAuditIssue[] = [];
  const health = buildDataHealthReport(state);
  for (const check of health.checks) {
    if (check.status === 'ok') continue;
    issues.push({
      id: `health:${check.id}`,
      severity: check.status === 'error' ? 'critical' : check.status === 'warning' ? 'warning' : 'info',
      title: check.label,
      explanation: check.detail,
      evidence: [`Valor observado: ${check.value}.`],
      transactionIds: check.transactionIds ?? [],
      accountIds: check.accountIds ?? [],
      suggestedAction: check.id === 'backup' ? 'backup' : check.id === 'unknown-technical' ? 'reprocess' : 'review',
    });
  }

  const conflicts: Array<[CategoryRule, CategoryRule]> = [];
  for (let index = 0; index < state.rules.length; index += 1) {
    for (let other = index + 1; other < state.rules.length; other += 1) {
      const a = state.rules[index]!;
      const b = state.rules[other]!;
      if (overlap(a, b)) conflicts.push([a, b]);
    }
  }
  if (conflicts.length) {
    issues.push({
      id: 'rule-conflicts',
      severity: 'warning',
      title: 'Regras automáticas podem competir',
      explanation: 'Existem padrões sobrepostos apontando para categorias diferentes. A ordem da regra pode esconder a intenção real.',
      evidence: conflicts.slice(0, 8).map(([a, b]) => `${a.pattern} → ${a.categoryId} / ${b.pattern} → ${b.categoryId}`),
      transactionIds: [],
      accountIds: [],
      suggestedAction: 'inspect_rule',
    });
  }

  const refunds = unmatchedRefunds(state);
  if (refunds.length) {
    issues.push({
      id: 'unmatched-refunds',
      severity: 'info',
      title: 'Reembolsos sem compra vinculada',
      explanation: 'O impacto líquido por comerciante continua correto, mas a história da compra não está completa.',
      evidence: [`${refunds.length} reembolso(s) sem vínculo explícito.`],
      transactionIds: refunds.map((item) => item.id),
      accountIds: [...new Set(refunds.map((item) => item.accountId))],
      suggestedAction: 'review',
    });
  }

  const eventIssues = buildFinancialEvents(state).filter((event) => event.type === 'conversion' && event.confidence !== 'high');
  if (eventIssues.length) {
    issues.push({
      id: 'incomplete-financial-events',
      severity: 'warning',
      title: 'Eventos compostos incompletos',
      explanation: 'Há conversões ou movimentos internos com apenas uma ponta observada no histórico.',
      evidence: eventIssues.slice(0, 8).map((event) => `${event.reportingDate}: ${event.title}`),
      transactionIds: eventIssues.flatMap((event) => event.transactionIds),
      accountIds: eventIssues.flatMap((event) => event.accountIds),
      suggestedAction: 'review',
    });
  }

  const internalSuggestions = findInternalTransferSuggestions(state);
  if (internalSuggestions.length) {
    issues.push({
      id: 'internal-transfer-suggestions',
      severity: internalSuggestions.some((item) => item.confidence === 'high') ? 'warning' : 'info',
      title: 'Possíveis transferências entre contas próprias',
      explanation: 'Confirmar o vínculo evita que as duas pontas apareçam como entrada e saída externas.',
      evidence: internalSuggestions.slice(0, 8).flatMap((item) => item.evidence.slice(0, 2)),
      transactionIds: internalSuggestions.flatMap((item) => [item.outflow.id, item.inflow.id]),
      accountIds: internalSuggestions.flatMap((item) => [item.outflow.accountId, item.inflow.accountId]),
      suggestedAction: 'link',
    });
  }

  const emptyObjects = state.financialObjects.filter((item) => item.status === 'active' && item.transactionIds.length === 0 && item.plannedEventIds.length === 0 && !item.targetCents);
  if (emptyObjects.length) {
    issues.push({
      id: 'empty-financial-objects',
      severity: 'info',
      title: 'Objetos financeiros sem vínculos',
      explanation: 'Esses objetos não estão errados, mas ainda não explicam nenhuma movimentação, compromisso ou meta.',
      evidence: emptyObjects.map((item) => item.title).slice(0, 10),
      transactionIds: [],
      accountIds: [],
      suggestedAction: 'review',
    });
  }

  const criticalCount = issues.filter((item) => item.severity === 'critical').length;
  const warningCount = issues.filter((item) => item.severity === 'warning').length;
  const infoCount = issues.filter((item) => item.severity === 'info').length;
  const fingerprint = stableHash(JSON.stringify(issues.map((item) => [item.id, item.severity, item.transactionIds.length, item.accountIds.length])));
  return {
    generatedAt: new Date().toISOString(),
    fingerprint,
    status: criticalCount ? 'critical' : warningCount ? 'attention' : 'healthy',
    criticalCount,
    warningCount,
    infoCount,
    issues: issues.sort((a, b) => (a.severity === 'critical' ? 3 : a.severity === 'warning' ? 2 : 1) - (b.severity === 'critical' ? 3 : b.severity === 'warning' ? 2 : 1)).reverse(),
  };
}
