import { BadgeCheck, CircleAlert, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { DataHealthReport } from '../application/dataHealth';

export function DataHealthPanel({ report, onReprocess, onOpenReview }: {
  report: DataHealthReport;
  onReprocess: () => void;
  onOpenReview: () => void;
}) {
  return <section className="health-page">
    <span className="eyebrow">SAÚDE DA BASE</span>
    <div className="health-hero panel">
      <div className={`health-score ${report.criticalCount ? 'error' : report.warningCount ? 'warning' : 'ok'}`}>{report.score}<small>/100</small></div>
      <div><h1>{report.confidenceLabel}</h1><p>O número resume verificações concretas. Nada de uma estrelinha decorativa tentando abafar um saldo errado.</p></div>
    </div>
    <div className="health-actions"><button type="button" onClick={onReprocess}><RefreshCw size={17}/> Reprocessar classificações</button><button type="button" className="secondary" onClick={onOpenReview}><CircleAlert size={17}/> Abrir revisão</button></div>
    <div className="health-checks">{report.checks.map((check) => <article className={`health-check ${check.status}`} key={check.id}>
      <span>{check.status === 'ok' ? <BadgeCheck/> : check.status === 'error' ? <TriangleAlert/> : check.status === 'warning' ? <CircleAlert/> : <ShieldCheck/>}</span>
      <div><header><b>{check.label}</b><strong>{check.value}</strong></header><p>{check.detail}</p></div>
    </article>)}</div>
    <small className="muted">Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}</small>
  </section>;
}
