const assert = {
  equal(actual: unknown, expected: unknown, message?: string) { if (actual !== expected) throw new Error(message ?? `Esperado ${String(expected)}, recebido ${String(actual)}`); },
  ok(value: unknown, message?: string) { if (!value) throw new Error(message ?? 'Condição esperada não foi satisfeita'); },
};
import { buildAnalytics } from '../src/analytics/metrics';
import { generateInsights } from '../src/insights/engine';
import { previewBankCsv } from '../src/core/csv';
import { normalizeState } from '../src/core/storage';
import type { AppState, Transaction } from '../src/core/types';
import { initialState } from '../src/data/defaults';

const now = '2026-07-30T12:00:00.000Z';
let sequence = 0;
function tx(input: { date: string; cents: number; categoryId: string; description: string; kind?: 'expense' | 'income' }): Transaction {
  const kind = input.kind ?? 'expense';
  const inflow = kind === 'income';
  sequence += 1;
  return {
    id: `tx-${sequence}`,
    accountId: 'revolut-eur',
    dedupFingerprint: `test-${sequence}`,
    amountCents: input.cents,
    netMovementCents: inflow ? input.cents : -input.cents,
    currency: 'EUR',
    direction: inflow ? 'inflow' : 'outflow',
    source: 'manual',
    status: 'completed',
    kind,
    kindSource: 'manual',
    analysisExcluded: false,
    descriptionOriginal: input.description,
    merchantNormalized: input.description.toLocaleLowerCase('pt-BR'),
    reportingDate: input.date,
    completedAt: `${input.date}T12:00:00.000Z`,
    categoryId: inflow ? 'income' : input.categoryId,
    categorySource: 'manual',
    needsReview: false,
    reviewReasons: [],
    manualEditLog: [],
    originalData: {},
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
const currentShopping = Array.from({ length: 8 }, (_, index) => tx({ date: `2026-07-${String(index + 2).padStart(2, '0')}`, cents: 3_000, categoryId: 'shopping', description: 'Vinted' }));
const previousShopping = Array.from({ length: 4 }, (_, index) => tx({ date: `2026-06-${String(index + 2).padStart(2, '0')}`, cents: 1_000, categoryId: 'shopping', description: 'Vinted' }));
const groceries = Array.from({ length: 5 }, (_, index) => tx({ date: `2026-07-${String(index + 12).padStart(2, '0')}`, cents: 900, categoryId: 'groceries', description: 'Lidl' }));
const incomes = [tx({ date: '2026-07-01', cents: 80_000, categoryId: 'income', description: 'Salário', kind: 'income' })];
const state: AppState = {
  ...initialState,
  transactions: [...currentShopping, ...previousShopping, ...groceries, ...incomes],
  reservePolicies: [{ currency: 'EUR', minimumCents: 20_000, updatedAt: now }],
  plannedEvents: [{ id: 'rent', title: 'Aluguel', kind: 'expense', direction: 'outflow', amountCents: 30_000, currency: 'EUR', dueDate: '2026-08-02', accountId: 'revolut-eur', active: true, createdAt: now, updatedAt: now }],
};

const range = { start: '2026-07-01', end: '2026-07-30' };
const analytics = buildAnalytics(state, 'EUR', range);
assert.equal(analytics.current.byCategory[0]?.key, 'shopping');
assert.equal(analytics.current.expenseTransactionCount, 13);
assert.equal(analytics.previous.expenseTransactionCount, 4);
console.log('✓ métricas ordenam categorias e separam períodos');

const insights = generateInsights(state, 'EUR', range, { limit: 30, now: new Date(now) });
assert.ok(insights.generatedCount > 3);
assert.ok(insights.insights.some((item) => item.family === 'category-change' && item.categoryId === 'shopping'));
assert.ok(insights.insights.some((item) => item.family === 'merchant-concentration'));
assert.ok(insights.insights.every((item) => !/\bcaus(?:ou|a)\b/i.test(item.message)));
console.log('✓ motor gera mudança de categoria, concentração e evita causalidade falsa');

const dismissed = insights.insights.find((item) => item.family === 'category-change')!;
const dismissedState: AppState = { ...state, insightFeedback: [{ insightKey: dismissed.key, dismissedAt: now }] };
const afterDismiss = generateInsights(dismissedState, 'EUR', range, { limit: 30, now: new Date(now) });
assert.ok(!afterDismiss.insights.some((item) => item.key === dismissed.key));
console.log('✓ insight dispensado respeita cooldown');

const csv = [
  'Tipo,Produto,Data de início,Data de conclusão,Descrição,Montante,Taxa,Moeda,Estado,Saldo',
  'Transferência,Atual,2026-07-20 10:00:00,2026-07-20 10:00:00,Carregamento de subconta EUR Reserva de EUR,-50,0,EUR,CONCLUÍDA,100',
  'Carregamento,Atual,2026-07-21 10:00:00,2026-07-21 10:00:00,Carregamento de Titular,80,0,EUR,CONCLUÍDA,180',
].join('\n');
const preview = await previewBankCsv(csv, 'internal-transfers.csv', initialState, 'revolut-eur');
assert.equal(preview.newTransactions.length, 2);
assert.ok(preview.newTransactions.every((item) => item.kind === 'transfer' && !item.needsReview && item.transferGroupId));
console.log('✓ subconta e carregamento próprio viram transferências internas sem pendência');


const legacyTransaction = { ...currentShopping[0]!, id: 'legacy-clothing', dedupFingerprint: 'legacy-clothing', categoryId: 'clothing' };
const legacyV4 = {
  ...initialState,
  schemaVersion: 4,
  transactions: [legacyTransaction],
  categories: [
    { id: 'uncategorized', name: 'Sem categoria', active: true },
    { id: 'income', name: 'Receitas', active: true },
    { id: 'clothing', name: 'Roupas', active: true },
    { id: 'custom-trip', name: 'Viagem', active: true },
  ],
  rules: [{ id: 'old-vinted', pattern: 'vinted', kind: 'contains', categoryId: 'clothing', order: 1 }],
  insightFeedback: undefined,
};
const migrated = normalizeState(legacyV4, initialState);
assert.equal(migrated.schemaVersion, 6);
assert.equal(migrated.transactions[0]?.categoryId, 'shopping');
assert.ok(migrated.categories.some((item) => item.id === 'custom-trip'));
assert.ok(migrated.rules.some((item) => item.id === 'old-vinted' && item.categoryId === 'shopping'));
console.log('✓ migração v4 → v6 preserva categoria personalizada e remapeia categorias antigas');

console.log('\n5/5 verificações do Motor de Insights aprovadas');

}

void main();
