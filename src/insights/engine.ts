import { buildAnalytics, latestReconciledBalance, previousReconciledBalance, type AnalyticsBundle, type RankedAmount } from '../analytics/metrics';
import { formatReportingDate } from '../core/date';
import { formatMoney } from '../core/money';
import {
  isAnalyticalExpense,
  isAnalyticalIncome,
  signedNetMovement,
  type DateRange,
} from '../core/finance';
import type { AppState, Transaction } from '../core/types';
import { addCivilDays, civilDaysBetween } from '../domain/dates';
import type { FinancialInsight, InsightConfidence, InsightEngineResult, InsightTone } from './types';
import { isActionableFinancialInsight } from './actionability';

interface CandidateInput {
  id: string;
  key?: string;
  family: string;
  title: string;
  message: string;
  tone?: InsightTone;
  confidence?: InsightConfidence;
  priority: number;
  novelty?: number;
  evidence?: FinancialInsight['evidence'];
  action?: FinancialInsight['action'];
  actionLabel?: string;
  categoryId?: string;
  merchant?: string;
  period: FinancialInsight['period'];
}

function candidate(input: CandidateInput): FinancialInsight {
  return {
    key: input.key ?? input.id,
    tone: input.tone ?? 'neutral',
    confidence: input.confidence ?? 'medium',
    novelty: input.novelty ?? 50,
    evidence: input.evidence ?? [],
    ...input,
  };
}

function percentChange(current: number, previous: number): number | undefined {
  if (previous <= 0) return undefined;
  return (current - previous) / previous;
}

function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

function categoryName(state: AppState, id: string): string {
  if (id === 'uncategorized') return 'Sem categoria';
  return state.categories.find((item) => item.id === id)?.name ?? id;
}

function merchantLabel(value: string): string {
  if (!value) return 'um estabelecimento';
  return value.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('pt-BR'));
}

function confidenceFor(count: number): InsightConfidence {
  if (count >= 12) return 'high';
  if (count >= 5) return 'medium';
  return 'low';
}

function amountMap(items: RankedAmount[]): Map<string, RankedAmount> {
  return new Map(items.map((item) => [item.key, item]));
}

function observedCompletedTransactions(state: AppState, currency: string): Transaction[] {
  return state.transactions.filter((transaction) =>
    transaction.status === 'completed'
    && transaction.currency === currency
    && !transaction.analysisExcluded,
  );
}

function postIncomePattern(state: AppState, currency: string): {
  purchaseCount: number;
  postIncomeCount: number;
  postIncomeAmountCents: number;
  totalAmountCents: number;
} {
  const transactions = observedCompletedTransactions(state, currency)
    .sort((a, b) => a.reportingDate.localeCompare(b.reportingDate));
  const incomeDates = transactions
    .filter((item) => isAnalyticalIncome(item) && signedNetMovement(item) > 0)
    .map((item) => item.reportingDate);
  const expenses = transactions.filter((item) => isAnalyticalExpense(item) && signedNetMovement(item) < 0);
  let postIncomeCount = 0;
  let postIncomeAmountCents = 0;
  let totalAmountCents = 0;
  for (const expense of expenses) {
    const amount = Math.abs(signedNetMovement(expense));
    totalAmountCents += amount;
    const followsIncome = incomeDates.some((date) => {
      const days = civilDaysBetween(date, expense.reportingDate);
      return days >= 0 && days <= 3;
    });
    if (followsIncome) {
      postIncomeCount += 1;
      postIncomeAmountCents += amount;
    }
  }
  return { purchaseCount: expenses.length, postIncomeCount, postIncomeAmountCents, totalAmountCents };
}

