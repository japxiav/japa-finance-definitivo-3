import { createClient } from '@supabase/supabase-js';
import {
  evaluateVerifiedAccess,
  type AccessEvaluation,
} from '../auth/accessControl';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const allowedEmail = (import.meta.env.VITE_ALLOWED_EMAIL as string | undefined)
  ?.trim()
  .toLowerCase();

export const supabaseConfigurationErrors: string[] = [
  !url ? 'VITE_SUPABASE_URL ausente' : '',
  !publishableKey ? 'VITE_SUPABASE_PUBLISHABLE_KEY ausente' : '',
  url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)
    ? 'VITE_SUPABASE_URL não parece uma URL válida do Supabase'
    : '',
  publishableKey && /(?:service_role|sb_secret)/i.test(publishableKey)
    ? 'Uma chave secreta foi fornecida ao frontend. Use somente a chave publishable.'
    : '',
].filter(Boolean);

export const supabaseConfigured = supabaseConfigurationErrors.length === 0;

export const supabase = supabaseConfigured
  ? createClient(url!, publishableKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;

export type CurrentUserAccessResult = AccessEvaluation & { detail?: string };

/**
 * Confirma no servidor que a sessão ainda pertence ao usuário esperado e que
 * current_user_is_allowed() devolve literalmente true. VITE_ALLOWED_EMAIL é
 * apenas uma barreira adicional; nunca substitui a autorização remota.
 */
export async function verifyCurrentUserAccess(
  expectedUserId: string,
  sessionEmail: string | null | undefined,
): Promise<CurrentUserAccessResult> {
  if (!supabase) {
    return {
      ...evaluateVerifiedAccess({
        expectedUserId,
        sessionEmail,
        configuredAllowedEmail: allowedEmail,
        remoteAllowed: false,
        configurationAvailable: false,
      }),
      detail: 'Supabase não configurado.',
    };
  }

  const before = await supabase.auth.getUser();
  if (before.error || !before.data.user) {
    return {
      ...evaluateVerifiedAccess({
        expectedUserId,
        sessionEmail,
        configuredAllowedEmail: allowedEmail,
        remoteAllowed: false,
        remoteCheckFailed: true,
        authenticatedUserIdBefore: before.data.user?.id,
        authenticatedUserIdAfter: before.data.user?.id,
      }),
      detail: before.error?.message ?? 'Não foi possível confirmar a identidade autenticada.',
    };
  }

  // Uma divergência local já é suficiente para negar, mas a identidade acima
  // ainda foi validada no servidor para não confiar apenas no objeto de sessão.
  if (allowedEmail && sessionEmail?.trim().toLowerCase() !== allowedEmail) {
    return evaluateVerifiedAccess({
      expectedUserId,
      sessionEmail,
      configuredAllowedEmail: allowedEmail,
      remoteAllowed: false,
      authenticatedUserIdBefore: before.data.user.id,
      authenticatedUserIdAfter: before.data.user.id,
    });
  }

  const remote = await supabase.rpc('current_user_is_allowed');
  const after = await supabase.auth.getUser();

  const evaluation = evaluateVerifiedAccess({
    expectedUserId,
    sessionEmail,
    configuredAllowedEmail: allowedEmail,
    remoteAllowed: remote.data,
    remoteCheckFailed: Boolean(remote.error || after.error),
    authenticatedUserIdBefore: before.data.user.id,
    authenticatedUserIdAfter: after.data.user?.id,
  });

  if (evaluation.allowed) return evaluation;
  return {
    ...evaluation,
    detail: remote.error?.message
      ?? after.error?.message
      ?? (remote.data === true ? undefined : 'A conta não está na allowlist remota.'),
  };
}
