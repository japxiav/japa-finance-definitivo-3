import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { localCivilDate } from '../core/date';
import { parseSignedMoneyToCents } from '../core/money';
import type { Account, PlannedEvent, RecurrenceFrequency } from '../core/types';
import { isCivilDate } from '../domain/dates';

export function PlannedEventModal({ accounts, currency, close, save }: {
  accounts: Account[];
  currency: string;
  close: () => void;
  save: (event: PlannedEvent) => void;
}) {
  const candidates = accounts.filter((account) => account.active && account.currency === currency);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(localCivilDate());
  const [accountId, setAccountId] = useState(candidates[0]?.id ?? '');
  const [direction, setDirection] = useState<'inflow' | 'outflow'>('outflow');
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('monthly');
  const [interval, setInterval] = useState('1');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const cleanTitle = title.trim();
      const amountCents = parseSignedMoneyToCents(amount);
      const recurrenceInterval = Number(interval);
      if (!cleanTitle) throw new Error('Informe o nome do compromisso.');
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('O valor deve ser maior que zero.');
      if (!isCivilDate(dueDate)) throw new Error('Data inválida.');
      if (!candidates.some((account) => account.id === accountId)) throw new Error('Escolha uma conta ativa nesta moeda.');
      if (recurring && (!Number.isSafeInteger(recurrenceInterval) || recurrenceInterval <= 0 || recurrenceInterval > 120)) throw new Error('Intervalo de recorrência inválido.');
      const now = new Date().toISOString();
      save({
        id: crypto.randomUUID(),
        title: cleanTitle,
        kind: recurring ? 'recurring' : direction === 'inflow' ? 'income' : 'expense',
        direction,
        amountCents,
        currency,
        dueDate,
        accountId,
        needsAccountReview: false,
        recurrence: recurring ? { frequency, interval: recurrenceInterval } : undefined,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível criar o evento.');
    }
  }

  return <div className="modal-bg"><form className="modal" onSubmit={submit}>
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">PLANEJAMENTO</span><h2>Adicionar compromisso</h2>
    <label>Nome<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aluguel, salário, pensão..." /></label>
    <div className="form-grid"><label>Valor em {currency}<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="180,00" /></label><label>Data<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
    <div className="form-grid"><label>Tipo<select value={direction} onChange={(event) => setDirection(event.target.value as 'inflow' | 'outflow')}><option value="outflow">Saída</option><option value="inflow">Entrada</option></select></label><label>Conta<select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{candidates.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
    <label className="check-row"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /><span>Repetir automaticamente</span></label>
    {recurring && <div className="form-grid"><label>Frequência<select value={frequency} onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label><label>A cada<input inputMode="numeric" value={interval} onChange={(event) => setInterval(event.target.value)} /></label></div>}
    {error && <div className="form-message error">{error}</div>}
    <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button>Adicionar</button></footer>
  </form></div>;
}
