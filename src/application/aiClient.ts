import type { AppState } from '../core/types';
import { supabase } from '../lib/supabase';
import { buildFinancialAuditContext, parseAiAuditResponse } from './smartAudit';

export async function requestAiFinancialAudit(state: AppState, options: { allowWebSearch: boolean; question?: string }) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session?.access_token) throw new Error('Sessão inválida. Entre novamente antes de chamar a auditoria.');
  const response = await fetch('/api/financial-audit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      context: buildFinancialAuditContext(state),
      allowWebSearch: options.allowWebSearch,
      question: options.question?.trim() || undefined,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `Auditoria indisponível (${response.status}).`);
  return parseAiAuditResponse(payload);
}
