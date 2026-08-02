import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  ArrowLeftRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  ChevronRight,
  ChartNoAxesCombined,
  CircleAlert,
  Cloud,
  Home,
  Lightbulb,
  List,
  MessageSquare,
  Landmark,
  TriangleAlert,
  Send,
  Download,
  FileWarning,
  FileDown,
  Filter,
  Gauge,
  History,
  Layers3,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  WalletCards,
  WandSparkles,
  X,
} from 'lucide-react';
import { AuthScreen } from './auth/AuthScreen';
import { UpdatePassword } from './auth/UpdatePassword';
import { mergeImportedTransaction, previewSmartBankCsv, type Preview } from './core/csv';
import { financialDecisionFacade, type AssistantResult } from './application/FinancialDecisionFacade';
import { createReconciliationSnapshotBatch } from './application/reconciliation';
import { previewRevolutPdf } from './core/pdf';
import { formatReportingDate, localCivilDate, localDateTimeToInstant } from './core/date';
import { monthDateRange, monthKey, signedNetMovement } from './core/finance';
import { buildAnalytics } from './analytics/metrics';
import { buildCurrencyPosition, buildFreeMoneyPosition } from './analytics/accountPositions';
import { buildCurrencyAnalytics } from './analytics/currencyAnalytics';
import { buildPeriodComparison } from './analytics/comparison';
import { generateInsights } from './insights/engine';
import { buildImpactInsights, type ImpactInsight } from './insights/impactEngine';
import type { FinancialInsight } from './insights/types';
import { InsightCard } from './components/InsightCard';
import { ImpactInsightCard } from './components/ImpactInsightCard';
import { TransferDetailModal, type TransferDetailResult } from './components/TransferDetailModal';
import { MerchantLearningModal } from './components/MerchantLearningModal';
import { ReserveModal } from './components/ReserveModal';
import { PlannedEventModal } from './components/PlannedEventModal';
import { CategoryManagerModal } from './components/CategoryManagerModal';
import { ReviewGroupsPanel } from './components/ReviewGroupsPanel';
import { BulkRuleModal, type BulkRuleInput } from './components/BulkRuleModal';
import { IdentityProfileModal } from './components/IdentityProfileModal';
import { TransferRecurrencePanel } from './components/TransferRecurrencePanel';
import { DataHealthPanel } from './components/DataHealthPanel';
import { FinancialMemoryPanel } from './components/FinancialMemoryPanel';
import { AiAuditPanel } from './components/AiAuditPanel';
import { TransactionDetailsSheet } from './components/TransactionDetailsSheet';
import { AuditProposalConfirmModal } from './components/AuditProposalConfirmModal';
import { createConfirmedBatch, getUndoImpact, restoreImport, undoImport } from './core/imports';
import { formatMoney, parseSignedMoneyToCents } from './core/money';
import { normalizeMerchant } from './core/merchant';
import { buildActivityTimeline } from './application/activityTimeline';
import { applyOwnerIdentityContext } from './application/ownerIdentity';
import { applyPurposeToRecurrence, findTransferRecurrenceSuggestions, type TransferRecurrenceSuggestion } from './application/transferRecurrence';
import { downloadContextDiagnostic } from './application/contextDiagnostic';
import { deactivatePlannedEvent } from './application/plannedEvents';
import { confirmInternalTransferSuggestion, findInternalTransferSuggestions, rejectInternalTransferSuggestion, type InternalTransferSuggestion } from './application/internalTransfers';
import { downloadTransactionsCsv, filterTransactions } from './application/transactionFilters';
import {
  loadRemoteState,
  RemoteStateConflictError,
  saveRemoteState,
  type RemoteStateSnapshot,
} from './core/remoteState';
import { decideInitialSync, hashAppState } from './core/sync';
import {
  createCheckpoint,
  exportState,
  loadLocalState,
  loadSyncMetadata,
  normalizeState,
  parseBackupFile,
  resolveIssues,
  saveLocalState,
  saveSyncMetadata,
} from './core/storage';
import type {
  Account,
  AppState,
  Category,
  CategoryType,
  ImportIssue,
  Institution,
  ReviewGroup,
  ReviewReason,
  Transaction,
  TechnicalMovementType,
  TransferPurpose,
  OwnerIdentityProfile,
  AuditProposal,
  FinancialEntityRelationship,
  FinancialEntityType,
} from './core/types';
import { initialState } from './data/defaults';
import { applyCategoryDecision, deferReviewGroup, reopenReviewGroup, undoLatestReviewDecision } from './classification/decisions';
import { withRebuiltReviewGroups } from './classification/grouping';
import { isCategoryCompatible } from './classification/categoryCompatibility';
import {
  isCategoryReviewApplicable,
  isTechnicalTypeDirectionCompatible,
  kindForTechnicalType,
  technicalTypeLabel,
} from './classification/technicalClassifier';
import { addCivilDays, civilDaysBetween, isCivilDate } from './domain/dates';
import { buildTodayActivity } from './application/todayActivity';
import { buildDataHealthReport } from './application/dataHealth';
import { buildMemorySuggestions, createMemoryEntity } from './application/financialMemory';
import { reprocessFinancialState } from './application/reprocess';
import { buildDeterministicAuditProposals, createAiAuditRun } from './application/smartAudit';
import { requestAiFinancialAudit } from './application/aiClient';
import { applyAuditProposal, previewAuditProposal } from './application/auditActions';
import { countAccountReferences, createManualAccount, deleteEmptyAccount, mergeAccounts, renameAccount as renameManagedAccount, setAccountArchived } from './application/accountManagement';
import { supabase, supabaseConfigured, supabaseConfigurationErrors, verifyCurrentUserAccess } from './lib/supabase';


const TECHNICAL_TYPES: TechnicalMovementType[] = [
  'salary',
  'other_income',
  'card_payment',
  'cash_withdrawal',
  'direct_debit',
  'bank_fee',
  'other_expense',
  'refund',
  'incoming_transfer',
  'outgoing_transfer',
  'internal_transfer',
  'currency_conversion',
  'adjustment',
  'unknown',
];

function technicalTypesForDirection(direction: Transaction['direction']): TechnicalMovementType[] {
  return TECHNICAL_TYPES.filter((type) => isTechnicalTypeDirectionCompatible(type, direction));
}

function withoutReason(reasons: ReviewReason[], reason: ReviewReason) {
  return reasons.filter((item) => item !== reason);
}

function withReason(reasons: ReviewReason[], reason: ReviewReason) {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

function ConfigurationMissing() {
  return (
    <main className="auth-shell">
      <section className="auth-card setup-card">
        <span className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</span>
        <h1>Conecte o cofre.</h1>
        <p>Crie um projeto gratuito no Supabase, execute a migração SQL e copie <code>.env.example</code> para <code>.env.local</code>. Sem essas duas variáveis, o login não tem onde existir. A burocracia venceu mais uma pequena batalha.</p>
        <pre>VITE_SUPABASE_URL=...{`\n`}VITE_SUPABASE_PUBLISHABLE_KEY=...</pre>
        {supabaseConfigurationErrors.length > 0 && (
          <ul>{supabaseConfigurationErrors.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>
    </main>
  );
}


type AccessGateState =
  | { status: 'idle' }
  | { status: 'checking'; userId: string }
  | { status: 'authorized'; userId: string }
  | { status: 'denied'; userId: string; detail?: string };

function AccessDenied({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">ACESSO RESTRITO</span>
        <h1>Não foi possível abrir o cofre.</h1>
        <p>A conta precisa ser confirmada pela allowlist remota antes que qualquer dado local ou da nuvem seja carregado.</p>
        {detail && <div className="form-message error">{detail}</div>}
        <div className="auth-switches">
          <button type="button" onClick={onRetry}>Tentar novamente</button>
          <button type="button" className="link-button" onClick={() => supabase?.auth.signOut()}>Sair</button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [accessGate, setAccessGate] = useState<AccessGateState>({ status: 'idle' });
  const [accessRetry, setAccessRetry] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    let disposed = false;
    let authEventVersion = 0;

    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      authEventVersion += 1;
      if (disposed) return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      setSession(nextSession);
      setAuthReady(true);
    });

    const requestVersion = authEventVersion;
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (disposed || authEventVersion !== requestVersion) return;
      setSession(data.session);
      setAuthReady(true);
    });

    return () => {
      disposed = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setAccessGate({ status: 'idle' });
      return;
    }

    const expectedUserId = session.user.id;
    let cancelled = false;
    setAccessGate({ status: 'checking', userId: expectedUserId });

    verifyCurrentUserAccess(expectedUserId, session.user.email)
      .then((result) => {
        if (cancelled) return;
        setAccessGate(result.allowed
          ? { status: 'authorized', userId: expectedUserId }
          : { status: 'denied', userId: expectedUserId, detail: result.detail });
      })
      .catch((caught) => {
        if (cancelled) return;
        setAccessGate({
          status: 'denied',
          userId: expectedUserId,
          detail: caught instanceof Error ? caught.message : 'A autorização remota falhou.',
        });
      });

    return () => { cancelled = true; };
  }, [session?.user.id, session?.user.email, accessRetry]);

  if (!supabaseConfigured) return <ConfigurationMissing />;
  if (!authReady) return <main className="loading-screen"><RefreshCw className="spin" />Abrindo seu cofre...</main>;
  if (passwordRecovery) return <UpdatePassword onDone={() => setPasswordRecovery(false)} />;
  if (!session) return <AuthScreen />;
  if (accessGate.status === 'idle'
    || accessGate.userId !== session.user.id
    || accessGate.status === 'checking') {
    return <main className="loading-screen"><RefreshCw className="spin" />Confirmando autorização...</main>;
  }
  if (accessGate.status === 'denied') {
    return <AccessDenied detail={accessGate.detail} onRetry={() => setAccessRetry((value) => value + 1)} />;
  }
  return <FinanceApp key={session.user.id} session={session} />;
}

type SyncState = 'loading' | 'saved' | 'saving' | 'offline' | 'error' | 'conflict';

interface SyncConflict {
  localState: AppState;
  remote: RemoteStateSnapshot;
  reason: 'startup' | 'save';
}

