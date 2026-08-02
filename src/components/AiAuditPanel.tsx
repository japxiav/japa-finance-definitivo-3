import { useState } from 'react';
import { Bot, Globe2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { AiAuditRun, AuditProposal } from '../core/types';

export function AiAuditPanel({ proposals, runs, busy, runLocal, runAi, apply, dismiss }: {
  proposals: AuditProposal[];
  runs: AiAuditRun[];
  busy: boolean;
  runLocal: () => void;
  runAi: (options: { allowWebSearch: boolean; question?: string }) => Promise<void>;
  apply: (proposal: AuditProposal) => void;
  dismiss: (proposal: AuditProposal) => void;
}) {
  const [allowWebSearch, setAllowWebSearch] = useState(false);
  const [question, setQuestion] = useState('');
  const pending = proposals.filter((item) => item.status === 'pending');
  return <section className="ai-audit-page">
    <span className="eyebrow">AUDITORIA INTELIGENTE</span><h1>A IA propõe.<br/>O motor comprova.</h1>
    <p>A auditoria recebe um panorama estruturado, nunca a chave bancária nem permissão para editar o livro. Toda correção passa por prévia, confirmação e desfazer.</p>
    <div className="panel ai-audit-controls"><label>Pergunta opcional<textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ex.: por que a base ainda está provisória?" /></label><label className="checkbox-row"><input type="checkbox" checked={allowWebSearch} onChange={(event) => setAllowWebSearch(event.target.checked)}/><Globe2 size={17}/><span>Permitir pesquisa pública apenas de empresas, comerciantes, bancos e documentação</span></label><small>Pessoas particulares nunca são pesquisadas.</small><div><button type="button" className="secondary" onClick={runLocal}><RefreshCw size={17}/> Auditoria local</button><button type="button" disabled={busy} onClick={() => runAi({allowWebSearch, question})}><Sparkles size={17}/> {busy ? 'Analisando…' : 'Auditar com IA'}</button></div></div>
    <div className="audit-proposals">{pending.length ? pending.map((proposal) => <article className={`panel audit-proposal ${proposal.severity}`} key={proposal.id}><header><span>{proposal.type === 'review_only' ? <ShieldCheck/> : <Bot/>}</span><div><small>{proposal.severity === 'critical' ? 'CRÍTICO' : proposal.severity === 'warning' ? 'ATENÇÃO' : 'SUGESTÃO'} · confiança {proposal.confidence}</small><h3>{proposal.title}</h3></div></header><p>{proposal.explanation}</p>{proposal.evidence.length > 0 && <ul>{proposal.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}<footer><button type="button" className="secondary" onClick={() => dismiss(proposal)}>Ignorar</button>{proposal.type !== 'review_only' && <button type="button" onClick={() => apply(proposal)}>Aplicar com prévia</button>}</footer></article>) : <section className="panel empty"><ShieldCheck size={32}/><p>Nenhuma proposta pendente.</p></section>}</div>
    {runs.length > 0 && <details className="panel"><summary>Auditorias anteriores</summary>{runs.slice(0,10).map((run) => <article key={run.id}><b>{run.summary}</b><small>{new Date(run.createdAt).toLocaleString('pt-BR')} · {run.model}{run.usedWebSearch ? ' · pesquisa pública usada' : ''}</small></article>)}</details>}
  </section>;
}
