import { Sparkles, X } from 'lucide-react';
import type { Category, Transaction } from '../core/types';

export function MerchantLearningModal({ transaction, category, close, remember }: {
  transaction: Transaction;
  category: Category;
  close: () => void;
  remember: () => void;
}) {
  return <div className="modal-bg"><section className="modal merchant-learning-modal">
    <button className="close" onClick={close}><X size={17} /></button>
    <span className="eyebrow">APRENDER COM SUA ESCOLHA</span>
    <div className="modal-illustration"><Sparkles size={24} /></div>
    <h2>Lembrar este comerciante?</h2>
    <p>Você classificou <b>{transaction.descriptionOriginal}</b> como <b>{category.name}</b>.</p>
    <div className="learning-preview"><span>{transaction.merchantNormalized || transaction.descriptionOriginal}</span><b>→</b><span>{category.name}</span></div>
    <p className="muted">A regra vale para próximas importações. Você ainda poderá corrigir uma movimentação específica, porque comércio também gosta de vender coisas fora da própria categoria e sabotar a ordem humana.</p>
    <footer><button className="secondary" onClick={close}>Só desta vez</button><button onClick={remember}>Sim, usar sempre</button></footer>
  </section></div>;
}
