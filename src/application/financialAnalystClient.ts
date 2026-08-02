import type { AppState } from '../core/types';
import { supabase } from '../lib/supabase';
import { buildFinancialAnalystContext, parseFinancialAnalystResult } from './financialAnalyst';

export async function requestFinancialAnalyst(
  state: AppState,
  options: { currency: string; question: string; mode?: 'question' | 'panorama' | 'hypotheses' },
) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session?.access_token) throw new Error('Sessão inválida. Entre novamente antes de chamar o analista.');
  const response = await fetch('/api/financial-assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      context: buildFinancialAnalystContext(state, options.currency),
      question: options.question.trim(),
      mode: options.mode ?? 'question',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `Analista indisponível (${response.status}).`);
  return parseFinancialAnalystResult(payload);
}
