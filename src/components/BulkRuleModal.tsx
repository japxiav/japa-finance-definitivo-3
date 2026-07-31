import { useEffect, useMemo, useState } from 'react';
import { Tags, X } from 'lucide-react';
import type { Category, Direction, RuleKind, TechnicalMovementType, Transaction } from '../core/types';
import { normalizeMerchant } from '../core/merchant';
import { signedNetMovement } from '../core/finance';
import { formatMoney } from '../core/money';
import { isCategoryCompatible } from '../classification/categoryCompatibility';
import { technicalTypeLabel } from '../classification/technicalClassifier';

export interface BulkRuleInput {
  pattern: string;
  kind: RuleKind;
  categoryId: string;
  transactionIds: string[];
  exceptionTransactionIds: string[];
  direction?: Direction;
  technicalType?: TechnicalMovementType;
}

function matches(value: string, pattern: string, kind: RuleKind): boolean {
  const merchant = normalizeMerchant(value);
  const normalizedPattern = normalizeMerchant(pattern);
  if (!normalizedPattern) return false;
  if (kind === 'exact') return merchant === normalizedPattern;
  if (kind === 'starts_with') return merchant.startsWith(normalizedPattern);
  return merchant.includes(normalizedPattern);
}

export function BulkRuleModal({
  candidates,
  categories,
  currency,
  close,
  apply,
}: {
  candidates: Transaction[];
  categories: Category[];
  currency: string;
  close: () => void;
  apply: (input: BulkRuleInput) => void;
}) {
  const [pattern, setPattern] = useState('');
  const [kind, setKind] = useState<RuleKind>('contains');
  const [categoryId, setCategoryId] = useState('');
  const [direction, setDirection] = useState<'all' | Direction>('all');
  const [technicalType, setTechnicalType] = useState<'all' | TechnicalMovementType>('all');
  const [exceptionIds, setExceptionIds] = useState<string[]>([]);
  const category = categories.find((item) => item.id === categoryId && item.active);

  useEffect(() => { setExceptionIds([]); }, [pattern, kind, categoryId, direction, technicalType]);

  const technicalTypes = useMemo(() => [...new Set(candidates
    .filter((transaction) => direction === 'all' || transaction.direction === direction)
    .map((transaction) => transaction.technicalType))].sort(), [candidates, direction]);

  const preview = useMemo(() => {
    if (!category || !pattern.trim()) return [];
    return candidates.filter((transaction) =>
      transaction.status === 'completed'
      && transaction.currency === currency
      && transaction.categorySource !== 'manual'
      && transaction.categoryId !== category.id
      && (direction === 'all' || transaction.direction === direction)
      && (technicalType === 'all' || transaction.technicalType === technicalType)
      && matches(transaction.descriptionOriginal, pattern, kind)
      && isCategoryCompatible(category, transaction));
  }, [candidates, category, currency, direction, kind, pattern, technicalType]);

  const selectedPreview = preview.filter((transaction) => !exceptionIds.includes(transaction.id));
  const totalCents = selectedPreview.reduce((total, transaction) => total + Math.abs(signedNetMovement(transaction)), 0);
  const toggleException = (transactionId: string) => setExceptionIds((current) => current.includes(transactionId)
    ? current.filter((id) => id !== transactionId)
    : [...current, transactionId]);

  return <div className="modal-bg">
    <section className="modal wide-modal bulk-rule-modal">
      <button className="close" onClick={close} aria-label="Fechar"><X size={18} /></button>
      <div className="modal-illustration"><Tags size={23} /></div>
      <span className="eyebrow">REGRA EM MASSA</span>
      <h2>Classifique padrões com prévia.</h2>
      <p>A prévia respeita os filtros atuais. Escolhas manuais ficam intactas e a aplicação pode ser desfeita pelo histórico.</p>

      <div className="form-grid bulk-rule-grid">
        <label>Padrão
          <input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="Ex.: tesco" autoFocus />
        </label>
        <label>Correspondência
          <select value={kind} onChange={(event) => setKind(event.target.value as RuleKind)}>
            <option value="contains">Contém</option>
            <option value="starts_with">Começa com</option>
            <option value="exact">É exatamente</option>
          </select>
        </label>
        <label>Categoria
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Escolha uma categoria</option>
            {categories.filter((item) => item.active && item.type !== 'system').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>Direção
          <select value={direction} onChange={(event) => { setDirection(event.target.value as 'all' | Direction); setTechnicalType('all'); }}>
            <option value="all">Entradas e saídas compatíveis</option>
            <option value="outflow">Somente saídas</option>
            <option value="inflow">Somente entradas</option>
          </select>
        </label>
        <label>Tipo técnico
          <select value={technicalType} onChange={(event) => setTechnicalType(event.target.value as 'all' | TechnicalMovementType)}>
            <option value="all">Todos os tipos compatíveis</option>
            {technicalTypes.map((type) => <option key={type} value={type}>{technicalTypeLabel(type)}</option>)}
          </select>
        </label>
      </div>

      <section className="bulk-preview-summary">
        <article><small>SELECIONADAS</small><b>{selectedPreview.length} de {preview.length}</b></article>
        <article><small>VALOR ANALISADO</small><b>{formatMoney(totalCents, currency)}</b></article>
        <article><small>ESCOLHAS MANUAIS</small><b>preservadas</b></article>
      </section>

      {preview.length > 0 && <div className="bulk-selection-actions"><button className="link-button" onClick={() => setExceptionIds([])}>Selecionar todas</button><button className="link-button" onClick={() => setExceptionIds(preview.map((transaction) => transaction.id))}>Limpar seleção</button></div>}
      <div className="bulk-preview-list">
        {preview.map((transaction) => <label className="bulk-preview-row" key={transaction.id}>
          <input type="checkbox" checked={!exceptionIds.includes(transaction.id)} onChange={() => toggleException(transaction.id)} />
          <div><b>{transaction.descriptionOriginal}</b><small>{transaction.reportingDate} · {technicalTypeLabel(transaction.technicalType)}</small></div>
          <strong>{formatMoney(Math.abs(signedNetMovement(transaction)), currency)}</strong>
        </label>)}
        {pattern.trim() && preview.length === 0 && <p className="muted">Nenhuma movimentação compatível nos filtros atuais.</p>}
      </div>

      <footer>
        <button className="secondary" onClick={close}>Cancelar</button>
        <button disabled={!category || selectedPreview.length === 0} onClick={() => category && apply({
          pattern,
          kind,
          categoryId: category.id,
          transactionIds: selectedPreview.map((transaction) => transaction.id),
          exceptionTransactionIds: preview.filter((transaction) => exceptionIds.includes(transaction.id)).map((transaction) => transaction.id),
          direction: direction === 'all' ? undefined : direction,
          technicalType: technicalType === 'all' ? undefined : technicalType,
        })}>Aplicar regra a {selectedPreview.length}</button>
      </footer>
    </section>
  </div>;
}
