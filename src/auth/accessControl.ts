export type AccessDenialReason =
  | 'configuration_missing'
  | 'configured_email_mismatch'
  | 'identity_unavailable'
  | 'session_changed'
  | 'remote_check_failed'
  | 'not_allowlisted';

export type AccessEvaluation =
  | { allowed: true }
  | { allowed: false; reason: AccessDenialReason };

export interface AccessVerificationFacts {
  expectedUserId: string;
  authenticatedUserIdBefore?: string;
  authenticatedUserIdAfter?: string;
  sessionEmail?: string | null;
  configuredAllowedEmail?: string;
  remoteAllowed: unknown;
  remoteCheckFailed?: boolean;
  configurationAvailable?: boolean;
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

/**
 * Avalia fatos já obtidos da autenticação e da allowlist remota.
 * A política é deliberadamente fail closed: qualquer fato ausente,
 * divergente ou ambíguo mantém o cofre fechado.
 */
export function evaluateVerifiedAccess(facts: AccessVerificationFacts): AccessEvaluation {
  if (facts.configurationAvailable === false) {
    return { allowed: false, reason: 'configuration_missing' };
  }

  const expectedUserId = facts.expectedUserId.trim();
  if (!expectedUserId || !facts.authenticatedUserIdBefore || !facts.authenticatedUserIdAfter) {
    return { allowed: false, reason: 'identity_unavailable' };
  }

  if (
    facts.authenticatedUserIdBefore !== expectedUserId
    || facts.authenticatedUserIdAfter !== expectedUserId
  ) {
    return { allowed: false, reason: 'session_changed' };
  }

  const configuredEmail = normalizeEmail(facts.configuredAllowedEmail);
  if (configuredEmail && normalizeEmail(facts.sessionEmail) !== configuredEmail) {
    return { allowed: false, reason: 'configured_email_mismatch' };
  }

  if (facts.remoteCheckFailed) {
    return { allowed: false, reason: 'remote_check_failed' };
  }

  if (facts.remoteAllowed !== true) {
    return { allowed: false, reason: 'not_allowlisted' };
  }

  return { allowed: true };
}
