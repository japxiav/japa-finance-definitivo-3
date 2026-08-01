import { useState } from 'react';
import { Check, ChevronDown, Repeat2 } from 'lucide-react';
import { formatMoney } from '../core/money';
import type { Category, TransferPurpose } from '../core/types';
import type { TransferRecurrenceSuggestion } from '../application/transferRecurrence';

const PURPOSE_OPTIONS: Array<{ value: TransferPurpose; label: string }> = [
  { value: 'subscription', label: 'Assinaturas' },
  { value: 'housing', label: 'Moradia' },
  { value: 'family', label: 'Família' },
  { value: 'support', label: 'Pensão ou ajuda' },
  { value: 'debt', label: 'Dívida' },
  { value: 'groceries', label: 'Mercado' },
  { value: 'leisure', label: 'Lazer' },
  { value: 'reimbursement', label: 'Reembolso' },
  { value: 'other', label: 'Outra finalidade' },
];

function frequencyLabel(value: TransferRecurrenceSuggestion['frequency']) {
  if (value === 'monthly') return 'mensal';
  if (value === 'weekly') return 'semanal';
  if (value === 'yearly') return 'anual';
  return 'recorrência irregular';
}

function RecurrenceCard({
  suggestion,
  categories,
  apply,
}: {
  suggestion: TransferRecurrenceSuggestion;
  categories: Category[];
  apply: (suggestion: TransferRecurrenceSuggestion, input: {
    label: string;
    purpose?: TransferPurpose;
    categoryId?: string;
    relatedPerson?: string;
  }) => void;
}) {
  const [purpose, setPurpose] = useState<TransferPurpose | ''>(suggestion.suggestedPurpose ?? '');
  const [categoryId, setCategoryId] = useState(suggestion.suggestedCategoryId ?? '');
  const [label, setLabel] = useState(suggestion.suggestedLabel ?? suggestion.recipientLabel);
  const [relatedPerson, setRelatedPerson] = useState(suggestion.suggestedRelatedPerson ?? suggestion.recipientLabel);

  return <article className="recurrence-card">
    <header><div><span className={`match-confidence ${suggestion.confidence}`}>{suggestion.confidence === 'high' ? 'Confiança alta' : 'Confirmar padrão'}</span><h3>{suggestion.recipientLabel}</h3><small>{suggestion.transactionIds.length} para classificar · {suggestion.observedCount} observadas · {frequencyLabel(suggestion.frequency)}</small></div><Repeat2 size={22} /></header>
    <div className="recurrence-range"><span><small>Faixa observada</small><b>{formatMoney(suggestion.minAmountCents, suggestion.currency)} a {formatMoney(suggestion.maxAmountCents, suggestion.currency)}</b></span><span><small>Valor típico</small><b>{formatMoney(suggestion.medianAmountCents, suggestion.currency)}</b></span></div>
    <details><summary><ChevronDown size={16} /> Por que parece recorrente</summary><ul>{suggestion.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>
    <div className="recurrence-form-grid">
      <label>Nome do grupo<input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <label>Finalidade<select value={purpose} onChange={(event) => setPurpose(event.target.value as TransferPurpose | '')}><option value="">Sem finalidade</option>{PURPOSE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Categoria<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria específica</option>{categories.filter((category) => category.active && category.type !== 'income').map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Pessoa relacionada<input value={relatedPerson} onChange={(event) => setRelatedPerson(event.target.value)} /></label>
    </div>
    <footer><button type="button" disabled={!label.trim()} onClick={() => apply(suggestion, { label, purpose: purpose || undefined, categoryId: categoryId || undefined, relatedPerson: relatedPerson.trim() || undefined })}><Check size={16} /> Aplicar às {suggestion.transactionIds.length}</button></footer>
  </article>;
}

export function TransferRecurrencePanel({
  suggestions,
  categories,
  apply,
}: {
  suggestions: TransferRecurrenceSuggestion[];
  categories: Category[];
  apply: Parameters<typeof RecurrenceCard>[0]['apply'];
}) {
  if (!suggestions.length) return null;
  return <section className="panel recurrence-panel">
    <div className="panel-title"><div><small>FINALIDADE POR PADRÃO</small><h2>Transferências que parecem recorrentes</h2><p>Uma confirmação resolve o grupo inteiro. A finalidade é opcional e nunca é inventada silenciosamente.</p></div><Repeat2 size={22} /></div>
    <div className="recurrence-list">{suggestions.map((suggestion) => <RecurrenceCard key={suggestion.id} suggestion={suggestion} categories={categories} apply={apply} />)}</div>
  </section>;
}
