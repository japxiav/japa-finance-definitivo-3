import { describe, expect, it } from 'vitest';
import { balanceByAccount, balanceByCurrency, cashflowSummary, expenseByCategory } from './finance';
import type { Transaction } from './types';

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(), accountId: 'revolut-eur', dedupFingerprint: crypto.randomUUID(), amountCents: 0,
    currency: 'EUR', direction: 'outflow', source: 'manual', status: 'completed', kind: 'expense', technicalType: 'other_expense', kindSource: 'manual',
    analysisExcluded: false, descriptionOriginal: 'Teste', merchantNormalized: 'teste', reportingDate: '2026-07-01',
    categoryId: 'other', categorySource: 'manual', categoryReviewStatus: 'resolved', needsReview: false, reviewReasons: [], manualEditLog: [], originalData: {},
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', ...overrides,
  };
}

describe('Finance Core', () => {
  it('calcula fluxo líquido em inteiros', () => {
    const summary = cashflowSummary([
      transaction({ direction: 'inflow', kind: 'income', technicalType: 'other_income', amountCents: 10000 }),
      transaction({ direction: 'outflow', kind: 'expense', amountCents: 2500 }),
    ], 'EUR');
    expect(summary.netCashflowCents).toBe(7500);
    expect(Number.isInteger(summary.netCashflowCents)).toBe(true);
  });

  it('ignora anuladas e pendentes', () => {
    const summary = cashflowSummary([transaction({ amountCents: 1000, status: 'voided' }), transaction({ amountCents: 2000, status: 'pending' })], 'EUR');
    expect(summary.netCashflowCents).toBe(0);
  });

  it('transferência move saldo sem virar receita ou despesa', () => {
    const transactions = [
      transaction({ accountId: 'revolut-eur', direction: 'inflow', kind: 'income', technicalType: 'other_income', amountCents: 100000 }),
      transaction({ accountId: 'revolut-eur', direction: 'outflow', kind: 'transfer', technicalType: 'internal_transfer', amountCents: 30000, transferGroupId: 't1', analysisExcluded: true }),
      transaction({ accountId: 'wise-eur', direction: 'inflow', kind: 'transfer', technicalType: 'internal_transfer', amountCents: 30000, transferGroupId: 't1', analysisExcluded: true }),
    ];
    expect(balanceByAccount(transactions).find((item) => item.accountId === 'revolut-eur')?.amountCents).toBe(70000);
    expect(cashflowSummary(transactions, 'EUR').incomeCents).toBe(100000);
  });

  it('separa moedas', () => {
    const balances = balanceByCurrency([
      transaction({ currency: 'EUR', amountCents: 10000, direction: 'inflow', kind: 'income', technicalType: 'other_income' }),
      transaction({ accountId: 'wise-brl', currency: 'BRL', amountCents: 5000, direction: 'inflow', kind: 'income', technicalType: 'other_income' }),
    ]);
    expect(balances).toEqual(expect.arrayContaining([{ currency: 'EUR', amountCents: 10000 }, { currency: 'BRL', amountCents: 5000 }]));
  });

  it('reembolso reduz gasto agregado, mas não categoria sem vínculo', () => {
    const transactions = [
      transaction({ kind: 'expense', amountCents: 10000, categoryId: 'games' }),
      transaction({ kind: 'refund', technicalType: 'refund', direction: 'inflow', amountCents: 4000, categoryId: undefined, categorySource: 'none', categoryReviewStatus: 'pending' }),
    ];
    expect(cashflowSummary(transactions, 'EUR').netExpenseCents).toBe(6000);
    expect(expenseByCategory(transactions, 'EUR')).toEqual([{ categoryId: 'games', amountCents: 10000 }]);
  });
});
