import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Category, PlannedEvent, Transaction, TransactionAllocation, TransferPurpose } from '../core/types';
import { formatMoney, parseSignedMoneyToCents } from '../core/money';
import { signedNetMovement } from '../core/finance';
import { isCategoryCompatible } from '../classification/categoryCompatibility';

interface EditableAllocation {
  id?: string;
  label: string;
  amount: string;
  categoryId: string;
  purpose: TransferPurpose;
  relatedPerson: string;
  recurring: boolean;
  recurrenceFrequency: 'weekly' | 'monthly' | 'yearly';
  nextDueDate: string;
  plannedEventId?: string;
  createCommitment: boolean;
  note: string;
  createdAt?: string;
}

export interface TransferDetailResult {
  allocations: TransactionAllocation[];
  plannedEvents: PlannedEvent[];
}

const PURPOSES: Array<{ value: TransferPurpose; label: string }> = [
  { value: 'subscription', label: 'Assinatura' },
  { value: 'housing', label: 'Moradia e contas' },
  { value: 'family', label: 'Família' },
  { value: 'support', label: 'Ajuda / pensão' },
  { value: 'debt', label: 'Dívida' },
  { value: 'groceries', label: 'Mercado' },
  { value: 'leisure', label: 'Lazer' },
  { value: 'reimbursement', label: 'Reembolso' },
  { value: 'other', label: 'Outro' },
];

function toEditable(allocation: TransactionAllocation): EditableAllocation {
  return {
    id: allocation.id,
    label: allocation.label,
    amount: (allocation.amountCents / 100).toFixed(2).replace('.', ','),
    categoryId: allocation.categoryId ?? '',
    purpose: allocation.purpose ?? 'other',
    relatedPerson: allocation.relatedPerson ?? '',
    recurring: allocation.recurring ?? false,
    recurrenceFrequency: allocation.recurrenceFrequency ?? 'monthly',
    nextDueDate: allocation.nextDueDate ?? '',
    plannedEventId: allocation.plannedEventId,
    createCommitment: false,
    note: allocation.note ?? '',
    createdAt: allocation.createdAt,
  };
}

function blank(amountCents = 0): EditableAllocation {
  return {
    label: '',
    amount: amountCents ? (amountCents / 100).toFixed(2).replace('.', ',') : '',
    categoryId: '',
    purpose: 'other',
    relatedPerson: '',
    recurring: false,
    recurrenceFrequency: 'monthly',
    nextDueDate: '',
    createCommitment: false,
    note: '',
  };
}

