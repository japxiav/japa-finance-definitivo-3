import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Account, OwnerIdentityProfile } from '../core/types';

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))];
}

export function IdentityProfileModal({
  profile,
  accounts,
  close,
  save,
}: {
  profile: OwnerIdentityProfile;
  accounts: Account[];
  close: () => void;
  save: (profile: OwnerIdentityProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [aliases, setAliases] = useState(profile.aliases.join('\n'));
  const [emails, setEmails] = useState(profile.emails.join('\n'));
  const [ibans, setIbans] = useState(profile.ibans.join('\n'));
  const [ownAccountIds, setOwnAccountIds] = useState(new Set(profile.ownAccountIds));
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = displayName.trim();
    if (!cleanName) {
      setError('Informe o nome que aparece nos extratos.');
      return;
    }
    save({
      displayName: cleanName,
      aliases: [...new Set([cleanName, ...lines(aliases)])],
      emails: lines(emails),
      ibans: lines(ibans).map((item) => item.replace(/\s+/g, '').toUpperCase()),
      ownAccountIds: [...ownAccountIds],
      updatedAt: new Date().toISOString(),
    });
  }

  function toggleAccount(accountId: string) {
    setOwnAccountIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  return <div className="modal-bg"><section className="modal wide-modal">
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">IDENTIDADE PRÓPRIA</span>
    <h2>Ensine o app a reconhecer suas contas.</h2>
    <p>O nome sozinho não é usado como prova universal. Frases como “enviado para Diogo”, IBAN próprio e pares entre contas aumentam a confiança.</p>
    <form onSubmit={submit}>
      <label>Nome principal<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>Variações do nome<textarea rows={4} value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder={'Diogo\nDiogo Rodrigues'} /></label>
      <label>E-mails próprios<textarea rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} /></label>
      <label>IBANs próprios<textarea rows={3} value={ibans} onChange={(event) => setIbans(event.target.value)} /></label>
      <fieldset className="identity-accounts"><legend>Contas que são suas</legend>{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={ownAccountIds.has(account.id)} onChange={() => toggleAccount(account.id)} /><span>{account.name} · {account.currency}</span></label>)}</fieldset>
      {error && <div className="form-message error">{error}</div>}
      <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit">Salvar identidade</button></footer>
    </form>
  </section></div>;
}
