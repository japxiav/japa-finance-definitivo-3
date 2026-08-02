import type { AppState } from '../core/types';
import type { AnalyticsBundle } from '../analytics/metrics';
import type { CurrencyAnalytics } from '../analytics/currencyAnalytics';
import type { CurrencyPosition, FreeMoneyPosition } from '../analytics/accountPositions';
import type { InternalTransferSuggestion } from '../application/internalTransfers';
import { signedNetMovement } from '../core/finance';
import { addCents } from '../domain/arithmetic';

export type ImpactInsightGroup = 'now' | 'opportunity';
export type ImpactInsightTone = 'critical' | 'attention' | 'positive' | 'neutral';
export type ImpactInsightAction = 'reconcile' | 'plan' | 'internal-transfers' | 'transactions' | 'transfer-details' | 'accounts';

export interface ImpactInsight {
  id: string;
  group: ImpactInsightGroup;
  tone: ImpactInsightTone;
  title: string;
  message: string;
  impactLabel?: string;
  impactValue?: string;
  evidence: Array<{ label: string; value: string }>;
  action?: ImpactInsightAction;
  actionLabel?: string;
}

function monthlyEquivalent(amountCents: number, frequency?: 'weekly' | 'monthly' | 'yearly'): number {
  if (frequency === 'weekly') return Math.round(amountCents * 52 / 12);
  if (frequency === 'yearly') return Math.round(amountCents / 12);
  return amountCents;
}

