
export type CurrencyCode = string;
export type CivilDate = string;
export type InstantTimestamp = string;
export type EvidenceLevel = 'confirmed' | 'planned' | 'estimated';
export type ForecastStatus = 'COMPLETE' | 'INCOMPLETE' | 'INVALID';

export interface Account {
  id: string;
  name: string;
  currency: CurrencyCode;
  active: boolean;
}

export interface ReconciliationBatch {
  id: string;
  /** Data civil do instante lógico no fuso em que a reconciliação foi feita. */
  logicalDate: CivilDate;
  logicalAsOf: InstantTimestamp;
  createdAt: InstantTimestamp;
  source: 'manual' | 'import' | 'system';
  status: 'COMPLETE' | 'INVALIDATED';
}

export interface AccountBalanceSnapshot {
  id: string;
  accountId: string;
  currency: CurrencyCode;
  balanceCents: number;
  reconciliationBatchId: string;
  reconciled: true;
}

export interface ReservePolicy {
  id: string;
  currency: CurrencyCode;
  minimumCents: number;
  targetCents?: number;
  updatedAt: InstantTimestamp;
}

export type EventKind = 'income' | 'expense' | 'installment';
export type EventStatus = 'active' | 'completed' | 'cancelled' | 'overdue';
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  until?: CivilDate;
  maxOccurrences?: number;
}

export interface PlannedEvent {
  id: string;
  title: string;
  kind: EventKind;
  accountId: string;
  currency: CurrencyCode;
  amountCents: number;
  dueDate: CivilDate;
  evidenceLevel: EvidenceLevel;
  status: EventStatus;
  recurrence?: RecurrenceRule;
}

export interface PlannedTransfer {
  id: string;
  title: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  feeCents: number;
  dueDate: CivilDate;
  evidenceLevel: EvidenceLevel;
  status: 'active' | 'cancelled';
}

export interface FinancialState {
  accounts: Account[];
  reconciliationBatches: ReconciliationBatch[];
  balanceSnapshots: AccountBalanceSnapshot[];
  reservePolicies: ReservePolicy[];
  plannedEvents: PlannedEvent[];
  plannedTransfers: PlannedTransfer[];
}

export type DomainViolationCode =
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'ACCOUNT_REFERENCE_INVALID'
  | 'ACCOUNT_CURRENCY_MISMATCH'
  | 'DATE_INVALID'
  | 'TIMESTAMP_INVALID'
  | 'AMOUNT_INVALID'
  | 'RECURRENCE_INVALID'
  | 'DUPLICATE_RESERVE_POLICY'
  | 'DUPLICATE_BATCH_SNAPSHOT'
  | 'BATCH_REFERENCE_INVALID'
  | 'BATCH_INVALIDATED'
  | 'SNAPSHOT_NOT_RECONCILED'
  | 'TRANSFER_SAME_ACCOUNT'
  | 'FX_TRANSFER_UNSUPPORTED'
  | 'ARITHMETIC_OVERFLOW';

export interface DomainViolation {
  code: DomainViolationCode;
  entityType: string;
  entityId?: string;
  field?: string;
  message: string;
}

export type ForecastBlockerCode =
  | 'RECONCILIATION_BATCH_NOT_FOUND'
  | 'RECONCILIATION_BATCH_INVALIDATED'
  | 'ACTIVE_ACCOUNT_SNAPSHOT_MISSING'
  | 'SNAPSHOT_NOT_RECONCILED'
  | 'FORECAST_START_NOT_AFTER_RECONCILIATION'
  | 'FORECAST_START_NOT_CONTIGUOUS_WITH_RECONCILIATION'
  | 'FORECAST_HORIZON_TOO_LARGE'
  | 'ACTIVE_ACCOUNT_NOT_FOUND';

export interface ForecastBlocker {
  code: ForecastBlockerCode;
  message: string;
  accountIds?: string[];
  reconciliationBatchId?: string;
}

