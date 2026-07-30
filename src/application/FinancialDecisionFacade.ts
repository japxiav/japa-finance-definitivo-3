
import { localCivilDate } from '../core/date';
import { expenseByCategory } from '../core/finance';
import { formatMoney, parseSignedMoneyToCents } from '../core/money';
import type { AppState } from '../core/types';
import { addCents, MonetaryArithmeticError } from '../domain/arithmetic';
import { availableUntilNextIncome, evaluatePurchase } from '../domain/decisions';
import { addCivilDays } from '../domain/dates';
import { buildConsolidatedForecast } from '../domain/forecast';
import type { CivilDate, DecisionEvidence, ForecastResult } from '../domain/model';
import { adaptAppStateToFinancialState } from './appStateAdapter';

export interface AssistantResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  amountCents?: number;
  status?: 'safe' | 'unsafe' | 'incomplete' | 'info';
  structuredEvidence?: DecisionEvidence[];
  dataScope?: string;
}

export interface FinancialDecisionFacade {
  buildForecast(input: { appState: AppState; currency: string; horizonStart: CivilDate; horizonEnd: CivilDate }): ForecastResult | undefined;
  getReconciledPosition(input: { appState: AppState; currency: string; accountId?: string }): AssistantResult;
  evaluatePurchase(input: { appState: AppState; currency: string; accountId: string; amountCents: number; purchaseDate: CivilDate; horizonEnd: CivilDate }): AssistantResult;
  calculateSpendingLimit(input: { appState: AppState; currency: string; accountId: string; horizonStart: CivilDate; horizonEnd: CivilDate }): AssistantResult;
  answerQuestion(input: { appState: AppState; currency: string; question: string; targetAccountId?: string; range?: { start?: string; end?: string }; today?: CivilDate }): AssistantResult;
}


interface QuestionAmount {
  amountCents: number;
  explicitCurrency?: string;
}

function currencyFromToken(token: string): string {
  const normalized = token.trim().toUpperCase();
  if (normalized === '€' || normalized === 'EUR') return 'EUR';
  if (normalized === 'R$' || normalized === 'BRL') return 'BRL';
  if (normalized === '£' || normalized === 'GBP') return 'GBP';
  return 'USD';
}

function amountFromQuestion(question: string): QuestionAmount | undefined {
  const numberPattern = String.raw`\b(?:[0-9]{1,3}(?:[.\s][0-9]{3})+(?:,[0-9]{1,2})?|[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)\b`;
  const currencyPattern = String.raw`R\$|€|£|\$|\bEUR\b|\bBRL\b|\bGBP\b|\bUSD\b`;
  const explicit = new RegExp(
    String.raw`(${currencyPattern})\s*(${numberPattern})|(${numberPattern})\s*(${currencyPattern})`,
    'gi',
  );
  const explicitValues = [...question.matchAll(explicit)].map((match) => ({
    token: match[1] ?? match[4] ?? '',
    raw: match[2] ?? match[3] ?? '',
  })).filter((item) => item.token && item.raw);

  if (explicitValues.length > 0) {
    const selected = explicitValues.at(-1)!;
    try {
      const amountCents = parseSignedMoneyToCents(selected.raw.replace(/\s/g, ''));
      return Number.isSafeInteger(amountCents) && amountCents > 0
        ? { amountCents, explicitCurrency: currencyFromToken(selected.token) }
        : undefined;
    } catch {
      return undefined;
    }
  }

  const withoutTemporalNumbers = question
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, ' ')
    .replace(/(?:daqui|em)\s+\d{1,4}\s+dias?\b/gi, ' ');
  const candidates = [...withoutTemporalNumbers.matchAll(new RegExp(numberPattern, 'g'))]
    .map((match) => match[0]);
  // Números temporais reconhecidos não disputam com o valor da compra. Outros
  // números sem moeda continuam ambíguos (parcelas, quantidade, desconto etc.).
  if (candidates.length !== 1) return undefined;
  try {
    const amountCents = parseSignedMoneyToCents(candidates[0]!.replace(/\s/g, ''));
    return Number.isSafeInteger(amountCents) && amountCents > 0 ? { amountCents } : undefined;
  } catch {
    return undefined;
  }
}



function purchaseDateFromQuestion(question: string, today: CivilDate): CivilDate | undefined {
  const normalized = question.toLocaleLowerCase('pt-BR');
  try {
    if (/depois\s+de\s+amanh[ãa]/i.test(normalized)) return addCivilDays(today, 2);
    if (/amanh[ãa]/i.test(normalized)) return addCivilDays(today, 1);

    const relative = normalized.match(/(?:daqui|em)\s+(\d{1,4})\s+dias?\b/i);
    if (relative) {
      const days = Number(relative[1]);
      if (!Number.isSafeInteger(days) || days < 0 || days > 3_660) return undefined;
      return addCivilDays(today, days);
    }

    const dayFirst = normalized.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (dayFirst) {
      const candidate = `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}`;
      return addCivilDays(candidate, 0);
    }

    const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return addCivilDays(iso[1]!, 0);

    return today;
  } catch {
    return undefined;
  }
}

