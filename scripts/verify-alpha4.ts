import { filterTransactions, transactionsToCsv } from '../src/application/transactionFilters';
import { buildPeriodComparison } from '../src/analytics/comparison';
import { buildActivityTimeline } from '../src/application/activityTimeline';
import { buildAnalytics } from '../src/analytics/metrics';
import { applyCategoryDecision, undoLatestReviewDecision } from '../src/classification/decisions';
import { matchRule } from '../src/core/merchant';
import type { AppState, Transaction } from '../src/core/types';
import { initialState } from '../src/data/defaults';

function ok(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal<T>(actual: T, expected: T, message = 'Values differ') { if (actual !== expected) throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`); }
function deepEqual(actual: unknown, expected: unknown, message = 'Values differ') { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); }
function matches(value: string, pattern: RegExp, message = 'Pattern did not match') { if (!pattern.test(value)) throw new Error(message); }
function notMatches(value: string, pattern: RegExp, message = 'Pattern unexpectedly matched') { if (pattern.test(value)) throw new Error(message); }

function transaction(input: Partial<Transaction> & Pick<Transaction, 'id' | 'descriptionOriginal' | 'reportingDate' | 'amountCents' | 'direction'>): Transaction {
  const now = `${input.reportingDate}T12:00:00.000Z`;
  const signed = input.direction === 'inflow' ? input.amountCents : -input.amountCents;
  const base: Transaction = {
    id: input.id,
    accountId: input.accountId ?? 'revolut-eur',
    dedupFingerprint: `fp-${input.id}`,
    amountCents: input.amountCents,
    reportedAmountCents: signed,
    netMovementCents: signed,
    currency: input.currency ?? 'EUR',
    direction: input.direction,
    source: input.source ?? 'revolut_csv',
    status: input.status ?? 'completed',
    kind: input.kind ?? (input.direction === 'inflow' ? 'income' : 'expense'),
    technicalType: input.technicalType ?? (input.direction === 'inflow' ? 'other_income' : 'card_payment'),
    kindSource: input.kindSource ?? 'system',
    analysisExcluded: input.analysisExcluded ?? false,
    descriptionOriginal: input.descriptionOriginal,
    merchantNormalized: input.merchantNormalized ?? input.descriptionOriginal.toLowerCase(),
    reportingDate: input.reportingDate,
    categoryId: input.categoryId,
    categorySource: input.categorySource ?? (input.categoryId ? 'rule' : 'none'),
    categoryReviewStatus: input.categoryReviewStatus ?? (input.categoryId ? 'resolved' : 'pending'),
    needsReview: input.needsReview ?? !input.categoryId,
    reviewReasons: input.reviewReasons ?? (input.categoryId ? [] : ['uncategorized']),
    manualEditLog: input.manualEditLog ?? [],
    originalData: input.originalData ?? {},
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
  return Object.assign(base, input);
}

const transactions = [
  transaction({ id: 'old-tesco', descriptionOriginal: 'TESCO BALLINA', reportingDate: '2026-06-05', amountCents: 5000, direction: 'outflow', categoryId: 'groceries' }),
  transaction({ id: 'new-tesco', descriptionOriginal: 'Tesco Express', reportingDate: '2026-07-05', amountCents: 7000, direction: 'outflow' }),
  transaction({ id: 'salary', descriptionOriginal: 'Kitchen Garden Salary', reportingDate: '2026-07-04', amountCents: 50000, direction: 'inflow', categoryId: 'income', technicalType: 'salary', kind: 'income' }),
  transaction({ id: 'manual-pub', descriptionOriginal: 'Hogans Pub', reportingDate: '2026-07-06', amountCents: 2500, direction: 'outflow', source: 'manual', categoryId: 'leisure', categorySource: 'manual' }),
];

const state: AppState = {
  ...structuredClone(initialState),
  transactions,
  imports: [{
    id: 'import-1', accountId: 'revolut-eur', fileName: 'july.csv', fileHash: 'hash', parserName: 'revolut_csv', parserVersion: '1', createdAt: '2026-07-07T10:00:00.000Z', status: 'active', rowsRead: 3, imported: 3, confirmedDuplicates: 0, possibleDuplicates: 0, pendingRows: 0, rejected: 0, currencies: ['EUR'],
  }],
  reconciliationBatches: [{ id: 'recon-1', logicalDate: '2026-07-07', logicalAsOf: '2026-07-07T11:00:00.000Z', createdAt: '2026-07-07T11:00:00.000Z', source: 'manual', status: 'COMPLETE' }],
  balanceSnapshots: [{ id: 'snap-1', accountId: 'revolut-eur', currency: 'EUR', balanceCents: 10000, asOf: '2026-07-07T11:00:00.000Z', source: 'manual', reconciled: true, createdAt: '2026-07-07T11:00:00.000Z', reconciliationBatchId: 'recon-1', logicalAsOf: '2026-07-07T11:00:00.000Z' }],
};

const filtered = filterTransactions(transactions, {
  currency: 'EUR', query: 'tesco', accountId: 'all', categoryId: 'all', periodStart: '2026-07-01', periodEnd: '2026-07-31', minAmount: '60', maxAmount: '80', direction: 'outflow', technicalType: 'all', source: 'all', reviewOnly: true,
});
deepEqual(filtered.map((item) => item.id), ['new-tesco']);

const csv = transactionsToCsv(filtered, {
  accountName: () => 'Revolut EUR',
  categoryName: (id) => id ?? 'Sem categoria',
  technicalTypeName: (type) => type,
});
matches(csv, /Tesco Express/);
notMatches(csv, /Hogans Pub/);

const analytics = buildAnalytics(state, 'EUR', { start: '2026-07-01', end: '2026-07-31' });
const comparison = buildPeriodComparison(analytics, (id) => id ?? 'Sem categoria', (value) => `€${(value / 100).toFixed(2)}`);
equal(comparison.comparable, true);
equal(comparison.metrics.find((item) => item.label === 'Despesas líquidas')?.differenceCents, 4500);
ok(comparison.explanations.some((item) => item.title.includes('despesas aumentaram')));

const afterRule = applyCategoryDecision({
  state,
  transactionIds: ['new-tesco'],
  categoryId: 'groceries',
  categorySource: 'rule',
  kind: 'create_rule',
  label: 'Regra contains: tesco → Mercado (1)',
  createRule: { pattern: 'tesco', merchantLabel: 'Tesco', kind: 'contains', currency: 'EUR', direction: 'outflow', transactionKind: 'expense', technicalType: 'card_payment', exceptionTransactionIds: ['old-tesco'] },
  now: '2026-07-08T10:00:00.000Z',
});
equal(afterRule.transactions.find((item) => item.id === 'new-tesco')?.categoryId, 'groceries');
const learned = afterRule.rules.find((rule) => rule.source === 'learned' && rule.pattern === 'tesco');
equal(learned?.kind, 'contains');
deepEqual(learned?.exceptionTransactionIds, ['old-tesco']);
equal(matchRule('TESCO ONLINE 1234', afterRule.rules, { currency: 'EUR', direction: 'outflow', kind: 'expense', technicalType: 'card_payment' })?.categoryId, 'groceries');

const undone = undoLatestReviewDecision(afterRule, '2026-07-08T10:05:00.000Z');
equal(undone.transactions.find((item) => item.id === 'new-tesco')?.categoryId, undefined);
equal(undone.rules.some((rule) => rule.id === learned?.id), false);

const timeline = buildActivityTimeline(afterRule, 'EUR', () => 'Revolut EUR');
equal(timeline[0]?.title, 'Classificação aplicada');
ok(timeline.some((item) => item.title === 'Saldos reconciliados'));
ok(timeline.some((item) => item.title === 'Extrato importado'));

console.log('Alpha 4 verification passed:', {
  filtered: filtered.length,
  comparisonExplanations: comparison.explanations.length,
  learnedRule: learned?.kind,
  timeline: timeline.length,
});
