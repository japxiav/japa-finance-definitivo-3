import type { AnalyticsBundle, MetricsSnapshot, RankedAmount } from './metrics';

export interface ComparisonMetric {
  label: string;
  currentCents: number;
  previousCents: number;
  differenceCents: number;
  percentChange?: number;
  favorableWhenLower?: boolean;
}

export interface ComparisonExplanation {
  id: string;
  title: string;
  body: string;
  tone: 'positive' | 'attention' | 'neutral';
}

export interface PeriodComparison {
  comparable: boolean;
  currentRange: MetricsSnapshot['range'];
  previousRange: MetricsSnapshot['range'];
  metrics: ComparisonMetric[];
  explanations: ComparisonExplanation[];
}

function percentChange(current: number, previous: number): number | undefined {
  if (previous === 0) return current === 0 ? 0 : undefined;
  return (current - previous) / Math.abs(previous);
}

function indexed(rows: RankedAmount[]): Map<string, RankedAmount> {
  return new Map(rows.map((row) => [row.key, row]));
}

function categoryDeltas(current: RankedAmount[], previous: RankedAmount[]) {
  const left = indexed(current);
  const right = indexed(previous);
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].map((key) => {
    const currentCents = left.get(key)?.amountCents ?? 0;
    const previousCents = right.get(key)?.amountCents ?? 0;
    return { key, currentCents, previousCents, differenceCents: currentCents - previousCents };
  }).sort((a, b) => Math.abs(b.differenceCents) - Math.abs(a.differenceCents));
}

export function buildPeriodComparison(
  analytics: AnalyticsBundle,
  categoryName: (categoryId?: string) => string,
  formatMoney: (amountCents: number) => string,
): PeriodComparison {
  const current = analytics.current;
  const previous = analytics.previous;
  const comparable = previous.transactions.length > 0;
  const metrics: ComparisonMetric[] = [
    {
      label: 'Entradas',
      currentCents: current.summary.incomeCents,
      previousCents: previous.summary.incomeCents,
      differenceCents: current.summary.incomeCents - previous.summary.incomeCents,
      percentChange: percentChange(current.summary.incomeCents, previous.summary.incomeCents),
    },
    {
      label: 'Despesas líquidas',
      currentCents: current.summary.netExpenseCents,
      previousCents: previous.summary.netExpenseCents,
      differenceCents: current.summary.netExpenseCents - previous.summary.netExpenseCents,
      percentChange: percentChange(current.summary.netExpenseCents, previous.summary.netExpenseCents),
      favorableWhenLower: true,
    },
    {
      label: 'Resultado do fluxo',
      currentCents: current.summary.netCashflowCents,
      previousCents: previous.summary.netCashflowCents,
      differenceCents: current.summary.netCashflowCents - previous.summary.netCashflowCents,
      percentChange: percentChange(current.summary.netCashflowCents, previous.summary.netCashflowCents),
    },
  ];

  const explanations: ComparisonExplanation[] = [];
  if (!comparable) {
    explanations.push({
      id: 'not-comparable',
      title: 'Ainda não há um período anterior comparável',
      body: 'A comparação aparece quando existe histórico suficiente antes do intervalo atual.',
      tone: 'neutral',
    });
    return { comparable, currentRange: current.range, previousRange: previous.range, metrics, explanations };
  }

  const expenseDelta = current.summary.netExpenseCents - previous.summary.netExpenseCents;
  if (expenseDelta !== 0) {
    explanations.push({
      id: 'expense-delta',
      title: expenseDelta > 0 ? 'As despesas aumentaram' : 'As despesas diminuíram',
      body: `${expenseDelta > 0 ? 'Foram' : 'Foram economizados'} ${formatMoney(Math.abs(expenseDelta))} em relação ao período anterior equivalente.`,
      tone: expenseDelta > 0 ? 'attention' : 'positive',
    });
  }

  const largestCategoryChange = categoryDeltas(current.byCategory, previous.byCategory)
    .find((item) => item.differenceCents !== 0);
  if (largestCategoryChange) {
    const category = categoryName(largestCategoryChange.key);
    explanations.push({
      id: `category-${largestCategoryChange.key}`,
      title: `${category} foi a principal mudança`,
      body: largestCategoryChange.differenceCents > 0
        ? `Essa categoria consumiu ${formatMoney(largestCategoryChange.differenceCents)} a mais.`
        : `Essa categoria consumiu ${formatMoney(Math.abs(largestCategoryChange.differenceCents))} a menos.`,
      tone: largestCategoryChange.differenceCents > 0 ? 'attention' : 'positive',
    });
  }

  const cashflowDelta = current.summary.netCashflowCents - previous.summary.netCashflowCents;
  explanations.push(cashflowDelta === 0
    ? {
        id: 'cashflow-delta',
        title: 'O resultado do fluxo ficou estável',
        body: 'Não houve diferença no resultado entre os dois períodos equivalentes.',
        tone: 'neutral',
      }
    : {
        id: 'cashflow-delta',
        title: cashflowDelta > 0 ? 'O resultado do fluxo melhorou' : 'O resultado do fluxo piorou',
        body: `${formatMoney(Math.abs(cashflowDelta))} de diferença entre os dois períodos, considerando entradas, despesas e reembolsos.`,
        tone: cashflowDelta > 0 ? 'positive' : 'attention',
      });

  return { comparable, currentRange: current.range, previousRange: previous.range, metrics, explanations: explanations.slice(0, 3) };
}
