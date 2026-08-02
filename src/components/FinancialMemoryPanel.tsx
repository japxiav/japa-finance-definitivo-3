import { useState } from 'react';
import { Brain, Plus, Trash2 } from 'lucide-react';
import type { AppState, FinancialEntityRelationship, FinancialEntityType, FinancialMemoryEntity } from '../core/types';
import type { MemorySuggestion } from '../application/financialMemory';

const RELATIONSHIPS: Array<{value: FinancialEntityRelationship; label: string}> = [
  { value:'family', label:'Família' }, { value:'friend', label:'Amigo(a)' }, { value:'employer', label:'Empregador' },
  { value:'merchant', label:'Comerciante' }, { value:'service', label:'Serviço' }, { value:'unknown', label:'Outro' },
];

export function FinancialMemoryPanel({ state, suggestions, create, remove }: {
  state: AppState;
  suggestions: MemorySuggestion[];
  create: (input: { displayName: string; alias: string; type: FinancialEntityType; relationship: FinancialEntityRelationship; contextLabel?: string; categoryId?: string; direction?: 'inflow'|'outflow'; validFrom?: string; validUntil?: string }) => void;
  remove: (id: string) => void;
}) {
  const [selected, setSelected] = useState<MemorySuggestion | null>(null);
  const [context, setContext] = useState('');
  const [relationship, setRelationship] = useState<FinancialEntityRelationship>('unknown');
  const [categoryId, setCategoryId] = useState('');
  function save() {
    if (!selected) return;
    create({
      displayName: selected.displayName,
      alias: selected.normalizedAlias,
      type: relationship === 'merchant' ? 'merchant' : relationship === 'employer' ? 'employer' : 'person',
      relationship,
      contextLabel: context.trim() || undefined,
      categoryId: categoryId || undefined,
      direction: selected.direction,
      validFrom: selected.firstDate,
      validUntil: selected.lastDate,
    });
    setSelected(null); setContext(''); setRelationship('unknown'); setCategoryId('');
  }
  return <section className="memory-page">
    <span className="eyebrow">MEMÓRIA FINANCEIRA</span><h1>O app aprende contexto.<br/>Não inventa biografia.</h1>
    <p>Uma confirmação vale para o grupo e para extratos futuros. Valores, datas e saldos continuam intocados.</p>
    {state.financialMemory.length > 0 && <div className="memory-list">{state.financialMemory.map((entity: FinancialMemoryEntity) => <article className="panel memory-card" key={entity.id}><Brain size={20}/><div><b>{entity.displayName}</b><small>{entity.contextLabel || entity.relationship} · {entity.normalizedAliases.join(', ')}</small>{entity.validFrom && <em>{entity.validFrom} até {entity.validUntil ?? 'hoje'}</em>}</div><button className="icon-button" type="button" onClick={() => remove(entity.id)} aria-label={`Excluir memória ${entity.displayName}`}><Trash2 size={16}/></button></article>)}</div>}
    <div className="panel"><div className="panel-title"><div><small>PADRÕES RECORRENTES</small><h2>Ensinar uma vez</h2></div><Plus size={20}/></div>
      {suggestions.length ? <div className="memory-suggestions">{suggestions.slice(0,25).map((suggestion) => <button type="button" key={`${suggestion.normalizedAlias}-${suggestion.direction}`} onClick={() => setSelected(suggestion)}><div><b>{suggestion.displayName}</b><small>{suggestion.count} transferências · {suggestion.direction === 'inflow' ? 'recebidas' : 'enviadas'} · {suggestion.firstDate} a {suggestion.lastDate}</small></div><span>Ensinar</span></button>)}</div> : <p className="muted">Nenhum grupo recorrente novo aguardando contexto.</p>}
    </div>
    {selected && <div className="modal-backdrop"><form className="modal-card" onSubmit={(event) => { event.preventDefault(); save(); }}><header><div><small>CONTEXTO DO GRUPO</small><h2>{selected.displayName}</h2></div><button type="button" className="icon-button" onClick={() => setSelected(null)}>×</button></header><p>{selected.count} movimentações serão associadas por alias, direção e intervalo. Você não precisa classificar uma por uma, porque a vida já fornece formulários suficientes.</p><label>Relação<select value={relationship} onChange={(event) => setRelationship(event.target.value as FinancialEntityRelationship)}>{RELATIONSHIPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Contexto financeiro<input value={context} onChange={(event) => setContext(event.target.value)} placeholder="Ex.: intermediou meu salário" /></label><label>Categoria ampla, opcional<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Sem categoria obrigatória</option>{state.categories.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><footer><button type="button" className="secondary" onClick={() => setSelected(null)}>Cancelar</button><button type="submit">Salvar memória</button></footer></form></div>}
  </section>;
}
