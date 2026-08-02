import { ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { AuditProposal } from '../core/types';
import type { AuditProposalPreview } from '../application/auditActions';

export function AuditProposalConfirmModal({ proposal, preview, close, confirm }: {
  proposal: AuditProposal;
  preview: AuditProposalPreview;
  close: () => void;
  confirm: () => void;
}) {
  return <div className="modal-backdrop"><section className="modal-card audit-confirm-modal">
    <button type="button" className="close icon-button" onClick={close}><X size={17}/></button>
    <span className="eyebrow">PRÉVIA DA CORREÇÃO</span><h2>{proposal.title}</h2>
    <p>{proposal.explanation}</p>
    <div className="audit-preview-block"><header><ShieldCheck size={18}/><b>O que será alterado</b></header><ul>{preview.changes.map((item) => <li key={item}>{item}</li>)}</ul></div>
    {preview.blockers.length > 0 && <div className="audit-preview-block blocked"><header><TriangleAlert size={18}/><b>Ação bloqueada</b></header><ul>{preview.blockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    <p className="muted">Um checkpoint será criado antes da aplicação. A IA não toca no livro diretamente, apesar de provavelmente achar que seria muito eficiente.</p>
    <footer><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={!preview.canApply} onClick={confirm}>Aplicar correção</button></footer>
  </section></div>;
}
