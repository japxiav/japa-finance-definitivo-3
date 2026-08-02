import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, FileText, Search, Trash2, Users } from 'lucide-react';
import { formatMoney } from '../core/money';
import type { FinancialRelationshipSummary, RelationshipTimelineEvent } from '../application/financialRelationships';
import { topRelationshipReceivers, topRelationshipSenders } from '../application/financialRelationships';
import type { RelationshipIntelligence, RelationshipOverviewInsight } from '../application/relationshipIntelligence';

type Mode = 'all' | 'sent' | 'received';

export function FinancialRelationshipsPanel({
  relationships,
  currency,
  saveNote,
  removeNote,
  openTransactions,
  timeline,
  intelligence,
  overviewInsights,
}: {
  relationships: FinancialRelationshipSummary[];
  currency: string;
  saveNote: (relationship: FinancialRelationshipSummary, note?: string) => void;
  removeNote: (memoryEntityId: string) => void;
  openTransactions: (relationship: FinancialRelationshipSummary) => void;
  timeline: RelationshipTimelineEvent[];
  intelligence: Record<string, RelationshipIntelligence>;
  overviewInsights: RelationshipOverviewInsight[];
}) {
  const [mode, setMode] = useState<Mode>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FinancialRelationshipSummary | null>(null);
  const [note, setNote] = useState('');
  const sent = useMemo(() => topRelationshipSenders(relationships, 5), [relationships]);
  const received = useMemo(() => topRelationshipReceivers(relationships, 5), [relationships]);
  const filtered = useMemo(() => relationships.filter((item) => {
    if (mode === 'sent' && item.sentCents <= 0) return false;
    if (mode === 'received' && item.receivedCents <= 0) return false;
    const search = query.trim().toLocaleLowerCase('pt-BR');
    return !search || item.displayName.toLocaleLowerCase('pt-BR').includes(search) || item.contextLabel?.toLocaleLowerCase('pt-BR').includes(search);
  }).sort((a, b) => {
    if (mode === 'sent') return b.sentCents - a.sentCents;
    if (mode === 'received') return b.receivedCents - a.receivedCents;
    return b.relevanceScore - a.relevanceScore;
  }), [relationships, mode, query]);

  function openDetails(item: FinancialRelationshipSummary) {
    setSelected(item);
    setNote(item.contextLabel ?? '');
  }

  function submitNote() {
    if (!selected) return;
    saveNote(selected, note.trim() || undefined);
    setSelected(null);
  }

  return <section className="relationships-page">
    <span className="eyebrow">RELACIONAMENTOS FINANCEIROS</span>
    <h1>Quem movimenta<br/>dinheiro com você.</h1>
    <p>O app não exige finalidade para transferências. Ele observa valores, frequência, direção e mudanças ao longo do tempo. Anotações são livres e opcionais.</p>

    {relationships.length === 0 ? <section className="panel empty"><Users size={32}/><p>Nenhuma contraparte de transferência foi reconhecida nesta moeda.</p></section> : <>
      <div className="relationship-ranking-grid">
        <section className="panel relationship-ranking"><header><div><small>MAIS ENVIADO</small><h2>Para quem foi</h2></div><ArrowUpRight size={20}/></header>{sent.length ? sent.slice(0,3).map((item, index) => <button type="button" key={item.key} onClick={() => openDetails(item)}><span><i>{index + 1}</i><b>{item.displayName}</b><small>{item.sentCount} transferências</small></span><strong>{formatMoney(item.sentCents, currency)}</strong></button>) : <p className="muted">Nenhuma transferência enviada.</p>}</section>
        <section className="panel relationship-ranking"><header><div><small>MAIS RECEBIDO</small><h2>De quem veio</h2></div><ArrowDownLeft size={20}/></header>{received.length ? received.slice(0,3).map((item, index) => <button type="button" key={item.key} onClick={() => openDetails(item)}><span><i>{index + 1}</i><b>{item.displayName}</b><small>{item.receivedCount} transferências</small></span><strong>{formatMoney(item.receivedCents, currency)}</strong></button>) : <p className="muted">Nenhuma transferência recebida.</p>}</section>
      </div>

      {overviewInsights.length > 0 && <section className="panel relationship-insights"><header><div><small>O QUE OS DADOS MOSTRAM</small><h2>Sem preencher categoria nenhuma</h2></div></header><div>{overviewInsights.map((insight) => <button type="button" key={insight.id} onClick={() => { const item = relationships.find((relationship) => relationship.key === insight.relationshipKey); if (item) openDetails(item); }}><span className={insight.tone}/><div><b>{insight.title}</b><small>{insight.explanation}</small></div><ChevronRight size={17}/></button>)}</div></section>}

      {timeline.length > 0 && <section className="panel relationship-timeline"><header><div><small>MUDANÇAS OBSERVÁVEIS</small><h2>Como as relações mudaram</h2></div></header><div>{timeline.slice(0, 8).map((event) => { const item = relationships.find((relationship) => relationship.key === event.relationshipKey); return <button type="button" key={event.id} onClick={() => item && openDetails(item)}><i className={event.direction}/><span><small>{event.month}</small><b>{event.title}</b><em>{event.detail}</em></span><ChevronRight size={17}/></button>; })}</div></section>}

      <section className="panel relationship-directory">
        <header className="relationship-directory-header"><div><small>MAPA FINANCEIRO</small><h2>{relationships.length} relações reconhecidas</h2></div><label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pessoa" /></label></header>
        <div className="relationship-tabs"><button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>Todas</button><button type="button" className={mode === 'sent' ? 'active' : ''} onClick={() => setMode('sent')}>Enviei</button><button type="button" className={mode === 'received' ? 'active' : ''} onClick={() => setMode('received')}>Recebi</button></div>
        <div className="relationship-list">{filtered.map((item) => { const profile = intelligence[item.key]; return <article key={item.key} className="relationship-card"><button type="button" className="relationship-main" onClick={() => openDetails(item)}><span className="relationship-avatar">{item.displayName.slice(0,1).toLocaleUpperCase('pt-BR')}</span><span><b>{item.displayName}</b><small>{profile?.cadenceLabel ?? 'observado'} · {item.totalCount} movimentos · {item.firstDate} a {item.lastDate}</small>{item.contextLabel && <em>{item.contextLabel}</em>}</span><ChevronRight size={18}/></button><div className="relationship-totals"><span><small>Enviado</small><b>{formatMoney(item.sentCents, currency)}</b></span><span><small>Recebido</small><b>{formatMoney(item.receivedCents, currency)}</b></span><span><small>Saldo da relação</small><b className={item.netCents > 0 ? 'positive' : item.netCents < 0 ? 'negative' : ''}>{formatMoney(item.netCents, currency)}</b></span></div></article>; })}</div>
      </section>
    </>}

    {selected && <div className="modal-backdrop"><form className="modal-card relationship-detail-modal" onSubmit={(event) => { event.preventDefault(); submitNote(); }}><header><div><small>ANÁLISE DO RELACIONAMENTO</small><h2>{selected.displayName}</h2></div><button type="button" className="icon-button" onClick={() => setSelected(null)}>×</button></header>{(() => { const profile = intelligence[selected.key]; return <><div className="relationship-detail-grid"><span><small>Enviado</small><b>{formatMoney(selected.sentCents, currency)}</b><em>{selected.sentCount} vezes</em></span><span><small>Recebido</small><b>{formatMoney(selected.receivedCents, currency)}</b><em>{selected.receivedCount} vezes</em></span><span><small>Média enviada</small><b>{formatMoney(profile?.averageSentCents ?? 0, currency)}</b></span><span><small>Média recebida</small><b>{formatMoney(profile?.averageReceivedCents ?? 0, currency)}</b></span><span><small>Participação nos envios</small><b>{Math.round((profile?.sentShare ?? 0) * 100)}%</b></span><span><small>Participação nos recebimentos</small><b>{Math.round((profile?.receivedShare ?? 0) * 100)}%</b></span></div>{profile?.facts.length ? <ul className="relationship-facts">{profile.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}<label><FileText size={16}/> Anotação opcional<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: minha irmã; dividimos assinaturas e fazemos empréstimos temporários" /></label><p className="muted">A anotação não classifica todas as transferências nem altera o saldo. Ela só ajuda você e a IA a entenderem a relação.</p></>; })()}<footer><button type="button" className="secondary" onClick={() => openTransactions(selected)}>Ver movimentos</button>{selected.memoryEntityId && <button type="button" className="secondary" onClick={() => { removeNote(selected.memoryEntityId!); setSelected(null); }}><Trash2 size={15}/> Remover anotação</button>}<button type="submit">Salvar anotação</button></footer></form></div>}
  </section>;
}
