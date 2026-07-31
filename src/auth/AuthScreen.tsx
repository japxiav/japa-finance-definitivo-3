import { useState, type FormEvent } from 'react';
import { KeyRound, LogIn, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup' | 'forgot';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (resetError) throw resetError;
        setMessage('Link de recuperação enviado. Confira seu e-mail.');
        return;
      }

      if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        setPassword('');
        setMessage(data.session
          ? 'Conta criada e login concluído.'
          : 'Conta criada. Confirme o e-mail para entrar.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        setPassword('');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível autenticar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">JAPA FINANCE // ACESSO PRIVADO</span>
        <h1>Seu dinheiro.<br />Sua senha.</h1>
        <p>A senha é criada por você e processada pelo Supabase Auth. Ela não fica escrita no aplicativo nem é enviada para quem montou o código.</p>

        <form onSubmit={submit}>
          <label>E-mail
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {mode !== 'forgot' && (
            <label>Senha
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && <div className="form-message error">{error}</div>}
          {message && <div className="form-message success">{message}</div>}
          <button disabled={busy} type="submit">
            {mode === 'signup' ? <UserPlus size={18} /> : mode === 'forgot' ? <KeyRound size={18} /> : <LogIn size={18} />}
            {busy ? 'Processando...' : mode === 'signup' ? 'Criar conta' : mode === 'forgot' ? 'Enviar recuperação' : 'Entrar'}
          </button>
        </form>

        <div className="auth-switches">
          {mode !== 'signin' && <button type="button" className="link-button" onClick={() => setMode('signin')}>Já tenho conta</button>}
          {mode !== 'signup' && <button type="button" className="link-button" onClick={() => setMode('signup')}>Criar minha conta</button>}
          {mode !== 'forgot' && <button type="button" className="link-button" onClick={() => setMode('forgot')}>Esqueci a senha</button>}
        </div>
      </section>
    </main>
  );
}
