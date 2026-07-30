export type CurrencyCode = 'EUR' | 'BRL' | string;
export type Institution = 'revolut' | 'wise' | 'cash' | 'other';
export type Direction = 'inflow' | 'outflow';
export type TransactionStatus = 'completed' | 'pending' | 'voided' | 'merged';
export type TransactionSource = 'revolut_csv' | 'wise_csv' | 'revolut_pdf' | 'manual';
export type TransactionKind = 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment' | 'unknown';
export type TechnicalMovementType =
  | 'salary'
  | 'other_income'
  | 'card_payment'
  | 'cash_withdrawal'
  | 'direct_debit'
  | 'bank_fee'
  | 'other_expense'
  | 'refund'
  | 'incoming_transfer'
  | 'outgoing_transfer'
  | 'internal_transfer'
  | 'currency_conversion'
  | 'adjustment'
  | 'unknown';
export type CategoryReviewStatus = 'pending' | 'deferred' | 'resolved' | 'not_applicable';
export type ClassificationSource = 'bank' | 'manual' | 'rule' | 'system' | 'unknown';
export type CategorySource = 'manual' | 'rule' | 'system' | 'none';
export type ParserName = 'revolut_csv' | 'wise_csv' | 'revolut_pdf';
export type FeeTreatment =
  | 'INCLUDED_IN_REPORTED_AMOUNT'
  | 'ADDITIONAL_TO_REPORTED_AMOUNT';
export type ReviewReason =
  | 'uncategorized'
  | 'unknown_kind'
  | 'possible_duplicate'
  | 'zero_amount'
  | 'unverified_fee'
  | 'ambiguous_transfer'
  | 'unlinked_refund';

export interface Account {
  id: string;
  name: string;
  currency: CurrencyCode;
  institution: Institution;
  active: boolean;
}

export interface ManualEdit {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  editedAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  importId?: string;

  bankTransactionId?: string;
  dedupFingerprint: string;
  sourceFileHash?: string;
  sourceRowNumber?: number;

  /** Magnitude sem sinal, mantida por compatibilidade com a UI legada. */
  amountCents: number;
  /** Valor assinado reportado pelo extrato antes da normalização da taxa. */
  reportedAmountCents?: number;
  /** Movimento líquido assinado; consumidores financeiros devem usar este campo. */
  netMovementCents?: number;
  feeCents?: number;
  feeTreatment?: FeeTreatment;
  sourceFingerprint?: string;
  semanticFingerprint?: string;
  balanceAfterCents?: number;
  currency: CurrencyCode;
  direction: Direction;

  source: TransactionSource;
  status: TransactionStatus;
  kind: TransactionKind;
  technicalType: TechnicalMovementType;
  kindSource: ClassificationSource;
  analysisExcluded: boolean;

  descriptionOriginal: string;
  merchantNormalized: string;
  bankType?: string;
  bankProduct?: string;
  bankState?: string;

  /** Instante original em texto canônico; reportingDate decide o dia contábil. */
  startedAt?: string;
  completedAt?: string;
  reportingDate: string;

  /** Categoria financeira opcional; `technicalType` preserva o fato bancário. */
  categoryId?: string;
  categorySource: CategorySource;
  categoryReviewStatus: CategoryReviewStatus;
  transferGroupId?: string;
  refundOfTransactionId?: string;
  mergedFromTransactionId?: string;
  possibleDuplicateOfId?: string;

  note?: string;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  manualEditLog: ManualEdit[];
  originalData: Record<string, string>;

