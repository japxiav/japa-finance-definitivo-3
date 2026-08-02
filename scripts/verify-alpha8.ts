import { readFileSync } from 'node:fs';
import { initialState } from '../src/data/defaults';
import { previewSmartBankCsv } from '../src/core/csv';
import { normalizeState } from '../src/core/storage';
import { buildReviewGroups } from '../src/classification/grouping';
import { buildFinancialRelationships } from '../src/application/financialRelationships';
import { buildRelationshipIntelligence, buildRelationshipOverviewInsights } from '../src/application/relationshipIntelligence';
import { buildFinancialHistory, buildMonthlyFinancialStories } from '../src/application/financialHistory';
import { buildFinancialAnalystContext } from '../src/application/financialAnalyst';
import { financialDecisionFacade } from '../src/application/FinancialDecisionFacade';
import type { AppState } from '../src/core/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mergeAccounts(state: AppState, accounts: AppState['accounts']): AppState['accounts'] {
  const map = new Map(state.accounts.map((item) => [item.id, item]));
  for (const account of accounts) map.set(account.id, { ...(map.get(account.id) ?? {}), ...account, active: true });
  return [...map.values()];
}

async function importCsv(state: AppState, path: string): Promise<AppState> {
  const preview = await previewSmartBankCsv(readFileSync(path, 'utf8'), path.split('/').at(-1)!, state);
  return {
    ...state,
    accounts: mergeAccounts(state, [...(preview.accounts ?? []), ...(preview.createdAccounts ?? [])]),
    transactions: [...state.transactions, ...preview.newTransactions],
    imports: [...state.imports, preview.batch],
    importIssues: [...state.importIssues, ...preview.issues],
  };
}

async function main() {
  let state: AppState = structuredClone(initialState);
  state = await importCsv(state, '/mnt/data/account-statement_2026-05-22_2026-08-01_pt_03ba8a.csv');
  state = await importCsv(state, '/mnt/data/jf_statement_audit/statement_124381219_BRL_2025-10-07_2026-08-01.csv');
  state = await importCsv(state, '/mnt/data/jf_statement_audit/statement_124381221_EUR_2025-10-07_2026-08-01.csv');
  state = normalizeState(state, initialState);

  const reviewGroups = buildReviewGroups(state);
  assert(reviewGroups.every((group) => !['incoming_transfer', 'outgoing_transfer'].includes(group.technicalType)), 'Transferências voltaram para a revisão obrigatória.');

  const eurRelationships = buildFinancialRelationships(state, 'EUR');
  const brlRelationships = buildFinancialRelationships(state, 'BRL');
  assert(eurRelationships.length > 0 && brlRelationships.length > 0, 'Relacionamentos não foram derivados.');
  const hannah = eurRelationships.find((item) => item.displayName.toLocaleLowerCase('pt-BR').includes('hannah'));
  assert(hannah && hannah.totalCount >= 60, 'Hannah não foi consolidada em um relacionamento.');
  const hannahProfile = buildRelationshipIntelligence(state, hannah, eurRelationships);
  assert(hannahProfile.monthly.length > 1, 'Perfil mensal do relacionamento ficou vazio.');
  assert(hannahProfile.cadenceLabel !== 'pontual', 'Relação recorrente foi tratada como pontual.');
  assert(buildRelationshipOverviewInsights(state, eurRelationships).length > 0, 'Insights automáticos de relacionamentos ficaram vazios.');

  const history = buildFinancialHistory(state, 'EUR');
  const stories = buildMonthlyFinancialStories(state, 'EUR');
  assert(history.length > 0, 'História financeira ficou vazia.');
  assert(history.some((item) => item.type === 'account'), 'História não registrou uso de instituições.');
  assert(stories.length >= 2, 'Panorama mensal não cobriu múltiplos meses.');

  const sentToHannah = financialDecisionFacade.answerQuestion({ appState: state, currency: 'EUR', question: 'Quanto mandei para Hannah?' });
  assert(sentToHannah.confidence === 'high' && sentToHannah.amountCents === hannah.sentCents, 'Pergunta por primeiro nome não encontrou o relacionamento correto.');
  const topReceiver = financialDecisionFacade.answerQuestion({ appState: state, currency: 'EUR', question: 'Quem mais recebeu transferências minhas?' });
  assert(topReceiver.confidence === 'high' && topReceiver.amountCents && topReceiver.amountCents > 0, 'Ranking de envios não respondeu.');
  const firstRevolut = financialDecisionFacade.answerQuestion({ appState: state, currency: 'EUR', question: 'Quando comecei a usar a Revolut?' });
  assert(firstRevolut.confidence === 'high' && firstRevolut.answer.includes('2026-05-22'), 'Primeiro uso da Revolut não foi encontrado.');
  const vinted = financialDecisionFacade.answerQuestion({ appState: state, currency: 'EUR', question: 'Quanto gastei na Vinted?' });
  assert(vinted.confidence === 'high' && vinted.answer.includes('impacto líquido') && (vinted.amountCents ?? 0) > 0, 'Pergunta por comerciante não calculou compras e reembolsos.');

  const context = buildFinancialAnalystContext(state, 'EUR');
  const serialized = JSON.stringify(context);
  assert(new TextEncoder().encode(serialized).byteLength < 220_000, 'Panorama ultrapassou o limite da rota de IA.');
  assert(!serialized.includes('descriptionOriginal') && !serialized.includes('bankTransactionId') && !serialized.includes('originalData') && !serialized.includes('transactionIds') && !serialized.includes('accountIds'), 'Panorama enviou linha bancária bruta ou identificadores internos para a IA.');
  assert(context.principles.some((item) => item.includes('não recalcula')), 'Panorama não declara a limitação da IA.');
  assert(context.relationships.length > 0 && context.monthlyStories.length > 0 && context.history.length > 0, 'Panorama perdeu camadas essenciais.');

  console.log(JSON.stringify({
    schemaVersion: state.schemaVersion,
    transactions: state.transactions.length,
    reviewGroups: reviewGroups.length,
    transferReviewGroups: reviewGroups.filter((group) => ['incoming_transfer', 'outgoing_transfer'].includes(group.technicalType)).length,
    relationships: { EUR: eurRelationships.length, BRL: brlRelationships.length },
    hannah: { count: hannah.totalCount, sentCents: hannah.sentCents, receivedCents: hannah.receivedCents, cadence: hannahProfile.cadenceLabel },
    historyEvents: history.length,
    monthlyStories: stories.length,
    analystContextBytes: new TextEncoder().encode(serialized).byteLength,
    deterministicAnswers: {
      hannah: sentToHannah.answer,
      topReceiver: topReceiver.answer,
      firstRevolut: firstRevolut.answer,
      vinted: vinted.answer,
    },
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