function recurringMerchants(state: AppState, currency: string): Array<{
  merchant: string;
  count: number;
  averageCents: number;
  variation: number;
}> {
  const expenses = observedCompletedTransactions(state, currency)
    .filter((item) =>
      isAnalyticalExpense(item)
      && signedNetMovement(item) < 0
      && item.categoryId === 'subscriptions',
    );
  const groups = new Map<string, number[]>();
  for (const transaction of expenses) {
    const merchant = transaction.merchantNormalized;
    if (!merchant) continue;
    const values = groups.get(merchant) ?? [];
    values.push(Math.abs(signedNetMovement(transaction)));
    groups.set(merchant, values);
  }
  return [...groups.entries()].flatMap(([merchant, values]) => {
    if (values.length < 3) return [];
    const averageCents = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    if (averageCents <= 0) return [];
    const maxDeviation = Math.max(...values.map((value) => Math.abs(value - averageCents) / averageCents));
    return [{ merchant, count: values.length, averageCents, variation: maxDeviation }];
  }).filter((item) => item.variation <= 0.08)
    .sort((a, b) => b.count - a.count || b.averageCents - a.averageCents);
}

function dismissedRecently(state: AppState, insight: FinancialInsight, now: Date): boolean {
  const feedback = state.insightFeedback.find((item) => item.insightKey === insight.key);
  if (!feedback?.dismissedAt) return false;
  const elapsed = now.getTime() - new Date(feedback.dismissedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 30 * 86_400_000;
}

function deduplicate(insights: FinancialInsight[]): FinancialInsight[] {
  const selected: FinancialInsight[] = [];
  const familyCounts = new Map<string, number>();
  const categoryFamilies = new Set<string>();
  for (const insight of insights) {
    const count = familyCounts.get(insight.family) ?? 0;
    const maxPerFamily = insight.family === 'category-change' ? 3 : 1;
    if (count >= maxPerFamily) continue;
    if (insight.categoryId) {
      const key = `${insight.family}:${insight.categoryId}`;
      if (categoryFamilies.has(key)) continue;
      categoryFamilies.add(key);
    }
    familyCounts.set(insight.family, count + 1);
    selected.push(insight);
  }
  return selected;
}

function addDataQualityInsights(state: AppState, bundle: AnalyticsBundle, items: FinancialInsight[]) {
  const current = bundle.current;
  const currencyAccountIds = new Set(state.accounts
    .filter((account) => account.currency === bundle.currency)
    .map((account) => account.id));
  const currentTransactionIds = new Set(current.transactions.map((item) => item.id));
  const unresolvedIssues = state.importIssues.filter((item) =>
    item.status === 'unresolved'
    && currencyAccountIds.has(item.accountId)
    && Boolean(item.transactionId && currentTransactionIds.has(item.transactionId)));
  const unresolvedTransactionIds = new Set(
    unresolvedIssues
      .map((item) => item.transactionId)
      .filter((id): id is string => Boolean(id)),
  );
  const unresolved = unresolvedIssues.length;
  const reviewTransactions = current.transactions
    .filter((item) => item.needsReview && !unresolvedTransactionIds.has(item.id))
    .length;
  const classificationGroups = state.reviewGroups.filter((item) => item.currency === bundle.currency && item.status === 'pending').length;
  const eventReviews = state.plannedEvents.filter((item) => item.currency === bundle.currency && item.needsAccountReview).length;
  const criticalTotal = unresolved + reviewTransactions;
  if (criticalTotal > 0) {
    items.push(candidate({
      id: 'data-quality-open-items',
      family: 'data-quality',
      title: 'Seus números ainda são provisórios',
      message: `${criticalTotal} ${criticalTotal === 1 ? 'item precisa' : 'itens precisam'} da sua ajuda antes de uma análise totalmente confiável.`,
      tone: 'warning',
      confidence: 'high',
      priority: 100,
      novelty: 90,
      evidence: [
        { label: 'Movimentações', value: String(reviewTransactions) },
        { label: 'Importação', value: String(unresolved) },
      ],
      action: 'review',
      actionLabel: 'Revisar agora',
      period: current.range,
    }));
  }
  if (eventReviews > 0) {
    items.push(candidate({
      id: `planned-events-account-review:${bundle.currency}`,
      family: 'planning-quality',
      title: 'Alguns compromissos ainda precisam de conta',
      message: `${eventReviews} ${eventReviews === 1 ? 'compromisso precisa' : 'compromissos precisam'} de uma conta-alvo antes de entrar nas previsões. Isso não altera o fluxo histórico exibido.`,
      tone: 'attention',
      confidence: 'high',
      priority: 68,
      novelty: 70,
      evidence: [{ label: 'Compromissos', value: String(eventReviews) }],
      action: 'review',
      actionLabel: 'Completar planejamento',
      period: current.range,
    }));
  }
  if (classificationGroups > 0) {
    items.push(candidate({
      id: `optional-classification-groups:${bundle.currency}`,
      family: 'classification-quality',
      title: 'Você pode melhorar os detalhes sem travar o app',
      message: `${classificationGroups} ${classificationGroups === 1 ? 'grupo ainda está' : 'grupos ainda estão'} sem categoria. O fluxo continua válido; a revisão melhora gráficos e descobertas.`,
      tone: 'neutral',
      confidence: 'high',
      priority: criticalTotal > 0 ? 57 : 73,
      novelty: 70,
      evidence: [{ label: 'Grupos opcionais', value: String(classificationGroups) }],
      action: 'review',
      actionLabel: 'Revisar grupos',
      period: current.range,
    }));
  }
  if (!current.isComplete && current.expenseTransactionCount > 0 && current.effectiveEnd < current.range.end) {
    items.push(candidate({
      id: `period-incomplete:${current.range.start}:${current.range.end}`,
      family: 'period-coverage',
      title: 'Este período ainda não terminou',
      message: `A análise usa dados até ${formatReportingDate(current.effectiveEnd)}. Comparações com períodos completos podem parecer melhores ou piores do que realmente são.`,
      tone: 'attention',
      confidence: 'high',
      priority: 76,
      evidence: [{ label: 'Dados até', value: formatReportingDate(current.effectiveEnd) }],
      period: current.range,
    }));
  }
}

function addCashflowInsights(bundle: AnalyticsBundle, items: FinancialInsight[]) {
  const { current, previous, currency } = bundle;
  const currentSpend = current.summary.netExpenseCents;
  const previousSpend = previous.summary.netExpenseCents;
  const change = percentChange(currentSpend, previousSpend);
  const minimum = 1_500;
  if (change !== undefined && Math.abs(currentSpend - previousSpend) >= minimum && Math.abs(change) >= 0.15 && previous.expenseTransactionCount >= 3) {
    const increased = change > 0;
    items.push(candidate({
      id: `total-spend-change:${current.range.start}`,
      family: 'total-spend-change',
      title: increased ? 'Seu ritmo de gastos aumentou' : 'Você reduziu seus gastos',
      message: increased
        ? `As saídas líquidas cresceram ${pct(Math.abs(change))} em comparação com o período anterior.`
        : `As saídas líquidas caíram ${pct(Math.abs(change))} em comparação com o período anterior.`,
      tone: increased ? 'warning' : 'positive',
      confidence: confidenceFor(current.expenseTransactionCount + previous.expenseTransactionCount),
      priority: increased ? 91 : 84,
      evidence: [
        { label: 'Período atual', value: formatMoney(currentSpend, currency) },
        { label: 'Período anterior', value: formatMoney(previousSpend, currency) },
      ],
      action: 'transactions',
      actionLabel: 'Ver movimentos',
      period: current.range,
    }));
  }

  if (current.summary.netCashflowCents > 0 && current.incomeTransactionCount > 0) {
    items.push(candidate({
      id: `positive-cashflow:${current.range.start}`,
      family: 'cashflow-result',
      title: 'Entrou mais do que saiu',
      message: `O fluxo do período ficou positivo em ${formatMoney(current.summary.netCashflowCents, currency)}.`,
      tone: 'positive',
      confidence: 'high',
      priority: 72,
      evidence: [
        { label: 'Entradas', value: formatMoney(current.summary.incomeCents, currency) },
        { label: 'Saídas líquidas', value: formatMoney(current.summary.netExpenseCents, currency) },
      ],
      period: current.range,
    }));
  } else if (current.summary.netCashflowCents < 0 && current.incomeTransactionCount > 0) {
    items.push(candidate({
      id: `negative-cashflow:${current.range.start}`,
      family: 'cashflow-result',
      title: 'Saiu mais do que entrou',
      message: `O fluxo do período ficou negativo em ${formatMoney(Math.abs(current.summary.netCashflowCents), currency)}. Isso não é o mesmo que o saldo da conta.`,
      tone: 'attention',
      confidence: 'high',
      priority: 79,
      evidence: [
        { label: 'Entradas', value: formatMoney(current.summary.incomeCents, currency) },
        { label: 'Saídas líquidas', value: formatMoney(current.summary.netExpenseCents, currency) },
      ],
      period: current.range,
    }));
  }

  if (current.refundTransactionCount > 0) {
    items.push(candidate({
      id: `refunds:${current.range.start}`,
      family: 'refunds',
      title: 'Reembolsos aliviaram o período',
      message: `${formatMoney(current.summary.refundCents, currency)} retornaram para a conta em ${current.refundTransactionCount} ${current.refundTransactionCount === 1 ? 'reembolso' : 'reembolsos'}.`,
      tone: 'positive',
      confidence: 'high',
      priority: 61,
      evidence: [{ label: 'Reembolsos', value: formatMoney(current.summary.refundCents, currency) }],
      period: current.range,
    }));
  }
}

function addCategoryInsights(state: AppState, bundle: AnalyticsBundle, items: FinancialInsight[]) {
  const { current, previous, currency } = bundle;
  const previousMap = amountMap(previous.byCategory);
  const currentMap = amountMap(current.byCategory);

  for (const category of current.byCategory) {
    if (category.key === 'uncategorized') continue;
    const before = previousMap.get(category.key);
    if (!before || before.transactionCount < 2 || category.transactionCount < 2) continue;
    const change = percentChange(category.amountCents, before.amountCents);
    if (change === undefined || Math.abs(change) < 0.25 || Math.abs(category.amountCents - before.amountCents) < 1_000) continue;
    const name = categoryName(state, category.key);
    const increased = change > 0;
    items.push(candidate({
      id: `category-change:${category.key}:${current.range.start}`,
      family: 'category-change',
      title: increased ? `${name} ganhou espaço` : `${name} caiu`,
      message: increased
        ? `Você gastou ${pct(Math.abs(change))} mais com ${name} do que no período anterior.`
        : `Você gastou ${pct(Math.abs(change))} menos com ${name} do que no período anterior.`,
      tone: increased ? 'attention' : 'positive',
      confidence: confidenceFor(category.transactionCount + before.transactionCount),
      priority: Math.min(90, 64 + Math.round(Math.abs(change) * 12) + Math.round(category.share * 20)),
      novelty: 75,
      evidence: [
        { label: 'Agora', value: formatMoney(category.amountCents, currency) },
        { label: 'Antes', value: formatMoney(before.amountCents, currency) },
        { label: 'Movimentações', value: String(category.transactionCount + before.transactionCount) },
      ],
      categoryId: category.key,
      action: 'transactions',
      actionLabel: `Ver ${name}`,
      period: current.range,
    }));
  }

  const top = current.byCategory[0];
  if (top && top.key !== 'uncategorized' && top.transactionCount >= 2 && top.share >= 0.28) {
    const name = categoryName(state, top.key);
    items.push(candidate({
      id: `category-concentration:${top.key}:${current.range.start}`,
      family: 'category-concentration',
      title: `${name} liderou seus gastos`,
      message: `${name} representou ${pct(top.share)} de todas as despesas do período.`,
      tone: top.share >= 0.5 ? 'attention' : 'neutral',
      confidence: confidenceFor(top.transactionCount),
      priority: top.share >= 0.5 ? 85 : 70,
      evidence: [
        { label: name, value: formatMoney(top.amountCents, currency) },
        { label: 'Participação', value: pct(top.share) },
      ],
      categoryId: top.key,
      period: current.range,
    }));
  }

  const previousTop = previous.byCategory[0];
  if (top && previousTop && top.key !== previousTop.key && top.amountCents >= 2_000) {
    items.push(candidate({
      id: `new-category-leader:${top.key}:${current.range.start}`,
      family: 'category-leader',
      title: 'Sua principal categoria mudou',
      message: `${categoryName(state, top.key)} passou à frente de ${categoryName(state, previousTop.key)} neste período.`,
      tone: 'neutral',
      confidence: confidenceFor(top.transactionCount + previousTop.transactionCount),
      priority: 68,
      evidence: [
        { label: categoryName(state, top.key), value: formatMoney(top.amountCents, currency) },
        { label: `Antes: ${categoryName(state, previousTop.key)}`, value: formatMoney(previousTop.amountCents, currency) },
      ],
      categoryId: top.key,
      period: current.range,
    }));
  }

  for (const before of previous.byCategory) {
    if (before.key === 'uncategorized' || before.amountCents < 2_000 || before.transactionCount < 2) continue;
    if (currentMap.has(before.key)) continue;
    items.push(candidate({
      id: `category-paused:${before.key}:${current.range.start}`,
      family: 'category-paused',
      title: `Nenhum gasto com ${categoryName(state, before.key)}`,
      message: `No período anterior foram ${formatMoney(before.amountCents, currency)}. Agora essa categoria não teve despesas registradas.`,
      tone: 'positive',
      confidence: 'high',
      priority: 58,
      categoryId: before.key,
      evidence: [{ label: 'Período anterior', value: formatMoney(before.amountCents, currency) }],
      period: current.range,
    }));
  }
}

function addBehaviorInsights(state: AppState, bundle: AnalyticsBundle, items: FinancialInsight[]) {
  const { current, previous, currency } = bundle;
  const topMerchant = current.byMerchant[0];
  if (topMerchant && topMerchant.transactionCount >= 2 && topMerchant.share >= 0.2) {
    const label = merchantLabel(topMerchant.key);
    items.push(candidate({
      id: `merchant-concentration:${topMerchant.key}:${current.range.start}`,
      family: 'merchant-concentration',
      title: `${label} teve peso relevante`,
      message: `${label} respondeu por ${pct(topMerchant.share)} das despesas do período.`,
      tone: topMerchant.share >= 0.4 ? 'attention' : 'neutral',
      confidence: confidenceFor(topMerchant.transactionCount),
      priority: topMerchant.share >= 0.4 ? 83 : 66,
      evidence: [
        { label: 'Total', value: formatMoney(topMerchant.amountCents, currency) },
        { label: 'Movimentações', value: String(topMerchant.transactionCount) },
      ],
      merchant: topMerchant.key,
      action: 'transactions',
      actionLabel: 'Ver movimentações relacionadas',
      period: current.range,
    }));
  }

  const topWeekday = current.byWeekday[0];
  if (topWeekday && current.expenseTransactionCount >= 8 && topWeekday.transactionCount >= 3 && topWeekday.share >= 0.28) {
    items.push(candidate({
      id: `weekday:${topWeekday.key}:${current.range.start}`,
      family: 'weekday-pattern',
      title: `${topWeekday.key} concentra mais gastos`,
      message: `${pct(topWeekday.share)} das despesas aconteceram nesse dia da semana.`,
      tone: 'neutral',
      confidence: confidenceFor(current.expenseTransactionCount),
      priority: 63,
      evidence: [
        { label: topWeekday.key, value: formatMoney(topWeekday.amountCents, currency) },
        { label: 'Movimentações', value: String(topWeekday.transactionCount) },
      ],
      period: current.range,
    }));
  }

  const night = current.byDaypart.find((item) => item.key === 'Noite');
  if (night && current.expenseTransactionCount >= 8 && night.transactionCount >= 4 && night.share >= 0.42) {
    items.push(candidate({
      id: `night-spending:${current.range.start}`,
      family: 'daypart-pattern',
      title: 'A noite pesa no seu orçamento',
      message: `${pct(night.share)} das despesas aconteceram depois das 18h.`,
      tone: night.share >= 0.6 ? 'attention' : 'neutral',
      confidence: confidenceFor(night.transactionCount),
      priority: night.share >= 0.6 ? 78 : 62,
      evidence: [
        { label: 'Gasto noturno', value: formatMoney(night.amountCents, currency) },
        { label: 'Movimentações', value: String(night.transactionCount) },
      ],
      period: current.range,
    }));
  }

  if (current.longestNoSpendStreak >= 3) {
    items.push(candidate({
      id: `no-spend-streak:${current.range.start}:${current.longestNoSpendStreak}`,
      family: 'no-spend-streak',
      title: `${current.longestNoSpendStreak} dias sem gastos registrados`,
      message: `Você passou ${current.longestNoSpendStreak} dias seguidos sem registrar gastos variáveis.`,
      tone: 'positive',
      confidence: 'high',
      priority: Math.min(72, 48 + current.longestNoSpendStreak * 4),
      evidence: [
        { label: 'Maior sequência', value: `${current.longestNoSpendStreak} dias` },
        { label: 'Dias sem gasto', value: String(current.daysWithoutExpense) },
      ],
      period: current.range,
    }));
  }

  if (current.largestExpense && current.largestExpense.amountCents >= Math.max(2_500, current.averageExpenseCents * 2.5)) {
    items.push(candidate({
      id: `largest-expense:${current.largestExpense.transactionId}`,
      family: 'largest-expense',
      title: 'Uma saída se destacou',
      message: `${current.largestExpense.description} foi a maior despesa do período: ${formatMoney(current.largestExpense.amountCents, currency)}.`,
      tone: 'neutral',
      confidence: 'high',
      priority: 60,
      evidence: [
        { label: 'Data', value: formatReportingDate(current.largestExpense.reportingDate) },
        { label: 'Categoria', value: categoryName(state, current.largestExpense.categoryId) },
      ],
      categoryId: current.largestExpense.categoryId,
      action: 'transactions',
      actionLabel: 'Abrir movimentos',
      period: current.range,
    }));
  }

  const averageChange = percentChange(current.averageExpenseCents, previous.averageExpenseCents);
  if (averageChange !== undefined && previous.expenseTransactionCount >= 4 && current.expenseTransactionCount >= 4 && Math.abs(averageChange) >= 0.25) {
    const increased = averageChange > 0;
    items.push(candidate({
      id: `average-ticket:${current.range.start}`,
      family: 'average-ticket',
      title: increased ? 'Suas despesas ficaram maiores' : 'Suas despesas ficaram menores',
      message: `O valor médio por despesa ${increased ? 'subiu' : 'caiu'} ${pct(Math.abs(averageChange))}.`,
      tone: increased ? 'attention' : 'positive',
      confidence: confidenceFor(current.expenseTransactionCount + previous.expenseTransactionCount),
      priority: 59,
      evidence: [
        { label: 'Média atual', value: formatMoney(current.averageExpenseCents, currency) },
        { label: 'Média anterior', value: formatMoney(previous.averageExpenseCents, currency) },
      ],
      period: current.range,
    }));
  }

  const postIncome = postIncomePattern(state, currency);
  if (postIncome.purchaseCount >= 10 && postIncome.postIncomeCount >= 4 && postIncome.totalAmountCents > 0) {
    const share = postIncome.postIncomeAmountCents / postIncome.totalAmountCents;
    if (share >= 0.35) {
      items.push(candidate({
        id: 'post-income-pattern',
        family: 'post-income-pattern',
        title: 'Seus gastos se concentram após entradas',
        message: `${pct(share)} dos seus gastos históricos aconteceram até três dias depois de uma entrada classificada como receita.`,
        tone: share >= 0.55 ? 'attention' : 'neutral',
        confidence: confidenceFor(postIncome.purchaseCount),
        priority: share >= 0.55 ? 77 : 64,
        novelty: 88,
        evidence: [
          { label: 'Após receitas', value: formatMoney(postIncome.postIncomeAmountCents, currency) },
          { label: 'Movimentações analisadas', value: String(postIncome.purchaseCount) },
        ],
        period: current.range,
      }));
    }
  }

  const recurring = recurringMerchants(state, currency)[0];
  if (recurring && recurring.count >= 3) {
    items.push(candidate({
      id: `recurring-merchant:${recurring.merchant}`,
      family: 'recurring-merchant',
      title: 'Possível cobrança recorrente',
      message: `${merchantLabel(recurring.merchant)} apareceu ${recurring.count} vezes com valor próximo de ${formatMoney(recurring.averageCents, currency)}.`,
      tone: 'neutral',
      confidence: recurring.count >= 5 ? 'high' : 'medium',
      priority: 65,
      novelty: 82,
      evidence: [
        { label: 'Ocorrências', value: String(recurring.count) },
        { label: 'Variação máxima', value: pct(recurring.variation, 1) },
      ],
      merchant: recurring.merchant,
      action: 'transactions',
      actionLabel: 'Conferir cobranças',
      period: current.range,
    }));
  }
}

function addBalanceAndPlanningInsights(state: AppState, bundle: AnalyticsBundle, items: FinancialInsight[]) {
  const { currency, current } = bundle;
  const latest = latestReconciledBalance(state, currency);
  const reserve = state.reservePolicies.find((item) => item.currency === currency)?.minimumCents ?? 0;
  if (latest) {
    const margin = latest.balanceCents - reserve;
    if (margin < 0) {
      items.push(candidate({
        id: `reserve-below:${latest.batchId}`,
        family: 'reserve-position',
        title: 'Saldo abaixo da reserva mínima',
        message: `A posição reconciliada está ${formatMoney(Math.abs(margin), currency)} abaixo da sua reserva.`,
        tone: 'warning',
        confidence: 'high',
        priority: 99,
        evidence: [
          { label: 'Saldo reconciliado', value: formatMoney(latest.balanceCents, currency) },
          { label: 'Reserva mínima', value: formatMoney(reserve, currency) },
        ],
        action: 'accounts',
        actionLabel: 'Revisar saldo',
        period: current.range,
      }));
    } else if (reserve > 0) {
      items.push(candidate({
        id: `reserve-covered:${latest.batchId}`,
        family: 'reserve-position',
        title: 'Sua reserva está protegida',
        message: `Há ${formatMoney(margin, currency)} acima da reserva mínima na posição reconciliada.`,
        tone: 'positive',
        confidence: 'high',
        priority: 73,
        evidence: [
          { label: 'Saldo reconciliado', value: formatMoney(latest.balanceCents, currency) },
          { label: 'Reserva mínima', value: formatMoney(reserve, currency) },
        ],
        period: current.range,
      }));
    }
  }

  const balanceChange = previousReconciledBalance(state, currency);
  if (balanceChange && Math.abs(balanceChange.differenceCents) >= 1_500) {
    const increased = balanceChange.differenceCents > 0;
    items.push(candidate({
      id: `reconciled-balance-change:${balanceChange.currentCents}`,
      family: 'balance-change',
      title: increased ? 'Sua posição reconciliada aumentou' : 'Sua posição reconciliada diminuiu',
      message: `A diferença entre as duas últimas reconciliações foi de ${formatMoney(Math.abs(balanceChange.differenceCents), currency)}.`,
      tone: increased ? 'positive' : 'attention',
      confidence: 'high',
      priority: increased ? 82 : 87,
      evidence: [
        { label: 'Atual', value: formatMoney(balanceChange.currentCents, currency) },
        { label: 'Anterior', value: formatMoney(balanceChange.previousCents, currency) },
      ],
      period: current.range,
    }));
  }

  const today = bundle.latestReportingDate ?? current.effectiveEnd;
  const horizon = addCivilDays(today, 30);
  const upcoming = state.plannedEvents
    .filter((event) => event.active && event.currency === currency && event.dueDate >= today && event.dueDate <= horizon)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next = upcoming[0];
  if (next) {
    const days = civilDaysBetween(today, next.dueDate);
    items.push(candidate({
      id: `next-event:${next.id}:${next.dueDate}`,
      family: 'next-planned-event',
      title: `${next.title} está chegando`,
      message: `${formatMoney(next.amountCents, currency)} ${next.direction === 'inflow' ? 'devem entrar' : 'devem sair'} ${days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`}.`,
      tone: next.direction === 'outflow' && days <= 7 ? 'attention' : 'neutral',
      confidence: next.needsAccountReview ? 'low' : 'high',
      priority: next.direction === 'outflow' && days <= 7 ? 94 : 75,
      evidence: [
        { label: 'Data', value: formatReportingDate(next.dueDate) },
        { label: 'Tipo', value: next.direction === 'inflow' ? 'Entrada planejada' : 'Saída planejada' },
      ],
      action: 'accounts',
      actionLabel: 'Ver planejamento',
      period: current.range,
    }));
  }

  if (latest && upcoming.length > 0) {
    const plannedOutflows = upcoming
      .filter((event) => event.direction === 'outflow')
      .reduce((sum, event) => sum + event.amountCents, 0);
    const usable = Math.max(0, latest.balanceCents - reserve);
    if (plannedOutflows > 0 && usable > 0) {
      const share = plannedOutflows / usable;
      if (share >= 0.5) {
        items.push(candidate({
          id: `commitment-pressure:${today}`,
          family: 'commitment-pressure',
          title: 'Compromissos vão consumir boa parte da margem',
          message: `As saídas planejadas dos próximos 30 dias equivalem a ${pct(share)} do valor acima da reserva.`,
          tone: share >= 0.9 ? 'warning' : 'attention',
          confidence: 'high',
          priority: share >= 0.9 ? 96 : 86,
          evidence: [
            { label: 'Saídas planejadas', value: formatMoney(plannedOutflows, currency) },
            { label: 'Margem acima da reserva', value: formatMoney(usable, currency) },
          ],
          action: 'assistant',
          actionLabel: 'Calcular limite seguro',
          period: current.range,
        }));
      }
    }
  }

  if (balanceChange?.differenceCents && balanceChange.differenceCents > 0 && current.summary.netExpenseCents < bundle.previous.summary.netExpenseCents) {
    const reductions = current.byCategory
      .map((item) => ({ item, previous: bundle.previous.byCategory.find((before) => before.key === item.key) }))
      .filter((entry) => entry.previous && entry.item.amountCents < entry.previous.amountCents)
      .sort((a, b) => (b.previous!.amountCents - b.item.amountCents) - (a.previous!.amountCents - a.item.amountCents))
      .slice(0, 2);
    if (reductions.length) {
      const names = reductions.map((entry) => categoryName(state, entry.item.key));
      items.push(candidate({
        id: `combined-reserve-growth:${current.range.start}`,
        family: 'combined-progress',
        title: 'Menos gastos, posição maior',
        message: `A redução em ${names.join(' e ')} foi acompanhada por um aumento de ${formatMoney(balanceChange.differenceCents, currency)} na posição reconciliada.`,
        tone: 'positive',
        confidence: 'high',
        priority: 89,
        novelty: 95,
        evidence: reductions.map((entry) => ({
          label: categoryName(state, entry.item.key),
          value: `-${formatMoney(entry.previous!.amountCents - entry.item.amountCents, currency)}`,
        })),
        period: current.range,
      }));
    }
  }
}

export function generateInsights(
  state: AppState,
  currency: string,
  range?: DateRange,
  options: { limit?: number; now?: Date } = {},
): InsightEngineResult {
  const bundle = buildAnalytics(state, currency, range);
  const generated: FinancialInsight[] = [];

  if (!bundle.current.transactions.length) {
    const empty = candidate({
      id: `no-data:${currency}`,
      family: 'no-data',
      title: 'Ainda não há dados suficientes',
      message: 'Importe um extrato ou registre movimentações para o app começar a encontrar padrões.',
      tone: 'neutral',
      confidence: 'high',
      priority: 100,
      action: 'accounts',
      actionLabel: 'Importar extrato',
      period: bundle.current.range,
    });
    return { generatedCount: 1, eligibleCount: 1, insights: [empty] };
  }

  addDataQualityInsights(state, bundle, generated);
  addCashflowInsights(bundle, generated);
  addCategoryInsights(state, bundle, generated);
  addBehaviorInsights(state, bundle, generated);
  addBalanceAndPlanningInsights(state, bundle, generated);

  const now = options.now ?? new Date();
  const eligible = generated
    .filter((insight) => insight.confidence !== 'low' || insight.priority >= 90)
    .filter(isActionableFinancialInsight)
    .filter((insight) => !dismissedRecently(state, insight, now))
    .sort((a, b) => b.priority - a.priority || b.novelty - a.novelty || a.title.localeCompare(b.title));
  const deduped = deduplicate(eligible);
  return {
    generatedCount: generated.length,
    eligibleCount: deduped.length,
    insights: deduped.slice(0, options.limit ?? 20),
  };
}
