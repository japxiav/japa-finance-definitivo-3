import type { AppState, AuditProposal, ReviewReason, TechnicalMovementType, Transaction } from '../core/types';
import { kindForTechnicalType, isCategoryReviewApplicable } from '../classification/technicalClassifier';
import { isCategoryCompatible } from '../classification/categoryCompatibility';
import { mergeAccounts, setAccountArchived } from './accountManagement';
import { reprocessFinancialState } from './reprocess';
import { createMemoryEntity } from './financialMemory';
import { normalizeMerchant } from '../core/merchant';

const TECHNICAL_TYPES = new Set<TechnicalMovementType>([
  'salary','other_income','card_payment','cash_withdrawal','direct_debit','bank_fee','other_expense','refund',
  'incoming_transfer','outgoing_transfer','internal_transfer','currency_conversion','adjustment','unknown',
]);

export interface AuditProposalPreview {
  canApply: boolean;
  title: string;
  changes: string[];
  blockers: string[];
}

function selectedTransactions(state: AppState, proposal: AuditProposal): Transaction[] {
  const ids = new Set(proposal.transactionIds);
  return state.transactions.filter((transaction) => ids.has(transaction.id));
}

export function previewAuditProposal(state: AppState, proposal: AuditProposal): AuditProposalPreview {
  const changes: string[] = [];
  const blockers: string[] = [];
  const transactions = selectedTransactions(state, proposal);
  const action = String(proposal.payload.action ?? '');

  if (action === 'reprocess_all') {
    changes.push('Reexecutar regras técnicas, vínculos compostos e Memória Financeira.');
    changes.push('Preservar todas as decisões manuais.');
  } else if (proposal.type === 'reclassify_technical') {
    const technicalType = proposal.payload.technicalType;
    if (typeof technicalType !== 'string' || !TECHNICAL_TYPES.has(technicalType as TechnicalMovementType)) blockers.push('Tipo técnico inválido.');
    if (!transactions.length) blockers.push('Nenhuma movimentação válida foi indicada.');
    const protectedCount = transactions.filter((transaction) => transaction.kindSource === 'manual').length;
    if (protectedCount) blockers.push(`${protectedCount} decisão(ões) manual(is) não podem ser sobrescritas pela auditoria.`);
    changes.push(`Reclassificar ${transactions.length - protectedCount} movimentação(ões) como ${String(technicalType ?? '')}.`);
  } else if (proposal.type === 'set_category') {
    const categoryId = proposal.payload.categoryId;
    const category = typeof categoryId === 'string' ? state.categories.find((item) => item.id === categoryId && item.active) : undefined;
    if (!category) blockers.push('Categoria não existe ou está arquivada.');
    const compatible = category ? transactions.filter((transaction) => isCategoryCompatible(category, transaction)) : [];
    if (!transactions.length) blockers.push('Nenhuma movimentação válida foi indicada.');
    if (compatible.length !== transactions.length) blockers.push('Parte das movimentações é incompatível com a categoria sugerida.');
    changes.push(`Aplicar ${category?.name ?? 'categoria'} a ${compatible.length} movimentação(ões), como decisão confirmada pelo usuário.`);
  } else if (proposal.type === 'link_internal_transfer') {
    if (transactions.length !== 2) blockers.push('Um vínculo interno precisa indicar exatamente duas movimentações.');
    if (transactions.length === 2 && (transactions[0]!.currency !== transactions[1]!.currency || transactions[0]!.direction === transactions[1]!.direction)) blockers.push('O par não possui moeda igual e direções opostas.');
    changes.push('Vincular o par como transferência entre contas próprias e excluí-lo de renda e despesa.');
  } else if (proposal.type === 'link_compound_event') {
    if (transactions.length < 2) blockers.push('Evento composto precisa de pelo menos duas linhas bancárias.');
    changes.push(`Agrupar ${transactions.length} linhas como um único acontecimento sem apagar os fatos originais.`);
  } else if (proposal.type === 'archive_account') {
    const account = state.accounts.find((item) => item.id === proposal.accountIds[0]);
    if (!account) blockers.push('Conta não encontrada.');
    changes.push(`Arquivar ${account?.name ?? 'conta'} sem remover o histórico.`);
  } else if (proposal.type === 'merge_accounts') {
    if (proposal.accountIds.length !== 2) blockers.push('A mesclagem precisa indicar origem e destino.');
    const [source, target] = proposal.accountIds.map((id) => state.accounts.find((account) => account.id === id));
    if (!source || !target) blockers.push('Uma das contas não existe.');
    if (source && target && source.currency !== target.currency) blockers.push('As contas têm moedas diferentes.');
    changes.push(`Mover todos os vínculos de ${source?.name ?? 'origem'} para ${target?.name ?? 'destino'}.`);
  } else if (proposal.type === 'create_memory_entity') {
    const displayName = proposal.payload.entityDisplayName ?? proposal.payload.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) blockers.push('Nome da entidade ausente.');
    if (!transactions.length) blockers.push('Nenhuma movimentação forneceu evidência para a memória.');
    changes.push(`Criar contexto financeiro para ${String(displayName ?? '')} e aplicá-lo ao grupo indicado.`);
  } else {
    blockers.push('Esta proposta é apenas informativa e precisa de revisão humana.');
  }

  return { canApply: blockers.length === 0, title: proposal.title, changes, blockers };
}

