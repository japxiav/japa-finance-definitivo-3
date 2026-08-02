import type { FinancialInsight } from './types';

/**
 * Um insight só existe se puder mudar uma decisão ou aumentar de forma
 * relevante a compreensão do usuário. Estatísticas decorativas ficam de fora.
 */
export function isActionableFinancialInsight(insight: FinancialInsight): boolean {
  const alwaysUseful = new Set([
    'data-quality',
    'planning-quality',
    'classification-quality',
    'period-coverage',
    'post-income-pattern',
    'recurring-merchant',
    'refunds',
    'reserve-position',
    'balance-change',
    'next-planned-event',
    'commitment-pressure',
    'combined-progress',
    'no-data',
  ]);
  if (alwaysUseful.has(insight.family)) return true;

  // Curiosidades que normalmente apenas repetem o que o extrato já diz.
  const decorative = new Set([
    'cashflow-result',
    'category-leader',
    'largest-expense',
    'average-ticket',
    'no-spend-streak',
  ]);
  if (decorative.has(insight.family)) return false;

  // Mudanças e concentrações só aparecem quando existe ação explícita,
  // evidência suficiente e novidade real.
  if (['category-change', 'category-concentration', 'merchant-concentration', 'weekday-pattern', 'daypart-pattern', 'total-spend-change', 'category-paused'].includes(insight.family)) {
    return Boolean(insight.action && insight.actionLabel && insight.evidence.length >= 2 && insight.novelty >= 70);
  }

  return Boolean(insight.action || insight.priority >= 90);
}