function addDaysOrUndefined(value: CivilDate, days: number): CivilDate | undefined {
  try {
    return addCivilDays(value, days);
  } catch {
    return undefined;
  }
}

function incomplete(blockers: string[]): AssistantResult {
  return { answer: `Não consigo calcular com segurança: ${blockers.join(', ')}.`, confidence: 'low', evidence: blockers, status: 'incomplete' };
}

export class DefaultFinancialDecisionFacade implements FinancialDecisionFacade {
  buildForecast(input: { appState: AppState; currency: string; horizonStart: CivilDate; horizonEnd: CivilDate }) {
    const adapted = adaptAppStateToFinancialState(input.appState, input.currency);
    if (!adapted.state || !adapted.reconciliationBatchId) return undefined;
    return buildConsolidatedForecast({
      state: adapted.state,
      reconciliationBatchId: adapted.reconciliationBatchId,
      horizonStart: input.horizonStart,
      horizonEnd: input.horizonEnd,
    });
  }

  getReconciledPosition(input: { appState: AppState; currency: string; accountId?: string }): AssistantResult {
    const adapted = adaptAppStateToFinancialState(input.appState, input.currency);
    if (!adapted.state || !adapted.reconciliationBatchId) return incomplete(adapted.blockers);
    const snapshots = adapted.state.balanceSnapshots.filter((snapshot) =>
      snapshot.currency === input.currency &&
      (!input.accountId || snapshot.accountId === input.accountId));
    if (!snapshots.length) return incomplete(['ACTIVE_ACCOUNT_SNAPSHOT_MISSING']);
    let total: number;
    try {
      total = snapshots.reduce((sum, snapshot) => addCents(sum, snapshot.balanceCents), 0);
    } catch (error) {
      if (error instanceof MonetaryArithmeticError) return incomplete(['ARITHMETIC_OVERFLOW']);
      throw error;
    }
    return {
      answer: `Saldo reconciliado em ${input.currency}: ${formatMoney(total, input.currency)}.`,
      confidence: 'high',
      evidence: [`Batch: ${adapted.reconciliationBatchId}.`],
      dataScope: 'posição reconciliada; sem eventos futuros',
      amountCents: total,
      status: 'info',
    };
  }

  evaluatePurchase(input: { appState: AppState; currency: string; accountId: string; amountCents: number; purchaseDate: CivilDate; horizonEnd: CivilDate }): AssistantResult {
    const adapted = adaptAppStateToFinancialState(input.appState, input.currency);
    if (!adapted.state || !adapted.reconciliationBatchId) return incomplete(adapted.blockers);
    const batch = adapted.state.reconciliationBatches.find((item) => item.id === adapted.reconciliationBatchId)!;
    const logicalDate = batch.logicalDate;
    let horizonStart: CivilDate;
    try {
      horizonStart = addCivilDays(logicalDate, 1);
    } catch {
      return incomplete(['DATE_INVALID']);
    }
    const forecast = buildConsolidatedForecast({
      state: adapted.state, reconciliationBatchId: adapted.reconciliationBatchId,
      horizonStart, horizonEnd: input.horizonEnd,
    });
    const decision = evaluatePurchase({
      state: adapted.state, forecast, accountId: input.accountId,
      amountCents: input.amountCents, purchaseDate: input.purchaseDate,
    });
    if (decision.status === 'INCOMPLETE' || decision.status === 'INVALID') return incomplete(decision.blockers);
    const margin = decision.marginCents ?? 0;
    return {
      answer: decision.status === 'SAFE'
        ? `A compra cabe na projeção conhecida. A menor margem acima da reserva seria ${formatMoney(margin, input.currency)}.`
        : `A compra não é segura na projeção conhecida. O caixa ficaria ${formatMoney(Math.abs(margin), input.currency)} abaixo da reserva.`,
      confidence: 'high',
      evidence: decision.evidence.map((item) => `${item.title}${item.dueAt ? ` em ${item.dueAt}` : ''}: ${formatMoney(item.impactCents, input.currency)}.`),
      structuredEvidence: decision.evidence,
      dataScope: 'novo domínio: snapshots + eventos futuros',
      amountCents: margin,
      status: decision.status === 'SAFE' ? 'safe' : 'unsafe',
    };
  }

