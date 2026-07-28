// T-R56 (admin console; i18n master-spec §17.5, uiux §6.2) — small "raw backend token -> localized
// DISPLAY string" mappers for the `/admin/*` console, same shape as `./team-token-display.ts` /
// `./error-display.ts` / `./channel-display.ts`: a `Record<token, catalogKey>` plus a generic,
// always-localized fallback for anything outside the known set — never the raw/humanized machine
// token rendered directly (guard:rendered-i18n-leak's exact class of defect).

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `User.role` (prisma/schema.prisma's 5-value `Role` enum) — the admin console's user list/detail/
 *  role-change UI. Generic fallback for any future role never renders the raw enum token. */
const ROLE_CATALOG_KEY: Readonly<Record<string, string>> = {
  REP: 'admin.role.rep',
  UPLINE: 'admin.role.upline',
  RVP: 'admin.role.rvp',
  ADMIN: 'admin.role.admin',
  DUAL: 'admin.role.dual',
};

export function adminRoleLabel(t: Translate, role: string | null | undefined): string {
  if (!role) return t('admin.role.generic');
  const key = ROLE_CATALOG_KEY[role];
  return t(key ?? 'admin.role.generic');
}

/** `User.is_suspended` — a boolean, not an enum, but rendered through the exact same
 *  never-raw-token discipline (no bare `{String(isSuspended)}`). */
export function suspendStatusLabel(t: Translate, isSuspended: boolean): string {
  return t(isSuspended ? 'admin.users.statusSuspended' : 'admin.users.statusActive');
}

/** `User.onboarding_status` (`OnboardingStatus`: `IN_PROGRESS | GATED_COMPLETE`) — reuses the exact
 *  vocabulary `team-token-display.ts`'s `activationStatusLabel` already established for the same
 *  column, under the admin console's own catalog namespace (kept separate from `team.cockpit.*` so
 *  the two surfaces' copy can diverge later without cross-coupling). */
const ONBOARDING_STATUS_CATALOG_KEY: Readonly<Record<string, string>> = {
  IN_PROGRESS: 'admin.users.onboardingStatus.inProgress',
  GATED_COMPLETE: 'admin.users.onboardingStatus.complete',
};

export function adminOnboardingStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return t('admin.users.onboardingStatus.generic');
  const key = ONBOARDING_STATUS_CATALOG_KEY[status];
  return t(key ?? 'admin.users.onboardingStatus.generic');
}

/** `AuditEntryRecord.outcome` (`CFEOutcome`: `PASS | FLAG | BLOCK | RECORDED`) — the Audit Viewer's
 *  entry list. Every admin-console-originated row is `RECORDED` (§5.7 "informational audit
 *  evidence, not a CFE risk-band adjudication"); PASS/FLAG/BLOCK appear for CFE-originated rows the
 *  same store also holds (§17.8 "one event stream"). */
const AUDIT_OUTCOME_CATALOG_KEY: Readonly<Record<string, string>> = {
  RECORDED: 'admin.audit.outcome.recorded',
  PASS: 'admin.audit.outcome.pass',
  FLAG: 'admin.audit.outcome.flag',
  BLOCK: 'admin.audit.outcome.block',
};

export function auditOutcomeLabel(t: Translate, outcome: string | null | undefined): string {
  if (!outcome) return t('admin.audit.outcome.generic');
  const key = AUDIT_OUTCOME_CATALOG_KEY[outcome];
  return t(key ?? 'admin.audit.outcome.generic');
}

/** `SecurityEvent.severity` (`INFO | WARNING | CRITICAL`, prisma/schema.prisma). */
const SEVERITY_CATALOG_KEY: Readonly<Record<string, string>> = {
  INFO: 'admin.audit.severity.info',
  WARNING: 'admin.audit.severity.warning',
  CRITICAL: 'admin.audit.severity.critical',
};

export function securitySeverityLabel(t: Translate, severity: string | null | undefined): string {
  if (!severity) return t('admin.audit.severity.generic');
  const key = SEVERITY_CATALOG_KEY[severity];
  return t(key ?? 'admin.audit.severity.generic');
}

/** `SecurityEvent.type` (the open, additive string vocabulary documented in
 *  `src/services/security/security-event.ts`'s `SecurityEventType`). Generic fallback (the raw
 *  token, de-snake-cased into a neutral label) for any value outside the known set — this
 *  vocabulary is INTENTIONALLY allowed to grow without a migration (schema header note), so a
 *  hard-fail-closed "unknown -> generic string" here, never the raw underscored token verbatim. */
const SECURITY_EVENT_TYPE_CATALOG_KEY: Readonly<Record<string, string>> = {
  login_success: 'admin.audit.eventType.loginSuccess',
  login_failure: 'admin.audit.eventType.loginFailure',
  mfa_challenge: 'admin.audit.eventType.mfaChallenge',
  mfa_enrolled: 'admin.audit.eventType.mfaEnrolled',
  mfa_verify_failed: 'admin.audit.eventType.mfaVerifyFailed',
  password_reset: 'admin.audit.eventType.passwordReset',
  session_revoked: 'admin.audit.eventType.sessionRevoked',
  rate_limited: 'admin.audit.eventType.rateLimited',
  suspected_takeover: 'admin.audit.eventType.suspectedTakeover',
  breach_incident: 'admin.audit.eventType.breachIncident',
  privilege_escalation_denied: 'admin.audit.eventType.privilegeEscalationDenied',
  account_suspended: 'admin.audit.eventType.accountSuspended',
};

export function securityEventTypeLabel(t: Translate, type: string | null | undefined): string {
  if (!type) return t('admin.audit.eventType.generic');
  const key = SECURITY_EVENT_TYPE_CATALOG_KEY[type];
  return t(key ?? 'admin.audit.eventType.generic');
}

/** `mapAdminMutationToAuditInput`'s `AdminMutationAction` (`src/services/admin/admin-audit.ts`) —
 *  the Audit Viewer's `event_data.action` field for admin-console-originated rows. */
const ADMIN_MUTATION_ACTION_CATALOG_KEY: Readonly<Record<string, string>> = {
  user_suspended: 'admin.audit.mutationAction.userSuspended',
  user_reactivated: 'admin.audit.mutationAction.userReactivated',
  user_role_changed: 'admin.audit.mutationAction.userRoleChanged',
};

export function adminMutationActionLabel(t: Translate, action: string | null | undefined): string {
  if (!action) return t('admin.audit.mutationAction.generic');
  const key = ADMIN_MUTATION_ACTION_CATALOG_KEY[action];
  return t(key ?? 'admin.audit.mutationAction.generic');
}

/** Hash-chain tamper-evidence verdict (`ChainVerificationResult.valid`, `./hash-chain.ts`) — the
 *  Audit Viewer's headline integrity badge. */
export function chainIntegrityLabel(t: Translate, valid: boolean): string {
  return t(valid ? 'admin.audit.chainValid' : 'admin.audit.chainBroken');
}
