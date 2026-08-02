import type { Account, AccountBalanceSnapshot, AppState } from '../core/types';

export interface AccountReferenceCount {
  transactions: number;
  snapshots: number;
  plannedEvents: number;
  plannedTransfers: number;
  imports: number;
  issues: number;
}

export function countAccountReferences(state: AppState, accountId: string): AccountReferenceCount {
  return {
    transactions: state.transactions.filter((item) => item.accountId === accountId).length,
    snapshots: state.balanceSnapshots.filter((item) => item.accountId === accountId).length,
    plannedEvents: state.plannedEvents.filter((item) => item.accountId === accountId).length,
    plannedTransfers: state.plannedTransfers.filter((item) => item.sourceAccountId === accountId || item.destinationAccountId === accountId).length,
    imports: state.imports.filter((item) => item.accountId === accountId || item.accountIds?.includes(accountId)).length,
    issues: state.importIssues.filter((item) => item.accountId === accountId).length,
  };
}

export function hasAccountReferences(counts: AccountReferenceCount): boolean {
  return Object.values(counts).some((count) => count > 0);
}

export function renameAccount(state: AppState, accountId: string, name: string): AppState {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('O nome da conta não pode ficar vazio.');
  const now = new Date().toISOString();
  return {
    ...state,
    accounts: state.accounts.map((account) => account.id === accountId
      ? { ...account, name: cleanName, updatedAt: now }
      : account),
  };
}

export function setAccountArchived(state: AppState, accountId: string, archived: boolean): AppState {
  const now = new Date().toISOString();
  return {
    ...state,
    accounts: state.accounts.map((account) => account.id === accountId
      ? {
        ...account,
        active: !archived,
        archivedAt: archived ? now : undefined,
        updatedAt: now,
      }
      : account),
  };
}

export function deleteEmptyAccount(state: AppState, accountId: string): AppState {
  const references = countAccountReferences(state, accountId);
  if (hasAccountReferences(references)) {
    throw new Error('A conta possui dados vinculados. Arquive ou mescle em vez de excluir.');
  }
  return {
    ...state,
    accounts: state.accounts.filter((account) => account.id !== accountId),
    ownerIdentity: {
      ...state.ownerIdentity,
      ownAccountIds: state.ownerIdentity.ownAccountIds.filter((id) => id !== accountId),
      updatedAt: new Date().toISOString(),
    },
  };
}

function mergeSnapshots(snapshots: AccountBalanceSnapshot[], sourceId: string, targetId: string): AccountBalanceSnapshot[] {
  const byKey = new Map<string, AccountBalanceSnapshot>();
  for (const original of snapshots) {
    const snapshot = original.accountId === sourceId ? { ...original, accountId: targetId } : original;
    const key = `${snapshot.accountId}|${snapshot.reconciliationBatchId ?? ''}|${snapshot.logicalAsOf ?? snapshot.asOf}|${snapshot.currency}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, snapshot);
      continue;
    }
    byKey.set(key, {
      ...existing,
      balanceCents: existing.balanceCents + snapshot.balanceCents,
      reconciled: existing.reconciled && snapshot.reconciled,
      source: existing.source === 'manual' || snapshot.source === 'manual' ? 'manual' : 'import',
      sourceImportId: existing.sourceImportId === snapshot.sourceImportId ? existing.sourceImportId : undefined,
    });
  }
  return [...byKey.values()];
}

export function mergeAccounts(state: AppState, sourceId: string, targetId: string): AppState {
  if (sourceId === targetId) throw new Error('Escolha duas contas diferentes.');
  const source = state.accounts.find((account) => account.id === sourceId);
  const target = state.accounts.find((account) => account.id === targetId);
  if (!source || !target) throw new Error('Uma das contas não existe mais.');
  if (source.currency !== target.currency) throw new Error('Só é possível mesclar contas da mesma moeda.');

  const now = new Date().toISOString();
  const mapId = (id: string) => id === sourceId ? targetId : id;
  return {
    ...state,
    accounts: state.accounts
      .filter((account) => account.id !== sourceId)
      .map((account) => account.id === targetId ? { ...account, active: true, archivedAt: undefined, updatedAt: now } : account),
    transactions: state.transactions.map((item) => item.accountId === sourceId
      ? { ...item, accountId: targetId, updatedAt: now }
      : item),
    balanceSnapshots: mergeSnapshots(state.balanceSnapshots, sourceId, targetId),
    plannedEvents: state.plannedEvents.map((item) => item.accountId === sourceId
      ? { ...item, accountId: targetId, updatedAt: now }
      : item),
    plannedTransfers: state.plannedTransfers.map((item) => ({
      ...item,
      sourceAccountId: mapId(item.sourceAccountId),
      destinationAccountId: mapId(item.destinationAccountId),
    })),
    imports: state.imports.map((item) => ({
      ...item,
      accountId: mapId(item.accountId),
      accountIds: item.accountIds ? [...new Set(item.accountIds.map(mapId))] : item.accountIds,
    })),
    importIssues: state.importIssues.map((item) => item.accountId === sourceId ? { ...item, accountId: targetId } : item),
    ownerIdentity: {
      ...state.ownerIdentity,
      ownAccountIds: [...new Set(state.ownerIdentity.ownAccountIds.map(mapId))],
      updatedAt: now,
    },
    auditProposals: state.auditProposals.map((proposal) => ({
      ...proposal,
      accountIds: [...new Set(proposal.accountIds.map(mapId))],
    })),
  };
}

export function createManualAccount(input: {
  name: string;
  currency: string;
  institution: Account['institution'];
  product?: string;
}): Account {
  const cleanName = input.name.trim();
  const cleanCurrency = input.currency.trim().toUpperCase();
  const cleanProduct = input.product?.trim();
  if (!cleanName) throw new Error('Informe um nome para a conta.');
  if (!/^[A-Z]{3}$/.test(cleanCurrency)) throw new Error('A moeda deve ter três letras, como EUR ou BRL.');
  const now = new Date().toISOString();
  return {
    id: `${input.institution}-${cleanCurrency.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`,
    name: cleanName,
    currency: cleanCurrency,
    institution: input.institution,
    product: cleanProduct || undefined,
    source: 'manual',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}
