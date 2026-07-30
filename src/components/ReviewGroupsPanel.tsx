import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Clock3, RotateCcw, WandSparkles } from 'lucide-react';
import { formatReportingDate } from '../core/date';
import { formatMoney } from '../core/money';
import { signedNetMovement } from '../core/finance';
import type { Category, ReviewGroup, Transaction } from '../core/types';
import { isCategoryCompatible } from '../classification/categoryCompatibility';
import { technicalTypeLabel } from '../classification/technicalClassifier';

function confidenceLabel(value: ReviewGroup['suggestionConfidence']) {
  if (value === 'high') return 'confiança alta';
  if (value === 'medium') return 'confiança média';
  if (value === 'low') return 'confiança baixa';
  return 'sem sugestão';
}

function ReviewGroupCard({
  group,
  transactions,
  categories,
  apply,
  resolveWithoutCategory,
  defer,
  reopen,
  applyOne,
}: {
  group: ReviewGroup;
  transactions: Transaction[];
  categories: Category[];
  apply: (group: ReviewGroup, transactionIds: string[], categoryId: string, createRule: boolean) => void;
  resolveWithoutCategory: (group: ReviewGroup, transactionIds: string[]) => void;
  defer: (group: ReviewGroup) => void;
  reopen: (group: ReviewGroup) => void;
  applyOne: (group: ReviewGroup, transaction: Transaction, categoryId: string) => void;
}) {
  const options = categories.filter((category) => isCategoryCompatible(category, group));
  const [categoryId, setCategoryId] = useState(group.suggestedCategoryId ?? '');
  const [selectedIds, setSelectedIds] = useState(() => new Set(group.transactionIds));
  const [createRule, setCreateRule] = useState(true);
  const transactionSignature = group.transactionIds.join('|');

  useEffect(() => {
    setSelectedIds(new Set(group.transactionIds));
    setCategoryId(group.suggestedCategoryId ?? '');
  }, [group.key, transactionSignature, group.suggestedCategoryId]);

  const selectedCount = selectedIds.size;
  const exceptions = group.transactionIds.length - selectedCount;

  function toggle(transactionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });
  }

  return <article className={`review-group-card ${group.status}`}>
    <header>
      <div><span className="review-group-kicker">{group.transactionIds.length} movimentações · {group.currency}</span><h3>{group.merchantLabel}</h3><small>{technicalTypeLabel(group.technicalType)} · {group.direction === 'inflow' ? 'entrada' : 'saída'}</small></div>
      {group.status === 'deferred' && <span className="deferred-badge"><Clock3 size={14} /> Depois</span>}
    </header>

    {group.suggestedCategoryId && <section className={`classification-suggestion ${group.suggestionConfidence ?? 'low'}`}>
      <WandSparkles size={18} />
      <div><b>Sugestão: {categories.find((item) => item.id === group.suggestedCategoryId)?.name ?? group.suggestedCategoryId}</b><small>{confidenceLabel(group.suggestionConfidence)}{group.suggestionScore ? ` · ${group.suggestionScore}%` : ''}</small><p>{group.suggestionExplanation}</p>{group.suggestionEvidence.length > 0 && <span>{group.suggestionEvidence.join(' · ')}</span>}</div>
    </section>}

    <details className="group-transactions" open={group.transactionIds.length <= 4}>
      <summary><ChevronDown size={16} /> Ver movimentações e exceções</summary>
      {transactions.map((transaction) => <div className="group-transaction" key={transaction.id}>
        <label className="group-transaction-check"><input type="checkbox" checked={selectedIds.has(transaction.id)} onChange={() => toggle(transaction.id)} /><span><b>{transaction.descriptionOriginal}</b><small>{formatReportingDate(transaction.reportingDate)}</small></span></label>
        <strong>{formatMoney(Math.abs(signedNetMovement(transaction)), transaction.currency)}</strong>
        <select aria-label={`Categoria individual de ${transaction.descriptionOriginal}`} value="" onChange={(event) => event.target.value && applyOne(group, transaction, event.target.value)}><option value="">Exceção individual…</option>{options.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
      </div>)}
    </details>

    {group.status === 'pending' ? <footer>
      <label className="group-category-select">Categoria<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Escolher categoria</option>{options.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="remember-rule"><input type="checkbox" checked={createRule} onChange={(event) => setCreateRule(event.target.checked)} /><span>Criar regra para próximas movimentações</span></label>
      {exceptions > 0 && <small className="exception-count">{exceptions} {exceptions === 1 ? 'exceção ficará' : 'exceções ficarão'} sem alteração.</small>}
      <div className="review-group-actions"><button className="secondary" onClick={() => defer(group)}><Clock3 size={16} /> Resolver depois</button><button className="secondary" disabled={selectedCount === 0} onClick={() => resolveWithoutCategory(group, [...selectedIds])}><Check size={16} /> Manter sem categoria</button><button disabled={!categoryId || selectedCount === 0} onClick={() => apply(group, [...selectedIds], categoryId, createRule)}><Check size={16} /> Aplicar a {selectedCount}</button></div>
    </footer> : <footer><button className="secondary" onClick={() => reopen(group)}><RotateCcw size={16} /> Voltar para revisão</button></footer>}
  </article>;
}

export function ReviewGroupsPanel({
  groups,
  transactions,
  categories,
  apply,
  resolveWithoutCategory,
  defer,
  reopen,
  applyOne,
}: {
  groups: ReviewGroup[];
  transactions: Transaction[];
  categories: Category[];
  apply: (group: ReviewGroup, transactionIds: string[], categoryId: string, createRule: boolean) => void;
  resolveWithoutCategory: (group: ReviewGroup, transactionIds: string[]) => void;
  defer: (group: ReviewGroup) => void;
  reopen: (group: ReviewGroup) => void;
  applyOne: (group: ReviewGroup, transaction: Transaction, categoryId: string) => void;
}) {
  const transactionById = useMemo(() => new Map(transactions.map((item) => [item.id, item])), [transactions]);
  const pending = groups.filter((group) => group.status === 'pending');
  const deferred = groups.filter((group) => group.status === 'deferred');
  const pendingTransactions = pending.reduce((sum, group) => sum + group.transactionIds.length, 0);
  if (!groups.length) return null;

  return <section className="review-groups-section">
    <div className="panel-title"><div><h2>Revisão por grupos</h2><small>{pending.length} decisões podem resolver {pendingTransactions} movimentações. Porque clicar 300 vezes seria um crime contra os polegares.</small></div><span>{pending.length}</span></div>
    <div className="review-groups-list">{pending.map((group) => <ReviewGroupCard key={group.id} group={group} transactions={group.transactionIds.map((id) => transactionById.get(id)).filter((item): item is Transaction => Boolean(item))} categories={categories} apply={apply} resolveWithoutCategory={resolveWithoutCategory} defer={defer} reopen={reopen} applyOne={applyOne} />)}</div>
    {deferred.length > 0 && <details className="deferred-groups"><summary>{deferred.length} para resolver depois</summary><div className="review-groups-list">{deferred.map((group) => <ReviewGroupCard key={group.id} group={group} transactions={group.transactionIds.map((id) => transactionById.get(id)).filter((item): item is Transaction => Boolean(item))} categories={categories} apply={apply} resolveWithoutCategory={resolveWithoutCategory} defer={defer} reopen={reopen} applyOne={applyOne} />)}</div></details>}
  </section>;
}
