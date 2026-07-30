import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function UpdatePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onDone();
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">RECUPERAÇÃO DE ACESSO</span>
        <h1>Crie uma nova senha.</h1>
        <form onSubmit={submit}>
          <label>Nova senha
            <input type="password" minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="form-message error">{error}</div>}
          <button disabled={busy}><KeyRound size={18} />{busy ? 'Salvando...' : 'Salvar nova senha'}</button>
        </form>
      </section>
    </main>
  );
}