  calculateSpendingLimit(input: { appState: AppState; currency: string; accountId: string; horizonStart: CivilDate; horizonEnd: CivilDate }): AssistantResult {
    const adapted = adaptAppStateToFinancialState(input.appState, input.currency);
    if (!adapted.state || !adapted.reconciliationBatchId) return incomplete(adapted.blockers);
    const batch = adapted.state.reconciliationBatches.find((item) => item.id === adapted.reconciliationBatchId)!;
    const logicalDate = batch.logicalDate;
    let horizonStart: CivilDate;
    try {
      horizonStart = addCivilDays(logicalDate, 1);
    } catch {
      return incomplete(['DATE_INVALID']);
    }
    const forecast = buildConsolidatedForecast({
      state: adapted.state, reconciliationBatchId: adapted.reconciliationBatchId,
      horizonStart, horizonEnd: input.horizonEnd,
    });
    const decision = availableUntilNextIncome({
      state: adapted.state, forecast, accountId: input.accountId, decisionDate: input.horizonStart,
    });
    if (decision.status === 'INCOMPLETE' || decision.status === 'INVALID') return incomplete(decision.blockers);
    const margin = decision.marginCents ?? 0;
    return {
      answer: decision.status === 'SAFE'
        ? `O limite projetado acima da reserva é ${formatMoney(margin, input.currency)}.`
        : `Não há limite seguro até à próxima receita. Antes dela, o caixa já ficaria ${formatMoney(Math.abs(margin), input.currency)} abaixo da reserva.`,
      confidence: 'high',
      evidence: decision.evidence.map((item) => `${item.title}: ${formatMoney(item.impactCents, input.currency)}.`),
      structuredEvidence: decision.evidence,
      dataScope: 'novo domínio: até à próxima receita',
      amountCents: margin,
      status: decision.status === 'SAFE' ? 'safe' : 'unsafe',
    };
  }

  answerQuestion(input: { appState: AppState; currency: string; question: string; targetAccountId?: string; range?: { start?: string; end?: string }; today?: CivilDate }): AssistantResult {
    const clean = input.question.trim();
    if (!clean) return { answer: 'Escreva uma pergunta sobre seus números.', confidence: 'low', evidence: [] };
    if (/duplicad/i.test(clean)) {
      const count = input.appState.importIssues.filter((item) => item.status === 'unresolved' && item.kind === 'possible_duplicate').length;
      return { answer: count ? `Há ${count} possível(is) duplicata(s) aguardando revisão.` : 'Não há possíveis duplicatas pendentes.', confidence: 'high', evidence: [`${count} pendência(s).`] };
    }
    const today = input.today ?? localCivilDate();
    const targetAccount = input.targetAccountId
      ? input.appState.accounts.find((item) =>
          item.id === input.targetAccountId && item.active && item.currency === input.currency)
      : undefined;
    const requiresTargetAccount =
      /quanto.*gastar.*pagamento|at[eé].*pagamento|pr[oó]ximo.*sal[aá]rio|posso|comprar|compra|gastar|mandar|enviar/i.test(clean);
    if (requiresTargetAccount && !targetAccount) {
      return incomplete(['TARGET_ACCOUNT_REQUIRED']);
    }
    if (/quanto.*gastar.*pagamento|at[eé].*pagamento|pr[oó]ximo.*sal[aá]rio/i.test(clean)) {
      const horizonEnd = addDaysOrUndefined(today, 90);
      if (!horizonEnd) return incomplete(['DATE_INVALID']);
      return this.calculateSpendingLimit({ appState: input.appState, currency: input.currency, accountId: targetAccount!.id, horizonStart: today, horizonEnd });
    }
    if (/posso|comprar|compra|gastar|mandar|enviar/i.test(clean)) {
      const amount = amountFromQuestion(clean);
      if (!amount) return { answer: 'Informe o valor da compra.', confidence: 'low', evidence: [] };
      if (amount.explicitCurrency && amount.explicitCurrency !== input.currency) {
        return {
          answer: `O valor foi informado em ${amount.explicitCurrency}, mas a conta selecionada está em ${input.currency}. Troque a moeda ou informe o valor em ${input.currency}.`,
          confidence: 'low',
          evidence: ['QUESTION_CURRENCY_MISMATCH'],
        };
      }
      const purchaseDate = purchaseDateFromQuestion(clean, today);
      if (!purchaseDate) return incomplete(['PURCHASE_DATE_INVALID_OR_UNSUPPORTED']);
      const horizonEnd = addDaysOrUndefined(purchaseDate, 90);
      if (!horizonEnd) return incomplete(['DATE_INVALID']);
      return this.evaluatePurchase({ appState: input.appState, currency: input.currency, accountId: targetAccount!.id, amountCents: amount.amountCents, purchaseDate, horizonEnd });
    }
    if (/saldo|quanto tenho|dinheiro dispon[ií]vel/i.test(clean)) {
      return this.getReconciledPosition({
        appState: input.appState,
        currency: input.currency,
        accountId: targetAccount?.id,
      });
    }
    if (/onde|categoria|gastei|dinheiro/i.test(clean)) {
      const byCategory = expenseByCategory(input.appState.transactions, input.currency, input.range);
      let total: number;
      try {
        total = byCategory.reduce((sum, item) => addCents(sum, item.amountCents), 0);
      } catch (error) {
        if (error instanceof MonetaryArithmeticError) return incomplete(['ARITHMETIC_OVERFLOW']);
        throw error;
      }
      return { answer: `Total categorizado: ${formatMoney(total, input.currency)}.`, confidence: 'high', evidence: [`${byCategory.length} categoria(s).`], dataScope: 'histórico filtrado' };
    }
    return { answer: 'Capacidades atuais: saldo reconciliado, gastos por categoria, duplicatas, limite até ao próximo pagamento e simulação de compra.', confidence: 'low', evidence: ['Intenção não reconhecida.'] };
  }
}

export const financialDecisionFacade: FinancialDecisionFacade = new DefaultFinancialDecisionFacade();
