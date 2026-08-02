import type {
  AiAuditRun,
  AppState,
  AuditProposal,
  AuditProposalType,
  SuggestionConfidence,
  TechnicalMovementType,
} from '../core/types';
import { buildDataHealthReport, severityForHealthCheck } from './dataHealth';
import { buildMemorySuggestions } from './financialMemory';
import { findInternalTransferSuggestions } from './internalTransfers';
import { previewReprocess } from './reprocess';
import { stableHash } from '../core/hash';
import { signedNetMovement } from '../core/finance';

export interface FinancialAuditContext {
  schemaVersion: number;
  generatedAt: string;
  currencies: string[];
  categorySummary: Array<{ id: string; name: string; type: string }>;
  accountSummary: Array<{
    id: string;
    name: string;
    institution: string;
    product?: string;
    currency: string;
    active: boolean;
    transactionCount: number;
    lastMovementDate?: string;
  }>;
  health: ReturnType<typeof buildDataHealthReport>;
  reprocess: ReturnType<typeof previewReprocess>;
  memorySummary: Array<{
    id: string;
    displayName: string;
    type: string;
    relationship: string;
    contextLabel?: string;
    validFrom?: string;
    validUntil?: string;
  }>;
  recurringCounterparties: Array<{
    displayName: string;
    direction: string;
    count: number;
    firstDate: string;
    lastDate: string;
    currency: string;
    totalCents: number;
    sampleDescriptions: string[];
  }>;
  unknownPatterns: Array<{
    normalized: string;
    count: number;
    currency: string;
    direction: string;
    sample: string;
    transactionIds: string[];
  }>;
  recentChanges: Array<{
    date: string;
    description: string;
    amountCents: number;
    currency: string;
    technicalType: string;
  }>;
  publicLookupCandidates: Array<{
    normalizedName: string;
    sample: string;
    count: number;
    transactionIds: string[];
  }>;
}

export function buildFinancialAuditContext(state: AppState): FinancialAuditContext {
  const health = buildDataHealthReport(state);
  const reprocess = previewReprocess(state);
  const currencies = [...new Set(state.accounts.map((account) => account.currency))].sort();
  const accountSummary = state.accounts.map((account) => {
    const rows = state.transactions.filter((transaction) => transaction.accountId === account.id && transaction.status !== 'voided');
    return {
      id: account.id,
      name: account.name,
      institution: account.institution,
      product: account.product,
      currency: account.currency,
      active: account.active,
      transactionCount: rows.length,
      lastMovementDate: rows.map((item) => item.reportingDate).sort().at(-1),
    };
  });
  const memorySuggestions = buildMemorySuggestions(state);
  const recurringCounterparties = memorySuggestions.slice(0, 30).map((suggestion) => {
    const rows = suggestion.transactionIds.map((id) => state.transactions.find((item) => item.id === id)).filter(Boolean) as AppState['transactions'];
    return {
      displayName: suggestion.displayName,
      direction: suggestion.direction,
      count: suggestion.count,
      firstDate: suggestion.firstDate,
      lastDate: suggestion.lastDate,
      currency: rows[0]?.currency ?? '',
      totalCents: rows.reduce((sum, item) => sum + Math.abs(signedNetMovement(item)), 0),
      sampleDescriptions: [...new Set(rows.slice(0, 4).map((item) => item.descriptionOriginal))],
    };
  });
  const unknownBuckets = new Map<string, AppState['transactions']>();
  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed' || transaction.technicalType !== 'unknown') continue;
    const normalized = transaction.merchantNormalized || transaction.descriptionOriginal.toLocaleLowerCase('pt-BR').replace(/\d+/g, '#').slice(0, 80);
    const key = `${transaction.currency}|${transaction.direction}|${normalized}`;
    const rows = unknownBuckets.get(key) ?? [];
    rows.push(transaction);
    unknownBuckets.set(key, rows);
  }
  const unknownPatterns = [...unknownBuckets.entries()].map(([key, rows]) => {
    const [currency, direction, normalized] = key.split('|');
    return {
      normalized: normalized!,
      count: rows.length,
      currency: currency!,
      direction: direction!,
      sample: rows[0]!.descriptionOriginal,
      transactionIds: rows.map((item) => item.id),
    };
  }).sort((a, b) => b.count - a.count).slice(0, 50);
  const recentChanges = state.transactions
    .filter((item) => item.status === 'completed')
    .sort((a, b) => b.reportingDate.localeCompare(a.reportingDate) || (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 80)
    .map((item) => ({
      date: item.reportingDate,
      description: item.friendlyDescription ?? item.descriptionOriginal,
      amountCents: signedNetMovement(item),
      currency: item.currency,
      technicalType: item.technicalType,
    }));
  const publicBuckets = new Map<string, AppState['transactions']>();
  for (const transaction of state.transactions) {
    if (transaction.status !== 'completed' || transaction.sourceComponent === 'fee') continue;
    if (!['card_payment', 'direct_debit', 'other_expense'].includes(transaction.technicalType)) continue;
    const normalizedName = transaction.merchantNormalized?.trim();
    if (!normalizedName || normalizedName.length < 3) continue;
    if (state.knowledgeBase.some((item) => item.normalizedName === normalizedName)) continue;
    const rows = publicBuckets.get(normalizedName) ?? [];
    rows.push(transaction);
    publicBuckets.set(normalizedName, rows);
  }
  const publicLookupCandidates = [...publicBuckets.entries()]
    .map(([normalizedName, rows]) => ({
      normalizedName,
      sample: rows[0]!.descriptionOriginal,
      count: rows.length,
      transactionIds: rows.map((item) => item.id).slice(0, 30),
    }))
    .sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName))
    .slice(0, 30);
  return {
    schemaVersion: state.schemaVersion,
    generatedAt: new Date().toISOString(),
    currencies,
    categorySummary: state.categories.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, type: item.type ?? 'both' })),
    accountSummary,
    health,
    reprocess,
    memorySummary: state.financialMemory.map((item) => ({
      id: item.id,
      displayName: item.displayName,
      type: item.type,
      relationship: item.relationship,
      contextLabel: item.contextLabel,
      validFrom: item.validFrom,
      validUntil: item.validUntil,
    })),
    recurringCounterparties,
    unknownPatterns,
    recentChanges,
    publicLookupCandidates,
  };
}

