import { useMemo, useState } from 'react';
import { Activity, Archive, BadgeCheck, BookOpen, Brain, ChevronRight, CircleAlert, GitBranch, Layers3, Lightbulb, Link2, Plus, ShieldAlert, Sparkles, WalletCards, X } from 'lucide-react';
import type { BehaviorObservation } from '../application/behaviorMemory';
import type { ChangeSignal } from '../application/changeDetection';
import type { ContinuousAuditSnapshot } from '../application/continuousAudit';
import type { ContextualInsight } from '../application/contextualInsights';
import type { CalculationExplanation } from '../application/explanationEngine';
import type { FinancialEventSummary } from '../application/financialEvents';
import type { FinancialObjectSuggestion } from '../application/financialObjects';
import type { KnowledgeSnapshot } from '../application/knowledgeEngine';
import type { CategoryRule, FinancialObject, FinancialObjectType } from '../core/types';
import { formatMoney } from '../core/money';
import { CalculationExplanationPanel } from './CalculationExplanationPanel';

type View = 'overview' | 'objects' | 'memory' | 'events' | 'rules' | 'audit';

const OBJECT_LABELS: Record<FinancialObjectType, string> = {
  subscription: 'Assinatura', loan: 'Empréstimo', family_support: 'Apoio familiar', trip: 'Viagem', large_purchase: 'Compra grande', goal: 'Meta', reserve: 'Reserva', commitment: 'Compromisso', project: 'Projeto',
};

function confidenceLabel(value: 'high' | 'medium' | 'low') {
  return value === 'high' ? 'alta' : value === 'medium' ? 'média' : 'baixa';
}

