import { BadgeCheck, CircleAlert, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { DataHealthReport } from '../application/dataHealth';
import type { Account } from '../core/types';

export function DataHealthPanel({ report, accounts, onReprocess, onOpenReview }: {
  report: DataHealthReport;
  accounts: Account[];
  onReprocess: () => void;
  onOpenReview: () => void;
}) {
  const accountById = new Map(accounts.map((item) => [item.id, item]));
  return <section className="health-page">
    <span className="eyebrow">SAÚDE DA BASE</span>
    <div className="health-hero panel">
      <div className={`health-score ${report.criticalCount ? 'error' : report.warningCount ? 'warning' : 'ok'}`}>{report.score}<small>/100</small></div>
      <div><h1>{report.confidenceLabel}</h1><p>{report.reportConfidence === 'confirmed' ? 'Os relatórios centrais podem ser tratados como confirmados pelos dados disponíveis.' : report.reportConfidence === 'usable' ? 'Os relatórios continuam úteis, mas precisam exibir as ressalvas encontradas.' : 'Existem problemas que podem alterar saldos, fluxos ou comparações.'}</p></div>
    </div>
    <div className="health-actions"><button type="button" onClick={onReprocess}><RefreshCw size={17}/> Reprocessar classificações</button><button type="button" className="secondary" onClick={onOpenReview}><CircleAlert size={17}/> Abrir revisão</button></div>

    <section className="panel health-dimensions-panel"><header><div><small>DIMENSÕES</small><h2>Qualidade por fundamento</h2></div></header><div>{report.dimensions.map((dimension) => <article key={dimension.id}><header><b>{dimension.label}</b><strong>{dimension.score}</strong></header><div className="quality-meter"><span style={{ width: `${dimension.score}%` }} /></div><p>{dimension.detail}</p></article>)}</div></section>

    <section className="panel account-quality-panel"><header><div><small>POR CONTA</small><h2>Onde os relatórios são mais confiáveis</h2></div></header><div>{report.accountQuality.map((quality) => <article key={quality.accountId} className={quality.confidence}><div><b>{accountById.get(quality.accountId)?.name ?? quality.accountId}</b><small>{quality.transactionCount} movimentos · {quality.firstDate ?? 'sem início'} a {quality.lastDate ?? 'sem fim'}</small>{quality.issues.length > 0 && <p>{quality.issues.join(' · ')}</p>}</div><strong>{quality.score}</strong></article>)}</div></section>

    <div className="health-checks">{report.checks.map((check) => <article className={`health-check ${check.status}`} key={check.id}>
      <span>{check.status === 'ok' ? <BadgeCheck/> : check.status === 'error' ? <TriangleAlert/> : check.status === 'warning' ? <CircleAlert/> : <ShieldCheck/>}</span>
      <div><header><b>{check.label}</b><strong>{check.value}</strong></header><p>{check.detail}</p></div>
    </article>)}</div>
    <small className="muted">Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}</small>
  </section>;
}
