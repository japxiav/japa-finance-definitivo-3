import { ChevronRight, ShieldCheck } from 'lucide-react';
import type { CalculationExplanation } from '../application/explanationEngine';

export function CalculationExplanationPanel({ explanation, openTransactions }: {
  explanation: CalculationExplanation;
  openTransactions?: (transactionIds: string[]) => void;
}) {
  return <details className="calculation-explanation">
    <summary><ShieldCheck size={16}/> Ver cálculo</summary>
    <div className="calculation-explanation-body">
      <header><div><small>{explanation.title}</small><b>{explanation.resultLabel}</b></div><span className={`confidence-chip ${explanation.confidence}`}>confiança {explanation.confidence === 'high' ? 'alta' : explanation.confidence === 'medium' ? 'média' : 'baixa'}</span></header>
      <dl><div><dt>Fórmula</dt><dd>{explanation.formula}</dd></div><div><dt>Escopo</dt><dd>{explanation.scope}</dd></div><div><dt>Incluídos</dt><dd>{explanation.includedCount} movimentos</dd></div><div><dt>Excluídos</dt><dd>{explanation.excludedCount} movimentos</dd></div></dl>
      {explanation.evidence.length > 0 && <ul>{explanation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
      {explanation.excludedReasons.length > 0 && <details><summary>Por que alguns movimentos ficaram fora</summary><ul>{explanation.excludedReasons.map((item) => <li key={item.reason}>{item.reason}: {item.count}</li>)}</ul></details>}
      {openTransactions && explanation.includedTransactionIds.length > 0 && <button type="button" className="secondary explanation-open-transactions" onClick={() => openTransactions(explanation.includedTransactionIds)}>Abrir movimentos usados <ChevronRight size={16}/></button>}
    </div>
  </details>;
}