export function KnowledgeCenterPanel({
  currency,
  knowledge,
  insights,
  changes,
  objects,
  objectSuggestions,
  behaviorObservations,
  events,
  audit,
  explanations,
  rules,
  acceptObject,
  createObject,
  archiveObject,
  saveBehavior,
  dismissBehavior,
  openTransactions,
  openRules,
}: {
  currency: string;
  knowledge: KnowledgeSnapshot;
  insights: ContextualInsight[];
  changes: ChangeSignal[];
  objects: FinancialObject[];
  objectSuggestions: FinancialObjectSuggestion[];
  behaviorObservations: BehaviorObservation[];
  events: FinancialEventSummary[];
  audit: ContinuousAuditSnapshot;
  explanations: CalculationExplanation[];
  rules: CategoryRule[];
  acceptObject: (suggestion: FinancialObjectSuggestion) => void;
  createObject: (input: { type: FinancialObjectType; title: string; currency: string; notes?: string }) => void;
  archiveObject: (id: string) => void;
  saveBehavior: (observation: BehaviorObservation) => void;
  dismissBehavior: (observation: BehaviorObservation) => void;
  openTransactions: (transactionIds: string[]) => void;
  openRules: () => void;
}) {
  const [view, setView] = useState<View>('overview');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualType, setManualType] = useState<FinancialObjectType>('project');
  const [manualTitle, setManualTitle] = useState('');
  const activeRules = rules.filter((item) => item.active !== false);
  const learnedRules = activeRules.filter((item) => item.source === 'learned');
  const activeObjects = objects.filter((item) => item.status !== 'archived' && item.currency === currency);
  const relevantEvents = events.filter((event) => event.currencies.includes(currency));
  const visibleMemory = behaviorObservations.filter((item) => item.currency === currency);
  const topEdges = useMemo(() => [...knowledge.edges].filter((edge) => edge.currency === currency && (edge.amountCents ?? 0) !== 0).sort((a, b) => Math.abs(b.amountCents ?? 0) - Math.abs(a.amountCents ?? 0)).slice(0, 8), [knowledge, currency]);
  const nodeById = useMemo(() => new Map(knowledge.nodes.map((node) => [node.id, node])), [knowledge]);

  return <section className="knowledge-center-page">
    <span className="eyebrow">CENTRAL DE COMPREENSÃO</span>
    <h1>O app sabe.<br/>E mostra como sabe.</h1>
    <p>Fatos, relações, mudanças, objetos e hipóteses ficam separados. Uma extravagância conceitual conhecida como não misturar verdade com palpite.</p>

    <div className="knowledge-tabs" role="tablist">
      <button type="button" className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><Brain size={16}/> Visão geral</button>
      <button type="button" className={view === 'objects' ? 'active' : ''} onClick={() => setView('objects')}><Layers3 size={16}/> Objetos</button>
      <button type="button" className={view === 'memory' ? 'active' : ''} onClick={() => setView('memory')}><BookOpen size={16}/> Memória</button>
      <button type="button" className={view === 'events' ? 'active' : ''} onClick={() => setView('events')}><Link2 size={16}/> Eventos</button>
      <button type="button" className={view === 'rules' ? 'active' : ''} onClick={() => setView('rules')}><GitBranch size={16}/> Regras</button>
      <button type="button" className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}><ShieldAlert size={16}/> Auditoria</button>
    </div>

    {view === 'overview' && <>
      <section className="knowledge-stat-grid">
        <article><small>Pessoas</small><b>{knowledge.counts.person}</b><span>relações reconhecidas</span></article>
        <article><small>Comerciantes</small><b>{knowledge.counts.merchant}</b><span>entidades de consumo</span></article>
        <article><small>Objetos</small><b>{activeObjects.length}</b><span>contextos da vida real</span></article>
        <article className={audit.status !== 'healthy' ? 'attention' : ''}><small>Auditoria</small><b>{audit.criticalCount + audit.warningCount}</b><span>{audit.status === 'healthy' ? 'sem alertas relevantes' : 'itens que merecem atenção'}</span></article>
      </section>

      {insights.length > 0 && <section className="panel contextual-insight-list"><header><div><small>O QUE REALMENTE IMPORTA</small><h2>Insights com consequência</h2></div><Lightbulb size={20}/></header>{insights.slice(0, 6).map((insight) => <article key={insight.id} className={`contextual-insight ${insight.type}`}><span><Sparkles size={17}/></span><div><small>confiança {confidenceLabel(insight.confidence)}</small><b>{insight.title}</b><p>{insight.message}</p><em>{insight.consequence}</em>{insight.transactionIds.length > 0 && <button type="button" className="text-action" onClick={() => openTransactions(insight.transactionIds)}>Ver evidências <ChevronRight size={14}/></button>}</div></article>)}</section>}

      <section className="panel knowledge-graph-panel"><header><div><small>GRAFO FINANCEIRO</small><h2>Principais conexões em {currency}</h2></div><GitBranch size={20}/></header>{topEdges.length ? <div className="knowledge-edge-list">{topEdges.map((edge) => <button type="button" key={edge.id} onClick={() => edge.transactionIds.length && openTransactions(edge.transactionIds)}><span><b>{nodeById.get(edge.from)?.label ?? edge.from}</b><small>{edge.type.replaceAll('_', ' ')}</small><b>{nodeById.get(edge.to)?.label ?? edge.to}</b></span><strong>{formatMoney(edge.amountCents ?? 0, currency)}</strong></button>)}</div> : <p className="muted">Ainda não há conexões financeiras suficientes nesta moeda.</p>}</section>

      {changes.length > 0 && <section className="panel change-signal-list"><header><div><small>MUDANÇAS DETECTADAS</small><h2>O que saiu do padrão</h2></div><Activity size={20}/></header>{changes.slice(0, 6).map((change) => <article key={change.id}><span className={`change-direction ${change.direction}`}>{change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : change.direction === 'started' ? '+' : change.direction === 'stopped' ? '×' : '↔'}</span><div><b>{change.title}</b><p>{change.explanation}</p><small>{change.evidence.join(' · ')}</small></div>{change.transactionIds.length > 0 && <button type="button" className="icon-button" aria-label="Abrir movimentos" onClick={() => openTransactions(change.transactionIds)}><ChevronRight size={17}/></button>}</article>)}</section>}

      {explanations.map((explanation) => <CalculationExplanationPanel key={explanation.id} explanation={explanation} openTransactions={openTransactions} />)}
    </>}

    {view === 'objects' && <>
      <section className="panel financial-object-panel"><header><div><small>OBJETOS FINANCEIROS</small><h2>Contextos que atravessam várias transações</h2></div><button type="button" className="secondary compact" onClick={() => setManualOpen(true)}><Plus size={16}/> Criar</button></header>
        {activeObjects.length ? <div className="financial-object-list">{activeObjects.map((object) => <article key={object.id}><span className={`object-type ${object.type}`}><WalletCards size={18}/></span><div><small>{OBJECT_LABELS[object.type]} · {object.currency}</small><b>{object.title}</b><p>{object.notes || `${object.transactionIds.length} movimento(s) e ${object.plannedEventIds.length} compromisso(s) vinculados.`}</p>{object.expectedCents !== undefined && <em>Valor esperado: {formatMoney(object.expectedCents, object.currency)}</em>}</div><button type="button" className="icon-button" title="Arquivar" onClick={() => archiveObject(object.id)}><Archive size={16}/></button></article>)}</div> : <p className="muted">Nenhum objeto criado. O app continua funcionando sem eles; o planeta segue girando.</p>}
      </section>
      {objectSuggestions.length > 0 && <section className="panel object-suggestion-list"><header><div><small>SUGESTÕES</small><h2>{objectSuggestions.length} objetos possíveis</h2></div></header>{objectSuggestions.map((suggestion) => <article key={suggestion.id}><div><small>{OBJECT_LABELS[suggestion.type]} · confiança {confidenceLabel(suggestion.confidence)}</small><b>{suggestion.title}</b><p>{suggestion.explanation}</p><em>{suggestion.evidence.join(' · ')}</em></div><button type="button" onClick={() => acceptObject(suggestion)}>Criar objeto</button></article>)}</section>}
    </>}

    {view === 'memory' && <section className="panel behavior-memory-panel"><header><div><small>MEMÓRIA COMPORTAMENTAL</small><h2>O que o app observou</h2></div><BookOpen size={20}/></header><p>Observações não mudam valores nem categorias. Você decide o que merece virar memória confirmada.</p>{visibleMemory.length ? <div>{visibleMemory.map((observation) => <article key={observation.id} className={observation.saved ? 'saved' : ''}><span>{observation.saved ? <BadgeCheck size={18}/> : <Brain size={18}/>}</span><div><small>{observation.kind.replaceAll('_', ' ')} · confiança {confidenceLabel(observation.confidence)}</small><b>{observation.title}</b><p>{observation.summary}</p><em>{observation.evidence.join(' · ')}</em></div><footer>{observation.saved ? <span>Memória confirmada</span> : <><button type="button" className="secondary" onClick={() => dismissBehavior(observation)}><X size={15}/> Ignorar</button><button type="button" onClick={() => saveBehavior(observation)}>Guardar</button></>}</footer></article>)}</div> : <p className="muted">Ainda não há observações relevantes suficientes.</p>}</section>}

    {view === 'events' && <section className="panel financial-event-panel"><header><div><small>EVENTOS COMPOSTOS</small><h2>Uma ação, várias linhas bancárias</h2></div><Link2 size={20}/></header>{relevantEvents.length ? <div>{relevantEvents.slice(0, 40).map((event) => <button type="button" key={event.id} onClick={() => openTransactions(event.transactionIds)}><span className={`event-kind ${event.type}`}><Link2 size={17}/></span><span><small>{event.reportingDate} · {event.transactionIds.length} linhas</small><b>{event.title}</b><em>{event.explanation}</em></span><span><small>taxas</small><strong>{event.totalFeeCents ? formatMoney(event.totalFeeCents, currency) : '—'}</strong></span><ChevronRight size={17}/></button>)}</div> : <p className="muted">Nenhum evento composto reconhecido.</p>}</section>}


    {view === 'rules' && <section className="panel learned-rules-panel"><header><div><small>APRENDIZADO DETERMINÍSTICO</small><h2>{learnedRules.length} regra(s) aprendida(s)</h2></div><button type="button" className="secondary compact" onClick={openRules}>Gerenciar regras</button></header><p>Uma confirmação manual pode virar regra reutilizável. A regra guarda escopo, origem e exceções; não altera fatos bancários antigos escondida atrás de um algoritmo sorridente.</p><div className="learned-rule-summary"><span><small>Ativas</small><b>{activeRules.length}</b></span><span><small>Aprendidas</small><b>{learnedRules.length}</b></span><span><small>Com exceções</small><b>{activeRules.filter((item) => (item.exceptionTransactionIds?.length ?? 0) > 0).length}</b></span></div>{learnedRules.length ? <div className="learned-rule-list">{learnedRules.slice(0, 30).map((rule) => <article key={rule.id}><div><small>{rule.kind} · {rule.currency ?? 'todas as moedas'} · {rule.direction ?? 'ambas as direções'}</small><b>{rule.merchantLabel || rule.pattern}</b><p>Quando encontrar <code>{rule.pattern}</code>, aplicar a categoria vinculada.</p></div><span>{(rule.exceptionTransactionIds?.length ?? 0) ? `${rule.exceptionTransactionIds?.length ?? 0} exceção(ões)` : 'sem exceções'}</span></article>)}</div> : <p className="muted">Nenhuma regra aprendida ainda. As regras padrão continuam ativas.</p>}</section>}

    {view === 'audit' && <section className="panel continuous-audit-panel"><header><div><small>AUDITORIA CONTÍNUA</small><h2>{audit.status === 'healthy' ? 'A base está coerente' : `${audit.criticalCount + audit.warningCount} alerta(s) relevante(s)`}</h2></div>{audit.status === 'healthy' ? <BadgeCheck size={22}/> : <CircleAlert size={22}/>}</header><p>Executada automaticamente sobre o estado atual. Não usa IA e não altera nada sozinha.</p>{audit.issues.length ? <div>{audit.issues.map((issue) => <article key={issue.id} className={issue.severity}><span>{issue.severity === 'critical' ? <ShieldAlert size={18}/> : <CircleAlert size={18}/>}</span><div><small>{issue.severity}</small><b>{issue.title}</b><p>{issue.explanation}</p><em>{issue.evidence.slice(0, 4).join(' · ')}</em></div>{issue.transactionIds.length > 0 && <button type="button" className="icon-button" onClick={() => openTransactions(issue.transactionIds)}><ChevronRight size={17}/></button>}</article>)}</div> : <p className="muted">Nenhum problema relevante detectado.</p>}</section>}

    {manualOpen && <div className="modal-backdrop" role="presentation"><section className="modal-card object-create-modal" role="dialog" aria-modal="true" aria-label="Criar objeto financeiro"><button type="button" className="modal-close" onClick={() => setManualOpen(false)}><X size={18}/></button><span className="eyebrow">NOVO OBJETO</span><h2>O que você quer acompanhar?</h2><label>Tipo<select value={manualType} onChange={(event) => setManualType(event.target.value as FinancialObjectType)}>{Object.entries(OBJECT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Nome<input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="Ex.: Viagem para o Brasil" /></label><button type="button" disabled={!manualTitle.trim()} onClick={() => { createObject({ type: manualType, title: manualTitle, currency }); setManualTitle(''); setManualOpen(false); }}>Criar objeto</button></section></div>}
  </section>;
}
