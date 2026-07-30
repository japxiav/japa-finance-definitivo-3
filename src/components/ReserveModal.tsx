import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { formatMoney, parseSignedMoneyToCents } from '../core/money';
import type { ReservePolicy } from '../core/types';

export function ReserveModal({ currency, policy, close, save }: {
  currency: string;
  policy?: ReservePolicy;
  close: () => void;
  save: (policy: ReservePolicy) => void;
}) {
  const [minimum, setMinimum] = useState(policy ? String(policy.minimumCents / 100).replace('.', ',') : '0');
  const [target, setTarget] = useState(policy?.targetCents !== undefined ? String(policy.targetCents / 100).replace('.', ',') : '');
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const minimumCents = parseSignedMoneyToCents(minimum);
      const targetCents = target.trim() ? parseSignedMoneyToCents(target) : undefined;
      if (!Number.isSafeInteger(minimumCents) || minimumCents < 0) throw new Error('A reserva mínima precisa ser zero ou maior.');
      if (targetCents !== undefined && (!Number.isSafeInteger(targetCents) || targetCents < minimumCents)) throw new Error('A meta deve ser igual ou maior que a reserva mínima.');
      save({ currency, minimumCents, targetCents, updatedAt: new Date().toISOString() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Valores inválidos.');
    }
  }
  return <div className="modal-bg"><form className="modal" onSubmit={submit}>
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">RESERVA</span><h2>Proteja um valor mínimo</h2>
    <p>O “Posso comprar?” e o forecast tratam este valor como intocável.</p>
    <label>Reserva mínima em {currency}<input inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="500,00" /></label>
    <label>Meta opcional<input inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="1000,00" /></label>
    {policy && <div className="form-message">Atual: {formatMoney(policy.minimumCents, currency)}</div>}
    {error && <div className="form-message error">{error}</div>}
    <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button>Salvar reserva</button></footer>
  </form></div>;
}