export function TransferDetailModal({
  transaction,
  allocations,
  categories,
  close,
  save,
}: {
  transaction: Transaction;
  allocations: TransactionAllocation[];
  categories: Category[];
  close: () => void;
  save: (result: TransferDetailResult) => void;
}) {
  const totalCents = Math.abs(signedNetMovement(transaction));
  const [rows, setRows] = useState<EditableAllocation[]>(allocations.length
    ? allocations.map(toEditable)
    : [blank(totalCents)]);
  const [message, setMessage] = useState('');
  const categoryOptions = useMemo(() => categories.filter((category) =>
    isCategoryCompatible(category, transaction)), [categories, transaction]);

  const parsed = rows.map((row) => {
    try { return Math.abs(parseSignedMoneyToCents(row.amount)); } catch { return undefined; }
  });
  const allocatedCents = parsed.reduce<number>((total, amount) => total + (amount ?? 0), 0);
  const remainingCents = totalCents - allocatedCents;

  function update(index: number, patch: Partial<EditableAllocation>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    if (!rows.length) return setMessage('Adicione pelo menos um item.');
    if (parsed.some((amount) => amount === undefined || amount <= 0)) return setMessage('Todos os itens precisam de um valor válido maior que zero.');
    if (remainingCents !== 0) return setMessage(`O detalhamento precisa fechar exatamente em ${formatMoney(totalCents, transaction.currency)}.`);
    if (rows.some((row) => !row.label.trim())) return setMessage('Dê um nome a cada item.');
    if (rows.some((row) => row.recurring && row.createCommitment && !row.nextDueDate)) return setMessage('Informe a próxima data dos itens que virarão compromisso.');

    const now = new Date().toISOString();
    const plannedEvents: PlannedEvent[] = [];
    const nextAllocations = rows.map((row, index): TransactionAllocation => {
      let plannedEventId = row.plannedEventId;
      if (row.recurring && row.createCommitment && row.nextDueDate && !plannedEventId) {
        plannedEventId = crypto.randomUUID();
        plannedEvents.push({
          id: plannedEventId,
          title: row.label.trim(),
          kind: 'recurring',
          direction: transaction.direction,
          amountCents: parsed[index]!,
          currency: transaction.currency,
          dueDate: row.nextDueDate,
          accountId: transaction.accountId,
          recurrence: { frequency: row.recurrenceFrequency, interval: 1 },
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        id: row.id ?? crypto.randomUUID(),
        transactionId: transaction.id,
        label: row.label.trim(),
        amountCents: parsed[index]!,
        categoryId: row.categoryId || undefined,
        purpose: row.purpose,
        relatedPerson: row.relatedPerson.trim() || undefined,
        recurring: row.recurring,
        recurrenceFrequency: row.recurring ? row.recurrenceFrequency : undefined,
        nextDueDate: row.recurring && row.nextDueDate ? row.nextDueDate : undefined,
        plannedEventId: row.recurring ? plannedEventId : undefined,
        note: row.note.trim() || undefined,
        createdAt: row.createdAt ?? now,
        updatedAt: now,
      };
    });
    save({ allocations: nextAllocations, plannedEvents });
  }

  return <div className="modal-bg"><form className="modal wide-modal transfer-detail-modal" onSubmit={submit}>
    <button type="button" className="close" onClick={close}><X size={18} /></button>
    <span className="eyebrow">DETALHAR TRANSFERÊNCIA</span>
    <h2>{transaction.descriptionOriginal}</h2>
    <p>O banco mostra como o dinheiro saiu. Aqui você informa por quê, sem alterar o lançamento original.</p>
    <div className={`allocation-total ${remainingCents === 0 ? 'closed' : ''}`}>
      <span>Total {formatMoney(totalCents, transaction.currency)}</span>
      <b>{remainingCents === 0 ? 'Detalhamento fechado' : `Faltam ${formatMoney(Math.abs(remainingCents), transaction.currency)}${remainingCents < 0 ? ' em excesso' : ''}`}</b>
    </div>
    <div className="allocation-list">{rows.map((row, index) => <article className="allocation-row" key={row.id ?? index}>
      <header><b>Item {index + 1}</b><button type="button" className="icon-button tiny" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button></header>
      <div className="form-grid">
        <label>Descrição<input value={row.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="Netflix, pensão, mercado..." /></label>
        <label>Valor<input inputMode="decimal" value={row.amount} onChange={(event) => update(index, { amount: event.target.value })} placeholder="0,00" /></label>
        <label>Finalidade<select value={row.purpose} onChange={(event) => update(index, { purpose: event.target.value as TransferPurpose })}>{PURPOSES.map((purpose) => <option key={purpose.value} value={purpose.value}>{purpose.label}</option>)}</select></label>
        <label>Categoria<select value={row.categoryId} onChange={(event) => update(index, { categoryId: event.target.value })}><option value="">Sem categoria</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Pessoa relacionada<input value={row.relatedPerson} onChange={(event) => update(index, { relatedPerson: event.target.value })} placeholder="Opcional" /></label>
        <label>Observação<input value={row.note} onChange={(event) => update(index, { note: event.target.value })} placeholder="Opcional" /></label>
      </div>
      <label className="check-row"><input type="checkbox" checked={row.recurring} onChange={(event) => update(index, { recurring: event.target.checked })} /> Este item se repete</label>
      {row.recurring && <div className="recurring-grid">
        <label>Frequência<select value={row.recurrenceFrequency} onChange={(event) => update(index, { recurrenceFrequency: event.target.value as EditableAllocation['recurrenceFrequency'] })}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
        <label>Próxima data<input type="date" value={row.nextDueDate} onChange={(event) => update(index, { nextDueDate: event.target.value })} /></label>
        {!row.plannedEventId && <label className="check-row commitment-check"><input type="checkbox" checked={row.createCommitment} onChange={(event) => update(index, { createCommitment: event.target.checked })} /> Incluir na previsão futura</label>}
        {row.plannedEventId && <small className="linked-commitment">Já vinculado a um compromisso futuro.</small>}
      </div>}
    </article>)}</div>
    <button type="button" className="secondary add-allocation" onClick={() => setRows((current) => [...current, blank(Math.max(0, remainingCents))])}><Plus size={16} /> Adicionar item</button>
    {message && <div className="form-message error">{message}</div>}
    <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit">Salvar detalhamento</button></footer>
  </form></div>;
}
