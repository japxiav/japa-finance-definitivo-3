import type { AppState, AuditIssueSeverity, Transaction } from '../core/types';
import { signedNetMovement } from '../core/finance';
import { buildCompoundEventSummaries } from './compoundEvents';

export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'info';
  value: string;
  detail: string;
  transactionIds?: string[];
  accountIds?: string[];
}

export interface DataQualityDimension {
  id: 'integrity' | 'coverage' | 'reconciliation' | 'classification' | 'recovery';
  label: string;
  score: number;
  detail: string;
}

export interface AccountDataQuality {
  accountId: string;
  score: number;
  confidence: 'confirmed' | 'usable' | 'limited';
  firstDate?: string;
  lastDate?: string;
  transactionCount: number;
  issues: string[];
}

export interface DataHealthReport {
  score: number;
  confidenceLabel: string;
  reportConfidence: 'confirmed' | 'usable' | 'limited';
  criticalCount: number;
  warningCount: number;
  checks: HealthCheck[];
  dimensions: DataQualityDimension[];
  accountQuality: AccountDataQuality[];
  generatedAt: string;
}

function duplicateGroups(transactions: Transaction[]): string[][] {
  const map = new Map<string, string[]>();
  for (const transaction of transactions) {
    if (transaction.status === 'voided' || transaction.status === 'merged') continue;
    const key = `${transaction.accountId}|${transaction.bankTransactionId ?? transaction.lifecycleFingerprint ?? transaction.semanticFingerprint ?? transaction.dedupFingerprint}|${transaction.sourceComponent ?? 'primary'}`;
    const ids = map.get(key) ?? [];
    ids.push(transaction.id);
    map.set(key, ids);
  }
  return [...map.values()].filter((ids) => ids.length > 1);
}

