import { useState } from 'react';
import { Bot, Calculator, Send, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import type { Account } from '../core/types';
import type { AssistantResult } from '../application/FinancialDecisionFacade';
import type { FinancialAnalystResult } from '../application/financialAnalyst';

export function FinancialAnalystPanel({
  currency,
  accounts,
  targetAccountId,
  setTargetAccountId,
  askDeterministic,
  askAi,
}: {
  currency: string;
  accounts: Account[];
  targetAccountId: string;
  setTargetAccountId: (value: string) => void;
  askDeterministic: (question: string) => AssistantResult;
  askAi: (question: string, mode: 'question' | 'panorama' | 'hypotheses') => Promise<FinancialAnalystResult>;
}) {
  const [question, setQuestion] = useState('');
  const [localAnswer, setLocalAnswer] = useState<AssistantResult | null>(null);
  const [aiAnswer, setAiAnswer] = useState<FinancialAnalystResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function runLocal(value = question) {
    const clean = value.trim();
    if (!clean) return;
    setQuestion(clean);
    setLocalAnswer(askDeterministic(clean));
    setAiAnswer(null);
    setError('');
  }

  async function runAi(mode: 'question' | 'panorama' | 'hypotheses', value = question) {
    const clean = value.trim() || (mode === 'panorama' ? 'Faça um panorama útil das minhas finanças.' : mode === 'hypotheses' ? 'Quais padrões podem precisar de contexto humano?' : 'Explique minhas finanças atuais.');
    setQuestion(clean);
    setBusy(true);
    setError('');
    try {
      setAiAnswer(await askAi(clean, mode));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'A análise por IA falhou.');
    } finally {
      setBusy(false);
    }
  }

  const prompts = [
    'Quanto mandei para a Emily?',
    'Quem mais me enviou dinheiro?',
    'Quando comecei a usar a Revolut?',
    'Quanto paguei em taxas de conversão?',
    'Quanto gastei na Vinted?',
  ];

  return <section className="assistant-page analyst-page">
    <span className="eyebrow">PERGUNTAR AOS NÚMEROS</span>
    <h1>O motor calcula.<br/>A IA interpreta.</h1>
    <p>Perguntas objetivas são respondidas localmente. A OpenAI só entra quando você pede explicação, panorama ou hipóteses, e nunca altera o livro financeiro.</p>

    <label className="assistant-account-selector">Conta-alvo para simulações<select aria-label="Conta-alvo do assistente" value={targetAccountId} onChange={(event) => setTargetAccountId(event.target.value)}><option value="">Nenhuma conta específica</option>{accounts.filter((account) => account.currency === currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>

    <div className="prompt-grid">{prompts.map((prompt) => <button type="button" className="prompt-card" key={prompt} onClick={() => runLocal(prompt)}>{prompt}</button>)}</div>

    <div className="analyst-mode-actions"><button type="button" className="secondary" disabled={busy} onClick={() => runAi('panorama')}><Sparkles size={17}/> Panorama com IA</button><button type="button" className="secondary" disabled={busy} onClick={() => runAi('hypotheses')}><Bot size={17}/> Levantar hipóteses</button></div>
    <div className="analyst-privacy-note"><ShieldCheck size={16}/><span>A IA recebe um panorama resumido com valores, períodos e relacionamentos. O CSV bruto, IDs bancários e saldos recalculados não são enviados. Sem chave configurada, estes dois botões apenas informam que o recurso está indisponível.</span></div>

    {localAnswer && <div className={`assistant-answer ${localAnswer.status ?? ''}`}><b><Calculator size={18}/></b><p>{localAnswer.answer}</p>{localAnswer.evidence.length > 0 && <ul>{localAnswer.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}<small>Resposta determinística · confiança {localAnswer.confidence === 'high' ? 'alta' : localAnswer.confidence === 'medium' ? 'média' : 'baixa'} · {localAnswer.dataScope ?? currency}</small>{localAnswer.confidence !== 'high' && <button type="button" className="secondary analyst-explain-button" disabled={busy} onClick={() => runAi('question', question)}><Sparkles size={15}/> Pedir interpretação à IA</button>}</div>}

    {aiAnswer && <div className="assistant-answer ai-analyst-answer"><b><Bot size={18}/></b><p>{aiAnswer.answer}</p>{aiAnswer.evidence.length > 0 && <details open><summary>Evidências usadas</summary><ul>{aiAnswer.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details>}{aiAnswer.hypotheses.length > 0 && <section className="analyst-hypotheses"><h3>Hipóteses, não certezas</h3>{aiAnswer.hypotheses.map((item, index) => <article key={`${item.title}-${index}`}><small>Confiança {item.confidence}</small><b>{item.title}</b><p>{item.explanation}</p>{item.confirmationQuestion && <em>{item.confirmationQuestion}</em>}</article>)}</section>}{aiAnswer.limitations.length > 0 && <details><summary>Limites desta resposta</summary><ul>{aiAnswer.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}<small>OpenAI · modelo {aiAnswer.model ?? 'configurado no servidor'} · não altera dados</small></div>}

    {error && <div className="form-message error"><TriangleAlert size={16}/>{error}</div>}

    <div className="assistant-input"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Pergunte sobre seu dinheiro" onKeyDown={(event) => { if (event.key === 'Enter') runLocal(); }} /><button type="button" onClick={() => runLocal()}><Send size={18}/></button></div>
  </section>;
}