export type ForecastWarning =
  | {
      code: 'ACCOUNT_PROJECTED_NEGATIVE';
      accountId: string;
      date: CivilDate;
      balanceCents: number;
    }
  | {
      code: 'OVERDUE_PLANNED_EVENT';
      eventId: string;
      dueDate: CivilDate;
    }
  | {
      code: 'DAILY_GRANULARITY_ONLY';
    };

export type ForecastGuarantee =
  | 'STATE_SCHEMA_VALID'
  | 'DOMAIN_INVARIANTS_VALID'
  | 'ALL_ACTIVE_ACCOUNTS_RECONCILED'
  | 'SNAPSHOTS_SHARE_RECONCILIATION_BATCH'
  | 'ACCOUNT_CURRENCIES_MATCH'
  | 'EVENT_DATES_VALID'
  | 'EVENT_ACCOUNT_REFERENCES_VALID'
  | 'RECURRENCES_VALID_AND_BOUNDED'
  | 'TRANSFERS_BALANCED'
  | 'CURRENCIES_NOT_AGGREGATED'
  | 'ACCOUNT_FORECASTS_PRESERVED';

export interface ForecastPointComposition {
  confirmedInflowCents: number;
  confirmedOutflowCents: number;
  plannedInflowCents: number;
  plannedOutflowCents: number;
  estimatedInflowCents: number;
  estimatedOutflowCents: number;
}

export interface ForecastPoint {
  date: CivilDate;
  balanceCents: number;
  composition: ForecastPointComposition;
}

export interface AccountForecast {
  accountId: string;
  currency: CurrencyCode;
  openingBalanceCents: number;
  minimumProjectedBalanceCents: number;
  minimumProjectedBalanceDate: CivilDate;
  closingBalanceCents: number;
  projectedPoints: ForecastPoint[];
}

export interface CurrencyForecast {
  currency: CurrencyCode;
  openingBalanceCents: number;
  minimumProjectedBalanceCents: number;
  minimumProjectedBalanceDate: CivilDate;
  closingBalanceCents: number;
  accountIds: string[];
  projectedPoints: ForecastPoint[];
}

export interface ForecastResult {
  status: ForecastStatus;
  reconciliationBatchId?: string;
  logicalAsOf?: InstantTimestamp;
  logicalDate?: CivilDate;
  horizonStart: CivilDate;
  horizonEnd: CivilDate;
  consolidatedByCurrency: CurrencyForecast[];
  byAccount: AccountForecast[];
  blockers: ForecastBlocker[];
  violations: DomainViolation[];
  warnings: ForecastWarning[];
  guarantees: ForecastGuarantee[];
}

export type DecisionStatus = 'SAFE' | 'UNSAFE' | 'INCOMPLETE' | 'INVALID';
export type DecisionGuarantee =
  | 'FORECAST_COMPLETE'
  | 'RESERVE_POLICY_PRESENT'
  | 'TARGET_ACCOUNT_SOLVENT'
  | 'DECISION_WITHIN_HORIZON';


export type DecisionEvidenceKind =
  | 'OPENING_BALANCE'
  | 'PROPOSED_PURCHASE'
  | 'PLANNED_EVENT'
  | 'TRANSFER'
  | 'RESERVE_POLICY';

export interface DecisionEvidence {
  kind: DecisionEvidenceKind;
  referenceId: string;
  title: string;
  dueAt?: CivilDate;
  impactCents: number;
  accountId?: string;
  evidenceLevel?: EvidenceLevel;
}

export interface DecisionResult {
  status: DecisionStatus;
  forecastStatus: ForecastStatus;
  accountId?: string;
  currency?: CurrencyCode;
  amountCents?: number;
  marginCents?: number;
  minimumBalanceDate?: CivilDate;
  minimumProjectedBalanceCents?: number;
  reserveMinimumCents?: number;
  evidence: DecisionEvidence[];
  appliedRules: string[];
  blockers: string[];
  guarantees: DecisionGuarantee[];
}