export function buildDataHealthReport(state: AppState): DataHealthReport {
  const checks: HealthCheck[] = [];
  const activeTransactions = state.transactions.filter((item) => item.status !== 'voided' && item.status !== 'merged');
  const duplicates = duplicateGroups(activeTransactions);
  checks.push({
    id: 'duplicates',
    label: 'Duplicatas conflitantes',
    status: duplicates.length ? 'error' : 'ok',
    value: String(duplicates.length),
    detail: duplicates.length ? 'Há fatos bancários repetidos com a mesma identidade estável.' : 'Nenhuma duplicata forte foi encontrada.',
    transactionIds: duplicates.flat(),
  });

  const unknown = activeTransactions.filter((item) => item.status === 'completed' && item.technicalType === 'unknown');
  checks.push({
    id: 'unknown-technical',
    label: 'Tipos técnicos desconhecidos',
    status: unknown.length ? 'warning' : 'ok',
    value: String(unknown.length),
    detail: unknown.length ? 'Esses movimentos podem alterar a leitura do fluxo.' : 'Todos os fatos concluídos têm natureza técnica conhecida.',
    transactionIds: unknown.map((item) => item.id),
  });

  const pending = activeTransactions.filter((item) => item.status === 'pending');
  checks.push({
    id: 'pending',
    label: 'Movimentos pendentes',
    status: pending.length ? 'info' : 'ok',
    value: String(pending.length),
    detail: pending.length ? 'Afetam o saldo disponível, mas ainda não o saldo contabilizado.' : 'Nenhum movimento pendente no último estado importado.',
    transactionIds: pending.map((item) => item.id),
  });

  const mismatchedFees = activeTransactions.filter((item) => item.technicalType === 'bank_fee'
    && item.direction !== 'outflow');
  checks.push({
    id: 'fee-direction',
    label: 'Taxas com direção incompatível',
    status: mismatchedFees.length ? 'error' : 'ok',
    value: String(mismatchedFees.length),
    detail: mismatchedFees.length ? 'Taxas deveriam ser débitos ou estornos explicitamente vinculados.' : 'As taxas têm direção coerente.',
    transactionIds: mismatchedFees.map((item) => item.id),
  });

  const compounds = buildCompoundEventSummaries(state);
  const incompleteConversions = compounds.filter((item) => item.kind === 'conversion' && (!item.source || !item.target));
  checks.push({
    id: 'conversion-links',
    label: 'Conversões sem as duas pontas',
    status: incompleteConversions.length ? 'warning' : 'ok',
    value: String(incompleteConversions.length),
    detail: incompleteConversions.length ? 'Pode ser cobertura incompleta do extrato ou vínculo ainda ausente.' : 'As conversões compostas conhecidas têm origem e destino.',
    transactionIds: incompleteConversions.flatMap((item) => item.transactionIds),
  });

  const accountsMissingPosition = state.accounts.filter((account) => account.active
    && !state.balanceSnapshots.some((snapshot) => snapshot.accountId === account.id && snapshot.reconciled));
  checks.push({
    id: 'positions',
    label: 'Contas sem posição confiável',
    status: accountsMissingPosition.length ? 'warning' : 'ok',
    value: String(accountsMissingPosition.length),
    detail: accountsMissingPosition.length ? 'O app não deve chamar o saldo dessas contas de atual.' : 'Todas as contas ativas têm uma posição reconciliada.',
    accountIds: accountsMissingPosition.map((item) => item.id),
  });

  const unresolvedImport = state.importIssues.filter((item) => item.status === 'unresolved' && item.kind !== 'pending');
  checks.push({
    id: 'import-issues',
    label: 'Problemas de importação',
    status: unresolvedImport.length ? 'error' : 'ok',
    value: String(unresolvedImport.length),
    detail: unresolvedImport.length ? 'Há linhas rejeitadas, formato inesperado ou conflitos de importação.' : 'Nenhum problema obrigatório de importação está aberto.',
  });

  const optionalGroups = state.reviewGroups.filter((item) => item.status === 'pending');
  checks.push({
    id: 'optional-context',
    label: 'Grupos de categoria opcionais',
    status: optionalGroups.length ? 'info' : 'ok',
    value: String(optionalGroups.length),
    detail: optionalGroups.length ? 'Melhoram a análise por categoria, mas não invalidam saldo nem fluxo.' : 'Nenhum grupo opcional aguardando organização.',
  });

  const lastBackup = typeof localStorage !== 'undefined' ? localStorage.getItem('japa-finance-last-export-at') : null;
  checks.push({
    id: 'backup',
    label: 'Último backup',
    status: lastBackup ? 'ok' : 'warning',
    value: lastBackup ? new Date(lastBackup).toLocaleDateString('pt-BR') : 'não registrado',
    detail: lastBackup ? 'Existe registro local de exportação recente.' : 'Baixe um backup antes de mudanças grandes.',
  });

  const criticalCount = checks.filter((item) => item.status === 'error').length;
  const warningCount = checks.filter((item) => item.status === 'warning').length;
  const penalty = criticalCount * 22 + warningCount * 8;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const confidenceLabel = criticalCount ? 'Base precisa de correção' : warningCount ? 'Base utilizável com ressalvas' : 'Base consistente';

  const integrityPenalty = (duplicates.length + mismatchedFees.length + unresolvedImport.length) * 18;
  const coveragePenalty = accountsMissingPosition.length * 12 + pending.length * 2;
  const conversionCount = compounds.filter((item) => item.kind === 'conversion').length;
  const incompleteConversionRatio = conversionCount ? incompleteConversions.length / conversionCount : 0;
  const reconciliationPenalty = accountsMissingPosition.length * 20 + Math.round(incompleteConversionRatio * 60);
  const classificationPenalty = unknown.length * 6 + optionalGroups.length;
  const recoveryPenalty = lastBackup ? 0 : 30;
  const dimensions: DataQualityDimension[] = [
    { id: 'integrity', label: 'Integridade', score: Math.max(0, 100 - integrityPenalty), detail: 'Duplicatas fortes, taxas incompatíveis e problemas obrigatórios de importação.' },
    { id: 'coverage', label: 'Cobertura', score: Math.max(0, 100 - coveragePenalty), detail: 'Até onde os extratos e posições cobrem as contas ativas.' },
    { id: 'reconciliation', label: 'Reconciliação', score: Math.max(0, 100 - reconciliationPenalty), detail: 'Posições confirmadas e eventos com as duas pontas observadas.' },
    { id: 'classification', label: 'Compreensão técnica', score: Math.max(0, 100 - classificationPenalty), detail: 'Natureza bancária conhecida; categorias opcionais pesam pouco.' },
    { id: 'recovery', label: 'Recuperação', score: Math.max(0, 100 - recoveryPenalty), detail: 'Registro de backup exportado e capacidade de voltar a um estado anterior.' },
  ];

  const accountQuality: AccountDataQuality[] = state.accounts.filter((account) => account.active).map((account) => {
    const rows = activeTransactions.filter((item) => item.accountId === account.id);
    const issues: string[] = [];
    const hasPosition = state.balanceSnapshots.some((snapshot) => snapshot.accountId === account.id && snapshot.reconciled);
    const accountUnknown = rows.filter((item) => item.status === 'completed' && item.technicalType === 'unknown').length;
    const accountImportIssues = unresolvedImport.filter((issue) => issue.accountId === account.id).length;
    if (!hasPosition) issues.push('Sem posição reconciliada');
    if (accountUnknown) issues.push(`${accountUnknown} tipo(s) técnico(s) desconhecido(s)`);
    if (accountImportIssues) issues.push(`${accountImportIssues} problema(s) de importação`);
    const accountScore = Math.max(0, 100 - (hasPosition ? 0 : 25) - accountUnknown * 8 - accountImportIssues * 20);
    const dates = rows.map((item) => item.reportingDate).sort();
    return {
      accountId: account.id,
      score: accountScore,
      confidence: accountScore >= 90 ? 'confirmed' : accountScore >= 65 ? 'usable' : 'limited',
      firstDate: dates[0],
      lastDate: dates.at(-1),
      transactionCount: rows.length,
      issues,
    };
  });
  const reportConfidence = criticalCount || score < 60 ? 'limited' : warningCount ? 'usable' : 'confirmed';
  return { score, confidenceLabel, reportConfidence, criticalCount, warningCount, checks, dimensions, accountQuality, generatedAt: new Date().toISOString() };
}

export function severityForHealthCheck(check: HealthCheck): AuditIssueSeverity {
  return check.status === 'error' ? 'critical' : check.status === 'warning' ? 'warning' : 'info';
}