  statusBeforeVoid?: TransactionStatus;
  voidReason?: 'import_undone' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export type ImportStatus = 'active' | 'undone';

export interface ImportBatch {
  id: string;
  accountId: string;
  fileName: string;
  fileHash: string;
  parserName: ParserName;
  parserVersion: string;
  createdAt: string;
  status: ImportStatus;
  rowsRead: number;
  imported: number;
  confirmedDuplicates: number;
  possibleDuplicates: number;
  pendingRows: number;
  rejected: number;
  currencies: string[];
  firstReportingDate?: string;
  lastReportingDate?: string;
}

export type ImportIssueKind =
  | 'row_error'
  | 'pending'
  | 'possible_duplicate'
  | 'currency_mismatch'
  | 'format_change';
export type ImportIssueStatus = 'unresolved' | 'accepted' | 'ignored';

export interface ImportIssue {
  id: string;
  importId: string;
  accountId: string;
  kind: ImportIssueKind;
  status: ImportIssueStatus;
  message: string;
  rowNumber?: number;
  transactionId?: string;
  matchedTransactionIds?: string[];
  originalData: Record<string, string>;
  createdAt: string;
  resolvedAt?: string;
}

export interface PossibleDuplicate {
  transaction: Transaction;
  matchedTransactionIds: string[];
  reason: string;
}

export type CategoryType = 'expense' | 'income' | 'both' | 'system';

export interface Category {
  id: string;
  name: string;
  active: boolean;
  type?: CategoryType;
  icon?: string;
  color?: string;
  system?: boolean;
  createdAt?: string;
  archivedAt?: string;
}

export type RuleKind = 'exact' | 'contains' | 'starts_with';

export type CategoryRuleSource = 'default' | 'learned';

export interface CategoryRule {
  id: string;
  pattern: string;
  kind: RuleKind;
  categoryId: string;
  order: number;
  source?: CategoryRuleSource;
  merchantLabel?: string;
  active?: boolean;
  /** Exceções manuais sempre prevalecem sobre a regra. */
  exceptionTransactionIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  /** Escopo técnico opcional. Regras padrão antigas continuam globais. */
  currency?: CurrencyCode;
  direction?: Direction;
  transactionKind?: TransactionKind;
  technicalType?: TechnicalMovementType;
}

export type SuggestionConfidence = 'high' | 'medium' | 'low';
export type ReviewGroupStatus = 'pending' | 'deferred';

export interface ReviewGroup {
  id: string;
  /** Chave determinística por comerciante, moeda, direção e tipo técnico. */
  key: string;
  merchantNormalized: string;
  merchantLabel: string;
  currency: CurrencyCode;
  direction: Direction;
  kind: TransactionKind;
  technicalType: TechnicalMovementType;
  transactionIds: string[];
  suggestedCategoryId?: string;
  suggestionConfidence?: SuggestionConfidence;
  suggestionScore?: number;
  suggestionExplanation?: string;
  suggestionEvidence: string[];
  status: ReviewGroupStatus;
  deferredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionClassificationSnapshot {
  transactionId: string;
  categoryId?: string;
  categorySource: CategorySource;
  categoryReviewStatus: CategoryReviewStatus;
  needsReview: boolean;
  reviewReasons: ReviewReason[];
  manualEditLog: ManualEdit[];
  updatedAt: string;
}

export interface ReviewRuleChange {
  before?: CategoryRule;
  after?: CategoryRule;
}

export type ReviewDecisionKind =
  | 'apply_group_category'
  | 'apply_transaction_category'
  | 'defer_group'
  | 'create_rule'
  | 'resolve_without_category'
  | 'reopen_group';

export interface ReviewDecision {
  id: string;
  kind: ReviewDecisionKind;
  label: string;
  groupKey?: string;
  transactionIds: string[];
  before: TransactionClassificationSnapshot[];
  after: TransactionClassificationSnapshot[];
  ruleChanges: ReviewRuleChange[];
  createdAt: string;
  undoneAt?: string;
}

export interface InsightFeedback {
  insightKey: string;
  lastShownAt?: string;
  dismissedAt?: string;
  useful?: boolean;
}

export interface AccountBalanceSnapshot {
  id: string;
  accountId: string;
  currency: CurrencyCode;
  balanceCents: number;
  asOf: string;
  source: 'import' | 'manual';
  sourceImportId?: string;
  reconciled: boolean;
  createdAt: string;
  reconciliationBatchId?: string;
  logicalAsOf?: string;
}

export interface ReservePolicy {
  currency: CurrencyCode;
  minimumCents: number;
  targetCents?: number;
  updatedAt: string;
}


export interface ReconciliationBatchRecord {
  id: string;
  /** Preserva o dia civil local; o instante UTC sozinho não consegue fazê-lo perto da meia-noite. */
  logicalDate?: string;
  logicalAsOf: string;
  createdAt: string;
  source: 'manual' | 'import' | 'system';
  status: 'COMPLETE' | 'INVALIDATED';
}

export interface PlannedTransferRecord {
  id: string;
  title: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  feeCents: number;
  dueDate: string;
  evidenceLevel: 'confirmed' | 'planned' | 'estimated';
  status: 'active' | 'cancelled';
}

export type PlannedEventKind = 'income' | 'expense' | 'transfer' | 'installment' | 'recurring';
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

export interface PlannedEvent {
  id: string;
  title: string;
  kind: PlannedEventKind;
  direction: Direction;
  amountCents: number;
  currency: CurrencyCode;
  dueDate: string;
  accountId?: string;
  needsAccountReview?: boolean;
  recurrence?: {
    frequency: RecurrenceFrequency;
    interval: number;
    until?: string;
    maxOccurrences?: number;
  };
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncMetadata {
  remoteRevision: number;
  remoteUpdatedAt: string;
  lastSyncedStateHash: string;
}

export interface AppState {
  schemaVersion: 7;
  accounts: Account[];
  transactions: Transaction[];
  imports: ImportBatch[];
  importIssues: ImportIssue[];
  categories: Category[];
  rules: CategoryRule[];
  balanceSnapshots: AccountBalanceSnapshot[];
  reservePolicies: ReservePolicy[];
  plannedEvents: PlannedEvent[];
  reconciliationBatches: ReconciliationBatchRecord[];
  plannedTransfers: PlannedTransferRecord[];
  insightFeedback: InsightFeedback[];
  reviewGroups: ReviewGroup[];
  reviewDecisions: ReviewDecision[];
}