export function buildImpactInsights(input: {
  state: AppState;
  currency: string;
  position: CurrencyPosition;
  freeMoney: FreeMoneyPosition;
  analytics: AnalyticsBundle;
  currencyAnalytics: CurrencyAnalytics;
  internalSuggestions: InternalTransferSuggestion[];
  formatMoney: (amountCents: number) => string;
}): ImpactInsight[] {
  const { state, currency, position, freeMoney, analytics, currencyAnalytics, internalSuggestions, formatMoney } = input;
  const items: ImpactInsight[] = [];

  if (position.confidence === 'missing') {
    items.push({
      id: 'balance-missing', group: 'now', tone: 'attention', title: 'Confirme quanto existe nas contas',
      message: 'Sem um saldo reconciliado por conta, o aplicativo consegue explicar o histórico, mas não consegue afirmar quanto está livre agora.',
      evidence: [{ label: 'Contas sem saldo', value: String(position.missingAccountCount) }],
      action: 'reconcile', actionLabel: 'Atualizar saldos',
    });
  } else if (position.confidence === 'stale') {
    items.push({
      id: 'balance-stale', group: 'now', tone: 'attention', title: 'Seu saldo pode estar desatualizado',
      message: 'A última posição confiável ficou para trás. Reconciliar agora evita decisões baseadas num saldo antigo vestido de número atual.',
      evidence: [{ label: 'Última confirmação', value: position.latestAsOf ? new Date(position.latestAsOf).toLocaleString('pt-BR') : 'não disponível' }],
      action: 'reconcile', actionLabel: 'Confirmar saldo',
    });
  } else if (position.confidence === 'estimated') {
    items.push({
      id: 'balance-estimated', group: 'now', tone: 'neutral', title: 'Saldo atualizado por estimativa',
      message: 'O valor atual foi calculado a partir do último saldo confirmado e das movimentações posteriores. Uma reconciliação transforma a estimativa em confirmação.',
      evidence: [{ label: 'Saldo calculado', value: formatMoney(position.currentBalanceCents ?? 0) }],
      action: 'reconcile', actionLabel: 'Confirmar agora',
    });
  }

  if (freeMoney.status === 'ready' && freeMoney.freeCents !== undefined) {
    if (freeMoney.freeCents < 0) {
      items.push({
        id: 'free-money-negative', group: 'now', tone: 'critical', title: 'Os compromissos ultrapassam o dinheiro disponível',
        message: `Depois da reserva mínima e dos compromissos antes da próxima receita, faltam ${formatMoney(Math.abs(freeMoney.freeCents))}.`,
        impactLabel: 'Déficit projetado', impactValue: formatMoney(Math.abs(freeMoney.freeCents)),
        evidence: [
          { label: 'Saldo atual', value: formatMoney(freeMoney.currentBalanceCents ?? 0) },
          { label: 'Compromissos', value: formatMoney(freeMoney.commitmentsCents) },
          { label: 'Reserva protegida', value: formatMoney(freeMoney.reserveCents) },
        ],
        action: 'plan', actionLabel: 'Rever planejamento',
      });
    } else if (freeMoney.daysToNextIncome && freeMoney.safeDailyCents !== undefined) {
      items.push({
        id: 'safe-daily', group: 'now', tone: freeMoney.safeDailyCents < 1_500 ? 'attention' : 'positive',
        title: 'Seu limite diário até a próxima entrada',
        message: `Mantendo compromissos e reserva protegidos, o teto médio é ${formatMoney(freeMoney.safeDailyCents)} por dia durante ${freeMoney.daysToNextIncome} dias.`,
        impactLabel: 'Dinheiro realmente livre', impactValue: formatMoney(freeMoney.freeCents),
        evidence: [
          { label: 'Próxima receita', value: freeMoney.nextIncomeDate ?? 'não cadastrada' },
          { label: 'Compromissos antes dela', value: formatMoney(freeMoney.commitmentsCents) },
        ],
        action: 'plan', actionLabel: 'Ver compromissos',
      });
    }
  }

  if (internalSuggestions.length > 0) {
    const total = internalSuggestions.reduce((sum, suggestion) => addCents(sum, suggestion.amountCents), 0);
    items.push({
      id: 'internal-suggestions', group: 'now', tone: 'attention', title: 'Há transferências que podem ser entre suas contas',
      message: 'Confirmar os pares evita que Wise e Revolut inflam entradas e saídas sem mudar seu patrimônio.',
      impactLabel: 'Montante para revisar', impactValue: formatMoney(total),
      evidence: [{ label: 'Pares sugeridos', value: String(internalSuggestions.length) }],
      action: 'internal-transfers', actionLabel: 'Revisar pares',
    });
  }

  const allocatedTransactionIds = new Set(state.transactionAllocations.map((allocation) => allocation.transactionId));
  const undetailedTransfers = analytics.current.transactions.filter((transaction) =>
    transaction.kind === 'transfer'
    && transaction.direction === 'outflow'
    && !transaction.analysisExcluded
    && !allocatedTransactionIds.has(transaction.id)
    && !transaction.counterpartyEntityId);
  const counterparties = new Set(undetailedTransfers
    .map((transaction) => transaction.merchantNormalized)
    .filter(Boolean));
  if (counterparties.size > 0 && undetailedTransfers.length >= 3) {
    const total = undetailedTransfers.reduce((sum, transaction) => addCents(sum, Math.abs(signedNetMovement(transaction))), 0);
    items.push({
      id: 'unknown-transfer-contexts', group: 'opportunity', tone: 'neutral', title: 'Algumas pessoas recorrentes ainda não têm contexto',
      message: `Há ${counterparties.size} ${counterparties.size === 1 ? 'contraparte recorrente' : 'contrapartes recorrentes'} sem vínculo na Memória Financeira. Identificar cada grupo uma vez evita revisar transferência por transferência.`,
      impactLabel: 'Movimento sem contexto', impactValue: formatMoney(total),
      evidence: [{ label: 'Transferências', value: String(undetailedTransfers.length) }, { label: 'Grupos de contraparte', value: String(counterparties.size) }],
      action: 'transfer-details', actionLabel: 'Ensinar contexto por grupo',
    });
  }

  const recurring = state.transactionAllocations.filter((allocation) => allocation.recurring
    && state.transactions.some((transaction) => transaction.id === allocation.transactionId && transaction.currency === currency));
  if (recurring.length > 0) {
    const monthly = recurring.reduce((sum, allocation) => addCents(sum, monthlyEquivalent(allocation.amountCents, allocation.recurrenceFrequency)), 0);
    items.push({
      id: 'shared-recurring', group: 'opportunity', tone: 'neutral', title: 'Pagamentos recorrentes escondidos em transferências',
      message: `Os itens detalhados equivalem a aproximadamente ${formatMoney(monthly)} por mês e ${formatMoney(monthly * 12)} por ano.`,
      impactLabel: 'Impacto anual', impactValue: formatMoney(monthly * 12),
      evidence: [{ label: 'Itens recorrentes', value: String(recurring.length) }, { label: 'Média mensal', value: formatMoney(monthly) }],
      action: 'plan', actionLabel: 'Planejar recorrências',
    });
  }

  if (currencyAnalytics.explicitFeeCents > 0) {
    const mostExpensive = [...currencyAnalytics.institutions].sort((a, b) => b.feeCents - a.feeCents)[0];
    items.push({
      id: 'explicit-fees', group: 'opportunity', tone: currencyAnalytics.explicitFeeCents >= 2_000 ? 'attention' : 'neutral',
      title: 'As taxas bancárias já têm um custo mensurável',
      message: `As comissões explícitas somam ${formatMoney(currencyAnalytics.explicitFeeCents)} no histórico disponível em ${currency}.`,
      impactLabel: 'Taxas explícitas', impactValue: formatMoney(currencyAnalytics.explicitFeeCents),
      evidence: mostExpensive ? [{ label: 'Maior parcela', value: `${mostExpensive.institution}: ${formatMoney(mostExpensive.feeCents)}` }] : [],
      action: 'accounts', actionLabel: 'Comparar instituições',
    });
  }

  return items;
}
