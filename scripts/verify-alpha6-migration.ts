import fs from 'node:fs';
import { initialState } from '../src/data/defaults';
import { previewSmartBankCsv } from '../src/core/csv';
import { normalizeState } from '../src/core/storage';
import type { AppState } from '../src/core/types';

async function main() {
  let state = structuredClone(initialState) as AppState;
  for (const path of [
    '/mnt/data/jf_statement_audit/statement_124381219_BRL_2025-10-07_2026-08-01.csv',
    '/mnt/data/jf_statement_audit/statement_124381221_EUR_2025-10-07_2026-08-01.csv',
    '/mnt/data/account-statement_2026-05-22_2026-08-01_pt_03ba8a.csv',
  ]) {
    const preview = await previewSmartBankCsv(fs.readFileSync(path, 'utf8'), path.split('/').at(-1)!, state);
    state = {
      ...state,
      accounts: [...state.accounts, ...(preview.createdAccounts ?? []).filter((account) => !state.accounts.some((existing) => existing.id === account.id))],
      transactions: [...preview.newTransactions, ...state.transactions],
      imports: [preview.batch, ...state.imports],
    };
  }

  const oldAccounts = state.accounts
    .filter((account) => !account.id.includes('poupancas'))
    .map(({ product: _product, source: _source, archivedAt: _archivedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...account }) => account);
  const oldTransactions = state.transactions.map((transaction) => {
    const collapsedAccountId = transaction.accountId === 'revolut-eur-poupancas' ? 'revolut-eur' : transaction.accountId;
    const forceUnknown = /wise charges for|rende\+/i.test(transaction.descriptionOriginal);
    return {
      ...transaction,
      accountId: collapsedAccountId,
      technicalType: forceUnknown ? 'unknown' as const : transaction.technicalType,
      kind: forceUnknown ? 'unknown' as const : transaction.kind,
      kindSource: forceUnknown ? 'unknown' as const : transaction.kindSource,
      needsReview: forceUnknown || transaction.needsReview,
      reviewReasons: forceUnknown ? ['unknown_kind' as const] : transaction.reviewReasons,
      friendlyDescription: undefined,
      lifecycleFingerprint: undefined,
      compoundEventId: undefined,
    };
  });
  const legacy: Record<string, unknown> = {
    ...state,
    schemaVersion: 11,
    accounts: oldAccounts,
    transactions: oldTransactions,
  };
  delete legacy.financialMemory;
  delete legacy.knowledgeBase;
  delete legacy.auditProposals;
  delete legacy.aiAuditRuns;

  const migrated = normalizeState(legacy, structuredClone(initialState));
  const savings = migrated.accounts.find((account) => account.institution === 'revolut' && account.currency === 'EUR' && account.product === 'Poupanças');
  if (!savings) throw new Error('Migração não criou livro Revolut Poupanças EUR.');
  const savingsRows = migrated.transactions.filter((transaction) => transaction.accountId === savings.id);
  if (savingsRows.length !== 19) throw new Error(`Poupanças deveria ter 19 movimentos, recebeu ${savingsRows.length}.`);
  const unresolvedWise = migrated.transactions.filter((transaction) => transaction.source === 'wise_csv' && /wise charges for|rende\+/i.test(transaction.descriptionOriginal) && transaction.technicalType === 'unknown');
  if (unresolvedWise.length) throw new Error(`${unresolvedWise.length} padrões Wise continuaram desconhecidos.`);
  if (migrated.schemaVersion !== 12) throw new Error('Schema não migrou para 12.');
  if (!Array.isArray(migrated.financialMemory) || !Array.isArray(migrated.auditProposals)) throw new Error('Novas coleções não foram inicializadas.');

  console.log(JSON.stringify({
    schemaVersion: migrated.schemaVersion,
    savingsBook: savings.name,
    savingsRows: savingsRows.length,
    wisePatternsResolved: migrated.transactions.filter((transaction) => /wise charges for|rende\+/i.test(transaction.descriptionOriginal)).length,
    memoryInitialized: migrated.financialMemory.length,
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