export function applyAuditProposal(state: AppState, proposal: AuditProposal): AppState {
  const preview = previewAuditProposal(state, proposal);
  if (!preview.canApply) throw new Error(preview.blockers.join(' '));
  const now = new Date().toISOString();
  const ids = new Set(proposal.transactionIds);
  let next = state;

  if (proposal.payload.action === 'reprocess_all') {
    next = reprocessFinancialState(state);
  } else if (proposal.type === 'reclassify_technical') {
    const technicalType = proposal.payload.technicalType as TechnicalMovementType;
    const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
    next = {
      ...state,
      transactions: state.transactions.map((transaction) => {
        if (!ids.has(transaction.id) || transaction.kindSource === 'manual') return transaction;
        const reviewReasons: ReviewReason[] = transaction.reviewReasons.filter((reason) => reason !== 'unknown_kind');
        if (technicalType === 'unknown' && !reviewReasons.includes('unknown_kind')) reviewReasons.push('unknown_kind');
        return {
          ...transaction,
          technicalType,
          kind: kindForTechnicalType(technicalType),
          kindSource: 'system',
          analysisExcluded,
          categoryId: analysisExcluded ? undefined : transaction.categoryId,
          categorySource: analysisExcluded ? 'none' : transaction.categorySource,
          categoryReviewStatus: analysisExcluded ? 'not_applicable' : transaction.categoryReviewStatus,
          reviewReasons,
          needsReview: reviewReasons.length > 0,
          updatedAt: now,
        };
      }),
    };
    next = reprocessFinancialState(next);
  } else if (proposal.type === 'set_category') {
    const categoryId = proposal.payload.categoryId as string;
    const researchedName = typeof proposal.payload.entityDisplayName === 'string' ? proposal.payload.entityDisplayName.trim() : '';
    const sourceUrl = typeof proposal.payload.sourceUrl === 'string' ? proposal.payload.sourceUrl.trim() : '';
    const knowledgeEntry = researchedName && sourceUrl ? {
      id: crypto.randomUUID(),
      normalizedName: normalizeMerchant(researchedName),
      displayName: researchedName,
      entityType: 'merchant' as const,
      categoryId,
      summary: proposal.explanation,
      source: 'web' as const,
      sourceUrl,
      confidence: proposal.confidence,
      researchedAt: now,
      createdAt: now,
      updatedAt: now,
    } : undefined;
    next = {
      ...state,
      transactions: state.transactions.map((transaction) => ids.has(transaction.id) && isCategoryReviewApplicable(transaction.technicalType)
        ? {
          ...transaction,
          categoryId,
          categorySource: 'manual',
          categoryReviewStatus: 'resolved',
          manualEditLog: [...transaction.manualEditLog, { field: 'categoryId', oldValue: transaction.categoryId, newValue: categoryId, editedAt: now }],
          updatedAt: now,
        }
        : transaction),
      knowledgeBase: knowledgeEntry
        ? [...state.knowledgeBase.filter((item) => item.normalizedName !== knowledgeEntry.normalizedName), knowledgeEntry]
        : state.knowledgeBase,
    };
    next = reprocessFinancialState(next);
  } else if (proposal.type === 'link_internal_transfer') {
    const groupId = `audit-internal:${crypto.randomUUID()}`;
    next = {
      ...state,
      transactions: state.transactions.map((transaction) => ids.has(transaction.id)
        ? {
          ...transaction,
          technicalType: 'internal_transfer',
          kind: 'transfer',
          kindSource: 'manual',
          analysisExcluded: true,
          transferGroupId: groupId,
          categoryId: undefined,
          categorySource: 'none',
          categoryReviewStatus: 'not_applicable',
          reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'ambiguous_transfer' && reason !== 'unknown_kind'),
          needsReview: transaction.reviewReasons.some((reason) => !['ambiguous_transfer','unknown_kind'].includes(reason)),
          updatedAt: now,
        }
        : transaction),
    };
    next = reprocessFinancialState(next);
  } else if (proposal.type === 'link_compound_event') {
    const compoundEventId = `audit-compound:${crypto.randomUUID()}`;
    next = { ...state, transactions: state.transactions.map((transaction) => ids.has(transaction.id) ? { ...transaction, compoundEventId, updatedAt: now } : transaction) };
  } else if (proposal.type === 'archive_account') {
    next = setAccountArchived(state, proposal.accountIds[0]!, true);
  } else if (proposal.type === 'merge_accounts') {
    next = mergeAccounts(state, proposal.accountIds[0]!, proposal.accountIds[1]!);
    next = reprocessFinancialState(next);
  } else if (proposal.type === 'create_memory_entity') {
    const transactions = selectedTransactions(state, proposal);
    const alias = transactions.map((transaction) => transaction.merchantNormalized).find(Boolean) ?? normalizeMerchant(String(proposal.payload.entityDisplayName ?? proposal.payload.displayName));
    const direction = transactions.every((transaction) => transaction.direction === transactions[0]?.direction) ? transactions[0]?.direction : undefined;
    const entity = createMemoryEntity({
      displayName: String(proposal.payload.entityDisplayName ?? proposal.payload.displayName),
      aliases: [alias],
      type: 'person',
      relationship: 'unknown',
      source: 'confirmed_suggestion',
      contextLabel: typeof proposal.payload.contextLabel === 'string' ? proposal.payload.contextLabel : undefined,
      direction,
      validFrom: transactions.map((transaction) => transaction.reportingDate).sort()[0],
      validUntil: transactions.map((transaction) => transaction.reportingDate).sort().at(-1),
    });
    next = reprocessFinancialState({ ...state, financialMemory: [...state.financialMemory, entity] });
  }

  return {
    ...next,
    auditProposals: next.auditProposals.map((item) => item.id === proposal.id
      ? { ...item, status: 'applied', resolvedAt: now }
      : item),
  };
}
