import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  CalendarClock,
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
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Tags,
  Upload,
  WalletCards,
  WandSparkles,
  X,
} from 'lucide-react';
import { AuthScreen } from './auth/AuthScreen';
import { UpdatePassword } from './auth/UpdatePassword';
import { previewBankCsv, type Preview } from './core/csv';
import { financialDecisionFacade, type AssistantResult } from './application/FinancialDecisionFacade';
import { createReconciliationSnapshotBatch } from './application/reconciliation';
import { previewRevolutPdf } from './core/pdf';
import { formatReportingDate, localCivilDate, localDateTimeToInstant } from './core/date';
import { monthDateRange, monthKey, signedNetMovement } from './core/finance';
import { buildAnalytics, latestReconciledBalance } from './analytics/metrics';
import { buildPeriodComparison } from './analytics/comparison';
import { generateInsights } from './insights/engine';
import type { FinancialInsight } from './insights/types';
import { InsightCard } from './components/InsightCard';
import { MerchantLearningModal } from './components/MerchantLearningModal';
import { ReserveModal } from './components/ReserveModal';
import { PlannedEventModal } from './components/PlannedEventModal';
import { CategoryManagerModal } from './components/CategoryManagerModal';
import { ReviewGroupsPanel } from './components/ReviewGroupsPanel';
import { BulkRuleModal, type BulkRuleInput } from './components/BulkRuleModal';
import { createConfirmedBatch, getUndoImpact, restoreImport, undoImport } from './core/imports';
import { formatMoney, parseSignedMoneyToCents } from './core/money';
import { normalizeMerchant } from './core/merchant';
import { buildActivityTimeline } from './application/activityTimeline';
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
  ReviewGroup,
  ReviewReason,
  Transaction,
  TechnicalMovementType,
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

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventVersion += 1;
      if (disposed) return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      setSession(nextSession);
      setAuthReady(true);
    });

    const requestVersion = authEventVersion;
    supabase.auth.getSession().then(({ data }) => {
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
  const [importAccountId, setImportAccountId] = useState('revolut-eur');
  const [error, setError] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
  const [activeTab, setActiveTab] = useState<'home' | 'transactions' | 'discoveries' | 'assistant' | 'accounts' | 'review'>('home');
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
    const availableMonths = new Set(state.transactions
      .filter((transaction) => transaction.status !== 'voided' && transaction.status !== 'merged')
      .map((transaction) => monthKey(transaction.reportingDate)));
    if (month !== 'all' && !availableMonths.has(month)) setMonth('all');
    if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && !state.categories.some((item) => item.id === categoryFilter && item.active)) setCategoryFilter('all');
  }, [state, currency, importAccountId, assistantTargetAccountId, accountFilter, month, categoryFilter]);

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
    categoryId: categoryFilter,
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
  const homeInsights = insightResult.insights.slice(0, 3);
  const reconciledPosition = latestReconciledBalance(financeState, currency);
  const reservePolicy = financeState.reservePolicies.find((item) => item.currency === currency);
  const currencyAccounts = activeAccounts.filter((account) => account.currency === currency);
  const homeTargetAccount = currencyAccounts.find((account) => account.id === assistantTargetAccountId)
    ?? (currencyAccounts.length === 1 ? currencyAccounts[0] : undefined);
  const today = localCivilDate();
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
        : await previewBankCsv(await file.text(), file.name, financeState, importAccountId));
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
    setState((current) => current && withRebuiltReviewGroups({
      ...current,
      transactions: [...transactions, ...current.transactions],
      imports: [batch, ...current.imports],
      importIssues: [...issues, ...current.importIssues],
    }));
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
    const categoryId = rawCategoryId || undefined;
    const category = categoryId
      ? financeState.categories.find((item) => item.id === categoryId && item.active)
      : undefined;
    if (categoryId && (!category || !isCategoryCompatible(category, transaction))) {
      setError('Categoria inválida para o tipo técnico desta movimentação.');
      return;
    }
    createCheckpoint(userId, financeState, `Antes de classificar ${transaction.descriptionOriginal}`);
    const next = applyCategoryDecision({
      state: financeState,
      transactionIds: [transaction.id],
      categoryId,
      kind: 'apply_transaction_category',
      label: category ? `${transaction.descriptionOriginal} → ${category.name}` : `${transaction.descriptionOriginal} → sem categoria`,
    });
    setState(next);
    const updatedTransaction = next.transactions.find((item) => item.id === transaction.id);
    if (
      category
      && updatedTransaction
      && transaction.categoryId !== categoryId
      && transaction.source !== 'manual'
      && categoryId !== 'income'
      && transaction.merchantNormalized.trim()
    ) {
      setMerchantLearning({ transaction: updatedTransaction, category });
    }
  }

  function updateTechnicalType(transaction: Transaction, technicalType: TechnicalMovementType) {
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
    setState(withRebuiltReviewGroups({
      ...financeState,
      transactions: financeState.transactions.map((item) => item.id === transaction.id ? {
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
    }, editedAt));
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
  const filtersActive = Boolean(query || accountFilter !== 'all' || categoryFilter !== 'all' || month !== 'all'
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
        <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Todas as contas</option>{activeAccounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
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
        <button className="secondary" onClick={() => setBulkRuleOpen(true)} disabled={filtered.length === 0 || invalidFilters}><WandSparkles size={16} /> Criar regra com prévia</button>
        <button className="secondary" onClick={exportFilteredCsv} disabled={filtered.length === 0 || invalidFilters}><FileDown size={16} /> Exportar estes {filtered.length}</button>
        {filtersActive && <button className="secondary filter-reset" onClick={clearTransactionFilters}><X size={15} /> Limpar filtros</button>}
      </div>
      {latestActiveDecision?.kind === 'create_rule' && <div className="bulk-undo-banner"><span>{latestActiveDecision.label}</span><button className="link-button" onClick={undoReviewDecision}><RotateCcw size={14} /> Desfazer</button></div>}
    </section>}
    {items.length === 0 ? <div className="empty"><WalletCards size={32} /><p>{reviewMode ? 'Nenhuma movimentação precisa de revisão.' : filtersActive ? 'Nenhuma movimentação corresponde aos filtros atuais.' : 'Importe um extrato ou crie uma movimentação manual.'}</p></div> : <div className="tx-list">{items.map((transaction) => {
      const categoryOptions = financeState.categories.filter((category) => isCategoryCompatible(category, transaction));
      const technicalOptions = technicalTypesForDirection(transaction.direction);
      const reverted = transaction.status === 'reverted';
      const displayedMovement = reverted
        ? (transaction.reportedAmountCents ?? (transaction.direction === 'inflow' ? transaction.amountCents : -transaction.amountCents))
        : signedNetMovement(transaction);
      return <article className={`tx ${transaction.needsReview ? 'needs-review' : ''} ${reverted ? 'reverted' : ''}`} key={transaction.id}>
        <div className="tx-main"><b>{transaction.descriptionOriginal}</b><small>{formatReportingDate(transaction.reportingDate)} · {accountName(transaction.accountId)} · {technicalTypeLabel(transaction.technicalType)} · {reverted ? 'Revertida, sem efeito financeiro' : categoryName(transaction.categoryId)}</small>{transaction.reviewReasons.length > 0 && <span className="review-label">{transaction.reviewReasons.map(reviewReasonLabel).join(' · ')}</span>}</div>
        <div className="tx-controls"><select aria-label={`Tipo técnico de ${transaction.descriptionOriginal}`} value={transaction.technicalType} onChange={(event) => updateTechnicalType(transaction, event.target.value as TechnicalMovementType)} disabled={reverted}>{technicalOptions.map((type) => <option key={type} value={type}>{technicalTypeLabel(type)}</option>)}</select><select aria-label={`Categoria de ${transaction.descriptionOriginal}`} value={transaction.categoryId ?? ''} onChange={(event) => updateCategory(transaction, event.target.value)} disabled={reverted || !isCategoryReviewApplicable(transaction.technicalType)}><option value="">Sem categoria</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
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
      : !reconciledPosition
        ? { label: 'SALDO AINDA NÃO RECONCILIADO', title: 'Falta confirmar a posição atual', tone: 'neutral' }
        : homeLimit?.status === 'unsafe'
          ? { label: 'ATENÇÃO', title: 'Sua margem está apertada', tone: 'warning' }
          : { label: 'SITUAÇÃO ATUAL', title: 'Você está dentro do planejado', tone: 'positive' };
  const recentTransactions = visibleTransactions
    .filter((transaction) => transaction.status === 'completed'
      && transaction.currency === currency
      && transaction.reportingDate >= analytics.current.range.start
      && transaction.reportingDate <= analytics.current.range.end)
    .slice(0, 5);

  return (
    <main className="app-shell">
      <header className="app-topbar"><div className="mini-brand"><span>JF</span><b>Japa Finance</b></div><div className="topbar-actions"><select aria-label="Moeda" value={currency} onChange={(event) => { setCurrency(event.target.value); setAccountFilter('all'); setCategoryFilter('all'); }}>{currencies.map((item) => <option key={item}>{item}</option>)}</select><button className="avatar-button" onClick={() => supabase?.auth.signOut()} title="Sair">D</button></div></header>
      {error && <section className="error-banner"><FileWarning size={18} /><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></section>}

      {activeTab === 'home' && <section className="home-page-v2">
        <section className="home-hero decision-hero"><span className="eyebrow">{month === 'all' ? 'AGORA' : month}</span><h1>Como está seu<br />dinheiro hoje?</h1><p>Primeiro a decisão. Depois os números, porque gráficos sem contexto são só decoração cara.</p></section>

        <section className={`financial-status ${homeStatus.tone}`}>
          <div className="status-orb"><Sparkles size={22} /></div>
          <div><small>{homeStatus.label}</small><h2>{homeStatus.title}</h2><p>{periodCriticalPendingCount > 0 ? `${periodCriticalPendingCount} ${periodCriticalPendingCount === 1 ? 'item deste período precisa' : 'itens deste período precisam'} da sua ajuda.` : criticalPendingCount > 0 ? `${criticalPendingCount} ${criticalPendingCount === 1 ? 'item permanece' : 'itens permanecem'} pendente fora do intervalo exibido; o fluxo atual não depende deles.` : reconciledPosition ? `Posição reconciliada em ${new Date(reconciledPosition.logicalAsOf).toLocaleString('pt-IE')}.${pendingReviewGroupCount > 0 ? ` ${pendingReviewGroupCount} ${pendingReviewGroupCount === 1 ? 'grupo opcional pode' : 'grupos opcionais podem'} melhorar categorias e insights.` : ''}` : 'Atualize os saldos das contas para liberar limites e previsões confiáveis.'}</p></div>
          {criticalPendingCount > 0 ? <button className="link-button" onClick={() => setActiveTab('review')}>Revisar</button> : !reconciledPosition ? <button className="link-button" onClick={recordBalanceSnapshot}>Atualizar saldos</button> : pendingReviewGroupCount > 0 ? <button className="link-button" onClick={() => setActiveTab('review')}>Melhorar categorias</button> : null}
        </section>

        <section className="home-grid-v2">
          <article className="position-card">
            <small>SALDO RECONCILIADO</small>
            <strong>{reconciledPosition ? formatMoney(reconciledPosition.balanceCents, currency) : 'Ainda não informado'}</strong>
            <span><Cloud size={14} /> {syncLabel}</span>
          </article>
          <article className={`safe-limit-card ${homeLimit?.status ?? 'incomplete'}`}>
            <div><small>ATÉ A PRÓXIMA RECEITA</small><WalletCards size={20} /></div>
            {currencyAccounts.length > 1 && <select aria-label="Conta usada no limite seguro" value={homeTargetAccount?.id ?? ''} onChange={(event) => { setAssistantTargetAccountId(event.target.value); setAssistantAnswer(null); }}><option value="">Escolha uma conta</option>{currencyAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>}
            <strong>{homeLimit?.amountCents !== undefined ? formatMoney(Math.max(0, homeLimit.amountCents), currency) : 'Precisa de dados'}</strong>
            <p>{homeLimit?.status === 'safe' ? 'Valor projetado acima da reserva mínima.' : homeLimit?.status === 'unsafe' ? 'Não existe margem segura na projeção atual.' : homeLimit?.answer ?? 'Selecione uma conta e reconcilie os saldos.'}</p>
            <button className="link-button" onClick={() => { setAssistantQuestion('Quanto posso gastar até o pagamento?'); setActiveTab('assistant'); }}>Ver cálculo</button>
          </article>
        </section>

        <section className="panel flow-panel">
          <div className="panel-title"><div><small>FLUXO DO PERÍODO · {analysisPeriodLabel}</small><h2>Resultado do fluxo{periodCriticalPendingCount > 0 ? ' provisório' : ''}</h2></div><ChartNoAxesCombined size={22} /></div>
          <div className="flow-breakdown"><article><small>Entradas externas</small><b className="positive">{formatMoney(analytics.current.summary.incomeCents, currency)}</b></article><article><small>Saídas externas líquidas</small><b>{formatMoney(analytics.current.summary.netExpenseCents, currency)}</b></article><article><small>Resultado do fluxo</small><b className={analytics.current.summary.netCashflowCents >= 0 ? 'positive' : ''}>{formatMoney(analytics.current.summary.netCashflowCents, currency)}</b></article></div>
          <details className="calculation-details"><summary>Como chegamos neste número</summary><div className="calculation-grid"><span><small>Despesas brutas</small><b>{formatMoney(analytics.current.summary.expenseCents, currency)}</b></span><span><small>Reembolsos</small><b>{formatMoney(analytics.current.summary.refundCents, currency)}</b></span><span><small>Internas/conversões</small><b>{analytics.current.excludedTransferTransactionCount}</b></span><span><small>Sem categoria</small><b>{analytics.current.uncategorizedTransactionCount}</b></span></div><p>Este resultado cobre {analysisPeriodLabel}. Transferências internas e conversões ficam fora do fluxo; as comissões bancárias entram como despesas separadas. Transferências externas entram conforme a direção. Isso não é o saldo da conta: saldo é uma posição, fluxo é a soma dos movimentos do período.</p></details>
        </section>

        {nextPlannedEvent && <section className="next-event-card"><div className="event-icon"><CalendarClock size={21} /></div><div><small>PRÓXIMO COMPROMISSO</small><h3>{nextPlannedEvent.title}</h3><p>{nextEventDays === 0 ? 'Hoje' : nextEventDays === 1 ? 'Amanhã' : `Em ${nextEventDays} dias`} · {nextPlannedEvent.direction === 'outflow' ? 'saída' : 'entrada'}</p></div><strong>{nextPlannedEvent.direction === 'outflow' ? '-' : '+'}{formatMoney(nextPlannedEvent.amountCents, currency)}</strong></section>}

        <section className="home-insights">
          <div className="section-heading"><div><span className="eyebrow">DESCOBERTAS</span><h2>O que merece atenção</h2></div><button className="link-button" onClick={() => setActiveTab('discoveries')}>Ver todas</button></div>
          <div className="insight-stack">{homeInsights.map((insight) => <InsightCard key={insight.key} insight={insight} compact onAction={openInsightAction} />)}</div>
        </section>

        <section className="panel home-section"><div className="panel-title"><div><small>GASTOS POR CATEGORIA</small><h2>Para onde foi seu dinheiro?</h2></div><button className="link-button" onClick={() => setActiveTab('transactions')}>Explorar</button></div>{categoryRows.length ? categoryRows.map((item) => { const max = categoryRows[0]?.amountCents ?? 1; return <button className="cat cat-button" key={item.key} onClick={() => { setCategoryFilter(item.key); setActiveTab('transactions'); }}><div><span>{categoryName(item.key)}</span><b>{formatMoney(item.amountCents, currency)}</b></div><i><em style={{ width: `${Math.max(3, item.amountCents / max * 100)}%` }} /></i><small>{Math.round(item.share * 100)}% · {item.transactionCount} movimentos</small></button>; }) : <p className="muted">Ainda não há despesas classificadas neste período.</p>}</section>

        <section className="panel home-section"><div className="panel-title"><div><small>ÚLTIMAS ATIVIDADES</small><h2>Movimentações recentes</h2></div><button className="link-button" onClick={() => setActiveTab('transactions')}>Ver todas</button></div><div className="recent-list">{recentTransactions.map((transaction) => <article key={transaction.id}><div><b>{transaction.descriptionOriginal}</b><small>{formatReportingDate(transaction.reportingDate)} · {categoryName(transaction.categoryId)}</small></div><strong className={signedNetMovement(transaction) > 0 ? 'positive' : ''}>{signedNetMovement(transaction) < 0 ? '-' : '+'}{formatMoney(Math.abs(signedNetMovement(transaction)), transaction.currency)}</strong></article>)}</div></section>
      </section>}

      {activeTab === 'transactions' && renderTransactions()}

      {activeTab === 'discoveries' && <section className="discoveries-page">
        <span className="eyebrow">DESCOBERTAS</span>
        <h1>Seu dinheiro<br />devolvendo contexto.</h1>
        <p>O motor encontrou {insightResult.generatedCount} análises candidatas e selecionou {insightResult.eligibleCount} que passaram pelos critérios de relevância, confiança e repetição.</p>
        <div className="discoveries-summary"><article><Sparkles size={21} /><div><b>{insightResult.insights.length}</b><small>visíveis agora</small></div></article><article><ChartNoAxesCombined size={21} /><div><b>{analytics.current.expenseTransactionCount}</b><small>despesas analisadas</small></div></article><article><CalendarClock size={21} /><div><b>{analytics.current.observedDays}</b><small>dias observados</small></div></article></div>

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

        <div className="insight-stack discoveries-stack">{insightResult.insights.map((insight) => <InsightCard key={insight.key} insight={insight} onAction={openInsightAction} onUseful={(item) => updateInsightFeedback(item, { useful: true, lastShownAt: new Date().toISOString() })} onDismiss={(item) => updateInsightFeedback(item, { dismissedAt: new Date().toISOString() })} />)}</div>
      </section>}

      {activeTab === 'assistant' && <section className="assistant-page"><span className="eyebrow">ASSISTENTE DETERMINÍSTICO</span><h1>Converse com<br />seus números.</h1><p>Ele não inventa saldo nem usa IA para decidir. O motor responde a partir da reconciliação, do forecast e dos compromissos cadastrados.</p><label className="assistant-account-selector">Conta-alvo<select aria-label="Conta-alvo do assistente" value={assistantTargetAccountId} onChange={(event) => setAssistantTargetAccountId(event.target.value)}><option value="">Selecione uma conta</option>{activeAccounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><div className="prompt-grid">{['Onde foi meu dinheiro este mês?','Posso comprar uma TV de €600?','Quanto posso gastar até o pagamento?','Há cobranças duplicadas?'].map((prompt) => <button className="prompt-card" key={prompt} onClick={() => { setAssistantQuestion(prompt); askAssistant(prompt); }}>{prompt}</button>)}</div>{assistantAnswer && <div className={`assistant-answer ${assistantAnswer.status ?? ''}`}><b>JF</b><p>{assistantAnswer.answer}</p>{assistantAnswer.evidence.length > 0 && <ul>{assistantAnswer.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}<small>Confiança {assistantAnswer.confidence === 'high' ? 'alta' : assistantAnswer.confidence === 'medium' ? 'média' : 'baixa'} · escopo: {assistantAnswer.dataScope ?? 'estado financeiro'} · {currency}</small></div>}<div className="assistant-input"><input value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder="Pergunte sobre seu dinheiro" onKeyDown={(event) => event.key === 'Enter' && askAssistant()} /><button onClick={() => askAssistant()}><Send size={18} /></button></div></section>}

      {activeTab === 'accounts' && <section className="settings-page">
        <span className="eyebrow">MAIS</span><h1>Configurações<br />sem caça ao menu.</h1>
        <div className="import-card"><select value={importAccountId} onChange={(event) => setImportAccountId(event.target.value)}>{activeAccounts.filter((account) => account.institution === 'revolut' || account.institution === 'wise').map((account) => <option key={account.id} value={account.id}>Importar para {account.name}</option>)}</select><button onClick={() => input.current?.click()}><Upload size={18} /> Importar extrato</button><small>CSV Revolut/Wise ou PDF Revolut digital. A prévia explica o que foi reconhecido antes de gravar.</small></div>
        <div className="settings-actions"><button className="secondary" onClick={() => setManualOpen(true)}><Plus size={18} /> Nova movimentação</button><button className="secondary" onClick={() => setCategoryOpen(true)}><Tags size={18} /> Categorias e comerciantes</button><button className="secondary" onClick={recordBalanceSnapshot}><WalletCards size={18} /> Atualizar saldos</button><button className="secondary" onClick={() => setReserveOpen(true)}><Sparkles size={18} /> Reserva mínima</button><button className="secondary" onClick={() => setPlannedEventOpen(true)}><CalendarClock size={18} /> Planejar compromisso</button><button className="secondary" onClick={() => setActiveTab('review')}><TriangleAlert size={18} /> Revisar pendências {pendingCount > 0 ? `(${pendingCount})` : ''}</button><button className="secondary" onClick={() => setAccountOpen(true)}><Landmark size={18} /> Gerenciar contas</button><button className="secondary" onClick={() => exportState(financeState)}><Download size={18} /> Baixar backup</button><button className="secondary" onClick={() => backupInput.current?.click()}><RotateCcw size={18} /> Restaurar backup</button></div>
        <section className="panel imports"><div className="panel-title"><h3>Importações recentes</h3><Settings size={18} /></div>{financeState.imports.length ? financeState.imports.slice(0, 10).map((batch) => <div className={batch.status === 'undone' ? 'undone' : ''} key={batch.id}><div><b>{batch.fileName}</b><small>{accountName(batch.accountId)} · {batch.imported} importadas · {batch.rejected} rejeitadas</small></div><button title={batch.status === 'undone' ? 'Restaurar lote' : 'Anular lote'} onClick={() => toggleImport(batch.id)}><RotateCcw size={15} /></button></div>) : <p className="muted">Nenhum extrato importado ainda.</p>}</section>
        <section className="panel activity-panel"><div className="panel-title"><div><small>RASTREABILIDADE</small><h2>Linha do tempo de alterações</h2></div><History size={20} /></div>{activityTimeline.length ? <div className="activity-list">{activityTimeline.map((item) => <article className={item.undone ? 'undone' : ''} key={item.id}><i /><div><b>{item.title}</b><small>{item.detail}</small><time>{new Date(item.occurredAt).toLocaleString('pt-BR')}</time></div></article>)}</div> : <p className="muted">As próximas importações, reconciliações, classificações e planejamentos aparecerão aqui.</p>}</section>
      </section>}

      {activeTab === 'review' && <section className="review-page"><span className="eyebrow">REVISAR</span><h1>Resolva em grupos.<br />Controle as exceções.</h1><div className="review-history-bar"><span>{financeState.reviewDecisions.filter((item) => !item.undoneAt).length} decisões ativas</span><button className="secondary" disabled={!financeState.reviewDecisions.some((item) => !item.undoneAt)} onClick={undoReviewDecision}><RotateCcw size={16} /> Desfazer última decisão</button></div>{recentReviewDecisions.length > 0 && <details className="review-decision-history"><summary>Histórico recente</summary><div>{recentReviewDecisions.map((decision) => <article className={decision.undoneAt ? 'undone' : ''} key={decision.id}><div><b>{decision.label}</b><small>{new Date(decision.createdAt).toLocaleString('pt-BR')} · {decision.transactionIds.length} movimentações</small></div><span>{decision.undoneAt ? 'desfeita' : 'ativa'}</span></article>)}</div></details>}{unresolvedIssues.length === 0 && reviewTransactions.length === 0 && eventsNeedingAccountReview.length === 0 && currencyReviewGroups.length === 0 ? <section className="panel empty"><CircleAlert size={32} /><p>Nenhuma pendência aberta.</p></section> : <>
        <ReviewGroupsPanel groups={currencyReviewGroups} transactions={visibleTransactions} categories={financeState.categories} apply={applyReviewGroup} resolveWithoutCategory={resolveReviewGroupWithoutCategory} defer={postponeReviewGroup} reopen={reactivateReviewGroup} applyOne={applyReviewException} />
        {eventsNeedingAccountReview.length > 0 && <section className="panel issues"><h3>Eventos sem conta</h3><p>Escolha a conta para reativá-los no forecast.</p>{eventsNeedingAccountReview.map((item) => <article key={item.id}><b>{item.title}</b><p>{item.dueDate} · {formatMoney(item.amountCents, item.currency)}</p><label>Conta<select aria-label={`Conta para ${item.title}`} defaultValue="" onChange={(event) => event.target.value && resolvePlannedEventAccount(item.id, event.target.value)}><option value="">Selecionar conta</option>{activeAccounts.filter((account) => account.currency === item.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></article>)}</section>}
        {unresolvedIssues.length > 0 && <section className="panel issues"><h3>Pendências de importação</h3>{unresolvedIssues.map((item) => <article key={item.id}><b>{item.kind.replaceAll('_', ' ')}</b><p>{item.message}</p><small>{accountName(item.accountId)}{item.rowNumber ? ` · linha ${item.rowNumber}` : ''}</small><button onClick={() => dismissIssue(item)}>Marcar como revisada</button></article>)}</section>}
        {reviewTransactions.length > 0 && renderTransactions(reviewTransactions.filter((item) => item.currency === currency), true)}
      </>}</section>}

      <input ref={input} hidden type="file" accept=".csv,.pdf,text/csv,application/pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && onFile(event.target.files[0])} />
      <input ref={backupInput} hidden type="file" accept=".json,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files?.[0] && restoreBackup(event.target.files[0])} />
      <nav className="bottom-nav"><button className={activeTab === 'home' ? 'active' : ''} onClick={() => setActiveTab('home')}><Home size={20} /><span>Início</span></button><button className={activeTab === 'transactions' ? 'active' : ''} onClick={() => setActiveTab('transactions')}><List size={20} /><span>Movimentos</span></button><button className={activeTab === 'discoveries' ? 'active' : ''} onClick={() => setActiveTab('discoveries')}><Lightbulb size={20} /><span>Descobertas</span></button><button className={activeTab === 'assistant' ? 'active' : ''} onClick={() => setActiveTab('assistant')}><MessageSquare size={20} /><span>Assistente</span></button><button className={activeTab === 'accounts' || activeTab === 'review' ? 'active' : ''} onClick={() => setActiveTab('accounts')}><Settings size={20} /><span>Mais</span></button></nav>

      {syncConflict && <SyncConflictModal conflict={syncConflict} busy={conflictBusy} message={error} exportLocal={() => exportState(syncConflict.localState)} keepLocal={keepLocalConflictVersion} useRemote={useRemoteConflictVersion} />}
      {preview && <ImportPreview preview={preview} includePossibleDuplicates={includePossibleDuplicates} setIncludePossibleDuplicates={setIncludePossibleDuplicates} allowPartial={allowPartial} setAllowPartial={setAllowPartial} close={() => setPreview(null)} confirm={confirmImport} />}
      {manualOpen && <ManualModal accounts={activeAccounts} categories={financeState.categories} close={() => setManualOpen(false)} add={(transaction) => { createCheckpoint(userId, financeState, 'Antes de transação manual'); setState(withRebuiltReviewGroups({ ...financeState, transactions: [transaction, ...financeState.transactions] })); setManualOpen(false); }} />}
      {accountOpen && <AccountModal accounts={financeState.accounts} close={() => setAccountOpen(false)} save={(account) => { setState({ ...financeState, accounts: [...financeState.accounts, account] }); setAccountOpen(false); }} />}
      {reconciliationOpen && <ReconciliationModal accounts={activeAccounts.filter((account) => account.currency === currency)} currency={currency} close={() => setReconciliationOpen(false)} confirm={confirmReconciliation} />}
      {reserveOpen && <ReserveModal currency={currency} policy={reservePolicy} close={() => setReserveOpen(false)} save={(policy) => { setState({ ...financeState, reservePolicies: [...financeState.reservePolicies.filter((item) => item.currency !== currency), policy] }); setReserveOpen(false); }} />}
      {plannedEventOpen && <PlannedEventModal accounts={activeAccounts} currency={currency} close={() => setPlannedEventOpen(false)} save={(plannedEvent) => { setState({ ...financeState, plannedEvents: [...financeState.plannedEvents, plannedEvent] }); setPlannedEventOpen(false); }} />}
      {categoryOpen && <CategoryManagerModal categories={financeState.categories} rules={financeState.rules} transactionCountByCategory={transactionCountByCategory} close={() => setCategoryOpen(false)} create={createCategory} rename={renameCategory} archive={archiveCategory} restore={restoreCategory} removeRule={removeCategoryRule} />}
      {merchantLearning && <MerchantLearningModal transaction={merchantLearning.transaction} category={merchantLearning.category} close={() => setMerchantLearning(null)} remember={rememberMerchantRule} />}
      {bulkRuleOpen && <BulkRuleModal candidates={filtered} categories={financeState.categories} currency={currency} close={() => setBulkRuleOpen(false)} apply={applyBulkRule} />}
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
    <button className="close" onClick={close}><X size={17} /></button>
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
      <button className="secondary" disabled={busy} onClick={exportLocal}><Download size={17} />Baixar backup local</button>
      <button className="secondary" disabled={busy} onClick={useRemote}>Usar versão da nuvem</button>
      <button disabled={busy} onClick={keepLocal}>{busy ? <RefreshCw className="spin" size={17} /> : null}Manter este aparelho</button>
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
  return <div className="modal-bg"><section className="modal wide-modal"><button className="close" onClick={close}><X size={17} /></button><span className="eyebrow">PRÉVIA SEGURA</span><h2>{preview.batch.fileName}</h2><p>Destino: <b>{preview.account.name}</b>. Nenhuma linha é gravada antes da confirmação.</p>
    <div className="preview-explainer"><b>O que o app entendeu</b><p>Transferências internas e conversões ficam fora do fluxo. Transferências externas contam pela direção, e reembolsos reduzem as saídas. O que continuar ambíguo será perguntado depois, sem sumir discretamente num porão contábil.</p></div>
    <div className="preview-smart-grid"><div><b>{technicallyIdentified}</b><small>tipos identificados</small></div><div><b>{internalTransfers}</b><small>internas ou conversões</small></div><div><b>{refunds}</b><small>reembolsos</small></div><div><b>{withoutCategory}</b><small>para revisar em grupos</small></div></div>
    <div className="preview-grid"><div><b>{preview.newTransactions.length}</b><small>novas</small></div><div><b>{preview.confirmedDuplicateIds.length}</b><small>duplicatas certas</small></div><div><b>{preview.possibleDuplicates.length}</b><small>possíveis</small></div><div><b>{preview.issues.length}</b><small>pendências técnicas</small></div></div>
    {preview.currencies.map((item) => <div className={`reconciliation ${item.reconciliation}`} key={item.key}><b>{item.label}</b><span>Entradas {formatMoney(item.inflowCents, item.currency)}</span><span>Saídas {formatMoney(item.outflowCents, item.currency)}</span><span>{item.reconciliation === 'reconciled' ? 'Livro de saldo reconciliado' : item.reconciliation === 'mismatch' ? `Diferença ${formatMoney(item.reconciliationDifferenceCents ?? 0, item.currency)}` : 'Livro sem saldo suficiente para reconciliar'}</span></div>)}
    {preview.issues.length > 0 && <details open><summary>Linhas que exigem atenção</summary>{preview.issues.slice(0, 12).map((item) => <p key={item.id}>• {item.message}</p>)}</details>}
    {preview.possibleDuplicates.length > 0 && <label className="duplicate-choice"><input type="checkbox" checked={includePossibleDuplicates} onChange={(event) => setIncludePossibleDuplicates(event.target.checked)} /><span>Importar também as possíveis duplicatas. Elas continuarão marcadas para revisão.</span></label>}
    {preview.blockingIssueCount > 0 && <label className="duplicate-choice danger"><input type="checkbox" checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)} /><span>Confirmar importação parcial mesmo com {preview.blockingIssueCount} linha(s) rejeitada(s). Os problemas serão preservados na lista de pendências.</span></label>}
    <footer><button className="secondary" onClick={close}>Cancelar</button><button disabled={preview.blockingIssueCount > 0 && !allowPartial} onClick={confirm}>Confirmar importação</button></footer>
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
    {error && <div className="form-message error">{error}</div>}<footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button>Adicionar</button></footer>
  </form></div>;
}

function AccountModal({ accounts, close, save }: { accounts: Account[]; close: () => void; save: (account: Account) => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [institution, setInstitution] = useState<Account['institution']>('cash');
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanCurrency = currency.trim().toUpperCase();
    if (!cleanName) {
      setError('Informe um nome para a conta.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(cleanCurrency)) {
      setError('A moeda deve ter três letras, como EUR ou BRL.');
      return;
    }
    const id = `${institution}-${cleanCurrency.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}`;
    save({ id, name: cleanName, currency: cleanCurrency, institution, active: true });
  }
  return <div className="modal-bg"><form className="modal" onSubmit={submit}><button type="button" className="close" onClick={close}><X size={17} /></button><span className="eyebrow">CONTAS</span><h2>Adicionar conta</h2><p className="muted">Atuais: {accounts.map((account) => account.name).join(', ')}</p>
    <label>Nome<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Dinheiro EUR" /></label><div className="form-grid"><label>Moeda<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} /></label><label>Instituição<select value={institution} onChange={(event) => setInstitution(event.target.value as Account['institution'])}><option value="cash">Dinheiro físico</option><option value="other">Outra</option><option value="revolut">Revolut</option><option value="wise">Wise</option></select></label></div>{error && <div className="form-message error">{error}</div>}<footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button>Criar conta</button></footer>
  </form></div>;
}

