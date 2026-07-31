import { useMemo, useState, type FormEvent } from 'react';
import { Archive, RotateCcw, Trash2, X } from 'lucide-react';
import type { Category, CategoryRule, CategoryType } from '../core/types';

export function CategoryManagerModal({
  categories,
  rules,
  transactionCountByCategory,
  close,
  create,
  rename,
  archive,
  restore,
  removeRule,
}: {
  categories: Category[];
  rules: CategoryRule[];
  transactionCountByCategory: Map<string, number>;
  close: () => void;
  create: (input: { name: string; type: CategoryType }) => void;
  rename: (id: string, name: string) => void;
  archive: (id: string, destinationId?: string) => void;
  restore: (id: string) => void;
  removeRule: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('expense');
  const [error, setError] = useState('');
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const activeDestinations = useMemo(() => categories.filter((item) => item.active && item.id !== 'uncategorized'), [categories]);
  const learnedRules = rules.filter((rule) => rule.source === 'learned');

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return setError('Informe um nome.');
    if (categories.some((item) => item.name.toLocaleLowerCase('pt-BR') === clean.toLocaleLowerCase('pt-BR'))) return setError('Já existe uma categoria com esse nome.');
    create({ name: clean, type });
    setName('');
    setError('');
  }

  return <div className="modal-bg"><section className="modal wide-modal category-manager">
    <button type="button" className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">CATEGORIAS</span><h2>Organize do seu jeito</h2>
    <p>As categorias padrão continuam amplas. Crie uma específica somente quando ela realmente ajudar a entender seu dinheiro, e não para catalogar cada átomo comprado.</p>

    <form className="category-create" onSubmit={submit}>
      <label>Nova categoria<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Filha, Música, Viagem..." /></label>
      <label>Tipo<select value={type} onChange={(event) => setType(event.target.value as CategoryType)}><option value="expense">Despesa</option><option value="income">Receita</option><option value="both">Ambos</option></select></label>
      <button type="submit">Adicionar</button>
    </form>
    {error && <div className="form-message error">{error}</div>}

    <div className="category-list">
      {categories.map((category) => {
        const count = transactionCountByCategory.get(category.id) ?? 0;
        const canEdit = !category.system;
        return <article className={!category.active ? 'archived' : ''} key={category.id}>
          <div className="category-main">
            <span className="category-dot" />
            <div>
              {canEdit ? <input aria-label={`Nome de ${category.name}`} defaultValue={category.name} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== category.name && rename(category.id, event.target.value.trim())} /> : <b>{category.name}</b>}
              <small>{count} {count === 1 ? 'movimentação' : 'movimentações'} · {category.type === 'income' ? 'receita' : category.type === 'both' ? 'receita e despesa' : category.type === 'system' ? 'sistema' : 'despesa'}</small>
            </div>
          </div>
          {canEdit && category.active && <div className="archive-controls">
            {count > 0 && <select aria-label={`Destino de ${category.name}`} value={destinations[category.id] ?? ''} onChange={(event) => setDestinations((current) => ({ ...current, [category.id]: event.target.value }))}><option value="">Mover antes de arquivar</option>{activeDestinations.filter((item) => item.id !== category.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <button type="button" className="icon-button tiny" title="Arquivar" disabled={count > 0 && !destinations[category.id]} onClick={() => archive(category.id, destinations[category.id])}><Archive size={15} /></button>
          </div>}
          {canEdit && !category.active && <button type="button" className="secondary tiny" onClick={() => restore(category.id)}><RotateCcw size={15} /> Restaurar</button>}
        </article>;
      })}
    </div>

    {learnedRules.length > 0 && <section className="learned-rules"><h3>Comerciantes aprendidos</h3>{learnedRules.map((rule) => <article key={rule.id}><div><b>{rule.merchantLabel ?? rule.pattern}</b><small>{categories.find((item) => item.id === rule.categoryId)?.name ?? rule.categoryId}</small></div><button type="button" className="icon-button tiny" title="Esquecer regra" onClick={() => removeRule(rule.id)}><Trash2 size={15} /></button></article>)}</section>}
    <footer><button type="button" onClick={close}>Concluir</button></footer>
  </section></div>;
}