function FinanceApp({ session }: { session: Session }) {
  // O key no pai força remontagem por usuário; este vínculo é uma segunda
  // barreira para impedir que uma futura regressão reutilize estado entre IDs.
  const boundUserId = useRef(session.user.id).current;
  const userId = boundUserId;
  const sessionMismatch = session.user.id !== boundUserId;
  const [state, setState] = useState<AppState | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [includePossibleDuplicates, setIncludePossibleDuplicates] = useState(false);
  const [allowPartial, setAllowPartial] = useState(false);
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState('all');
  const [currency, setCurrency] = useState('EUR');
  const [accountFilter, setAccountFilter] = useState('all');
  const [institutionFilter, setInstitutionFilter] = useState<'all' | Institution>('all');
  const [importAccountId, setImportAccountId] = useState('revolut-eur');
  const [error, setError] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [plannedEventOpen, setPlannedEventOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [merchantLearning, setMerchantLearning] = useState<{ transaction: Transaction; category: Category } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'all' | Transaction['direction']>('all');
  const [technicalTypeFilter, setTechnicalTypeFilter] = useState<'all' | TechnicalMovementType>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | Transaction['source']>('all');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [bulkRuleOpen, setBulkRuleOpen] = useState(false);
  const [transferDetailTransaction, setTransferDetailTransaction] = useState<Transaction | null>(null);
  const [transactionSheet, setTransactionSheet] = useState<Transaction | null>(null);
  const [aiAuditBusy, setAiAuditBusy] = useState(false);
  const [pendingAuditProposal, setPendingAuditProposal] = useState<AuditProposal | null>(null);
  const [discoveriesView, setDiscoveriesView] = useState<'now' | 'opportunity' | 'patterns'>('now');
  const [activeTab, setActiveTab] = useState<'home' | 'transactions' | 'planning' | 'discoveries' | 'assistant' | 'accounts' | 'review' | 'health' | 'memory' | 'ai'>('home');
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantTargetAccountId, setAssistantTargetAccountId] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantResult | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const backupInput = useRef<HTMLInputElement | null>(null);
  const hydrated = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveRevision = useRef(0);
  const remoteRevision = useRef<number | null>(null);
  const lastSyncedStateHash = useRef<string | null>(null);
  const conflictLock = useRef(false);
  const latestState = useRef<AppState | null>(null);
  const activeInstance = useRef(true);
  const categoryMutationLock = useRef(new Set<string>());

  useEffect(() => () => {
    activeInstance.current = false;
    conflictLock.current = true;
    saveRevision.current += 1;
  }, []);

  useEffect(() => {
    latestState.current = state;
  }, [state]);

  async function rememberRemote(snapshot: RemoteStateSnapshot, knownHash?: string) {
    const stateHash = knownHash ?? await hashAppState(snapshot.state);
    remoteRevision.current = snapshot.revision;
    lastSyncedStateHash.current = stateHash;
    saveSyncMetadata(userId, {
      remoteRevision: snapshot.revision,
      remoteUpdatedAt: snapshot.updatedAt,
      lastSyncedStateHash: stateHash,
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSyncState('loading');
      try {
        const loadedRemote = await loadRemoteState(userId);
        const remote = loadedRemote
          ? { ...loadedRemote, state: normalizeState(loadedRemote.state, initialState) }
          : undefined;
        const local = loadLocalState(userId, initialState);
        const metadata = loadSyncMetadata(userId);
        const decision = await decideInitialSync(local, remote, metadata, initialState);
        if (cancelled) return;

        if (decision.kind === 'conflict') {
          remoteRevision.current = decision.remote.revision;
          lastSyncedStateHash.current = metadata?.lastSyncedStateHash ?? null;
          conflictLock.current = true;
          setState(decision.localState);
          saveLocalState(userId, decision.localState);
          setSyncConflict({ localState: decision.localState, remote: decision.remote, reason: 'startup' });
          hydrated.current = true;
          setSyncState('conflict');
          return;
        }

        let chosen: AppState;
        if (decision.kind === 'create_remote') {
          chosen = decision.state;
          const saved = await saveRemoteState(userId, chosen, null);
          await rememberRemote(saved);
        } else if (decision.kind === 'upload_local') {
          chosen = decision.state;
          const localHash = await hashAppState(chosen);
          const saved = await saveRemoteState(userId, chosen, decision.remote.revision);
          await rememberRemote(saved, localHash);
        } else {
          chosen = decision.state;
          await rememberRemote(decision.remote);
        }

        if (cancelled) return;
        setState(chosen);
        saveLocalState(userId, chosen);
        hydrated.current = true;
        setSyncState('saved');
      } catch (caught) {
        if (cancelled) return;
        const local = loadLocalState(userId, initialState) ?? initialState;
        if (caught instanceof RemoteStateConflictError && caught.remote) {
          remoteRevision.current = caught.remote.revision;
          conflictLock.current = true;
          setState(local);
          saveLocalState(userId, local);
          setSyncConflict({ localState: local, remote: caught.remote, reason: 'startup' });
          hydrated.current = true;
          setSyncState('conflict');
          return;
        }
        setState(local);
        hydrated.current = true;
        setSyncState('offline');
        setError(`Não foi possível carregar a nuvem. O cache local foi aberto: ${caught instanceof Error ? caught.message : 'erro desconhecido'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!state || !hydrated.current || syncConflict || conflictLock.current) return;
    saveLocalState(userId, state);
    setSyncState('saving');
    const revision = ++saveRevision.current;
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (!activeInstance.current || conflictLock.current) return;
          const stateHash = await hashAppState(state);
          if (!activeInstance.current || conflictLock.current) return;
          if (stateHash === lastSyncedStateHash.current) return;
          const saved = await saveRemoteState(userId, state, remoteRevision.current);
          if (!activeInstance.current) return;
          await rememberRemote(saved, stateHash);
        });
      saveQueue.current
        .then(() => {
          if (!activeInstance.current) return;
          if (!conflictLock.current && revision === saveRevision.current) setSyncState('saved');
        })
        .catch((caught) => {
          if (!activeInstance.current) return;
          if (caught instanceof RemoteStateConflictError && caught.remote) {
            conflictLock.current = true;
            remoteRevision.current = caught.remote.revision;
            setSyncConflict({ localState: latestState.current ?? state, remote: caught.remote, reason: 'save' });
            setSyncState('conflict');
            setError('');
            return;
          }
          if (revision !== saveRevision.current) return;
          setSyncState('error');
          setError(`Dados mantidos no aparelho, mas a sincronização falhou: ${caught instanceof Error ? caught.message : 'erro desconhecido'}`);
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state, syncConflict, userId]);

  async function keepLocalConflictVersion() {
    if (!syncConflict) return;
    setConflictBusy(true);
    setError('');
    try {
      createCheckpoint(userId, syncConflict.remote.state, 'Versão da nuvem antes de resolver conflito');
      const localHash = await hashAppState(syncConflict.localState);
      const saved = await saveRemoteState(userId, syncConflict.localState, syncConflict.remote.revision);
      await rememberRemote(saved, localHash);
      saveLocalState(userId, syncConflict.localState);
      conflictLock.current = false;
      setState(syncConflict.localState);
      setSyncConflict(null);
      setSyncState('saved');
    } catch (caught) {
      if (caught instanceof RemoteStateConflictError && caught.remote) {
        remoteRevision.current = caught.remote.revision;
        setSyncConflict((current) => current ? { ...current, remote: caught.remote! } : current);
        setError('A nuvem mudou novamente enquanto você decidia. As duas versões continuam preservadas; revise os números atualizados.');
      } else {
        setError(`Não foi possível salvar esta versão: ${caught instanceof Error ? caught.message : 'erro desconhecido'}`);
      }
    } finally {
      setConflictBusy(false);
    }
  }

  async function useRemoteConflictVersion() {
    if (!syncConflict) return;
    setConflictBusy(true);
    try {
      createCheckpoint(userId, syncConflict.localState, 'Versão deste aparelho antes de usar a nuvem');
      const remoteState = normalizeState(syncConflict.remote.state, initialState);
      await rememberRemote({ ...syncConflict.remote, state: remoteState });
      saveLocalState(userId, remoteState);
      conflictLock.current = false;
      setState(remoteState);
      setSyncConflict(null);
      setSyncState('saved');
      setError('');
    } catch (caught) {
      setError(`Não foi possível aplicar a versão da nuvem: ${caught instanceof Error ? caught.message : 'erro desconhecido'}`);
    } finally {
      setConflictBusy(false);
    }
  }

  useEffect(() => {
    if (!state) return;
    const active = state.accounts.filter((account) => account.active);
    const availableCurrencies = [...new Set(active.map((account) => account.currency))].sort();
    if (!availableCurrencies.includes(currency) && availableCurrencies[0]) {
      setCurrency(availableCurrencies[0]);
      setAccountFilter('all');
      setAssistantTargetAccountId('');
      setAssistantAnswer(null);
    }
    const importable = active.filter((account) => account.institution === 'revolut' || account.institution === 'wise');
    if (!importable.some((account) => account.id === importAccountId)) {
      setImportAccountId(importable[0]?.id ?? '');
    }
    if (assistantTargetAccountId && !active.some((account) =>
      account.id === assistantTargetAccountId && account.currency === currency)) {
      setAssistantTargetAccountId('');
      setAssistantAnswer(null);
    }
    if (accountFilter !== 'all' && !active.some((account) =>
      account.id === accountFilter && account.currency === currency)) {
      setAccountFilter('all');
    }
    if (institutionFilter !== 'all' && !active.some((account) => account.currency === currency && account.institution === institutionFilter)) {
      setInstitutionFilter('all');
    }
    const availableMonths = new Set(state.transactions
      .filter((transaction) => transaction.status !== 'voided' && transaction.status !== 'merged')
      .map((transaction) => monthKey(transaction.reportingDate)));
    if (month !== 'all' && !availableMonths.has(month)) setMonth('all');
    if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && !state.categories.some((item) => item.id === categoryFilter && item.active)) setCategoryFilter('all');
  }, [state, currency, importAccountId, assistantTargetAccountId, accountFilter, institutionFilter, month, categoryFilter]);

  if (sessionMismatch) return <main className="loading-screen"><RefreshCw className="spin" />Trocando de cofre...</main>;
  if (!state) return <main className="loading-screen"><RefreshCw className="spin" />Carregando dados...</main>;
  const financeState: AppState = state;

  const activeAccounts = financeState.accounts.filter((account) => account.active);
  const visibleTransactions = financeState.transactions
    .filter((transaction) => transaction.status !== 'voided' && transaction.status !== 'merged')
    .sort((a, b) => b.reportingDate.localeCompare(a.reportingDate)
      || (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? '')
      || (b.sourceRowNumber ?? 0) - (a.sourceRowNumber ?? 0));
  const currencies = [...new Set(activeAccounts.map((account) => account.currency))].sort();
  const months = [...new Set(visibleTransactions.map((transaction) => monthKey(transaction.reportingDate)))].sort().reverse();
  const accountName = (id: string) => financeState.accounts.find((account) => account.id === id)?.name ?? id;
  const completedCurrencyDates = financeState.transactions
    .filter((transaction) => transaction.status === 'completed' && transaction.currency === currency)
    .map((transaction) => transaction.reportingDate)
    .sort();
  const customRange = dateStart && dateEnd && dateStart <= dateEnd
    ? { start: dateStart, end: dateEnd }
    : undefined;
  const range = customRange ?? (month === 'all'
    ? completedCurrencyDates.length
      ? { start: completedCurrencyDates[0]!, end: completedCurrencyDates.at(-1)! }
      : undefined
    : monthDateRange(month));
  const filtered = filterTransactions(visibleTransactions, {
    currency,
    query,
    accountId: accountFilter,
    institution: institutionFilter,
    institutionByAccountId: new Map(financeState.accounts.map((account) => [account.id, account.institution])),
    categoryId: categoryFilter,
    allocations: financeState.transactionAllocations,
    periodStart: dateStart || (month !== 'all' ? range?.start : undefined),
    periodEnd: dateEnd || (month !== 'all' ? range?.end : undefined),
    minAmount,
    maxAmount,
    direction: directionFilter,
    technicalType: technicalTypeFilter,
    source: sourceFilter,
    reviewOnly,
  });
  const analytics = buildAnalytics(financeState, currency, range);
  const insightResult = generateInsights(financeState, currency, range, { limit: 30 });
  const reservePolicy = financeState.reservePolicies.find((item) => item.currency === currency);
  const currencyAccounts = activeAccounts.filter((account) => account.currency === currency);
  const currencyInstitutions = [...new Set(currencyAccounts.map((account) => account.institution))].sort();
  const homeTargetAccount = currencyAccounts.find((account) => account.id === assistantTargetAccountId)
    ?? (currencyAccounts.length === 1 ? currencyAccounts[0] : undefined);
  const today = localCivilDate();
  const currencyPosition = buildCurrencyPosition(financeState, currency, today);
  const freeMoneyPosition = buildFreeMoneyPosition(financeState, currencyPosition, today);
  const currencyAnalytics = buildCurrencyAnalytics(financeState, currency);
  const internalTransferSuggestions = findInternalTransferSuggestions(financeState, currency);
  const transferRecurrenceSuggestions = findTransferRecurrenceSuggestions(financeState, currency);
  const impactInsights = buildImpactInsights({
    state: financeState,
    currency,
    position: currencyPosition,
    freeMoney: freeMoneyPosition,
    analytics,
    currencyAnalytics,
    internalSuggestions: internalTransferSuggestions,
    formatMoney: (amountCents) => formatMoney(amountCents, currency),
  });
  const nowImpactInsights = impactInsights.filter((insight) => insight.group === 'now');
  const opportunityImpactInsights = impactInsights.filter((insight) => insight.group === 'opportunity');
  const allCurrencyPositions = currencies.map((item) => buildCurrencyPosition(financeState, item, today));
  const allCurrencyAnalytics = currencies.map((item) => buildCurrencyAnalytics(financeState, item));
  const recurringAllocations = financeState.transactionAllocations.filter((allocation) => allocation.recurring
    && financeState.transactions.some((transaction) => transaction.id === allocation.transactionId && transaction.currency === currency));
  const currencyHistoryDates = financeState.transactions
    .filter((transaction) => transaction.currency === currency && transaction.status === 'completed')
    .map((transaction) => transaction.reportingDate)
    .sort();
  const currencyHistoryStart = currencyHistoryDates[0];
  const currencyHistoryEnd = currencyHistoryDates.at(-1);
  const unpairedConversionCount = financeState.transactions.filter((transaction) => transaction.currency === currency
    && transaction.status === 'completed'
    && transaction.technicalType === 'currency_conversion'
    && transaction.sourceComponent !== 'fee'
    && !transaction.transferGroupId).length;
  const homeLimit = homeTargetAccount
    ? financialDecisionFacade.calculateSpendingLimit({
        appState: financeState,
        currency,
        accountId: homeTargetAccount.id,
        horizonStart: today,
        horizonEnd: addCivilDays(today, 90),
      })
    : undefined;
  const upcomingEvents = financeState.plannedEvents
    .filter((event) => event.active && event.currency === currency && event.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextPlannedEvent = upcomingEvents[0];
  const plannedOutflows = upcomingEvents.filter((event) => event.direction === 'outflow');
  const plannedInflows = upcomingEvents.filter((event) => event.direction === 'inflow');
  const currencyAccountIds = new Set(financeState.accounts
    .filter((account) => account.currency === currency)
    .map((account) => account.id));
  const unresolvedIssues = financeState.importIssues.filter((item) =>
    item.status === 'unresolved' && currencyAccountIds.has(item.accountId));
  const unresolvedTransactionIds = new Set(unresolvedIssues.flatMap((item) => item.transactionId ? [item.transactionId] : []));
  const groupedTransactionIds = new Set(financeState.reviewGroups.flatMap((group) => group.transactionIds));
  const reviewTransactions = visibleTransactions.filter((transaction) =>
    transaction.currency === currency
    && transaction.needsReview
    && !unresolvedTransactionIds.has(transaction.id)
    && !groupedTransactionIds.has(transaction.id));
  const currencyReviewGroups = financeState.reviewGroups.filter((group) => group.currency === currency);
  const pendingReviewGroupCount = currencyReviewGroups.filter((group) => group.status === 'pending').length;
  const eventsNeedingAccountReview = financeState.plannedEvents.filter((item) => item.currency === currency && item.needsAccountReview);
  const criticalPendingCount = reviewTransactions.length + unresolvedIssues.length + eventsNeedingAccountReview.length;
  const pendingCount = criticalPendingCount + pendingReviewGroupCount;
  const recentReviewDecisions = financeState.reviewDecisions.slice(0, 8);
  const transactionCountByCategory = new Map<string, number>();
  for (const transaction of visibleTransactions) {
    if (!transaction.categoryId) continue;
    transactionCountByCategory.set(transaction.categoryId, (transactionCountByCategory.get(transaction.categoryId) ?? 0) + 1);
  }

  async function onFile(file: File) {
    setError('');
    setIncludePossibleDuplicates(false);
    setAllowPartial(false);
    try {
      setPreview(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
        ? await previewRevolutPdf(file, financeState, importAccountId)
        : await previewSmartBankCsv(await file.text(), file.name, financeState, importAccountId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível ler o extrato.');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  function confirmImport() {
    if (!preview) return;
    if (preview.blockingIssueCount > 0 && !allowPartial) return;
    createCheckpoint(userId, financeState, `Antes da importação ${preview.batch.fileName}`);
    const ambiguous = includePossibleDuplicates ? preview.possibleDuplicates.map((item) => item.transaction) : [];
    const transactions = [...preview.newTransactions, ...ambiguous];
    const acceptedIds = new Set(ambiguous.map((item) => item.id));
    const issues = preview.issues.map((item) => item.kind === 'possible_duplicate' && item.transactionId && acceptedIds.has(item.transactionId)
      ? { ...item, status: 'accepted' as const, resolvedAt: new Date().toISOString() }
      : item);
    const batch = createConfirmedBatch(preview.batch, transactions.filter((transaction) => (transaction.sourceComponent ?? 'primary') === 'primary').length);
    setState((current) => {
      if (!current) return current;
      const now = new Date().toISOString();
      const destinationIds = new Set(preview.accounts?.map((account) => account.id) ?? [preview.account.id]);
      const existingIds = new Set(current.accounts.map((account) => account.id));
      const accounts = [
        ...current.accounts.map((account) => destinationIds.has(account.id) ? { ...account, active: true, archivedAt: undefined, updatedAt: now } : account),
        ...(preview.createdAccounts ?? []).filter((account) => !existingIds.has(account.id)).map((account) => ({ ...account, active: true })),
      ];
      const updateById = new Map(preview.updates.map((item) => [item.existingId, item]));
      const updatedExisting = current.transactions.map((existing) => {
        const update = updateById.get(existing.id);
        return update ? mergeImportedTransaction(existing, update.incoming) : existing;
      });
      const ownAccountIds = [...new Set([
        ...current.ownerIdentity.ownAccountIds,
        ...accounts.filter((account) => destinationIds.has(account.id)).map((account) => account.id),
      ])];
      const reconciledBooks = preview.currencies.filter((item) => item.reconciliation === 'reconciled'
        && item.statementEndBalanceCents !== undefined && item.lastReportingDate);
      const reconciliationBatches = reconciledBooks.map((item) => {
        const logicalAsOf = `${item.lastReportingDate}T23:59:59.000Z`;
        return { id: crypto.randomUUID(), logicalDate: item.lastReportingDate!, logicalAsOf, createdAt: now, source: 'import' as const, status: 'COMPLETE' as const };
      });
      const balanceSnapshots = reconciledBooks.map((item, index) => ({
        id: crypto.randomUUID(), accountId: item.accountId, currency: item.currency,
        balanceCents: item.statementEndBalanceCents!, asOf: reconciliationBatches[index]!.logicalAsOf,
        source: 'import' as const, sourceImportId: batch.id, reconciled: true, createdAt: now,
        reconciliationBatchId: reconciliationBatches[index]!.id, logicalAsOf: reconciliationBatches[index]!.logicalAsOf,
      }));
      return reprocessFinancialState({
        ...current,
        accounts,
        ownerIdentity: { ...current.ownerIdentity, ownAccountIds, updatedAt: now },
        transactions: [...transactions, ...updatedExisting],
        imports: [batch, ...current.imports],
        importIssues: [...issues, ...current.importIssues],
        reconciliationBatches: [...reconciliationBatches, ...current.reconciliationBatches],
        balanceSnapshots: [...balanceSnapshots, ...current.balanceSnapshots],
      });
    });
    setPreview(null);
  }

  function toggleImport(importId: string) {
    const batch = financeState.imports.find((item) => item.id === importId);
    if (!batch) return;
    createCheckpoint(userId, financeState, `${batch.status === 'undone' ? 'Antes de restaurar' : 'Antes de anular'} ${batch.fileName}`);
    if (batch.status === 'undone') {
      setState(withRebuiltReviewGroups(restoreImport(financeState, importId)));
      return;
    }
    const impact = getUndoImpact(financeState, importId);
    const hasWork = impact.manuallyEditedCount || impact.linkedTransferCount || impact.notedCount;
    const message = hasWork
      ? `Este lote contém trabalho manual. ${impact.manuallyEditedCount} editadas, ${impact.linkedTransferCount} transferências e ${impact.notedCount} notas. Ele será anulado, nunca apagado. Continuar?`
      : `Anular ${impact.transactionCount} transações deste lote? Nada será apagado.`;
    if (window.confirm(message)) setState(withRebuiltReviewGroups(undoImport(financeState, importId)));
  }

  function updateCategory(transaction: Transaction, rawCategoryId: string) {
    if (categoryMutationLock.current.has(transaction.id)) return;
    categoryMutationLock.current.add(transaction.id);
    try {
      const categoryId = rawCategoryId || undefined;
      const category = categoryId
        ? financeState.categories.find((item) => item.id === categoryId && item.active)
        : undefined;
      if (categoryId && (!category || !isCategoryCompatible(category, transaction))) {
        setError('Categoria inválida para o tipo técnico desta movimentação.');
        return;
      }
      setError('');
      createCheckpoint(userId, financeState, `Antes de classificar ${transaction.descriptionOriginal}`);
      setState((current) => {
        if (!current) return current;
        try {
          return applyCategoryDecision({
            state: current,
            transactionIds: [transaction.id],
            categoryId,
            kind: 'apply_transaction_category',
            label: category ? `${transaction.descriptionOriginal} → ${category.name}` : `${transaction.descriptionOriginal} → sem categoria`,
          });
        } catch (caught) {
          queueMicrotask(() => setError(`Não foi possível alterar a categoria: ${caught instanceof Error ? caught.message : 'erro inesperado'}. Seus dados anteriores foram preservados.`));
          return current;
        }
      });
      if (
        category
        && transaction.categoryId !== categoryId
        && transaction.source !== 'manual'
        && categoryId !== 'income'
        && transaction.merchantNormalized.trim()
      ) {
        setMerchantLearning({ transaction: { ...transaction, categoryId, categorySource: 'manual', categoryReviewStatus: 'resolved' }, category });
      }
    } catch (caught) {
      setError(`Não foi possível alterar a categoria: ${caught instanceof Error ? caught.message : 'erro inesperado'}. Seus dados anteriores foram preservados.`);
    } finally {
      queueMicrotask(() => categoryMutationLock.current.delete(transaction.id));
    }
  }

  function updateTechnicalType(transaction: Transaction, technicalType: TechnicalMovementType) {
    if (categoryMutationLock.current.has(transaction.id)) return;
    categoryMutationLock.current.add(transaction.id);
    try {
      if (!isTechnicalTypeDirectionCompatible(technicalType, transaction.direction)) {
        setError(`O tipo ${technicalTypeLabel(technicalType)} é incompatível com uma ${transaction.direction === 'inflow' ? 'entrada' : 'saída'} bancária.`);
        return;
      }
      setError('');
      const editedAt = new Date().toISOString();
      const kind = kindForTechnicalType(technicalType);
      let reasons = withoutReason(transaction.reviewReasons, 'unknown_kind');
      reasons = withoutReason(reasons, 'ambiguous_transfer');
      if (technicalType === 'unknown') reasons = withReason(reasons, 'unknown_kind');
      const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
      const transferGroupId = analysisExcluded
        ? (transaction.transferGroupId ?? `manual-confirmed:${transaction.id}`)
        : undefined;
      const currentCategory = transaction.categoryId
        ? financeState.categories.find((category) => category.id === transaction.categoryId)
        : undefined;
      const keepCategory = currentCategory
        ? isCategoryCompatible(currentCategory, { direction: transaction.direction, kind, technicalType })
        : false;
      const nextCategoryId = keepCategory ? transaction.categoryId : undefined;
      const categoryWasCleared = Boolean(transaction.categoryId && !nextCategoryId);
      const categoryReviewStatus = nextCategoryId
        ? 'resolved' as const
        : isCategoryReviewApplicable(technicalType)
          ? 'pending' as const
          : 'not_applicable' as const;
      createCheckpoint(userId, financeState, `Antes de corrigir o tipo de ${transaction.descriptionOriginal}`);
      setState((current) => {
        if (!current) return current;
        try {
          return withRebuiltReviewGroups({
            ...current,
            transactions: current.transactions.map((item) => item.id === transaction.id ? {
              ...item,
              kind,
              technicalType,
              kindSource: 'manual',
              transferGroupId,
              analysisExcluded,
              categoryId: nextCategoryId,
              categorySource: nextCategoryId ? item.categorySource : 'none',
              categoryReviewStatus,
              needsReview: reasons.length > 0,
              reviewReasons: reasons,
              manualEditLog: [
                ...item.manualEditLog,
                { field: 'technicalType', oldValue: item.technicalType, newValue: technicalType, editedAt },
                { field: 'kind', oldValue: item.kind, newValue: kind, editedAt },
                ...(categoryWasCleared ? [{ field: 'categoryId', oldValue: item.categoryId, newValue: undefined, editedAt }] : []),
              ],
              updatedAt: editedAt,
            } : item),
          }, editedAt);
        } catch (caught) {
          queueMicrotask(() => setError(`Não foi possível alterar o tipo da movimentação: ${caught instanceof Error ? caught.message : 'erro inesperado'}. Seus dados anteriores foram preservados.`));
          return current;
        }
      });
    } catch (caught) {
      setError(`Não foi possível alterar o tipo da movimentação: ${caught instanceof Error ? caught.message : 'erro inesperado'}.`);
    } finally {
      queueMicrotask(() => categoryMutationLock.current.delete(transaction.id));
    }
  }

  function rememberMerchantRule() {
    if (!merchantLearning) return;
    const { transaction, category } = merchantLearning;
    const pattern = transaction.merchantNormalized.trim();
    if (!pattern) {
      setMerchantLearning(null);
      return;
    }
    const affectedIds = financeState.transactions
      .filter((item) => item.id !== transaction.id
        && item.merchantNormalized === pattern
        && item.currency === transaction.currency
        && item.direction === transaction.direction
        && item.kind === transaction.kind
        && item.technicalType === transaction.technicalType
        && item.categorySource !== 'manual'
        && isCategoryCompatible(category, item))
      .map((item) => item.id);
    createCheckpoint(userId, financeState, `Antes de aprender ${transaction.descriptionOriginal}`);
    setState(applyCategoryDecision({
      state: financeState,
      transactionIds: affectedIds,
      categoryId: category.id,
      categorySource: 'rule',
      kind: 'create_rule',
      label: `Regra: ${transaction.descriptionOriginal} → ${category.name}`,
      createRule: {
        pattern,
        merchantLabel: transaction.descriptionOriginal,
        currency: transaction.currency,
        direction: transaction.direction,
        transactionKind: transaction.kind,
        technicalType: transaction.technicalType,
      },
    }));
    setMerchantLearning(null);
  }

  function createCategory(input: { name: string; type: CategoryType }) {
    const now = new Date().toISOString();
    const slug = input.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'categoria';
    const category: Category = {
      id: `custom-${slug}-${crypto.randomUUID().slice(0, 6)}`,
      name: input.name,
      active: true,
      type: input.type,
      system: false,
      createdAt: now,
    };
    setState(withRebuiltReviewGroups({ ...financeState, categories: [...financeState.categories, category] }));
  }

  function renameCategory(categoryId: string, name: string) {
    setState(withRebuiltReviewGroups({
      ...financeState,
      categories: financeState.categories.map((category) =>
        category.id === categoryId && !category.system ? { ...category, name } : category),
    }));
  }

  function archiveCategory(categoryId: string, destinationId?: string) {
    const category = financeState.categories.find((item) => item.id === categoryId);
    if (!category || category.system) return;
    const count = transactionCountByCategory.get(categoryId) ?? 0;
    const destination = destinationId ? financeState.categories.find((item) => item.id === destinationId && item.active) : undefined;
    const incompatibleDestination = destination && financeState.transactions.some((transaction) =>
      transaction.categoryId === categoryId && !isCategoryCompatible(destination, transaction));
    if (incompatibleDestination) {
      setError('A categoria de destino é incompatível com parte das movimentações.');
      return;
    }
    if (count > 0 && !destination) {
      setError('Escolha para onde mover as movimentações antes de arquivar.');
      return;
    }
    const now = new Date().toISOString();
    createCheckpoint(userId, financeState, `Antes de arquivar ${category.name}`);
    setState(withRebuiltReviewGroups({
      ...financeState,
      categories: financeState.categories.map((item) => item.id === categoryId ? { ...item, active: false, archivedAt: now } : item),
      transactions: destination ? financeState.transactions.map((transaction) => transaction.categoryId === categoryId ? {
        ...transaction,
        categoryId: destination.id,
        categorySource: 'manual' as const,
        categoryReviewStatus: 'resolved' as const,
        updatedAt: now,
      } : transaction) : financeState.transactions,
      rules: destination ? financeState.rules.map((rule) => rule.categoryId === categoryId ? { ...rule, categoryId: destination.id, updatedAt: now } : rule) : financeState.rules,
    }, now));
    if (categoryFilter === categoryId) setCategoryFilter('all');
  }

  function restoreCategory(categoryId: string) {
    setState(withRebuiltReviewGroups({
      ...financeState,
      categories: financeState.categories.map((category) => category.id === categoryId ? { ...category, active: true, archivedAt: undefined } : category),
    }));
  }

  function removeCategoryRule(ruleId: string) {
    const rule = financeState.rules.find((item) => item.id === ruleId && item.source === 'learned');
    if (!rule) return;
    setState(withRebuiltReviewGroups({ ...financeState, rules: financeState.rules.filter((item) => item.id !== ruleId) }));
  }

  function applyReviewGroup(group: ReviewGroup, transactionIds: string[], categoryId: string, createRule: boolean) {
    const category = financeState.categories.find((item) => item.id === categoryId && item.active);
    if (!category || !isCategoryCompatible(category, group) || transactionIds.length === 0) {
      setError('Escolha uma categoria e pelo menos uma movimentação.');
      return;
    }
    const exceptions = group.transactionIds.filter((id) => !transactionIds.includes(id));
    createCheckpoint(userId, financeState, `Antes de classificar grupo ${group.merchantLabel}`);
    setState(applyCategoryDecision({
      state: financeState,
      transactionIds,
      categoryId,
      kind: 'apply_group_category',
      label: `${group.merchantLabel} → ${category.name} (${transactionIds.length})`,
      groupKey: group.key,
      createRule: createRule ? {
        pattern: group.merchantNormalized,
        merchantLabel: group.merchantLabel,
        currency: group.currency,
        direction: group.direction,
        transactionKind: group.kind,
        technicalType: group.technicalType,
        exceptionTransactionIds: exceptions,
      } : undefined,
    }));
  }

  function applyReviewException(group: ReviewGroup, transaction: Transaction, categoryId: string) {
    const category = financeState.categories.find((item) => item.id === categoryId && item.active);
    if (!category || !isCategoryCompatible(category, transaction)) return;
    createCheckpoint(userId, financeState, `Antes de criar exceção para ${transaction.descriptionOriginal}`);
    setState(applyCategoryDecision({
      state: financeState,
      transactionIds: [transaction.id],
      categoryId,
      kind: 'apply_transaction_category',
      label: `Exceção: ${transaction.descriptionOriginal} → ${category.name}`,
      groupKey: group.key,
    }));
  }

  function resolveReviewGroupWithoutCategory(group: ReviewGroup, transactionIds: string[]) {
    if (transactionIds.length === 0) return;
    createCheckpoint(userId, financeState, `Antes de manter ${group.merchantLabel} sem categoria`);
    setState(applyCategoryDecision({
      state: financeState,
      transactionIds,
      kind: 'resolve_without_category',
      label: `${group.merchantLabel} → sem categoria (${transactionIds.length})`,
      groupKey: group.key,
    }));
  }

  function postponeReviewGroup(group: ReviewGroup) {
    setState(deferReviewGroup(financeState, group.key));
  }

  function reactivateReviewGroup(group: ReviewGroup) {
    setState(reopenReviewGroup(financeState, group.key));
  }

  function undoReviewDecision() {
    const latest = financeState.reviewDecisions.find((item) => !item.undoneAt);
    if (!latest) return;
    createCheckpoint(userId, financeState, `Antes de desfazer: ${latest.label}`);
    setState(undoLatestReviewDecision(financeState));
  }

  function updateInsightFeedback(insight: FinancialInsight, patch: { dismissedAt?: string; useful?: boolean; lastShownAt?: string }) {
    const existing = financeState.insightFeedback.find((item) => item.insightKey === insight.key);
    setState({
      ...financeState,
      insightFeedback: [
        { ...existing, insightKey: insight.key, ...patch },
        ...financeState.insightFeedback.filter((item) => item.insightKey !== insight.key),
      ],
    });
  }

  function openInsightAction(insight: FinancialInsight) {
    if (insight.action === 'review') return setActiveTab('review');
    if (insight.action === 'accounts') return setActiveTab('accounts');
    if (insight.action === 'assistant') {
      setAssistantQuestion('Quanto posso gastar até o pagamento?');
      return setActiveTab('assistant');
    }
    if (insight.action === 'categories') {
      setCategoryOpen(true);
      return;
    }
    if (insight.action === 'transactions') {
      setCategoryFilter(insight.categoryId ?? 'all');
      setQuery(insight.merchant ?? '');
      setActiveTab('transactions');
    }
  }

  function openImpactAction(insight: ImpactInsight) {
    if (insight.action === 'reconcile') return recordBalanceSnapshot();
    if (insight.action === 'plan') return setActiveTab('planning');
    if (insight.action === 'internal-transfers') return setActiveTab('review');
    if (insight.action === 'accounts') return setActiveTab('accounts');
    if (insight.action === 'transfer-details') {
      setTechnicalTypeFilter('outgoing_transfer');
      setDirectionFilter('outflow');
      setActiveTab('transactions');
      return;
    }
    if (insight.action === 'transactions') setActiveTab('transactions');
  }

  function confirmInternalSuggestion(suggestion: InternalTransferSuggestion) {
    createCheckpoint(userId, financeState, `Antes de vincular transferência interna de ${formatMoney(suggestion.amountCents, suggestion.outflow.currency)}`);
    setState(confirmInternalTransferSuggestion(financeState, suggestion));
  }

  function rejectInternalSuggestion(suggestion: InternalTransferSuggestion) {
    createCheckpoint(userId, financeState, `Antes de rejeitar sugestão de transferência interna`);
    setState(rejectInternalTransferSuggestion(financeState, suggestion));
  }

  function applyRecurrencePurpose(suggestion: TransferRecurrenceSuggestion, input: {
    label: string;
    purpose?: TransferPurpose;
    categoryId?: string;
    relatedPerson?: string;
  }) {
    createCheckpoint(userId, financeState, `Antes de detalhar grupo recorrente ${suggestion.recipientLabel}`);
    setState(applyPurposeToRecurrence(financeState, suggestion, input));
  }

  function saveIdentityProfile(profile: OwnerIdentityProfile) {
    createCheckpoint(userId, financeState, 'Antes de atualizar identidade própria');
    const transactions = financeState.transactions.map((transaction) => applyOwnerIdentityContext(transaction, profile));
    setState(withRebuiltReviewGroups({ ...financeState, ownerIdentity: profile, transactions }));
    setIdentityOpen(false);
  }

  function saveTransferDetail(result: TransferDetailResult) {
    if (!transferDetailTransaction) return;
    const transactionId = transferDetailTransaction.id;
    const now = new Date().toISOString();
    createCheckpoint(userId, financeState, `Antes de detalhar ${transferDetailTransaction.descriptionOriginal}`);
    const transactions = financeState.transactions.map((transaction) => transaction.id === transactionId ? {
      ...transaction,
      categoryId: undefined,
      categorySource: 'none' as const,
      categoryReviewStatus: 'resolved' as const,
      reviewReasons: transaction.reviewReasons.filter((reason) => reason !== 'uncategorized'),
      needsReview: transaction.reviewReasons.some((reason) => reason !== 'uncategorized'),
      manualEditLog: [...transaction.manualEditLog, {
        field: 'transactionAllocations',
        oldValue: financeState.transactionAllocations.filter((allocation) => allocation.transactionId === transactionId).map((allocation) => allocation.id),
        newValue: result.allocations.map((allocation) => allocation.id),
        editedAt: now,
      }],
      updatedAt: now,
    } : transaction);
    const previousAllocations = financeState.transactionAllocations.filter((allocation) => allocation.transactionId === transactionId);
    const previousLinkedEventIds = new Set(previousAllocations.map((allocation) => allocation.plannedEventId).filter((id): id is string => Boolean(id)));
    const nextAllocationByEventId = new Map<string, TransferDetailResult['allocations'][number]>();
    for (const allocation of result.allocations) {
      if (allocation.plannedEventId) nextAllocationByEventId.set(allocation.plannedEventId, allocation);
    }
    const plannedEvents = financeState.plannedEvents.map((event) => {
      if (!previousLinkedEventIds.has(event.id)) return event;
      const allocation = nextAllocationByEventId.get(event.id);
      if (!allocation) return { ...event, active: false, updatedAt: now };
      return {
        ...event,
        title: allocation.label,
        amountCents: allocation.amountCents,
        dueDate: allocation.nextDueDate ?? event.dueDate,
        recurrence: allocation.recurring ? { frequency: allocation.recurrenceFrequency ?? 'monthly', interval: 1 } : event.recurrence,
        active: Boolean(allocation.recurring),
        updatedAt: now,
      };
    });
    setState(withRebuiltReviewGroups({
      ...financeState,
      transactions,
      transactionAllocations: [
        ...result.allocations,
        ...financeState.transactionAllocations.filter((allocation) => allocation.transactionId !== transactionId),
      ],
      plannedEvents: [
        ...plannedEvents,
        ...result.plannedEvents.filter((event) => !plannedEvents.some((current) => current.id === event.id)),
      ],
    }));
    setTransferDetailTransaction(null);
  }

  async function restoreBackup(file: File) {
    try {
      const replacement = await parseBackupFile(file, initialState);
      if (!window.confirm('Substituir os dados atuais por este backup? Um checkpoint local será criado antes.')) return;
      createCheckpoint(userId, financeState, 'Antes de restaurar backup JSON');
      setState(replacement);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup inválido.');
    } finally {
      if (backupInput.current) backupInput.current.value = '';
    }
  }

  function deletePlannedEvent(eventId: string) {
    const event = financeState.plannedEvents.find((item) => item.id === eventId);
    if (!event) return;
    const linkedAllocations = financeState.transactionAllocations.filter((allocation) => allocation.plannedEventId === eventId);
    const linkWarning = linkedAllocations.length > 0
      ? `\n\n${linkedAllocations.length} detalhamento${linkedAllocations.length === 1 ? '' : 's'} continuará${linkedAllocations.length === 1 ? '' : 'ão'} salvo${linkedAllocations.length === 1 ? '' : 's'}, mas sem participar da previsão.`
      : '';
    if (!window.confirm(`Excluir o compromisso “${event.title}”?${linkWarning}`)) return;

    createCheckpoint(userId, financeState, `Antes de excluir compromisso ${event.title}`);
    setState(deactivatePlannedEvent(financeState, eventId));
  }

  function resolvePlannedEventAccount(eventId: string, accountId: string) {
    const event = financeState.plannedEvents.find((item) => item.id === eventId);
    const account = financeState.accounts.find((item) => item.id === accountId && item.active);
    if (!event || !account || account.currency !== event.currency) {
      setError('Selecione uma conta ativa na mesma moeda do evento.');
      return;
    }
    setState({
      ...financeState,
      plannedEvents: financeState.plannedEvents.map((item) =>
        item.id === eventId
          ? {
              ...item,
              accountId,
              active: true,
              needsAccountReview: false,
              updatedAt: new Date().toISOString(),
            }
          : item),
    });
  }

  function dismissIssue(item: ImportIssue) {
    setState({ ...financeState, importIssues: resolveIssues(financeState.importIssues, [item.id], 'ignored') });
  }

  function clearTransactionFilters() {
    setQuery('');
    setAccountFilter('all');
    setInstitutionFilter('all');
    setCategoryFilter('all');
    setMonth('all');
    setDateStart('');
    setDateEnd('');
    setMinAmount('');
    setMaxAmount('');
    setDirectionFilter('all');
    setTechnicalTypeFilter('all');
    setSourceFilter('all');
    setReviewOnly(false);
  }

  function exportFilteredCsv() {
    if (invalidFilters) {
      setError(invalidDateRange
        ? 'A data inicial do filtro não pode ser posterior à data final.'
        : invalidAmountRange
          ? 'O valor mínimo não pode ser maior que o valor máximo.'
          : 'Revise os valores mínimo e máximo informados.');
      return;
    }
    if (filtered.length === 0) {
      setError('Não há movimentações nos filtros atuais para exportar.');
      return;
    }
    const periodLabel = customRange
      ? `${customRange.start}_${customRange.end}`
      : month === 'all' ? 'historico-completo' : month;
    downloadTransactionsCsv(filtered, `japa-finance-${currency}-${periodLabel}.csv`, {
      accountName,
      categoryName,
      technicalTypeName: technicalTypeLabel,
    });
  }

  function applyBulkRule(input: BulkRuleInput) {
    const category = financeState.categories.find((item) => item.id === input.categoryId && item.active);
    if (!category || input.transactionIds.length === 0) return;
    const selected = financeState.transactions.filter((transaction) => input.transactionIds.includes(transaction.id));
    const uniqueKinds = [...new Set(selected.map((transaction) => transaction.kind))];
    createCheckpoint(userId, financeState, `Antes da regra em massa ${input.pattern}`);
    setState(applyCategoryDecision({
      state: financeState,
      transactionIds: input.transactionIds,
      categoryId: input.categoryId,
      categorySource: 'rule',
      kind: 'create_rule',
      label: `Regra ${input.kind}: ${input.pattern} → ${category.name} (${input.transactionIds.length})`,
      createRule: {
        pattern: input.pattern,
        merchantLabel: input.pattern.trim(),
        kind: input.kind,
        currency,
        direction: input.direction,
        transactionKind: uniqueKinds.length === 1 ? uniqueKinds[0] : undefined,
        technicalType: input.technicalType,
        exceptionTransactionIds: input.exceptionTransactionIds,
      },
    }));
    setBulkRuleOpen(false);
  }

  const syncLabel = syncState === 'saved' ? 'Salvo na nuvem' : syncState === 'saving' ? 'Salvando...' : syncState === 'offline' ? 'Modo local' : syncState === 'error' ? 'Falha de sincronização' : syncState === 'conflict' ? 'Conflito protegido' : 'Carregando';

  function askAssistant(question = assistantQuestion) {
    const clean = question.trim();
    if (!clean) return;
    setAssistantAnswer(financialDecisionFacade.answerQuestion({
      appState: financeState,
      currency,
      question: clean,
      targetAccountId: assistantTargetAccountId || undefined,
      range: range ?? {},
    }));
    setAssistantQuestion(clean);
  }


  function recordBalanceSnapshot() {
    const candidates = activeAccounts.filter((account) => account.currency === currency);
    if (!candidates.length) {
      setError(`Não há conta ativa em ${currency}.`);
      return;
    }
    setReconciliationOpen(true);
  }

  function confirmReconciliation(input: {
    logicalDate: string;
    logicalAsOf: string;
    balances: Array<{ accountId: string; balanceCents: number }>;
  }) {
    const candidates = activeAccounts.filter((account) => account.currency === currency);
    try {
      const batch = createReconciliationSnapshotBatch({
        accounts: candidates,
        balances: input.balances,
        currency,
        logicalDate: input.logicalDate,
        logicalAsOf: input.logicalAsOf,
        reconciliationBatchId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        source: 'manual',
      });
      setState({
        ...financeState,
        balanceSnapshots: [...financeState.balanceSnapshots, ...batch.snapshots],
        reconciliationBatches: [
          ...financeState.reconciliationBatches.filter((item) => item.id !== batch.batch.id),
          batch.batch,
        ],
      });
      setReconciliationOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Falha ao criar reconciliação.');
    }
  }

  const categoryName = (categoryId?: string) => !categoryId || categoryId === 'uncategorized' ? 'Sem categoria' : (financeState.categories.find((category) => category.id === categoryId)?.name ?? categoryId);
  const institutionName = (institution: Institution) => institution === 'revolut' ? 'Revolut' : institution === 'wise' ? 'Wise' : institution === 'cash' ? 'Dinheiro' : 'Outra';
  const recurrenceName = (frequency?: 'weekly' | 'monthly' | 'yearly') => frequency === 'weekly' ? 'semanal' : frequency === 'yearly' ? 'anual' : 'mensal';
  const reviewReasonLabel = (reason: ReviewReason) => ({
    uncategorized: 'sem categoria',
    unknown_kind: 'tipo desconhecido',
    possible_duplicate: 'possível duplicata',
    zero_amount: 'valor zero',
    unverified_fee: 'taxa a conferir',
    ambiguous_transfer: 'transferência a confirmar',
    unlinked_refund: 'reembolso sem vínculo',
  } satisfies Record<ReviewReason, string>)[reason];

  const parseFilterAmount = (value: string) => {
    if (!value.trim()) return undefined;
    try { return Math.abs(parseSignedMoneyToCents(value)); } catch { return undefined; }
  };
  const minimumFilterCents = parseFilterAmount(minAmount);
  const maximumFilterCents = parseFilterAmount(maxAmount);
  const invalidDateRange = Boolean(dateStart && dateEnd && dateStart > dateEnd);
  const invalidMinimumAmount = Boolean(minAmount.trim() && minimumFilterCents === undefined);
  const invalidMaximumAmount = Boolean(maxAmount.trim() && maximumFilterCents === undefined);
  const invalidAmountRange = minimumFilterCents !== undefined && maximumFilterCents !== undefined && minimumFilterCents > maximumFilterCents;
  const invalidFilters = invalidDateRange || invalidMinimumAmount || invalidMaximumAmount || invalidAmountRange;
  const filtersActive = Boolean(query || accountFilter !== 'all' || institutionFilter !== 'all' || categoryFilter !== 'all' || month !== 'all'
    || dateStart || dateEnd || minAmount || maxAmount || directionFilter !== 'all'
    || technicalTypeFilter !== 'all' || sourceFilter !== 'all' || reviewOnly);
  const latestActiveDecision = financeState.reviewDecisions.find((item) => !item.undoneAt);
  const comparisonAnalytics = analytics.current.effectiveEnd < analytics.current.range.end
    ? buildAnalytics(financeState, currency, {
        start: analytics.current.range.start,
        end: analytics.current.effectiveEnd,
      })
    : analytics;
  const comparison = buildPeriodComparison(
    comparisonAnalytics,
    categoryName,
    (amountCents) => formatMoney(amountCents, currency),
  );
  const activityTimeline = buildActivityTimeline(financeState, currency, accountName);
  const sourceLabel = (source: Transaction['source']) => ({
    revolut_csv: 'Revolut CSV',
    wise_csv: 'Wise CSV',
    revolut_pdf: 'Revolut PDF',
    manual: 'Manual',
  } satisfies Record<Transaction['source'], string>)[source];

  const renderTransactions = (items = filtered, reviewMode = false) => <section className="panel transaction-panel">
    <div className="panel-title"><div><h2>{reviewMode ? 'Movimentações para revisar' : 'Movimentações'}</h2><small>{reviewMode ? 'Corrija somente o que ficou ambíguo.' : 'Do mais recente para o mais antigo.'}</small></div><span>{items.length}</span></div>
    {!reviewMode && <section className="transaction-tools">
      <section className="toolbar compact-toolbar">
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar descrição, comerciante, nota ou ID" /></label>
        <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas as contas</option>{activeAccounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select value={institutionFilter} onChange={(event) => { setInstitutionFilter(event.target.value as 'all' | Institution); setAccountFilter('all'); }}><option value="all">Todas as instituições</option>{currencyInstitutions.map((institution) => <option key={institution} value={institution}>{institution === 'revolut' ? 'Revolut' : institution === 'wise' ? 'Wise' : institution}</option>)}</select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas as categorias</option><option value="uncategorized">Sem categoria</option>{financeState.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select value={month} onChange={(event) => { setMonth(event.target.value); setDateStart(''); setDateEnd(''); }}><option value="all">Todo o histórico</option>{months.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      </section>
      <details className="advanced-filters">
        <summary><Filter size={16} /> Filtros avançados {filtersActive ? 'ativos' : ''}</summary>
        <div className="advanced-filter-grid">
          <label>De<input type="date" value={dateStart} onChange={(event) => { setDateStart(event.target.value); setMonth('all'); }} /></label>
          <label>Até<input type="date" value={dateEnd} onChange={(event) => { setDateEnd(event.target.value); setMonth('all'); }} /></label>
          <label>Valor mínimo<input inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="0,00" /></label>
          <label>Valor máximo<input inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="sem limite" /></label>
          <label>Direção<select value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as 'all' | Transaction['direction'])}><option value="all">Entradas e saídas</option><option value="inflow">Entradas</option><option value="outflow">Saídas</option></select></label>
          <label>Tipo técnico<select value={technicalTypeFilter} onChange={(event) => setTechnicalTypeFilter(event.target.value as 'all' | TechnicalMovementType)}><option value="all">Todos os tipos</option>{TECHNICAL_TYPES.map((type) => <option key={type} value={type}>{technicalTypeLabel(type)}</option>)}</select></label>
          <label>Origem<select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as 'all' | Transaction['source'])}><option value="all">Todas as origens</option>{(['revolut_csv','wise_csv','revolut_pdf','manual'] as Transaction['source'][]).map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}</select></label>
          <label className="check-row review-only"><input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} /> Somente pendências</label>
        </div>
        {invalidDateRange && <p className="filter-warning">A data inicial precisa ser anterior ou igual à data final.</p>}
        {(invalidMinimumAmount || invalidMaximumAmount) && <p className="filter-warning">Use um valor numérico válido nos limites do filtro.</p>}
        {invalidAmountRange && <p className="filter-warning">O valor mínimo precisa ser menor ou igual ao valor máximo.</p>}
      </details>
      <div className="transaction-actions">
        <button type="button" className="secondary" onClick={() => setBulkRuleOpen(true)} disabled={filtered.length === 0 || invalidFilters}><WandSparkles size={16} /> Criar regra com prévia</button>
        <button type="button" className="secondary" onClick={exportFilteredCsv} disabled={filtered.length === 0 || invalidFilters}><FileDown size={16} /> Exportar estes {filtered.length}</button>
        {filtersActive && <button type="button" className="secondary filter-reset" onClick={clearTransactionFilters}><X size={15} /> Limpar filtros</button>}
      </div>
      {latestActiveDecision?.kind === 'create_rule' && <div className="bulk-undo-banner"><span>{latestActiveDecision.label}</span><button type="button" className="link-button" onClick={undoReviewDecision}><RotateCcw size={14} /> Desfazer</button></div>}
    </section>}
    {items.length === 0 ? <div className="empty"><WalletCards size={32} /><p>{reviewMode ? 'Nenhuma movimentação precisa de revisão.' : filtersActive ? 'Nenhuma movimentação corresponde aos filtros atuais.' : 'Importe um extrato ou crie uma movimentação manual.'}</p></div> : <div className="tx-list">{items.map((transaction) => {
      const categoryOptions = financeState.categories.filter((category) => isCategoryCompatible(category, transaction));
      const technicalOptions = technicalTypesForDirection(transaction.direction);
      const allocations = financeState.transactionAllocations.filter((allocation) => allocation.transactionId === transaction.id);
      const allocationSummary = allocations.length ? `${allocations.length} ${allocations.length === 1 ? 'item detalhado' : 'itens detalhados'}${allocations.some((allocation) => allocation.relatedPerson) ? ` · ${[...new Set(allocations.map((allocation) => allocation.relatedPerson).filter(Boolean))].join(', ')}` : ''}` : '';
      const reverted = transaction.status === 'reverted';
      const displayedMovement = reverted
        ? (transaction.reportedAmountCents ?? (transaction.direction === 'inflow' ? transaction.amountCents : -transaction.amountCents))
        : signedNetMovement(transaction);
      return <article className={`tx ${transaction.needsReview ? 'needs-review' : ''} ${reverted ? 'reverted' : ''}`} key={transaction.id}>
        <button type="button" className="tx-main" onClick={() => setTransactionSheet(transaction)}><b>{transaction.friendlyDescription ?? transaction.descriptionOriginal}</b><small>{formatReportingDate(transaction.reportingDate)} · {accountName(transaction.accountId)} · {technicalTypeLabel(transaction.technicalType)} · {reverted ? 'Revertida, sem efeito financeiro' : allocations.length ? 'Detalhada por finalidade' : categoryName(transaction.categoryId)}</small>{allocationSummary && <span className="allocation-summary">{allocationSummary}</span>}{transaction.reviewReasons.length > 0 && <span className="review-label">{transaction.reviewReasons.map(reviewReasonLabel).join(' · ')}</span>}</button>
        <div className="tx-controls"><select aria-label={`Tipo técnico de ${transaction.descriptionOriginal}`} value={transaction.technicalType} onChange={(event) => updateTechnicalType(transaction, event.target.value as TechnicalMovementType)} disabled={reverted}>{technicalOptions.map((type) => <option key={type} value={type}>{technicalTypeLabel(type)}</option>)}</select><select aria-label={`Categoria de ${transaction.descriptionOriginal}`} value={transaction.categoryId ?? ''} onChange={(event) => updateCategory(transaction, event.target.value)} disabled={reverted || allocations.length > 0 || !isCategoryReviewApplicable(transaction.technicalType)}><option value="">{allocations.length ? 'Usa o detalhamento' : 'Sem categoria'}</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{transaction.kind === 'transfer' && !transaction.analysisExcluded && !reverted && <button type="button" className="secondary tx-detail-button" onClick={() => setTransferDetailTransaction(transaction)}><ReceiptText size={14} /> {allocations.length ? 'Editar detalhes' : 'Detalhar transferência'}</button>}</div>
        <strong className={`${displayedMovement > 0 ? 'positive' : ''} ${reverted ? 'reverted-amount' : ''}`}>{displayedMovement < 0 ? '-' : '+'}{formatMoney(Math.abs(displayedMovement), transaction.currency)}{reverted && <small>revertida</small>}</strong>
      </article>;
    })}</div>}
  </section>;

  const nextEventDays = nextPlannedEvent ? civilDaysBetween(today, nextPlannedEvent.dueDate) : undefined;
  const categoryRows = analytics.current.byCategory.slice(0, 5);
  const periodTransactionIds = new Set(analytics.current.transactions.map((transaction) => transaction.id));
  const periodCriticalPendingCount = analytics.current.transactions.filter((transaction) => transaction.needsReview).length
    + unresolvedIssues.filter((issue) => Boolean(issue.transactionId && periodTransactionIds.has(issue.transactionId))).length;
  const analysisPeriodLabel = `${formatReportingDate(analytics.current.range.start)} a ${formatReportingDate(analytics.current.range.end)}`;
  const homeStatus = periodCriticalPendingCount > 0
    ? { label: 'ANÁLISE DO PERÍODO PROVISÓRIA', title: 'Há dados deste período para revisar', tone: 'attention' }
    : criticalPendingCount > 0
      ? { label: 'REVISÃO PENDENTE', title: 'Há itens fora deste período para revisar', tone: 'attention' }
      : currencyPosition.confidence === 'missing'
        ? { label: 'SALDO AINDA NÃO CONFIRMADO', title: 'Falta informar a posição das contas', tone: 'neutral' }
        : currencyPosition.confidence === 'stale'
          ? { label: 'SALDO POSSIVELMENTE DESATUALIZADO', title: 'Vale confirmar a posição atual', tone: 'attention' }
          : freeMoneyPosition.status === 'ready' && (freeMoneyPosition.freeCents ?? 0) < 0
            ? { label: 'ATENÇÃO', title: 'Compromissos acima do dinheiro livre', tone: 'warning' }
            : { label: 'SITUAÇÃO ATUAL', title: 'Seu presente financeiro está organizado', tone: 'positive' };
  const recentTransactions = visibleTransactions
    .filter((transaction) => transaction.status === 'completed'
      && transaction.currency === currency
      && transaction.reportingDate >= analytics.current.range.start
      && transaction.reportingDate <= analytics.current.range.end)
    .slice(0, 5);
  const todayActivity = buildTodayActivity(financeState, currency, today);
  const healthReport = buildDataHealthReport(financeState);
  const memorySuggestions = buildMemorySuggestions(financeState, currency);
  const balanceConfidenceLabel = currencyPosition.confidence === 'confirmed' ? 'Confirmado'
    : currencyPosition.confidence === 'estimated' ? 'Estimado após a última confirmação'
      : currencyPosition.confidence === 'stale' ? 'Possivelmente desatualizado' : 'Precisa confirmar';
  const balanceConfidenceIcon = currencyPosition.confidence === 'confirmed' ? <BadgeCheck size={15} />
    : currencyPosition.confidence === 'missing' ? <CircleAlert size={15} /> : <Gauge size={15} />;
  const displayedCurrentBalance = currencyPosition.currentBalanceCents !== undefined
    ? formatMoney(currencyPosition.currentBalanceCents, currency)
    : 'Ainda não informado';
  const displayedAvailableBalance = currencyPosition.availableBalanceCents !== undefined
    ? formatMoney(currencyPosition.availableBalanceCents, currency)
    : undefined;
  const topCategoryAmount = categoryRows.reduce((sum, item) => sum + item.amountCents, 0);
  const otherCategoryAmount = Math.max(0, analytics.current.summary.expenseCents - topCategoryAmount);
  const primaryImpactInsight = nowImpactInsights[0] ?? opportunityImpactInsights[0];

  return (
    <main className="app-shell">
      <header className="app-topbar"><div className="mini-brand"><span>JF</span><b>Japa Finance</b></div><div className="topbar-actions"><select aria-label="Moeda" value={currency} onChange={(event) => { setCurrency(event.target.value); setAccountFilter('all'); setInstitutionFilter('all'); setCategoryFilter('all'); }}>{currencies.map((item) => <option key={item}>{item}</option>)}</select><button type="button" className="avatar-button" onClick={() => supabase?.auth.signOut()} title="Sair">D</button></div></header>
      {error && <section className="error-banner"><FileWarning size={18} /><span>{error}</span><button type="button" onClick={() => setError('')}><X size={16} /></button></section>}

      {activeTab === 'home' && <section className="home-page-v2">
        <section className="home-context-strip"><div><span className="eyebrow">AGORA · {currency}</span><h1>Visão financeira</h1></div><p>{currencyPosition.latestAsOf ? `Posição mais recente: ${new Date(currencyPosition.latestAsOf).toLocaleString('pt-BR')}` : 'Nenhuma posição bancária confirmada ainda.'}</p></section>

        <section className={`financial-status ${homeStatus.tone}`}>
          <div className="status-orb"><Sparkles size={22} /></div>
          <div><small>{homeStatus.label}</small><h2>{homeStatus.title}</h2><p>{periodCriticalPendingCount > 0 ? `${periodCriticalPendingCount} ${periodCriticalPendingCount === 1 ? 'item deste período precisa' : 'itens deste período precisam'} da sua ajuda.` : criticalPendingCount > 0 ? `${criticalPendingCount} ${criticalPendingCount === 1 ? 'item permanece' : 'itens permanecem'} pendente fora do intervalo exibido.` : currencyPosition.confidence === 'missing' ? 'Confirme os saldos por conta para liberar dinheiro livre e projeções confiáveis.' : `${balanceConfidenceLabel}.${pendingReviewGroupCount > 0 ? ` ${pendingReviewGroupCount} grupos opcionais podem melhorar as categorias.` : ''}`}</p></div>
          {criticalPendingCount > 0 ? <button type="button" className="link-button" onClick={() => setActiveTab('review')}>Revisar</button> : currencyPosition.confidence === 'missing' || currencyPosition.confidence === 'stale' ? <button type="button" className="link-button" onClick={recordBalanceSnapshot}>Confirmar saldo</button> : null}
        </section>

        <section className="current-balance-card">
          <header><div><small>SALDO CONTABILIZADO · {currency}</small><strong>{displayedCurrentBalance}</strong>{currencyPosition.pendingCount > 0 && displayedAvailableBalance && <small className="available-balance">Disponível após {currencyPosition.pendingCount} pendente(s): <b>{displayedAvailableBalance}</b></small>}</div><span className={`balance-confidence ${currencyPosition.confidence}`}>{balanceConfidenceIcon}{balanceConfidenceLabel}</span></header>
          <div className="account-position-list">{currencyPosition.positions.map((position) => <article key={position.account.id}><div><Building2 size={16} /><span><b>{position.account.name}</b><small>{position.account.institution === 'revolut' ? 'Revolut' : position.account.institution === 'wise' ? 'Wise' : position.account.institution}{position.account.product ? ` · ${position.account.product}` : ''}{position.logicalDate ? ` · posição de ${formatReportingDate(position.logicalDate)}` : ''}</small></span></div><span className="position-values"><strong>{position.currentBalanceCents !== undefined ? formatMoney(position.currentBalanceCents, currency) : 'não informado'}</strong>{position.pendingCount > 0 && position.availableBalanceCents !== undefined && <small>disponível {formatMoney(position.availableBalanceCents, currency)}</small>}</span></article>)}</div>
          <footer><span><Cloud size={14} /> {syncLabel}</span><button type="button" className="link-button" onClick={recordBalanceSnapshot}>Atualizar saldos</button></footer>
          {currencyPosition.bridge && <details className="balance-bridge"><summary>Entenda como o saldo chegou aqui</summary><div><span><small>Saldo confirmado</small><b>{formatMoney(currencyPosition.bridge.openingBalanceCents, currency)}</b></span><span><small>Fluxo externo depois disso</small><b className={currencyPosition.bridge.externalFlowCents >= 0 ? 'positive' : 'negative'}>{formatMoney(currencyPosition.bridge.externalFlowCents, currency)}</b></span><span><small>Internas e conversões</small><b>{formatMoney(currencyPosition.bridge.internalMovementCents, currency)}</b></span><span><small>Taxas bancárias</small><b className="negative">{formatMoney(currencyPosition.bridge.feeCents, currency)}</b></span><span><small>Ajustes</small><b>{formatMoney(currencyPosition.bridge.adjustmentCents, currency)}</b></span><span className="bridge-total"><small>Saldo calculado agora</small><b>{formatMoney(currencyPosition.bridge.closingBalanceCents, currency)}</b></span></div><p>Base confirmada em {new Date(currencyPosition.bridge.logicalAsOf).toLocaleString('pt-BR')}. Movimentos posteriores atualizam o valor como estimativa até a próxima reconciliação.</p></details>}
        </section>

        <section className="home-grid-v2 alpha5-home-grid">
          <article className={`free-money-card ${freeMoneyPosition.status === 'ready' && (freeMoneyPosition.freeCents ?? 0) < 0 ? 'unsafe' : ''}`}>
            <div><small>DINHEIRO REALMENTE LIVRE</small><ShieldCheck size={20} /></div>
            <strong>{freeMoneyPosition.freeCents !== undefined ? formatMoney(freeMoneyPosition.freeCents, currency) : 'Precisa de saldo'}</strong>
            <p>Saldo menos {formatMoney(freeMoneyPosition.commitmentsCents, currency)} em compromissos e {formatMoney(freeMoneyPosition.reserveCents, currency)} de reserva.</p>
            <button type="button" className="link-button" onClick={() => setActiveTab('planning')}>Ver planejamento</button>
          </article>
          <article className="today-card">
            <div><small>ATIVIDADE DE HOJE</small><CalendarClock size={20} /></div>
            <strong>{formatMoney(todayActivity.externalNetCents, currency)}</strong>
            {todayActivity.hasDataForToday ? <div className="today-breakdown">{todayActivity.buckets.map((bucket) => <button type="button" key={bucket.key} onClick={() => { setDateStart(today); setDateEnd(today); setMonth('all'); setActiveTab('transactions'); }}><span>{bucket.label}</span><b className={bucket.amountCents > 0 ? 'positive' : bucket.amountCents < 0 ? 'negative' : ''}>{formatMoney(bucket.amountCents, currency)}</b></button>)}</div> : <p>Nenhum dado bancário disponível para hoje.{todayActivity.latestImportedDate ? ` Último movimento: ${formatReportingDate(todayActivity.latestImportedDate)}.` : ''}</p>}
            <button type="button" className="link-button" onClick={() => { setDateStart(today); setDateEnd(today); setMonth('all'); setActiveTab('transactions'); }}>Ver cálculo e movimentos</button>
          </article>
        </section>

        {nextPlannedEvent && <section className="next-event-card"><div className="event-icon"><CalendarClock size={21} /></div><div><small>PRÓXIMO COMPROMISSO</small><h3>{nextPlannedEvent.title}</h3><p>{nextEventDays === 0 ? 'Hoje' : nextEventDays === 1 ? 'Amanhã' : `Em ${nextEventDays} dias`} · {nextPlannedEvent.direction === 'outflow' ? 'saída' : 'entrada'}</p></div><strong>{nextPlannedEvent.direction === 'outflow' ? '-' : '+'}{formatMoney(nextPlannedEvent.amountCents, currency)}</strong></section>}

        <section className="panel flow-panel">
          <div className="panel-title"><div><small>FLUXO DO PERÍODO · {analysisPeriodLabel}</small><h2>Resultado do fluxo{periodCriticalPendingCount > 0 ? ' provisório' : ''}</h2></div><ChartNoAxesCombined size={22} /></div>
          <div className="flow-breakdown"><article><small>Entradas externas</small><b className="positive">{formatMoney(analytics.current.summary.incomeCents, currency)}</b></article><article><small>Saídas externas líquidas</small><b>{formatMoney(analytics.current.summary.netExpenseCents, currency)}</b></article><article><small>Resultado do fluxo</small><b className={analytics.current.summary.netCashflowCents >= 0 ? 'positive' : 'negative'}>{formatMoney(analytics.current.summary.netCashflowCents, currency)}</b></article></div>
          <details className="calculation-details"><summary>Como chegamos neste número</summary><div className="calculation-grid"><span><small>Despesas brutas</small><b>{formatMoney(analytics.current.summary.expenseCents, currency)}</b></span><span><small>Reembolsos</small><b>{formatMoney(analytics.current.summary.refundCents, currency)}</b></span><span><small>Internas/conversões</small><b>{analytics.current.excludedTransferTransactionCount}</b></span><span><small>Sem categoria</small><b>{analytics.current.uncategorizedTransactionCount}</b></span></div><p>Transferências internas e conversões ficam fora do fluxo. Taxas bancárias entram como despesas separadas. Saldo é posição; fluxo é movimento.</p></details>
        </section>

        <section className="panel home-section"><div className="panel-title"><div><small>ÚLTIMAS ATIVIDADES</small><h2>Movimentações recentes</h2></div><button type="button" className="link-button" onClick={() => setActiveTab('transactions')}>Ver todas</button></div><div className="recent-list">{recentTransactions.map((transaction) => <button type="button" className="recent-row" key={transaction.id} onClick={() => transaction.kind === 'transfer' && !transaction.analysisExcluded ? setTransferDetailTransaction(transaction) : setActiveTab('transactions')}><div><b>{transaction.friendlyDescription ?? transaction.descriptionOriginal}</b><small>{formatReportingDate(transaction.reportingDate)} · {financeState.transactionAllocations.some((allocation) => allocation.transactionId === transaction.id) ? 'Detalhada por finalidade' : categoryName(transaction.categoryId)}</small></div><strong className={signedNetMovement(transaction) > 0 ? 'positive' : 'negative'}>{signedNetMovement(transaction) < 0 ? '-' : '+'}{formatMoney(Math.abs(signedNetMovement(transaction)), transaction.currency)}</strong></button>)}</div></section>

        {primaryImpactInsight && <section className="home-insights"><div className="section-heading"><div><span className="eyebrow">PRIORIDADE</span><h2>O que pode mudar uma decisão</h2></div><button type="button" className="link-button" onClick={() => { setDiscoveriesView(primaryImpactInsight.group); setActiveTab('discoveries'); }}>Ver todas</button></div><ImpactInsightCard insight={primaryImpactInsight} compact onAction={openImpactAction} /></section>}

        <section className="panel home-section"><div className="panel-title"><div><small>GASTOS POR FINALIDADE</small><h2>Para onde foi seu dinheiro?</h2></div><button type="button" className="link-button" onClick={() => setActiveTab('transactions')}>Explorar</button></div>{categoryRows.length ? <>{categoryRows.map((item) => { const max = categoryRows[0]?.amountCents ?? 1; return <button type="button" className="cat cat-button" key={item.key} onClick={() => { setCategoryFilter(item.key); setActiveTab('transactions'); }}><div><span>{categoryName(item.key)}</span><b>{formatMoney(item.amountCents, currency)}</b></div><i><em style={{ width: `${Math.max(3, item.amountCents / max * 100)}%` }} /></i><small>{Math.round(item.share * 100)}% · {item.transactionCount} movimentos/itens</small></button>; })}{otherCategoryAmount > 0 && <div className="other-categories"><span>Outras categorias</span><b>{formatMoney(otherCategoryAmount, currency)} · {Math.round(otherCategoryAmount / Math.max(1, analytics.current.summary.expenseCents) * 100)}%</b></div>}</> : <p className="muted">Ainda não há despesas classificadas neste período.</p>}</section>
      </section>}

      {activeTab === 'transactions' && renderTransactions()}

      {activeTab === 'planning' && <section className="planning-page">
        <span className="eyebrow">PLANEJAR · {currency}</span>
        <h1>O futuro sem<br />fantasia contábil.</h1>
        <p>O saldo bruto não é dinheiro livre. Esta tela separa reserva, compromissos e próxima entrada antes que o otimismo faça compras sozinho.</p>

        <section className="planning-summary">
          <article className={freeMoneyPosition.freeCents !== undefined && freeMoneyPosition.freeCents < 0 ? 'unsafe' : ''}><small>DINHEIRO LIVRE</small><strong>{freeMoneyPosition.freeCents !== undefined ? formatMoney(freeMoneyPosition.freeCents, currency) : 'Precisa de saldo'}</strong><span>Depois de compromissos e reserva</span></article>
          <article><small>PRÓXIMA ENTRADA</small><strong>{freeMoneyPosition.nextIncomeDate ? formatReportingDate(freeMoneyPosition.nextIncomeDate) : 'Não cadastrada'}</strong><span>{plannedInflows[0] ? `${plannedInflows[0].title} · ${formatMoney(plannedInflows[0].amountCents, currency)}` : 'Cadastre uma receita futura'}</span></article>
          <article><small>LIMITE DIÁRIO</small><strong>{freeMoneyPosition.safeDailyCents !== undefined ? formatMoney(freeMoneyPosition.safeDailyCents, currency) : 'Indisponível'}</strong><span>{freeMoneyPosition.daysToNextIncome ? `por ${freeMoneyPosition.daysToNextIncome} dias` : 'depende da próxima receita'}</span></article>
        </section>

        <div className="planning-actions"><button type="button" onClick={() => setPlannedEventOpen(true)}><Plus size={17} /> Adicionar compromisso</button><button type="button" className="secondary" onClick={() => setReserveOpen(true)}><ShieldCheck size={17} /> Definir reserva</button><button type="button" className="secondary" onClick={() => setActiveTab('assistant')}><MessageSquare size={17} /> Perguntar aos números</button></div>

        <section className="panel planning-breakdown"><div className="panel-title"><div><small>ATÉ A PRÓXIMA RECEITA</small><h2>O que já está comprometido</h2></div><CalendarClock size={20} /></div><div className="planning-breakdown-grid"><span><small>Saldo atual</small><b>{currencyPosition.currentBalanceCents !== undefined ? formatMoney(currencyPosition.currentBalanceCents, currency) : 'não confirmado'}</b></span><span><small>Compromissos</small><b className="negative">-{formatMoney(freeMoneyPosition.commitmentsCents, currency)}</b></span><span><small>Reserva protegida</small><b>-{formatMoney(freeMoneyPosition.reserveCents, currency)}</b></span><span className="planning-total"><small>Realmente livre</small><b>{freeMoneyPosition.freeCents !== undefined ? formatMoney(freeMoneyPosition.freeCents, currency) : 'incompleto'}</b></span></div></section>

        <section className="panel commitments-panel"><div className="panel-title"><div><small>AGENDA FINANCEIRA</small><h2>Próximos eventos</h2></div><span>{upcomingEvents.length}</span></div>{upcomingEvents.length ? <div className="commitment-list">{upcomingEvents.slice(0, 12).map((event) => <article key={event.id}><div className={`commitment-direction ${event.direction}`}><ChevronRight size={16} /></div><div><b>{event.title}</b><small>{formatReportingDate(event.dueDate)} · {event.recurrence ? recurrenceName(event.recurrence.frequency) : 'pontual'}{event.accountId ? ` · ${accountName(event.accountId)}` : ' · conta pendente'}</small></div><strong className={event.direction === 'inflow' ? 'positive' : 'negative'}>{event.direction === 'inflow' ? '+' : '-'}{formatMoney(event.amountCents, currency)}</strong><button type="button" className="icon-button tiny commitment-delete" title={`Excluir ${event.title}`} aria-label={`Excluir compromisso ${event.title}`} onClick={() => deletePlannedEvent(event.id)}><Trash2 size={15} /></button></article>)}</div> : <div className="empty compact-empty"><CalendarClock size={28} /><p>Nenhuma receita ou compromisso futuro cadastrado.</p></div>}</section>

        <section className="panel recurring-panel"><div className="panel-title"><div><small>RECORRÊNCIAS EM TRANSFERÊNCIAS</small><h2>Assinaturas e divisões</h2></div><ReceiptText size={20} /></div>{recurringAllocations.length ? <div className="recurring-allocation-list">{recurringAllocations.map((allocation) => <article key={allocation.id}><div><b>{allocation.label}</b><small>{allocation.relatedPerson ? `${allocation.relatedPerson} · ` : ''}${recurrenceName(allocation.recurrenceFrequency)}{allocation.nextDueDate ? ` · próxima ${formatReportingDate(allocation.nextDueDate)}` : ''}</small></div><strong>{formatMoney(allocation.amountCents, currency)}</strong></article>)}</div> : <p className="muted">Ao detalhar uma transferência, marque itens recorrentes para que assinaturas compartilhadas entrem no planejamento.</p>}</section>

        {homeLimit && <section className="panel decision-limit-card"><div className="panel-title"><div><small>LIMITE DETERMINÍSTICO</small><h2>Margem da conta selecionada</h2></div><Gauge size={20} /></div><strong>{homeLimit.amountCents !== undefined ? formatMoney(homeLimit.amountCents, currency) : 'Precisa completar os dados'}</strong><p>{homeLimit.answer}</p></section>}
      </section>}

      {activeTab === 'discoveries' && <section className="discoveries-page">
        <span className="eyebrow">INSIGHTS</span>
        <h1>Contexto que<br />leva a uma ação.</h1>
        <p>Um insight só aparece quando muda uma decisão ou aumenta de verdade a compreensão. O óbvio não ganha cartão só porque veio acompanhado de porcentagem.</p>
        <nav className="discoveries-tabs" aria-label="Tipos de insights"><button type="button" className={discoveriesView === 'now' ? 'active' : ''} onClick={() => setDiscoveriesView('now')}>Agora <span>{nowImpactInsights.length}</span></button><button type="button" className={discoveriesView === 'opportunity' ? 'active' : ''} onClick={() => setDiscoveriesView('opportunity')}>Oportunidades <span>{opportunityImpactInsights.length}</span></button><button type="button" className={discoveriesView === 'patterns' ? 'active' : ''} onClick={() => setDiscoveriesView('patterns')}>Padrões <span>{insightResult.insights.length}</span></button></nav>

        {discoveriesView === 'now' && <div className="impact-stack">{nowImpactInsights.length ? nowImpactInsights.map((insight) => <ImpactInsightCard key={insight.id} insight={insight} onAction={openImpactAction} />) : <section className="panel empty compact-empty"><BadgeCheck size={30} /><p>Nenhuma ação urgente identificada com os dados atuais.</p></section>}</div>}

        {discoveriesView === 'opportunity' && <div className="impact-stack">{opportunityImpactInsights.length ? opportunityImpactInsights.map((insight) => <ImpactInsightCard key={insight.id} insight={insight} onAction={openImpactAction} />) : <section className="panel empty compact-empty"><Lightbulb size={30} /><p>Nenhuma oportunidade suficientemente comprovada por enquanto.</p></section>}</div>}

        {discoveriesView === 'patterns' && <>
          <div className="discoveries-summary"><article><Sparkles size={21} /><div><b>{insightResult.insights.length}</b><small>padrões visíveis</small></div></article><article><ChartNoAxesCombined size={21} /><div><b>{analytics.current.expenseTransactionCount}</b><small>movimentações analisadas</small></div></article><article><CalendarClock size={21} /><div><b>{analytics.current.observedDays}</b><small>dias observados</small></div></article></div>
          <section className="panel comparison-panel">
            <div className="panel-title"><div><small>COMPARAÇÃO EQUIVALENTE</small><h2>Período atual x anterior</h2></div><ChartNoAxesCombined size={21} /></div>
            <p className="comparison-range">{formatReportingDate(comparison.currentRange.start)} a {formatReportingDate(comparison.currentRange.end)} <span>contra</span> {formatReportingDate(comparison.previousRange.start)} a {formatReportingDate(comparison.previousRange.end)}</p>
            {comparison.comparable && <div className="comparison-metrics">{comparison.metrics.map((metric) => {
              const improved = metric.favorableWhenLower ? metric.differenceCents < 0 : metric.differenceCents > 0;
              const comparisonTone = metric.differenceCents === 0 ? 'neutral' : improved ? 'positive' : 'negative';
              const differencePrefix = metric.differenceCents === 0 ? '' : metric.differenceCents > 0 ? '+' : '-';
              return <article key={metric.label}><small>{metric.label}</small><strong>{formatMoney(metric.currentCents, currency)}</strong><span className={comparisonTone}>{differencePrefix}{formatMoney(Math.abs(metric.differenceCents), currency)}{metric.percentChange !== undefined ? ` · ${Math.round(metric.percentChange * 100)}%` : ''}</span><em>anterior: {formatMoney(metric.previousCents, currency)}</em></article>;
            })}</div>}
            <div className="comparison-explanations">{comparison.explanations.map((explanation) => <article className={explanation.tone} key={explanation.id}><b>{explanation.title}</b><p>{explanation.body}</p></article>)}</div>
            {comparison.comparable && <small className="comparison-note">Os dois lados usam a mesma quantidade de dias observados.</small>}
          </section>
          <div className="insight-stack discoveries-stack">{insightResult.insights.length ? insightResult.insights.map((insight) => <InsightCard key={insight.key} insight={insight} onAction={openInsightAction} onUseful={(item) => updateInsightFeedback(item, { useful: true, lastShownAt: new Date().toISOString() })} onDismiss={(item) => updateInsightFeedback(item, { dismissedAt: new Date().toISOString() })} />) : <section className="panel empty compact-empty"><Sparkles size={30} /><p>Ainda não há histórico suficiente para padrões confiáveis.</p></section>}</div>
        </>}
      </section>}

      {activeTab === 'assistant' && <section className="assistant-page"><span className="eyebrow">ASSISTENTE DETERMINÍSTICO</span><h1>Converse com<br />seus números.</h1><p>Ele não inventa saldo nem usa IA para decidir. O motor responde a partir da reconciliação, do forecast e dos compromissos cadastrados.</p><label className="assistant-account-selector">Conta-alvo<select aria-label="Conta-alvo do assistente" value={assistantTargetAccountId} onChange={(event) => setAssistantTargetAccountId(event.target.value)}><option value="">Selecione uma conta</option>{activeAccounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><div className="prompt-grid">{['Onde foi meu dinheiro este mês?','Posso comprar uma TV de €600?','Quanto posso gastar até o pagamento?','Há cobranças duplicadas?'].map((prompt) => <button type="button" className="prompt-card" key={prompt} onClick={() => { setAssistantQuestion(prompt); askAssistant(prompt); }}>{prompt}</button>)}</div>{assistantAnswer && <div className={`assistant-answer ${assistantAnswer.status ?? ''}`}><b>JF</b><p>{assistantAnswer.answer}</p>{assistantAnswer.evidence.length > 0 && <ul>{assistantAnswer.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}<small>Confiança {assistantAnswer.confidence === 'high' ? 'alta' : assistantAnswer.confidence === 'medium' ? 'média' : 'baixa'} · escopo: {assistantAnswer.dataScope ?? 'estado financeiro'} · {currency}</small></div>}<div className="assistant-input"><input value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder="Pergunte sobre seu dinheiro" onKeyDown={(event) => event.key === 'Enter' && askAssistant()} /><button type="button" onClick={() => askAssistant()}><Send size={18} /></button></div></section>}

      {activeTab === 'accounts' && <section className="settings-page">
        <span className="eyebrow">MAIS</span><h1>Contas, dados<br />e controle.</h1>

        <section className="currency-overview"><div className="section-heading"><div><span className="eyebrow">POSIÇÃO POR MOEDA</span><h2>Saldo consolidado sem esconder as contas</h2></div></div>{allCurrencyPositions.map((position) => <article key={position.currency}><header><div><small>{position.currency}</small><strong>{position.currentBalanceCents !== undefined ? formatMoney(position.currentBalanceCents, position.currency) : 'saldo incompleto'}</strong></div><span className={`balance-confidence ${position.confidence}`}>{position.confidence === 'confirmed' ? 'Confirmado' : position.confidence === 'estimated' ? 'Estimado' : position.confidence === 'stale' ? 'Desatualizado' : 'Precisa confirmar'}</span></header><div>{position.positions.map((accountPosition) => <span key={accountPosition.account.id}><small>{accountPosition.account.name} · {institutionName(accountPosition.account.institution)}</small><b>{accountPosition.currentBalanceCents !== undefined ? formatMoney(accountPosition.currentBalanceCents, position.currency) : 'não informado'}</b></span>)}</div></article>)}</section>

        <section className="panel institution-summary"><div className="panel-title"><div><small>INSTITUIÇÕES · {currency}</small><h2>Wise e Revolut separadas</h2></div><Building2 size={20} /></div>{currencyAnalytics.institutions.length ? <div className="institution-list">{currencyAnalytics.institutions.map((summary) => <article key={summary.institution}><header><b>{institutionName(summary.institution)}</b><small>{summary.accountCount} {summary.accountCount === 1 ? 'conta' : 'contas'} · {summary.transactionCount} movimentos</small></header><div><span><small>Entradas externas</small><b className="positive">{formatMoney(summary.externalInflowCents, currency)}</b></span><span><small>Saídas externas</small><b>{formatMoney(summary.externalOutflowCents, currency)}</b></span><span><small>Movimentos internos</small><b>{formatMoney(summary.internalMovementCents, currency)}</b></span><span><small>Taxas</small><b className="negative">{formatMoney(summary.feeCents, currency)}</b></span></div></article>)}</div> : <p className="muted">Nenhuma movimentação encontrada nesta moeda.</p>}</section>

        <section className="panel fx-panel"><div className="panel-title"><div><small>MOEDAS E CÂMBIO</small><h2>Conversões e custo explícito</h2></div><ArrowLeftRight size={20} /></div><div className="fx-summary"><span><small>Volume convertido em {currency}</small><b>{formatMoney(currencyAnalytics.convertedOutflowCents, currency)}</b></span><span><small>Taxas explícitas</small><b className="negative">{formatMoney(currencyAnalytics.explicitFeeCents, currency)}</b></span><span><small>Conversões identificadas</small><b>{currencyAnalytics.conversionCount}</b></span><span><small>Vínculos de conversão</small><b>{unpairedConversionCount === 0 ? 'Todos vinculados ✓' : `${unpairedConversionCount} sem par`}</b></span></div>{currencyAnalytics.effectiveConversions.length > 0 && <div className="conversion-list">{currencyAnalytics.effectiveConversions.slice(0, 6).map((conversion) => <article key={conversion.groupId}><div><b>{conversion.sourceCurrency} → {conversion.targetCurrency}</b><small>{formatReportingDate(conversion.reportingDate)} · {institutionName(conversion.institution)}</small></div><span><strong>{formatMoney(conversion.sourceAmountCents, conversion.sourceCurrency)} → {formatMoney(conversion.targetAmountCents, conversion.targetCurrency)}</strong><small>câmbio efetivo {conversion.effectiveRate.toFixed(4).replace('.', ',')} · taxa {formatMoney(conversion.explicitFeeCents, conversion.sourceCurrency)}</small></span></article>)}</div>}<p className="muted">O custo explícito vem do extrato. Spread contra o mercado exige uma referência histórica externa e, por isso, não é inventado nesta versão.</p></section>

        <section className="panel integrity-panel"><div className="panel-title"><div><small>INTEGRIDADE VISÍVEL</small><h2>Quanto o aplicativo realmente sabe</h2></div><ShieldCheck size={20} /></div><div className="integrity-grid"><span><small>Saldo</small><b>{balanceConfidenceLabel}</b></span><span><small>Histórico disponível</small><b>{currencyHistoryStart && currencyHistoryEnd ? `${formatReportingDate(currencyHistoryStart)} a ${formatReportingDate(currencyHistoryEnd)}` : 'sem dados'}</b></span><span><small>Pendências críticas</small><b>{criticalPendingCount}</b></span><span><small>Pares internos sugeridos</small><b>{internalTransferSuggestions.length}</b></span><span><small>Conversões sem par</small><b>{unpairedConversionCount}</b></span><span><small>Detalhamentos</small><b>{financeState.transactionAllocations.filter((allocation) => financeState.transactions.some((transaction) => transaction.id === allocation.transactionId && transaction.currency === currency)).length}</b></span></div></section>

        <div className="import-card"><label className="import-fallback-label"><span>Destino de apoio para arquivos genéricos</span><select value={importAccountId} onChange={(event) => setImportAccountId(event.target.value)}>{activeAccounts.filter((account) => account.institution === 'revolut' || account.institution === 'wise').map((account) => <option key={account.id} value={account.id}>{account.name} · {institutionName(account.institution)}</option>)}</select></label><button type="button" onClick={() => input.current?.click()}><Upload size={18} /> Importar extrato bancário</button><small>Wise e Revolut são detectados e separados automaticamente por instituição, moeda e produto. O destino acima só é usado quando o arquivo realmente não traz essa informação.</small></div>
        <div className="settings-actions"><button type="button" className="secondary" onClick={() => setManualOpen(true)}><Plus size={18} /> Nova movimentação</button><button type="button" className="secondary" onClick={() => setCategoryOpen(true)}><Tags size={18} /> Categorias e comerciantes</button><button type="button" className="secondary" onClick={recordBalanceSnapshot}><WalletCards size={18} /> Atualizar saldos</button><button type="button" className="secondary" onClick={() => setReserveOpen(true)}><Sparkles size={18} /> Reserva mínima</button><button type="button" className="secondary" onClick={() => setPlannedEventOpen(true)}><CalendarClock size={18} /> Planejar compromisso</button><button type="button" className="secondary" onClick={() => setActiveTab('review')}><TriangleAlert size={18} /> Revisar pendências {pendingCount + internalTransferSuggestions.length + transferRecurrenceSuggestions.length > 0 ? `(${pendingCount + internalTransferSuggestions.length + transferRecurrenceSuggestions.length})` : ''}</button><button type="button" className="secondary" onClick={() => setAccountOpen(true)}><Landmark size={18} /> Gerenciar contas</button><button type="button" className="secondary" onClick={() => setIdentityOpen(true)}><BadgeCheck size={18} /> Identidade própria</button><button type="button" className="secondary" onClick={() => setActiveTab('health')}><ShieldCheck size={18} /> Saúde da base ({healthReport.score})</button><button type="button" className="secondary" onClick={() => setActiveTab('memory')}><Layers3 size={18} /> Memória financeira</button><button type="button" className="secondary" onClick={() => setActiveTab('ai')}><WandSparkles size={18} /> Auditoria inteligente</button><button type="button" className="secondary" onClick={() => downloadContextDiagnostic(financeState)}><FileDown size={18} /> Exportar diagnóstico</button><button type="button" className="secondary" onClick={() => exportState(financeState)}><Download size={18} /> Baixar backup</button><button type="button" className="secondary" onClick={() => backupInput.current?.click()}><RotateCcw size={18} /> Restaurar backup</button></div>
        <section className="panel imports"><div className="panel-title"><h3>Importações recentes</h3><Settings size={18} /></div>{financeState.imports.length ? financeState.imports.slice(0, 10).map((batch) => <div className={batch.status === 'undone' ? 'undone' : ''} key={batch.id}><div><b>{batch.fileName}</b><small>{(batch.accountIds?.length ?? 1) > 1 ? `${batch.accountIds!.length} contas` : accountName(batch.accountId)} · {batch.imported} importadas · {batch.rejected} rejeitadas</small></div><button type="button" title={batch.status === 'undone' ? 'Restaurar lote' : 'Anular lote'} onClick={() => toggleImport(batch.id)}><RotateCcw size={15} /></button></div>) : <p className="muted">Nenhum extrato importado ainda.</p>}</section>
        <section className="panel activity-panel"><div className="panel-title"><div><small>RASTREABILIDADE</small><h2>Linha do tempo de alterações</h2></div><History size={20} /></div>{activityTimeline.length ? <div className="activity-list">{activityTimeline.map((item) => <article className={item.undone ? 'undone' : ''} key={item.id}><i /><div><b>{item.title}</b><small>{item.detail}</small><time>{new Date(item.occurredAt).toLocaleString('pt-BR')}</time></div></article>)}</div> : <p className="muted">As próximas importações, reconciliações, classificações e planejamentos aparecerão aqui.</p>}</section>
      </section>}

      {activeTab === 'health' && <DataHealthPanel report={healthReport} onOpenReview={() => setActiveTab('review')} onReprocess={() => {
        const proposal = buildDeterministicAuditProposals(financeState).find((item) => item.payload.action === 'reprocess_all');
        if (!proposal) { setError('Nenhuma classificação automática precisa ser atualizada.'); return; }
        setPendingAuditProposal(proposal);
      }} />}

      {activeTab === 'memory' && <FinancialMemoryPanel state={financeState} suggestions={memorySuggestions} create={(input) => {
        createCheckpoint(userId, financeState, `Antes de ensinar ${input.displayName}`);
        const entity = createMemoryEntity({ displayName: input.displayName, aliases: [input.alias], type: input.type as FinancialEntityType, relationship: input.relationship as FinancialEntityRelationship, contextLabel: input.contextLabel, categoryId: input.categoryId, direction: input.direction, validFrom: input.validFrom, validUntil: input.validUntil, source: 'confirmed_suggestion' });
        setState(reprocessFinancialState({ ...financeState, financialMemory: [...financeState.financialMemory, entity] }));
      }} remove={(id) => { createCheckpoint(userId, financeState, 'Antes de remover memória financeira'); setState(reprocessFinancialState({ ...financeState, financialMemory: financeState.financialMemory.filter((item) => item.id !== id), transactions: financeState.transactions.map((item) => item.counterpartyEntityId === id ? { ...item, counterpartyEntityId: undefined } : item) })); }} />}

      {activeTab === 'ai' && <AiAuditPanel proposals={financeState.auditProposals} runs={financeState.aiAuditRuns} busy={aiAuditBusy} runLocal={() => {
        const proposals = buildDeterministicAuditProposals(financeState);
        setState({ ...financeState, auditProposals: [...proposals, ...financeState.auditProposals.filter((item) => item.status !== 'pending')] });
      }} runAi={async (options) => {
        setAiAuditBusy(true); setError('');
        try {
          const result = await requestAiFinancialAudit(financeState, options);
          const run = createAiAuditRun(financeState, result);
          setState({ ...financeState, auditProposals: [...result.proposals, ...financeState.auditProposals], aiAuditRuns: [run, ...financeState.aiAuditRuns] });
        } catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível executar a auditoria.'); }
        finally { setAiAuditBusy(false); }
      }} apply={(proposal: AuditProposal) => setPendingAuditProposal(proposal)} dismiss={(proposal) => setState({ ...financeState, auditProposals: financeState.auditProposals.map((item) => item.id === proposal.id ? { ...item, status: 'dismissed', resolvedAt: new Date().toISOString() } : item) })} />}

      {activeTab === 'review' && <section className="review-page"><span className="eyebrow">REVISAR</span><h1>Resolva em grupos.<br />Controle as exceções.</h1><div className="review-summary-grid"><article className={criticalPendingCount ? 'attention' : ''}><small>Corrigir dados</small><b>{criticalPendingCount}</b><span>Afeta cálculo ou integridade</span></article><article><small>Confirmar vínculos</small><b>{internalTransferSuggestions.length}</b><span>Contas próprias e conversões</span></article><article><small>Ensinar contexto</small><b>{memorySuggestions.length}</b><span>Pessoas e padrões recorrentes</span></article><article><small>Organizar categorias</small><b>{pendingReviewGroupCount}</b><span>Opcional, não trava o fluxo</span></article></div><div className="review-history-bar"><span>{financeState.reviewDecisions.filter((item) => !item.undoneAt).length} decisões ativas</span><button type="button" className="secondary" disabled={!financeState.reviewDecisions.some((item) => !item.undoneAt)} onClick={undoReviewDecision}><RotateCcw size={16} /> Desfazer última decisão</button></div>{recentReviewDecisions.length > 0 && <details className="review-decision-history"><summary>Histórico recente</summary><div>{recentReviewDecisions.map((decision) => <article className={decision.undoneAt ? 'undone' : ''} key={decision.id}><div><b>{decision.label}</b><small>{new Date(decision.createdAt).toLocaleString('pt-BR')} · {decision.transactionIds.length} movimentações</small></div><span>{decision.undoneAt ? 'desfeita' : 'ativa'}</span></article>)}</div></details>}{internalTransferSuggestions.length > 0 && <section className="panel internal-match-list"><div className="panel-title"><div><small>ENTRE SUAS CONTAS</small><h2>Possíveis transferências internas</h2></div><ArrowLeftRight size={20} /></div><p>Os dois lançamentos continuam no livro. Confirmar apenas os vincula e os retira de receita e despesa.</p><div>{internalTransferSuggestions.map((suggestion) => <article className="internal-match-card" key={suggestion.key}><header><span className={`match-confidence ${suggestion.confidence}`}>{suggestion.confidence === 'high' ? 'Confiança alta' : 'Revisar'}</span><strong>{formatMoney(suggestion.amountCents, suggestion.outflow.currency)}</strong></header><div className="match-sides"><span><small>SAIU</small><b>{accountName(suggestion.outflow.accountId)}</b><em>{formatReportingDate(suggestion.outflow.reportingDate)} · {suggestion.outflow.descriptionOriginal}</em></span><ArrowLeftRight size={18} /><span><small>ENTROU</small><b>{accountName(suggestion.inflow.accountId)}</b><em>{formatReportingDate(suggestion.inflow.reportingDate)} · {suggestion.inflow.descriptionOriginal}</em></span></div><ul>{suggestion.evidence.map((item) => <li key={item}>{item}</li>)}</ul><footer><button type="button" className="secondary" onClick={() => rejectInternalSuggestion(suggestion)}>Não são minhas contas</button><button type="button" onClick={() => confirmInternalSuggestion(suggestion)}>Confirmar vínculo</button></footer></article>)}</div></section>}{unresolvedIssues.length === 0 && reviewTransactions.length === 0 && eventsNeedingAccountReview.length === 0 && currencyReviewGroups.length === 0 && internalTransferSuggestions.length === 0 && transferRecurrenceSuggestions.length === 0 ? <section className="panel empty"><CircleAlert size={32} /><p>Nenhuma pendência aberta.</p></section> : <>
        <TransferRecurrencePanel suggestions={transferRecurrenceSuggestions} categories={financeState.categories} apply={applyRecurrencePurpose} />
        <ReviewGroupsPanel groups={currencyReviewGroups} transactions={visibleTransactions} categories={financeState.categories} apply={applyReviewGroup} resolveWithoutCategory={resolveReviewGroupWithoutCategory} defer={postponeReviewGroup} reopen={reactivateReviewGroup} applyOne={applyReviewException} />
        {eventsNeedingAccountReview.length > 0 && <section className="panel issues"><h3>Eventos sem conta</h3><p>Escolha a conta para reativá-los no forecast ou exclua o evento.</p>{eventsNeedingAccountReview.map((item) => <article key={item.id}><div className="issue-heading"><b>{item.title}</b><button type="button" className="icon-button tiny" title={`Excluir ${item.title}`} aria-label={`Excluir compromisso ${item.title}`} onClick={() => deletePlannedEvent(item.id)}><Trash2 size={15} /></button></div><p>{item.dueDate} · {formatMoney(item.amountCents, item.currency)}</p><label>Conta<select aria-label={`Conta para ${item.title}`} defaultValue="" onChange={(event) => event.target.value && resolvePlannedEventAccount(item.id, event.target.value)}><option value="">Selecionar conta</option>{activeAccounts.filter((account) => account.currency === item.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></article>)}</section>}
        {unresolvedIssues.length > 0 && <section className="panel issues"><h3>Pendências de importação</h3>{unresolvedIssues.map((item) => <article key={item.id}><b>{item.kind.replaceAll('_', ' ')}</b><p>{item.message}</p><small>{accountName(item.accountId)}{item.rowNumber ? ` · linha ${item.rowNumber}` : ''}</small><button type="button" onClick={() => dismissIssue(item)}>Marcar como revisada</button></article>)}</section>}
        {reviewTransactions.length > 0 && renderTransactions(reviewTransactions.filter((item) => item.currency === currency), true)}
      </>}</section>}

      <input ref={input} hidden type="file" accept=".csv,.pdf,text/csv,application/pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && onFile(event.target.files[0])} />
      <input ref={backupInput} hidden type="file" accept=".json,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && restoreBackup(event.target.files[0])} />
      <nav className="bottom-nav"><button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}><Home size={20} /><span>Início</span></button><button type="button" className={activeTab === 'transactions' ? 'active' : ''} onClick={() => setActiveTab('transactions')}><List size={20} /><span>Movimentos</span></button><button type="button" className={activeTab === 'planning' ? 'active' : ''} onClick={() => setActiveTab('planning')}><CalendarClock size={20} /><span>Planejar</span></button><button type="button" className={['discoveries','assistant','ai'].includes(activeTab) ? 'active' : ''} onClick={() => setActiveTab('discoveries')}><Lightbulb size={20} /><span>Insights</span></button><button type="button" className={['accounts','review','health','memory'].includes(activeTab) ? 'active' : ''} onClick={() => setActiveTab('accounts')}><Settings size={20} /><span>Mais</span></button></nav>

      {syncConflict && <SyncConflictModal conflict={syncConflict} busy={conflictBusy} message={error} exportLocal={() => exportState(syncConflict.localState)} keepLocal={keepLocalConflictVersion} useRemote={useRemoteConflictVersion} />}
      {preview && <ImportPreview preview={preview} includePossibleDuplicates={includePossibleDuplicates} setIncludePossibleDuplicates={setIncludePossibleDuplicates} allowPartial={allowPartial} setAllowPartial={setAllowPartial} close={() => setPreview(null)} confirm={confirmImport} />}
      {manualOpen && <ManualModal accounts={activeAccounts} categories={financeState.categories} close={() => setManualOpen(false)} add={(transaction) => { createCheckpoint(userId, financeState, 'Antes de transação manual'); setState(withRebuiltReviewGroups({ ...financeState, transactions: [transaction, ...financeState.transactions] })); setManualOpen(false); }} />}
      {accountOpen && <AccountModal
        accounts={financeState.accounts}
        referenceCounts={Object.fromEntries(financeState.accounts.map((account) => [account.id, countAccountReferences(financeState, account.id)]))}
        close={() => setAccountOpen(false)}
        save={(account) => {
          createCheckpoint(userId, financeState, `Antes de criar conta ${account.name}`);
          setState({ ...financeState, accounts: [...financeState.accounts, account] });
        }}
        rename={(accountId, name) => {
          createCheckpoint(userId, financeState, `Antes de renomear conta ${accountName(accountId)}`);
          setState(renameManagedAccount(financeState, accountId, name));
        }}
        archive={(accountId, archived) => {
          createCheckpoint(userId, financeState, `Antes de ${archived ? 'arquivar' : 'reativar'} conta ${accountName(accountId)}`);
          setState(setAccountArchived(financeState, accountId, archived));
        }}
        remove={(accountId) => {
          createCheckpoint(userId, financeState, `Antes de excluir conta ${accountName(accountId)}`);
          setState(deleteEmptyAccount(financeState, accountId));
        }}
        merge={(sourceId, targetId) => {
          createCheckpoint(userId, financeState, `Antes de mesclar ${accountName(sourceId)} em ${accountName(targetId)}`);
          setState(reprocessFinancialState(mergeAccounts(financeState, sourceId, targetId)));
        }}
      />}
      {identityOpen && <IdentityProfileModal profile={financeState.ownerIdentity} accounts={financeState.accounts} close={() => setIdentityOpen(false)} save={saveIdentityProfile} />}
      {reconciliationOpen && <ReconciliationModal accounts={activeAccounts.filter((account) => account.currency === currency)} currency={currency} close={() => setReconciliationOpen(false)} confirm={confirmReconciliation} />}
      {reserveOpen && <ReserveModal currency={currency} policy={reservePolicy} close={() => setReserveOpen(false)} save={(policy) => { setState({ ...financeState, reservePolicies: [...financeState.reservePolicies.filter((item) => item.currency !== currency), policy] }); setReserveOpen(false); }} />}
      {plannedEventOpen && <PlannedEventModal accounts={activeAccounts} currency={currency} close={() => setPlannedEventOpen(false)} save={(plannedEvent) => { setState({ ...financeState, plannedEvents: [...financeState.plannedEvents, plannedEvent] }); setPlannedEventOpen(false); }} />}
      {categoryOpen && <CategoryManagerModal categories={financeState.categories} rules={financeState.rules} transactionCountByCategory={transactionCountByCategory} close={() => setCategoryOpen(false)} create={createCategory} rename={renameCategory} archive={archiveCategory} restore={restoreCategory} removeRule={removeCategoryRule} />}
      {merchantLearning && <MerchantLearningModal transaction={merchantLearning.transaction} category={merchantLearning.category} close={() => setMerchantLearning(null)} remember={rememberMerchantRule} />}
      {bulkRuleOpen && <BulkRuleModal candidates={filtered} categories={financeState.categories} currency={currency} close={() => setBulkRuleOpen(false)} apply={applyBulkRule} />}
      {transactionSheet && <TransactionDetailsSheet transaction={transactionSheet} account={financeState.accounts.find((item) => item.id === transactionSheet.accountId)} category={financeState.categories.find((item) => item.id === transactionSheet.categoryId)} close={() => setTransactionSheet(null)} />}
      {pendingAuditProposal && <AuditProposalConfirmModal proposal={pendingAuditProposal} preview={previewAuditProposal(financeState, pendingAuditProposal)} close={() => setPendingAuditProposal(null)} confirm={() => {
        try {
          createCheckpoint(userId, financeState, `Antes de aplicar auditoria: ${pendingAuditProposal.title}`);
          setState(applyAuditProposal(financeState, pendingAuditProposal));
          setPendingAuditProposal(null);
          setError('');
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : 'Não foi possível aplicar a correção proposta.');
        }
      }} />}
      {transferDetailTransaction && <TransferDetailModal transaction={transferDetailTransaction} allocations={financeState.transactionAllocations.filter((allocation) => allocation.transactionId === transferDetailTransaction.id)} categories={financeState.categories} close={() => setTransferDetailTransaction(null)} save={saveTransferDetail} />}
    </main>
  );

}


function ReconciliationModal({ accounts, currency, close, confirm }: {
  accounts: Account[];
  currency: string;
  close: () => void;
  confirm: (input: {
    logicalDate: string;
    logicalAsOf: string;
    balances: Array<{ accountId: string; balanceCents: number }>;
  }) => void;
}) {
  const [logicalAsOf, setLogicalAsOf] = useState(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(accounts.map((account) => [account.id, ''])),
  );
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    let canonicalLogicalAsOf: string;
    try {
      canonicalLogicalAsOf = localDateTimeToInstant(logicalAsOf);
    } catch {
      setError('Informe um instante lógico válido.');
      return;
    }
    const balances: Array<{ accountId: string; balanceCents: number }> = [];
    for (const account of accounts) {
      let balanceCents: number;
      try {
        balanceCents = parseSignedMoneyToCents(values[account.id] ?? '');
      } catch {
        setError(`Saldo inválido para ${account.name}.`);
        return;
      }
      if (!Number.isSafeInteger(balanceCents)) {
        setError(`Saldo inválido para ${account.name}.`);
        return;
      }
      balances.push({ accountId: account.id, balanceCents });
    }
    const logicalDate = logicalAsOf.slice(0, 10);
    if (!isCivilDate(logicalDate)) {
      setError('Informe uma data civil válida.');
      return;
    }
    confirm({ logicalDate, logicalAsOf: canonicalLogicalAsOf, balances });
  }

  return <div className="modal-bg"><section className="modal wide-modal">
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">RECONCILIAÇÃO ATÓMICA</span>
    <h2>Atualizar saldos em conjunto</h2>
    <p>Todos os saldos abaixo serão gravados no mesmo lote e no mesmo instante lógico.</p>
    <form onSubmit={submit}>
      <label>Instante lógico
        <input
          aria-label="Instante lógico da reconciliação"
          type="datetime-local"
          value={logicalAsOf}
          onChange={(event) => setLogicalAsOf(event.target.value)}
        />
      </label>
      {accounts.map((account) => <label key={account.id}>{account.name} · {currency}
        <input
          aria-label={`Saldo de ${account.name}`}
          inputMode="decimal"
          value={values[account.id] ?? ''}
          onChange={(event) => setValues((current) => ({
            ...current,
            [account.id]: event.target.value,
          }))}
          placeholder="0,00"
        />
      </label>)}
      {error && <div className="form-message error">{error}</div>}
      <footer>
        <button type="button" className="secondary" onClick={close}>Cancelar</button>
        <button type="submit">Confirmar reconciliação</button>
      </footer>
    </form>
  </section></div>;
}

function SyncConflictModal({ conflict, busy, message, exportLocal, keepLocal, useRemote }: {
  conflict: SyncConflict;
  busy: boolean;
  message: string;
  exportLocal: () => void;
  keepLocal: () => void;
  useRemote: () => void;
}) {
  const localTransactions = conflict.localState.transactions.length;
  const remoteTransactions = conflict.remote.state.transactions.length;
  const remoteUpdated = new Date(conflict.remote.updatedAt).toLocaleString('pt-IE');
  return <div className="modal-bg sync-conflict-bg"><section className="modal wide-modal sync-conflict-modal">
    <span className="eyebrow">CONFLITO DE SINCRONIZAÇÃO PROTEGIDO</span>
    <h2>Nenhuma versão foi sobrescrita.</h2>
    <p>{conflict.reason === 'startup' ? 'Este aparelho e a nuvem têm alterações diferentes.' : 'Outro aparelho alterou a nuvem antes deste salvamento.'} Escolha conscientemente qual versão continuará ativa. Um checkpoint local será criado antes de qualquer substituição.</p>
    <div className="conflict-grid">
      <article><small>ESTE APARELHO</small><strong>{localTransactions} transações</strong><span>{conflict.localState.imports.length} importações</span></article>
      <article><small>NUVEM · REVISÃO {conflict.remote.revision}</small><strong>{remoteTransactions} transações</strong><span>Atualizada em {remoteUpdated}</span></article>
    </div>
    {message && <div className="form-message error">{message}</div>}
    <div className="conflict-note"><CircleAlert size={18} /><span>O aplicativo não tenta mesclar transações automaticamente porque uma fusão errada seria só perda de dados usando gravata.</span></div>
    <footer className="conflict-actions">
      <button type="button" className="secondary" disabled={busy} onClick={exportLocal}><Download size={17} />Baixar backup local</button>
      <button type="button" className="secondary" disabled={busy} onClick={useRemote}>Usar versão da nuvem</button>
      <button type="button" disabled={busy} onClick={keepLocal}>{busy ? <RefreshCw className="spin" size={17} /> : null}Manter este aparelho</button>
    </footer>
  </section></div>;
}

function ImportPreview({ preview, includePossibleDuplicates, setIncludePossibleDuplicates, allowPartial, setAllowPartial, close, confirm }: {
  preview: Preview;
  includePossibleDuplicates: boolean;
  setIncludePossibleDuplicates: (value: boolean) => void;
  allowPartial: boolean;
  setAllowPartial: (value: boolean) => void;
  close: () => void;
  confirm: () => void;
}) {
  const technicallyIdentified = preview.newTransactions.filter((item) => item.technicalType !== 'unknown').length;
  const withoutCategory = preview.newTransactions.filter((item) => item.categoryReviewStatus === 'pending').length;
  const internalTransfers = preview.newTransactions.filter((item) => item.technicalType === 'internal_transfer' || item.technicalType === 'currency_conversion').length;
  const refunds = preview.newTransactions.filter((item) => item.technicalType === 'refund').length;
  return <div className="modal-bg"><section className="modal wide-modal"><button type="button" className="close" onClick={close}><X size={17} /></button><span className="eyebrow">PRÉVIA SEGURA</span><h2>{preview.batch.fileName}</h2><p>{preview.destinations && preview.destinations.length > 1 ? 'O arquivo será separado automaticamente por conta e moeda.' : <>Destino: <b>{preview.account.name}</b>.</>} Nenhuma linha é gravada antes da confirmação.</p>
    <div className="preview-explainer"><b>O que o app entendeu</b><p>Transferências internas e conversões ficam fora do fluxo. Transferências externas contam pela direção, e reembolsos reduzem as saídas. O que continuar ambíguo será perguntado depois, sem sumir discretamente num porão contábil.</p></div>
    {preview.destinations && <div className="preview-destinations">{preview.destinations.map((destination) => <article key={destination.account.id}><div><b>{destination.account.name}</b><small>{destination.account.institution === 'wise' ? 'Wise' : 'Revolut'} · {destination.currency}{destination.created ? ' · nova conta' : ''}</small></div><strong>{destination.transactionCount} movimentações</strong></article>)}</div>}
    <div className="preview-smart-grid"><div><b>{technicallyIdentified}</b><small>tipos identificados</small></div><div><b>{internalTransfers}</b><small>internas ou conversões</small></div><div><b>{refunds}</b><small>reembolsos</small></div><div><b>{withoutCategory}</b><small>para revisar em grupos</small></div></div>
    <div className="preview-grid"><div><b>{preview.newTransactions.length}</b><small>novas</small></div><div><b>{preview.updates.length}</b><small>atualizadas</small></div><div><b>{preview.confirmedDuplicateIds.length}</b><small>duplicatas certas</small></div><div><b>{preview.possibleDuplicates.length}</b><small>possíveis</small></div><div><b>{preview.issues.length}</b><small>pendências técnicas</small></div></div>
    {preview.currencies.map((item) => <div className={`reconciliation ${item.reconciliation}`} key={item.key}><b>{item.label}</b><span>Entradas {formatMoney(item.inflowCents, item.currency)}</span><span>Saídas {formatMoney(item.outflowCents, item.currency)}</span><span>{item.reconciliation === 'reconciled' ? 'Livro de saldo reconciliado' : item.reconciliation === 'mismatch' ? `Diferença ${formatMoney(item.reconciliationDifferenceCents ?? 0, item.currency)}` : 'Livro sem saldo suficiente para reconciliar'}</span></div>)}
    {preview.issues.length > 0 && <details open><summary>Linhas que exigem atenção</summary>{preview.issues.slice(0, 12).map((item) => <p key={item.id}>• {item.message}</p>)}</details>}
    {preview.possibleDuplicates.length > 0 && <label className="duplicate-choice"><input type="checkbox" checked={includePossibleDuplicates} onChange={(event) => setIncludePossibleDuplicates(event.target.checked)} /><span>Importar também as possíveis duplicatas. Elas continuarão marcadas para revisão.</span></label>}
    {preview.blockingIssueCount > 0 && <label className="duplicate-choice danger"><input type="checkbox" checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)} /><span>Confirmar importação parcial mesmo com {preview.blockingIssueCount} linha(s) rejeitada(s). Os problemas serão preservados na lista de pendências.</span></label>}
    <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={preview.blockingIssueCount > 0 && !allowPartial} onClick={confirm}>Confirmar importação</button></footer>
  </section></div>;
}

function ManualModal({ accounts, categories, close, add }: { accounts: Account[]; categories: AppState['categories']; close: () => void; add: (transaction: Transaction) => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(localCivilDate());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'inflow' | 'outflow'>('outflow');
  const [technicalType, setTechnicalType] = useState<TechnicalMovementType>('other_expense');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState('');
  const kind = kindForTechnicalType(technicalType);
  const technicalOptions = technicalTypesForDirection(direction);
  const categoryOptions = categories.filter((category) => isCategoryCompatible(category, { kind, direction, technicalType }));

  function changeDirection(nextDirection: 'inflow' | 'outflow') {
    setDirection(nextDirection);
    setCategoryId('');
    if (!isTechnicalTypeDirectionCompatible(technicalType, nextDirection)) {
      setTechnicalType(nextDirection === 'inflow' ? 'other_income' : 'other_expense');
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const account = accounts.find((item) => item.id === accountId);
      if (!account) throw new Error('Escolha uma conta');
      if (!isCivilDate(date)) throw new Error('Data inválida');
      const cleanDescription = description.trim();
      if (!cleanDescription) throw new Error('Informe uma descrição');
      const amountCents = parseSignedMoneyToCents(amount);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('O valor deve ser maior que zero');
      if (!isTechnicalTypeDirectionCompatible(technicalType, direction)) throw new Error('Tipo técnico incompatível com a direção');
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const reviewReasons = [
        ...(technicalType === 'unknown' ? ['unknown_kind' as const] : []),
      ];
      const analysisExcluded = technicalType === 'internal_transfer' || technicalType === 'currency_conversion';
      const categoryReviewStatus = categoryId
        ? 'resolved' as const
        : isCategoryReviewApplicable(technicalType)
          ? 'pending' as const
          : 'not_applicable' as const;
      add({
        id,
        accountId,
        dedupFingerprint: `manual:${id}`,
        amountCents,
        currency: account.currency,
        direction,
        source: 'manual',
        status: 'completed',
        kind,
        technicalType,
        kindSource: 'manual',
        transferGroupId: analysisExcluded ? `manual-confirmed:${id}` : undefined,
        analysisExcluded,
        descriptionOriginal: cleanDescription,
        merchantNormalized: normalizeMerchant(cleanDescription),
        reportingDate: date,
        completedAt: `${date}T12:00:00.000Z`,
        categoryId: categoryId || undefined,
        categorySource: categoryId ? 'manual' : 'none',
        categoryReviewStatus,
        needsReview: reviewReasons.length > 0,
        reviewReasons,
        manualEditLog: [],
        originalData: {},
        createdAt: now,
        updatedAt: now,
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Dados inválidos'); }
  }

  return <div className="modal-bg"><form className="modal" onSubmit={submit}><button type="button" className="close" onClick={close}><X size={17} /></button><span className="eyebrow">MOVIMENTAÇÃO MANUAL</span><h2>Registrar sem CSV</h2>
    <label>Conta<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    <div className="form-grid"><label>Data<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Valor<input required inputMode="decimal" placeholder="42,80" value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div>
    <label>Descrição<input required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
    <div className="form-grid"><label>Direção<select value={direction} onChange={(event) => changeDirection(event.target.value as 'inflow' | 'outflow')}><option value="outflow">Saída</option><option value="inflow">Entrada</option></select></label><label>Tipo técnico<select value={technicalType} onChange={(event) => { setTechnicalType(event.target.value as TechnicalMovementType); setCategoryId(''); }}>{technicalOptions.map((type) => <option key={type} value={type}>{technicalTypeLabel(type)}</option>)}</select></label></div>
    <label>Categoria opcional<select value={categoryId} disabled={!isCategoryReviewApplicable(technicalType)} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    {error && <div className="form-message error">{error}</div>}<footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit">Adicionar</button></footer>
  </form></div>;
}

function AccountModal({ accounts, referenceCounts, close, save, rename, archive, remove, merge }: {
  accounts: Account[];
  referenceCounts: Record<string, ReturnType<typeof countAccountReferences>>;
  close: () => void;
  save: (account: Account) => void;
  rename: (accountId: string, name: string) => void;
  archive: (accountId: string, archived: boolean) => void;
  remove: (accountId: string) => void;
  merge: (sourceId: string, targetId: string) => void;
}) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [institution, setInstitution] = useState<Account['institution']>('cash');
  const [product, setProduct] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [error, setError] = useState('');

  function protect(action: () => void) {
    try {
      action();
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir a ação.');
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    protect(() => {
      const account = createManualAccount({ name, currency, institution, product });
      save(account);
      setName('');
      setProduct('');
    });
  }

  const mergeSource = accounts.find((account) => account.id === mergeSourceId);
  const mergeTargets = accounts.filter((account) => account.id !== mergeSourceId && (!mergeSource || account.currency === mergeSource.currency));

  return <div className="modal-bg"><form className="modal account-manager-modal" onSubmit={submit}>
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">CONTAS E PRODUTOS</span><h2>Gerenciar livros bancários</h2>
    <p className="muted">Cada produto mantém saldo próprio. O consolidado da instituição continua disponível sem transformar Poupanças em conta corrente por pura conveniência administrativa.</p>
    <div className="account-manager-list">{accounts.map((account) => {
      const counts = referenceCounts[account.id];
      const totalReferences = counts ? Object.values(counts).reduce((total, count) => total + count, 0) : 0;
      const editing = editingId === account.id;
      return <article key={account.id} className={!account.active ? 'archived' : ''}>
        <div className="account-manager-main">
          {editing ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} /> : <b>{account.name}</b>}
          <small>{account.currency} · {account.institution === 'revolut' ? 'Revolut' : account.institution === 'wise' ? 'Wise' : account.institution}{account.product ? ` · ${account.product}` : ''} · {totalReferences} vínculos</small>
        </div>
        <div className="account-manager-actions">
          {editing ? <>
            <button type="button" onClick={() => protect(() => { rename(account.id, editingName); setEditingId(''); })}>Salvar</button>
            <button type="button" className="secondary" onClick={() => setEditingId('')}>Cancelar</button>
          </> : <button type="button" className="secondary" onClick={() => { setEditingId(account.id); setEditingName(account.name); }}>Renomear</button>}
          <button type="button" className="secondary" onClick={() => protect(() => archive(account.id, account.active))}>{account.active ? 'Arquivar' : 'Reativar'}</button>
          {totalReferences === 0 && <button type="button" className="danger" onClick={() => protect(() => remove(account.id))}>Excluir</button>}
        </div>
      </article>;
    })}</div>

    {accounts.length > 1 && <section className="account-merge-box">
      <h3>Mesclar conta criada incorretamente</h3>
      <p className="muted">Todos os movimentos, posições, importações e planejamentos serão transferidos para o destino. Só contas da mesma moeda aparecem como opção.</p>
      <div className="form-grid">
        <label>Conta de origem<select value={mergeSourceId} onChange={(event) => { setMergeSourceId(event.target.value); setMergeTargetId(''); }}><option value="">Escolha</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Conta de destino<select value={mergeTargetId} disabled={!mergeSourceId} onChange={(event) => setMergeTargetId(event.target.value)}><option value="">Escolha</option>{mergeTargets.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </div>
      <button type="button" className="secondary" disabled={!mergeSourceId || !mergeTargetId} onClick={() => protect(() => { merge(mergeSourceId, mergeTargetId); setMergeSourceId(''); setMergeTargetId(''); })}>Mesclar com prévia protegida por checkpoint</button>
    </section>}

    <h3>Adicionar outro livro</h3>
    <label>Nome<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Wise EUR Rende+" /></label>
    <div className="form-grid"><label>Moeda<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} /></label><label>Instituição<select value={institution} onChange={(event) => setInstitution(event.target.value as Account['institution'])}><option value="cash">Dinheiro físico</option><option value="other">Outra</option><option value="revolut">Revolut</option><option value="wise">Wise</option></select></label></div>
    <label>Produto opcional<input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Atual, Poupanças, Conta principal..." /></label>
    {error && <div className="form-message error">{error}</div>}
    <footer><button type="button" className="secondary" onClick={close}>Fechar</button><button type="submit">Criar conta</button></footer>
  </form></div>;
}