function proposal(input: Omit<AuditProposal, 'id' | 'status' | 'createdAt'>): AuditProposal {
  return {
    id: crypto.randomUUID(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...input,
  };
}

export function buildDeterministicAuditProposals(state: AppState): AuditProposal[] {
  const proposals: AuditProposal[] = [];
  const reprocess = previewReprocess(state);
  if (reprocess.changed > 0) {
    proposals.push(proposal({
      type: 'reclassify_technical',
      severity: reprocess.technicalResolved || reprocess.internalResolved ? 'warning' : 'info',
      title: `Reprocessar ${reprocess.changed} movimentações`,
      explanation: `${reprocess.technicalResolved} tipos técnicos podem ser resolvidos, ${reprocess.internalResolved} movimentos podem sair do fluxo externo e ${reprocess.reviewRemoved} itens podem deixar a revisão obrigatória.`,
      evidence: [
        `${reprocess.manualPreserved} decisões técnicas manuais serão preservadas`,
        `${reprocess.feesResolved} taxas reconhecíveis`,
        `${reprocess.categoriesResolved} categorias por regra`,
      ],
      transactionIds: [],
      accountIds: [],
      confidence: 'high',
      payload: { action: 'reprocess_all' },
    }));
  }

  for (const suggestion of findInternalTransferSuggestions(state).filter((item) => item.confidence === 'high').slice(0, 30)) {
    proposals.push(proposal({
      type: 'link_internal_transfer',
      severity: 'warning',
      title: 'Vincular transferência entre contas próprias',
      explanation: `${suggestion.outflow.friendlyDescription ?? suggestion.outflow.descriptionOriginal} e ${suggestion.inflow.friendlyDescription ?? suggestion.inflow.descriptionOriginal} têm mesmo valor e moeda em contas diferentes.`,
      evidence: suggestion.evidence,
      transactionIds: [suggestion.outflow.id, suggestion.inflow.id],
      accountIds: [suggestion.outflow.accountId, suggestion.inflow.accountId],
      confidence: suggestion.confidence,
      payload: { suggestionKey: suggestion.key },
    }));
  }

  for (const memory of buildMemorySuggestions(state).slice(0, 20)) {
    proposals.push(proposal({
      type: 'create_memory_entity',
      severity: 'info',
      title: `Ensinar quem é ${memory.displayName}`,
      explanation: `${memory.count} transferências recorrentes foram agrupadas. Uma resposta sobre o contexto vale para o grupo inteiro e para próximos extratos.`,
      evidence: memory.evidence,
      transactionIds: memory.transactionIds,
      accountIds: [],
      confidence: memory.count >= 5 ? 'high' : 'medium',
      payload: {
        displayName: memory.displayName,
        alias: memory.normalizedAlias,
        direction: memory.direction,
        validFrom: memory.firstDate,
        validUntil: memory.lastDate,
      },
    }));
  }

  const health = buildDataHealthReport(state);
  for (const check of health.checks.filter((item) => item.status === 'error' || item.status === 'warning')) {
    if (check.id === 'unknown-technical' || check.id === 'conversion-links' || check.id === 'positions') continue;
    proposals.push(proposal({
      type: 'review_only',
      severity: severityForHealthCheck(check),
      title: check.label,
      explanation: check.detail,
      evidence: [`Quantidade: ${check.value}`],
      transactionIds: check.transactionIds ?? [],
      accountIds: check.accountIds ?? [],
      confidence: 'high',
      payload: { healthCheckId: check.id },
    }));
  }
  return proposals;
}

function isTechnicalMovementType(value: unknown): value is TechnicalMovementType {
  return typeof value === 'string' && [
    'salary', 'other_income', 'card_payment', 'cash_withdrawal', 'direct_debit', 'bank_fee', 'other_expense',
    'refund', 'incoming_transfer', 'outgoing_transfer', 'internal_transfer', 'currency_conversion', 'adjustment', 'unknown',
  ].includes(value);
}

function isConfidence(value: unknown): value is SuggestionConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

function isProposalType(value: unknown): value is AuditProposalType {
  return [
    'reclassify_technical', 'link_internal_transfer', 'link_compound_event', 'set_category',
    'create_memory_entity', 'merge_accounts', 'archive_account', 'review_only',
  ].includes(String(value));
}

export function parseAiAuditResponse(raw: unknown): { summary: string; proposals: AuditProposal[]; model?: string; usedWebSearch?: boolean } {
  if (!raw || typeof raw !== 'object') throw new Error('A auditoria de IA retornou um formato inválido.');
  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary : 'A auditoria foi concluída.';
  const items = Array.isArray(record.proposals) ? record.proposals : [];
  const proposals = items.slice(0, 50).flatMap((item): AuditProposal[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    if (!isProposalType(value.type)) return [];
    const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
      ? value.payload as Record<string, unknown>
      : {};
    if (value.type === 'reclassify_technical' && payload.technicalType !== undefined && !isTechnicalMovementType(payload.technicalType)) return [];
    return [proposal({
      type: value.type,
      severity: value.severity === 'critical' || value.severity === 'warning' ? value.severity : 'info',
      title: typeof value.title === 'string' ? value.title.slice(0, 180) : 'Sugestão da auditoria',
      explanation: typeof value.explanation === 'string' ? value.explanation.slice(0, 1200) : '',
      evidence: Array.isArray(value.evidence) ? value.evidence.filter((entry): entry is string => typeof entry === 'string').slice(0, 8) : [],
      transactionIds: Array.isArray(value.transactionIds) ? value.transactionIds.filter((entry): entry is string => typeof entry === 'string') : [],
      accountIds: Array.isArray(value.accountIds) ? value.accountIds.filter((entry): entry is string => typeof entry === 'string') : [],
      confidence: isConfidence(value.confidence) ? value.confidence : 'low',
      payload,
    })];
  });
  return {
    summary,
    proposals,
    model: typeof record.model === 'string' ? record.model : undefined,
    usedWebSearch: Boolean(record.usedWebSearch),
  };
}

export function createAiAuditRun(state: AppState, result: ReturnType<typeof parseAiAuditResponse>): AiAuditRun {
  const context = buildFinancialAuditContext(state);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    model: result.model ?? 'unknown',
    usedWebSearch: Boolean(result.usedWebSearch),
    summary: result.summary,
    proposalIds: result.proposals.map((item) => item.id),
    inputFingerprint: stableHash(JSON.stringify(context)),
  };
}
