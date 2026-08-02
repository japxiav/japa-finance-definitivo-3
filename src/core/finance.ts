import { addCents, subtractCents } from '../domain/arithmetic';
import type { Direction, Transaction, TransactionKind } from './types';



export function isTransactionKindDirectionCompatible(
  kind: TransactionKind,
  direction: Direction,
): boolean {
  if (kind === 'income' || kind === 'refund') return direction === 'inflow';
  if (kind === 'expense') return direction === 'outflow';
  return true;
}

export interface DateRange {
  start?: string;
  end?: string;
}

export interface CashflowSummary {
  currency: string;
  incomeCents: number;
  expenseCents: number;
  refundCents: number;
  adjustmentCents: number;
  netExpenseCents: number;
  netCashflowCents: number;
}

function isCompletedFact(transaction: Transaction): boolean {
  return transaction.status === 'completed';
}

function inDateRange(transaction: Transaction, range: DateRange): boolean {
  if (range.start && transaction.reportingDate < range.start) return false;
  if (range.end && transaction.reportingDate > range.end) return false;
  return true;
}

/**
 * Entradas externas contam no fluxo de caixa mesmo quando continuam apenas
 * como "transferência recebida" e não ganharam uma categoria financeira.
 * Transferências internas e conversões já chegam com `analysisExcluded`.
 */
export function isAnalyticalIncome(transaction: Transaction): boolean {
  return transaction.kind === 'income'
    || transaction.technicalType === 'incoming_transfer';
}

/**
 * Saídas externas contam no fluxo de caixa mesmo sem categoria. Isso mantém
 * o app útil antes da revisão completa sem transformar movimentação interna
 * ou câmbio em gasto.
 */
export function isAnalyticalExpense(transaction: Transaction): boolean {
  return transaction.kind === 'expense'
    || transaction.technicalType === 'outgoing_transfer';
}

export function signedNetMovement(transaction: Transaction): number {
  if (Number.isSafeInteger(transaction.netMovementCents)) return transaction.netMovementCents!;
  return transaction.direction === 'inflow'
    ? transaction.amountCents
    : -transaction.amountCents;
}

/** @deprecated Use signedNetMovement. */
const signedAmount = signedNetMovement;

/**
 * Movimento líquido importado por conta. Não é saldo bancário absoluto sem
 * um saldo inicial reconciliado. Transferências contam porque movem dinheiro.
 */
export function netMovementByAccount(transactions: Transaction[]) {
  const balances = new Map<string, { currency: string; amountCents: number }>();

  for (const transaction of transactions.filter(isCompletedFact)) {
    const current = balances.get(transaction.accountId);
    if (current && current.currency !== transaction.currency) {
      throw new Error(`A conta ${transaction.accountId} contém moedas incompatíveis.`);
    }

    balances.set(transaction.accountId, {
      currency: transaction.currency,
      amountCents: addCents(current?.amountCents ?? 0, signedAmount(transaction)),
    });
  }

  return [...balances.entries()].map(([accountId, value]) => ({ accountId, ...value }));
}


/** Compatibilidade com versões anteriores. */
export const balanceByAccount = netMovementByAccount;

export function balanceByCurrency(transactions: Transaction[]) {
  const byCurrency = new Map<string, number>();
  for (const balance of netMovementByAccount(transactions)) {
    byCurrency.set(
      balance.currency,
      addCents(byCurrency.get(balance.currency) ?? 0, balance.amountCents),
    );
  }
  return [...byCurrency.entries()].map(([currency, amountCents]) => ({ currency, amountCents }));
}

/** Fluxo financeiro, sem transferências internas e sem itens excluídos da análise. */
export function cashflowSummary(
  transactions: Transaction[],
  currency: string,
  range: DateRange = {},
): CashflowSummary {
  const relevant = transactions.filter((transaction) =>
    isCompletedFact(transaction)
    && !transaction.analysisExcluded
    && transaction.currency === currency
    && inDateRange(transaction, range),
  );

  let incomeCents = 0;
  let expenseCents = 0;
  let refundCents = 0;
  let adjustmentCents = 0;

  for (const transaction of relevant) {
    const signed = signedNetMovement(transaction);
    if (isAnalyticalIncome(transaction) && signed > 0) incomeCents = addCents(incomeCents, signed);
    if (isAnalyticalExpense(transaction) && signed < 0) expenseCents = addCents(expenseCents, Math.abs(signed));
    if (transaction.kind === 'refund' && signed > 0) refundCents = addCents(refundCents, signed);
    if (transaction.kind === 'adjustment') adjustmentCents = addCents(adjustmentCents, signedAmount(transaction));
  }

  const netExpenseCents = subtractCents(expenseCents, refundCents);
  return {
    currency,
    incomeCents,
    expenseCents,
    refundCents,
    adjustmentCents,
    netExpenseCents,
    netCashflowCents: addCents(incomeCents, -expenseCents, refundCents, adjustmentCents),
  };
}

/**
 * Compatibilidade com a interface antiga. Exige moeda para impedir que EUR e
 * GBP sejam somados como se fossem a mesma unidade.
 */
export function calculateNet(transactions: Transaction[], currency = 'EUR') {
  return cashflowSummary(transactions, currency).netCashflowCents;
}

export function totals(transactions: Transaction[], currency = 'EUR') {
  const summary = cashflowSummary(transactions, currency);
  return {
    inflow: summary.incomeCents,
    outflow: summary.netExpenseCents,
    refunds: summary.refundCents,
  };
}

export function expenseByCategory(
  transactions: Transaction[],
  currency = 'EUR',
  range: DateRange = {},
) {
  const map = new Map<string, number>();

  for (const transaction of transactions) {
    if (!isCompletedFact(transaction)
      || transaction.analysisExcluded
      || transaction.currency !== currency
      || !inDateRange(transaction, range)) continue;

    if (isAnalyticalExpense(transaction) && transaction.technicalType !== 'outgoing_transfer') {
      const movement = signedNetMovement(transaction);
      if (movement < 0) {
        // Taxas adicionais permanecem na categoria da transação de origem:
        // é a única atribuição auditável enquanto não houver uma categoria
        // separada fornecida pelo extrato.
        const categoryId = transaction.categoryId ?? 'uncategorized';
        map.set(categoryId, addCents(map.get(categoryId) ?? 0, Math.abs(movement)));
      }
    }

    // Reembolso NÃO subtrai da categoria aqui: compra e reembolso são duas
    // linhas independentes do CSV, categorizadas separadamente, e ainda não
    // existe vínculo entre elas (isso é a feature "reembolsos vinculados",
    // que é backlog). Subtrair sem vínculo já causou o bug de zerar/reduzir
    // a categoria errada quando o reembolso vem com descrição genérica.
    // O reembolso ainda reduz o net_expense agregado via cashflowSummary,
    // só não é atribuído a uma categoria específica até haver vínculo real.
  }

  return [...map.entries()]
    .filter((item) => item[1] > 0)
    .map(([categoryId, amountCents]) => ({ categoryId, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}

export function monthKey(reportingDate: string) {
  return reportingDate.slice(0, 7);
}


export function monthDateRange(month: string): Required<DateRange> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Mês inválido.');
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error('Mês inválido.');
  }
  const lastDay = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}
