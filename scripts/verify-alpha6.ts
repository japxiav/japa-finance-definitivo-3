import fs from 'node:fs';
import { initialState } from '../src/data/defaults';
import { mergeImportedTransaction, previewSmartBankCsv } from '../src/core/csv';
import { reprocessFinancialState } from '../src/application/reprocess';
import { buildTodayActivity } from '../src/application/todayActivity';
import type { AppState } from '../src/core/types';

async function main() {
  let state = structuredClone(initialState) as AppState;
  const wiseFiles = [
    '/mnt/data/jf_statement_audit/statement_124381219_BRL_2025-10-07_2026-08-01.csv',
    '/mnt/data/jf_statement_audit/statement_124381221_EUR_2025-10-07_2026-08-01.csv',
  ];
  for (const path of wiseFiles) {
    const preview = await previewSmartBankCsv(fs.readFileSync(path, 'utf8'), path.split('/').at(-1)!, state);
    state = {
      ...state,
      accounts: [...state.accounts, ...(preview.createdAccounts ?? []).filter((a) => !state.accounts.some((x) => x.id === a.id))],
      transactions: [...preview.newTransactions, ...state.transactions.map((existing) => {
        const update = preview.updates.find((item) => item.existingId === existing.id);
        return update ? mergeImportedTransaction(existing, update.incoming) : existing;
      })],
      imports: [preview.batch, ...state.imports],
    };
  }
  const revPath = '/mnt/data/account-statement_2026-05-22_2026-08-01_pt_03ba8a.csv';
  const rev = await previewSmartBankCsv(fs.readFileSync(revPath, 'utf8'), 'revolut.csv', state);
  state = {
    ...state,
    accounts: [...state.accounts, ...(rev.createdAccounts ?? []).filter((a) => !state.accounts.some((x) => x.id === a.id))],
    transactions: [...rev.newTransactions, ...state.transactions],
    imports: [rev.batch, ...state.imports],
  };
  state = reprocessFinancialState(state);
  const unknownWise = state.transactions.filter((t) => t.source === 'wise_csv' && t.status !== 'voided' && t.technicalType === 'unknown');
  const today = buildTodayActivity(state, 'EUR', '2026-08-01');
  const accounts = state.accounts.filter((a) => state.transactions.some((t) => t.accountId === a.id)).map((a) => ({ id:a.id,name:a.name,product:a.product,currency:a.currency }));
  const result = {
    transactionCount: state.transactions.filter((t) => (t.sourceComponent ?? 'primary') === 'primary').length,
    wiseUnknown: unknownWise.length,
    pending: state.transactions.filter((t) => t.status === 'pending').length,
    accounts,
    today: {
      externalNetCents: today.externalNetCents,
      pendingNetCents: today.pendingNetCents,
      externalOutflowCents: today.buckets.find((bucket) => bucket.key === 'external_outflow')?.amountCents ?? 0,
      transactionIds: today.buckets.flatMap((bucket) => bucket.transactionIds),
    },
    revolut: { imported: rev.batch.imported, pendingRows: rev.batch.pendingRows, destinations: rev.destinations },
  };
  console.log(JSON.stringify(result, null, 2));
  if (unknownWise.length !== 0) throw new Error(`Wise ainda tem ${unknownWise.length} desconhecidas`);
  if (today.externalNetCents !== -5040) throw new Error(`Hoje concluído esperado -5040, recebido ${today.externalNetCents}`);
  if (today.pendingNetCents !== -710) throw new Error(`Hoje pendente esperado -710, recebido ${today.pendingNetCents}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
