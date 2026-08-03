import { Cloud, Download, FileClock, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import type { RuntimeSecurityStatus } from '../application/securityStatus';
import type { RecoveryCheckpoint } from '../core/storage';

export function SecurityRecoveryPanel({ security, checkpoints, exportBackup, importBackup, restore, clear, lastRemoteUpdate }: {
  security: RuntimeSecurityStatus;
  checkpoints: RecoveryCheckpoint[];
  exportBackup: () => void;
  importBackup: () => void;
  restore: (createdAt: string) => void | Promise<void>;
  clear: () => void;
  lastRemoteUpdate?: string;
}) {
  return <section className="security-recovery-page">
    <span className="eyebrow">SEGURANÇA E RECUPERAÇÃO</span>
    <h1>Dados preservados.<br/>Sem prometer magia.</h1>
    <p>O painel mostra somente garantias verificáveis pelo aplicativo. Ele não finge auditar a infraestrutura inteira do planeta a partir de um cartão verde.</p>

    <section className="panel security-score-panel"><header><div><small>PROTEÇÃO EM TEMPO DE EXECUÇÃO</small><h2>{security.label}</h2></div><strong>{security.score}</strong></header><div>{security.items.map((item) => <article key={item.id} className={item.status}><ShieldCheck size={18}/><div><b>{item.label}</b><p>{item.detail}</p></div></article>)}</div>{lastRemoteUpdate && <small className="muted">Última versão remota conhecida: {new Date(lastRemoteUpdate).toLocaleString('pt-BR')}</small>}</section>

    <section className="panel recovery-actions-panel"><header><div><small>BACKUP PORTÁTIL</small><h2>Uma cópia fora do app</h2></div><Cloud size={20}/></header><p>Exporte um JSON completo antes de mudanças grandes. No iPhone, use “Salvar em Arquivos”.</p><div><button type="button" onClick={exportBackup}><Download size={17}/> Exportar backup</button><button type="button" className="secondary" onClick={importBackup}><Upload size={17}/> Importar backup</button></div></section>

    <section className="panel checkpoint-panel"><header><div><small>PONTOS DE RECUPERAÇÃO</small><h2>{checkpoints.length ? `${checkpoints.length} estado(s) preservado(s)` : 'Nenhum ponto local disponível'}</h2></div><FileClock size={20}/></header><p>São cópias locais curtas, criadas antes de ações destrutivas. O Safari pode removê-las quando falta espaço, porque aparentemente 2026 ainda não curou a quota do localStorage.</p>{checkpoints.length > 0 && <div>{checkpoints.map((checkpoint) => <article key={checkpoint.createdAt}><div><b>{checkpoint.label}</b><small>{new Date(checkpoint.createdAt).toLocaleString('pt-BR')} · {checkpoint.transactionCount} movimentos</small></div><button type="button" className="secondary" onClick={() => restore(checkpoint.createdAt)}><RotateCcw size={15}/> Restaurar</button></article>)}</div>}{checkpoints.length > 0 && <button type="button" className="danger-link" onClick={clear}><Trash2 size={15}/> Apagar pontos locais</button>}</section>
  </section>;
}
