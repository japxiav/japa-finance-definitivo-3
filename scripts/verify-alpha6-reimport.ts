import fs from 'node:fs';
import { initialState } from '../src/data/defaults';
import { mergeImportedTransaction, previewSmartBankCsv } from '../src/core/csv';
import type { AppState } from '../src/core/types';

function applyPreview(state: AppState, preview: Awaited<ReturnType<typeof previewSmartBankCsv>>): AppState {
  return {
    ...state,
    accounts: [...state.accounts, ...(preview.createdAccounts ?? []).filter((account) => !state.accounts.some((existing) => existing.id === account.id))],
    transactions: [
      ...preview.newTransactions,
      ...state.transactions.map((existing) => {
        const update = preview.updates.find((item) => item.existingId === existing.id);
        return update ? mergeImportedTransaction(existing, update.incoming) : existing;
      }),
    ],
    imports: [preview.batch, ...state.imports],
  };
}

async function main() {
  const path = '/mnt/data/account-statement_2026-05-22_2026-08-01_pt_03ba8a.csv';
  const source = fs.readFileSync(path, 'utf8');
  let state = structuredClone(initialState) as AppState;
  const first = await previewSmartBankCsv(source, 'revolut.csv', state);
  state = applyPreview(state, first);
  const second = await previewSmartBankCsv(source, 'revolut.csv', state);
  if (second.newTransactions.length !== 0) throw new Error(`Reimportação idêntica criou ${second.newTransactions.length} linhas.`);
  if (second.updates.length !== 0) throw new Error(`Reimportação idêntica criou ${second.updates.length} atualizações.`);
  if (second.confirmedDuplicateIds.length < 329) throw new Error(`Poucas duplicatas confirmadas: ${second.confirmedDuplicateIds.length}`);

  const completedSource = source.replace(
    '2026-08-01 17:10:07,,Dunnes Stores,-7.10,0.00,EUR,PENDENTE,',
    '2026-08-01 17:10:07,2026-08-02 09:00:00,Dunnes Stores,-7.10,0.00,EUR,CONCLUÍDA,5.81',
  );
  if (completedSource === source) throw new Error('Linha pendente de teste não foi localizada.');
  const lifecycle = await previewSmartBankCsv(completedSource, 'revolut-updated.csv', state);
  const pendingUpdate = lifecycle.updates.find((item) => item.incoming.descriptionOriginal === 'Dunnes Stores' && item.incoming.amountCents === 710 && item.incoming.status === 'completed');
  if (!pendingUpdate) throw new Error('Pendente → concluída não foi reconhecida como atualização.');
  const existing = state.transactions.find((item) => item.id === pendingUpdate.existingId)!;
  const manual = { ...existing, categoryId: 'groceries', categorySource: 'manual' as const, note: 'preservar' };
  const enriched = mergeImportedTransaction(manual, pendingUpdate.incoming);
  if (enriched.status !== 'completed') throw new Error('Estado bancário não foi atualizado.');
  if (enriched.categoryId !== 'groceries' || enriched.categorySource !== 'manual' || enriched.note !== 'preservar') throw new Error('Decisão manual foi sobrescrita.');

  console.log(JSON.stringify({
    firstImported: first.batch.imported,
    duplicateReimport: second.confirmedDuplicateIds.length,
    lifecycleUpdate: pendingUpdate.reason,
    preservedManualCategory: enriched.categoryId,
  }, null, 2));
}
main().catch((error) => { console.error(error); process.exit(1); });
