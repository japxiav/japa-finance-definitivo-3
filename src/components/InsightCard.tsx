import { ArrowUpRight, Check, CircleAlert, Lightbulb, Sparkles, X } from 'lucide-react';
import type { FinancialInsight } from '../insights/types';

function Icon({ tone }: { tone: FinancialInsight['tone'] }) {
  if (tone === 'warning') return <CircleAlert size={19} />;
  if (tone === 'positive') return <Sparkles size={19} />;
  return <Lightbulb size={19} />;
}

export function InsightCard({
  insight,
  compact = false,
  onAction,
  onDismiss,
  onUseful,
}: {
  insight: FinancialInsight;
  compact?: boolean;
  onAction?: (insight: FinancialInsight) => void;
  onDismiss?: (insight: FinancialInsight) => void;
  onUseful?: (insight: FinancialInsight) => void;
}) {
  return <article className={`insight-card ${insight.tone} ${compact ? 'compact' : ''}`}>
    <div className="insight-icon"><Icon tone={insight.tone} /></div>
    <div className="insight-content">
      <div className="insight-heading"><div><small>DESCOBERTA</small><h3>{insight.title}</h3></div><span className={`confidence ${insight.confidence}`}>{insight.confidence === 'high' ? 'alta confiança' : insight.confidence === 'medium' ? 'confiança média' : 'poucos dados'}</span></div>
      <p>{insight.message}</p>
      {!compact && insight.evidence.length > 0 && <details className="insight-evidence"><summary>Como chegamos nisso</summary><div>{insight.evidence.map((item) => <span key={`${item.label}:${item.value}`}><small>{item.label}</small><b>{item.value}</b></span>)}</div></details>}
      {(onAction || onDismiss || onUseful) && <footer className="insight-actions">
        {onAction && insight.action && <button type="button" className="link-button insight-link" onClick={() => onAction(insight)}>{insight.actionLabel ?? 'Abrir'} <ArrowUpRight size={15} /></button>}
        <span />
        {onUseful && <button type="button" className="icon-button tiny" title="Foi útil" onClick={() => onUseful(insight)}><Check size={15} /></button>}
        {onDismiss && <button type="button" className="icon-button tiny" title="Ocultar por 30 dias" onClick={() => onDismiss(insight)}><X size={15} /></button>}
      </footer>}
    </div>
  </article>;
}
