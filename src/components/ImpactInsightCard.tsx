import { ArrowUpRight, CircleAlert, Gauge, ShieldCheck, Sparkles } from 'lucide-react';
import type { ImpactInsight } from '../insights/impactEngine';

function Icon({ tone }: { tone: ImpactInsight['tone'] }) {
  if (tone === 'critical' || tone === 'attention') return <CircleAlert size={19} />;
  if (tone === 'positive') return <ShieldCheck size={19} />;
  return <Gauge size={19} />;
}

export function ImpactInsightCard({ insight, compact = false, onAction }: {
  insight: ImpactInsight;
  compact?: boolean;
  onAction?: (insight: ImpactInsight) => void;
}) {
  return <article className={`impact-card ${insight.tone} ${compact ? 'compact' : ''}`}>
    <div className="impact-icon"><Icon tone={insight.tone} /></div>
    <div className="impact-content">
      <small>{insight.group === 'now' ? 'AGORA' : 'OPORTUNIDADE'}</small>
      <h3>{insight.title}</h3>
      <p>{insight.message}</p>
      {insight.impactValue && <div className="impact-number"><span>{insight.impactLabel}</span><strong>{insight.impactValue}</strong></div>}
      {!compact && insight.evidence.length > 0 && <details><summary>Ver cálculo</summary><div className="impact-evidence">{insight.evidence.map((item) => <span key={`${item.label}:${item.value}`}><small>{item.label}</small><b>{item.value}</b></span>)}</div></details>}
      {onAction && insight.action && <button type="button" className="link-button impact-action" onClick={() => onAction(insight)}>{insight.actionLabel ?? 'Abrir'} <ArrowUpRight size={15} /></button>}
    </div>
  </article>;
}
