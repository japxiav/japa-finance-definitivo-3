import type { AppState } from '../core/types';
import { formatMoney } from '../core/money';
import { buildChangeSignals } from './changeDetection';
import { buildFinancialRelationships } from './financialRelationships';
import { buildDataHealthReport } from './dataHealth';
import { buildFinancialObjectSuggestions } from './financialObjects';

export type ContextualInsightType = 'change' | 'relationship' | 'integrity' | 'opportunity' | 'milestone';

export interface ContextualInsight {
  id: string;
  type: ContextualInsightType;
  title: string;
  message: string;
  consequence: string;
  actionLabel?: string;
  actionTarget?: 'history' | 'relationships' | 'health' | 'objects' | 'transactions';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  transactionIds: string[];
  priority: number;
}

export function buildContextualInsights(state: AppState, currency: string): ContextualInsight[] {
  const insights: ContextualInsight[] = [];
  const changes = buildChangeSignals(state, currency);
  for (const change of changes.slice(0, 6)) {
    insights.push({
      id: `change:${change.id}`,
      type: 'change',
      title: change.title,
      message: change.impactCents !== undefined ? `${change.explanation} Impacto observado: ${formatMoney(change.impactCents, currency)}.` : change.explanation,
      consequence: change.actionable ? 'Vale abrir os movimentos usados para entender a causa antes de decidir.' : 'A mudança descreve o comportamento, mas o motivo depende de contexto humano.',
      actionLabel: 'Ver mudança',
      actionTarget: 'history',
      confidence: change.confidence,
      evidence: change.evidence,
      transactionIds: change.transactionIds,
      priority: change.actionable ? 90 : 72,
    });
  }

  const relationships = buildFinancialRelationships(state, currency);
  const totalSent = relationships.reduce((sum, item) => sum + item.sentCents, 0);
  const totalReceived = relationships.reduce((sum, item) => sum + item.receivedCents, 0);
  const topSent = [...relationships].filter((item) => item.sentCents > 0).sort((a, b) => b.sentCents - a.sentCents)[0];
  const topReceived = [...relationships].filter((item) => item.receivedCents > 0).sort((a, b) => b.receivedCents - a.receivedCents)[0];
  if (topSent && totalSent > 0) {
    const share = topSent.sentCents / totalSent;
    insights.push({
      id: `relationship-top-sent:${topSent.key}`,
      type: 'relationship',
      title: `${topSent.displayName} é o principal destino das suas transferências`,
      message: `${formatMoney(topSent.sentCents, currency)} enviados em ${topSent.sentCount} movimentos, equivalentes a ${Math.round(share * 100)}% do dinheiro enviado para pessoas.`,
      consequence: share >= 0.5 ? 'Esse relacionamento concentra a maior parte das transferências e merece destaque nas análises mensais.' : 'É o maior relacionamento do período, mas sem concentração extrema.',
      actionLabel: 'Abrir relacionamento',
      actionTarget: 'relationships',
      confidence: 'high',
      evidence: [`${relationships.filter((item) => item.sentCents > 0).length} destinatários comparados.`, `Período: ${topSent.firstDate} a ${topSent.lastDate}.`],
      transactionIds: topSent.transactionIds,
      priority: 82,
    });
  }
  if (topReceived && totalReceived > 0) {
    const share = topReceived.receivedCents / totalReceived;
    insights.push({
      id: `relationship-top-received:${topReceived.key}`,
      type: 'relationship',
      title: `${topReceived.displayName} é a principal origem de transferências recebidas`,
      message: `${formatMoney(topReceived.receivedCents, currency)} recebidos em ${topReceived.receivedCount} movimentos, ${Math.round(share * 100)}% do total recebido de pessoas.`,
      consequence: 'O app consegue detectar quando essa origem muda ao longo dos meses, sem presumir que seja salário ou ajuda.',
      actionLabel: 'Ver história',
      actionTarget: 'history',
      confidence: 'high',
      evidence: [`${relationships.filter((item) => item.receivedCents > 0).length} remetentes comparados.`],
      transactionIds: topReceived.transactionIds,
      priority: 78,
    });
  }

  const health = buildDataHealthReport(state);
  if (health.criticalCount || health.warningCount) {
    insights.push({
      id: `integrity:${health.generatedAt.slice(0, 10)}`,
      type: 'integrity',
      title: health.criticalCount ? 'Há problemas que podem alterar os números' : 'Os relatórios são utilizáveis com ressalvas',
      message: `${health.criticalCount} problema(s) crítico(s) e ${health.warningCount} ressalva(s) foram encontrados.`,
      consequence: health.criticalCount ? 'Corrija a integridade antes de confiar em previsões ou comparações.' : 'Saldo e fluxo podem continuar úteis, mas alguns relatórios precisam mostrar a limitação.',
      actionLabel: 'Abrir saúde da base',
      actionTarget: 'health',
      confidence: 'high',
      evidence: health.checks.filter((item) => item.status === 'error' || item.status === 'warning').slice(0, 6).map((item) => `${item.label}: ${item.value}`),
      transactionIds: health.checks.flatMap((item) => item.transactionIds ?? []),
      priority: health.criticalCount ? 100 : 86,
    });
  }

  const objectSuggestions = buildFinancialObjectSuggestions(state, currency);
  if (objectSuggestions.length) {
    insights.push({
      id: `objects:${currency}:${objectSuggestions.length}`,
      type: 'opportunity',
      title: `${objectSuggestions.length} contexto(s) da vida real podem ser criados`,
      message: 'O app encontrou assinaturas, compromissos ou relações já confirmadas que podem virar objetos financeiros sem alterar nenhuma transação.',
      consequence: 'Objetos permitem acompanhar uma assinatura, empréstimo, apoio familiar ou meta como uma história única, em vez de uma coleção de linhas.',
      actionLabel: 'Revisar objetos',
      actionTarget: 'objects',
      confidence: objectSuggestions.some((item) => item.confidence === 'high') ? 'high' : 'medium',
      evidence: objectSuggestions.slice(0, 5).map((item) => item.title),
      transactionIds: objectSuggestions.flatMap((item) => item.transactionIds),
      priority: 68,
    });
  }

  return insights.sort((a, b) => b.priority - a.priority).slice(0, 12);
}
