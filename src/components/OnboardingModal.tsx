import { useState } from 'react';
import { ArrowRight, BadgeCheck, FileSpreadsheet, LockKeyhole, WalletCards, X } from 'lucide-react';

type Step = 'welcome' | 'privacy' | 'accounts' | 'import';
const STEPS: Step[] = ['welcome', 'privacy', 'accounts', 'import'];

export function OnboardingModal({ complete, dismiss, startImport }: {
  complete: () => void;
  dismiss: () => void;
  startImport: () => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const index = STEPS.indexOf(step);
  const content = {
    welcome: { icon: <WalletCards size={28}/>, title: 'Seu dinheiro começa no extrato', text: 'O Japa Finance registra fatos bancários primeiro. Categorias, contexto e IA nunca podem mudar valor, data ou moeda.' },
    privacy: { icon: <LockKeyhole size={28}/>, title: 'Seus dados têm dono', text: 'Cada sessão usa um cofre separado. A IA é opcional, acionada manualmente e recebe um panorama resumido, não o CSV bruto.' },
    accounts: { icon: <BadgeCheck size={28}/>, title: 'Contas e produtos ficam separados', text: 'Wise, Revolut, moedas e produtos bancários são detectados na prévia. Transferências internas e conversões não viram renda ou gasto.' },
    import: { icon: <FileSpreadsheet size={28}/>, title: 'Importe e confira antes de salvar', text: 'A prévia mostra período, linhas, pendências, duplicatas e contas detectadas. Nada é gravado silenciosamente.' },
  }[step];
  return <div className="modal-backdrop onboarding-backdrop" role="presentation"><section className="modal-card onboarding-modal" role="dialog" aria-modal="true" aria-label="Primeiros passos"><button type="button" className="modal-close" onClick={dismiss}><X size={18}/></button><div className="onboarding-progress">{STEPS.map((item, itemIndex) => <span key={item} className={itemIndex <= index ? 'active' : ''}/>)}</div><div className="onboarding-icon">{content.icon}</div><span className="eyebrow">PRIMEIROS PASSOS</span><h2>{content.title}</h2><p>{content.text}</p><footer>{index > 0 ? <button type="button" className="secondary" onClick={() => setStep(STEPS[index - 1]!)}>Voltar</button> : <button type="button" className="secondary" onClick={dismiss}>Agora não</button>}{index < STEPS.length - 1 ? <button type="button" onClick={() => setStep(STEPS[index + 1]!)}>Continuar <ArrowRight size={16}/></button> : <button type="button" onClick={() => { complete(); startImport(); }}>Escolher extrato <FileSpreadsheet size={16}/></button>}</footer></section></div>;
}
