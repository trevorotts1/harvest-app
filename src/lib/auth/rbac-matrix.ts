import { Role } from '@prisma/client';

/**
 * The authoritative §16.6 RBAC matrix (T-14), consumed by every WP.
 *
 * This is the single source of truth for "can this role do this action on this resource" — the
 * per-resource capability layer that master-spec §16.6 defines and §17.2/§16.8-6 requires be
 * "enforced at the gateway, deny-by-default." It extends the T-04 primitives in `./rbac.ts`
 * (`roleSatisfies`/`requireRole`, which check a caller-supplied allow-list) with a matrix that
 * itself encodes the allow-list per resource+action, so call-sites no longer have to hand-write
 * `[Role.UPLINE, Role.RVP]`-style lists that can drift from §16.6 — they call `can(role, resource,
 * action)` and the matrix is the only place the allow-list is spelled out.
 *
 * `src/services/compliance/rbac/rbac-service.ts` (T-11's dependency, pre-dating this module)
 * derives its `ROLE_PERMISSIONS` from `MATRIX` below rather than hand-maintaining a parallel copy
 * — see that file for the reconciliation. `MATRIX` here is the one authoritative definition.
 *
 * ## Design rules (load-bearing — read before editing MATRIX)
 *
 * 1. **Fail-closed.** `can()` returns `false` for any resource/action pair not present in `MATRIX`,
 *    for a resource present but missing that particular action, and for a role not listed against
 *    an action that IS present — including ADMIN. There is no generic bypass in this module (unlike
 *    `roleSatisfies`'s `adminBypass` option, which is a caller-opt-in default for the coarser
 *    allow-list guard in `./rbac.ts`). Every grant here — ADMIN included — is an explicit role
 *    listed against a resource+action. This is what makes the §16.6 "audited-only" exception
 *    (`downline_pii`) enforceable: ADMIN simply is not listed there, and there is no bypass to fall
 *    back on.
 * 2. **DUAL is computed, never hand-listed.** §6.2/§16.6: DUAL = REP ∪ UPLINE ("union
 *    permissions") — a DUAL user gets exactly what a REP or an UPLINE would get for that
 *    resource+action, nothing more (never RVP-only or ADMIN-only grants). `MATRIX` therefore never
 *    lists `Role.DUAL` directly; `can()` derives DUAL's effective grant from whether REP or UPLINE
 *    is present. Hand-listing DUAL alongside REP/UPLINE would risk exactly the kind of silent
 *    inversion (DUAL drifting out of sync with REP/UPLINE) this module exists to prevent.
 * 3. **Row-level data scope ("own" vs. "team" vs. "org-wide" vs. "full") is NOT expressed here.**
 *    §16.6 distinguishes, e.g., a rep's "full" access to their own contacts from an upline's "own
 *    only" access to theirs — both get the same *capability* (read/write/delete/export on
 *    `contacts`), scoped to different *data* (their own row vs. everyone's). That row-level
 *    ownership filter is a data-access-layer concern (a `WHERE user_id = …` / org-tree-membership
 *    check) each WP's query/service layer owns — this module only answers "is this role capable of
 *    this action on this resource class at all."
 * 4. **Two rows are conditional grants, not flat allow-lists, and get dedicated functions instead of
 *    a MATRIX entry naming the conditionally-eligible role:**
 *    - §16.6 row 3 ("Downline raw contact PII / conversation content"): `never` for
 *      upline/rvp/dual (no exception encoded here — the documented "except explicit three-way"
 *      exception is a *workflow* owned by WP05/WP09 that bridges upline into the same conversation
 *      thread as a participant, not an RBAC grant), and `audited-only` for ADMIN — not a bypass.
 *      `MATRIX.downline_pii` is intentionally empty (nobody is granted it, ADMIN included); the only
 *      legitimate path is `canAccessDownlinePIIAudited()`, which requires an actual audit context
 *      and is not a "check permission" call any code should treat as a blanket capability.
 *    - §16.6 row 9 ("Cross-org visibility"): `yes` for ADMIN (a flat grant, in `MATRIX`) but
 *      "gated behind admin approval" for RVP — not automatic. `canAccessCrossOrg()` handles the RVP
 *      conditional path; `MATRIX.cross_org` only lists ADMIN.
 */

export type Resource =
  // ── §16.6 rows (the authoritative matrix) ──────────────────────────────────────────────────
  | 'contacts' // row 1 "Own pipeline / contacts / conversations" (contacts/pipeline half)
  | 'messaging' // row 1 (conversation-content half)
  | 'downline_visibility' // row 2 "Downline pipeline states / ratios / names-in-play"
  | 'downline_pii' // row 3 "Downline raw contact PII / conversation content" — see canAccessDownlinePIIAudited
  | 'compliance_audit' // row 4 "Flagged-content review"
  | 'billing_own' // row 5 "Billing (own)"
  | 'billing_org' // row 6 "Billing (downline/org-sponsored)"
  | 'org_seat_config' // row 7 "Org-sponsored seat config"
  | 'data_rights' // row 8 "Data-rights (own export/delete)" + the pre-existing oversight `manage` action
  | 'cross_org' // row 9 "Cross-org visibility" — see canAccessCrossOrg
  // ── Extension resources (WP-specific; pre-date this matrix in rbac-service.ts, not literal
  //    §16.6 rows, retained here so there is exactly one permissions table in the codebase) ──────
  | 'calendar'
  | 'agent_logs'
  | 'social'
  | 'team_metrics'
  | 'payment'
  | 'user_profile'
  | 'onboarding'
  | 'incident_response' // T-15, §16.7 breach notification & incident-response lifecycle
  | 'sponsor_invite' // T-19, §6.5/§6.6: sending/managing an UplineInvite (the sponsor-matching invite)
  | 'access_tier_assignment' // T-19, §6.7: the MANUAL admin-provisioning branch only — every other
  // tier outcome (free_org_linked/free_paid_external/paid_individual) is a system-computed result of
  // the registration path, not a role "acting", so it has no capability row of its own here.
  // T-45 (WP09, §14.4/uiux §5.9): the RVP master calendar (opportunity nights, training, team
  // calls). Distinct from the pre-existing `calendar` resource above (which governs a rep's own
  // personal calendar link/read/write) — this one gates who may CREATE/EDIT the org-wide broadcast
  // calendar everyone else sees read-only ("The RVP controls and populates the master calendar").
  | 'team_calendar_broadcast'
  // T-45 (WP09, §14.2): booking a Coaching Session (rep + upline mentoring window) — either party
  // may propose/respond, so this is broader than `team_calendar_broadcast` above.
  | 'coaching_session'
  // T-45 (WP09, §14.5): the enterprise ($25k/yr) admin console — seat management, org analytics
  // narrative trigger, custom onboarding config, SSO config/status.
  | 'enterprise_console'
  // T-45 (WP09, §14.5/uiux §5.9 item 7): the Sponsor Cockpit. Every role may sponsor a downline
  // member (mirrors `sponsor_invite`'s "any existing account can sponsor" rule, §15.3) — the actual
  // gate is row-level ownership (sponsor_user_id = caller), enforced in the service layer, not a
  // role restriction here.
  | 'sponsor_cockpit';

export type Action = 'read' | 'write' | 'delete' | 'export' | 'approve' | 'manage';

/** The roles explicitly granted an action. Absence of an action key = deny for everyone. */
type Grant = Partial<Record<Action, readonly Role[]>>;

/**
 * The authoritative §16.6 permission matrix. See the module doc above for the rules governing this
 * table — most importantly: no implicit ADMIN bypass, and DUAL is never listed directly.
 */
export const MATRIX: Record<Resource, Grant> = {
  // Row 1 — "Own pipeline / contacts / conversations": rep=full, upline=own only, rvp=own only,
  // admin=full, dual=rep-side. Capability is identical across rep/upline/rvp/admin; only the data
  // scope differs (rule 3 above), which this module does not enforce.
  contacts: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    delete: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    export: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
  },
  messaging: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
  },

  // Row 2 — "Downline pipeline states / ratios / names-in-play": rep=never, upline=team (aggregate),
  // rvp=org-wide, admin=full, dual=upline-side. Read-only aggregate visibility — never raw PII (row 3).
  downline_visibility: {
    read: [Role.UPLINE, Role.RVP, Role.ADMIN],
  },

  // Row 3 — "Downline raw contact PII / conversation content": never for upline/rvp/dual (except an
  // explicit three-way, a WP05/WP09 workflow, not an RBAC grant); audited-only for ADMIN, meaning
  // NOT a bypass. Deliberately empty: see canAccessDownlinePIIAudited() for the one legitimate path.
  downline_pii: {},

  // Row 4 — "Flagged-content review": rep=never, upline=team, rvp=org-wide, admin=full,
  // dual=upline-side.
  compliance_audit: {
    read: [Role.UPLINE, Role.RVP, Role.ADMIN],
    approve: [Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // Row 5 — "Billing (own)": rep=manage, upline=manage, rvp=manage, admin=full, dual=rep-side.
  billing_own: {
    manage: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
  },

  // Row 6 — "Billing (downline/org-sponsored)": rep=never, upline=view downline, rvp=configure+pay,
  // admin=full, dual=upline-side.
  billing_org: {
    read: [Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // Row 7 — "Org-sponsored seat config": rep=never, upline=never, rvp=yes, admin=yes, dual="if rvp".
  // A DUAL user's `role` is exactly `DUAL`, never simultaneously `RVP` (single-role-enum schema, §3.1)
  // — so the "if rvp" qualifier is structurally unreachable for a DUAL-role user and correctly
  // resolves to "no" here (DUAL is never listed; see rule 2 — union only pulls from REP/UPLINE, and
  // neither is granted this resource, so DUAL is denied, matching every real-world DUAL account).
  org_seat_config: {
    manage: [Role.RVP, Role.ADMIN],
  },

  // Row 8 — "Data-rights (own export/delete)": yes for all five roles (step-up MFA required per
  // §16.4, enforced by T-12's step-up layer, not this matrix). `manage` is NOT a §16.6 row-8 action
  // — it is the pre-existing oversight capability (administering/fulfilling *other* users' data-rights
  // requests and legal holds, T-11) and is restricted to RVP+ADMIN only; this is the exact contract
  // `RBACService.assertPermission(role, 'data_rights', 'manage')` must keep enforcing.
  data_rights: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    export: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    delete: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // Row 9 — "Cross-org visibility": rep=never, upline=never, rvp=gated behind admin approval (NOT a
  // flat grant — see canAccessCrossOrg), admin=yes, dual=never.
  cross_org: {
    read: [Role.ADMIN],
  },

  // ── Extension resources (not literal §16.6 rows) ───────────────────────────────────────────
  // "incident_response" (T-15, §16.7 "Breach notification & incident response" — an IR lifecycle
  // "owned by the operator with an on-call rotation"). Not a literal §16.6 row, so — like the
  // other extension resources below — this is the one place its allow-list is spelled out. Scoped
  // to RVP/ADMIN only: incident records surface other users' account-security evidence (SecurityEvent
  // clusters, breach classification, notification detail) that is materially more sensitive than
  // the row-4 "Flagged-content review" UPLINE already sees team-scoped, so UPLINE is deliberately
  // NOT listed here (unlike compliance_audit's `read`/`approve`) — REP/UPLINE/DUAL are all denied;
  // only RVP/ADMIN can read or manage an incident record. DUAL is never hand-listed (rule 2 above)
  // and REP/UPLINE are absent from every action here, so DUAL's REP∪UPLINE union correctly resolves
  // to "denied" too.
  incident_response: {
    read: [Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },
  calendar: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.ADMIN],
    manage: [Role.ADMIN],
  },
  agent_logs: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.ADMIN],
  },
  social: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.ADMIN],
    approve: [Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.ADMIN],
  },
  team_metrics: {
    read: [Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },
  payment: {
    read: [Role.RVP, Role.ADMIN],
    manage: [Role.ADMIN],
  },
  user_profile: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.ADMIN],
  },
  onboarding: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.ADMIN],
    manage: [Role.ADMIN],
  },

  // T-19 (§6.5/§6.6): "the RVP/leader/rep who underwrites a new member's free tier" (§15.3/§1.6
  // glossary "Downline Sponsor") — any existing account can sponsor/invite a new downline member,
  // so `write` (send/resend an invite) is granted to every non-system-only role; DUAL derives REP∪
  // UPLINE as everywhere else. `manage` (oversight of invites sent by OTHERS — force-expire, audit,
  // org-wide visibility into pending invites) is scoped like row 4's "team"/"org-wide" review
  // capability: RVP (org-wide) + ADMIN (full) only, never a flat rep/upline grant. NOTE: this
  // resource answers "does this ROLE have the sponsor_invite capability at all" — it does NOT
  // encode the row-level "is this invite actually THIS caller's own" ownership check (rule 3 above);
  // that ownership gate lives in the service layer (see
  // src/services/onboarding/wp01/invite-state-machine.ts `assertInviteActionAuthorized`, called
  // from sponsor-invite.service.ts).
  sponsor_invite: {
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // T-19 (§6.7): "admin provisioning → enterprise" is the ONE manual, role-gated tier action in the
  // whole §6.7 assignment rule — every other outcome is computed automatically from the
  // registration path (auth source + sponsor-linked or not), never a role "performing an action" a
  // capability row would gate. Restricted to ADMIN only — not even RVP, unlike most other rows here
  // — because §6.7 names exactly "admin provisioning", no RVP-level exception.
  access_tier_assignment: {
    manage: [Role.ADMIN],
  },

  // T-45 (WP09, §14.4): "The RVP controls and populates the master calendar" — write/manage is
  // RVP+ADMIN only; every role reads it (reps see it read-only and mark attendance, §14.4).
  team_calendar_broadcast: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // T-45 (WP09, §14.2): either the rep or their upline trainer may propose/respond to a Coaching
  // Session — broader than team_calendar_broadcast's RVP-only write.
  coaching_session: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
    write: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
  },

  // T-45 (WP09, §14.5): the enterprise admin console — seat management, org analytics, custom
  // onboarding config, SSO config. RVP/ADMIN only (mirrors org_seat_config's row-7 allow-list).
  enterprise_console: {
    read: [Role.RVP, Role.ADMIN],
    manage: [Role.RVP, Role.ADMIN],
  },

  // T-45 (WP09, §14.5/uiux §5.9 item 7): the Sponsor Cockpit. Every role may be a Downline Sponsor
  // (§15.3) — the service layer scopes results to the caller's OWN sponsorships (sponsor_user_id =
  // caller), so a flat "everyone may read" grant here is safe; it is not a cross-account read.
  sponsor_cockpit: {
    read: [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN],
  },
};

/** Runtime-safe resource-key check — used to fail closed on a value from an untyped/dynamic source. */
function isKnownResource(resource: string): resource is Resource {
  return Object.prototype.hasOwnProperty.call(MATRIX, resource);
}

/**
 * The one place §16.6 gets enforced: "does `role` have `action` on `resource`?"
 *
 * Fail-closed by construction: an unknown resource, a resource with no grant for that action, or a
 * role not listed (and not covered by the DUAL union) all return `false`. Accepts `string` for
 * `resource`/`action` (not just the literal unions) so a value arriving at runtime from an untyped
 * boundary — a route param, a header, a dynamic dispatch table — is still fail-closed rather than
 * merely "would have been a compile error had someone typed it correctly."
 */
export function can(role: Role, resource: Resource | string, action: Action | string): boolean {
  if (!isKnownResource(resource)) return false;
  const grant = MATRIX[resource][action as Action];
  if (!grant) return false;

  if (grant.includes(role)) return true;

  // DUAL = REP ∪ UPLINE (§6.2) — computed here, never hand-listed in MATRIX (rule 2 above).
  if (role === Role.DUAL && (grant.includes(Role.REP) || grant.includes(Role.UPLINE))) {
    return true;
  }

  return false;
}

/** Context an ADMIN must supply to exercise the row-3 audited-only exception. Never optional in spirit. */
export interface AuditedAccessContext {
  /** The ADMIN user id performing the access — goes on the audit record. */
  actorId: string;
  /** Why this specific access is happening — goes on the audit record. */
  reason: string;
}

/**
 * §16.6 row 3's ADMIN exception: "Downline raw contact PII / conversation content" is
 * `audited-only`, never a bypass. `can(role, 'downline_pii', anything)` always returns `false` —
 * for every role, ADMIN included — because `MATRIX.downline_pii` is empty and this module has no
 * generic ADMIN bypass. This is the *only* function that can authorize that access, and only for
 * ADMIN, and only when the caller actually supplies an audit context (the write-the-audit-entry
 * obligation is the caller's — e.g. via `AuditService` — this function only gates the check and
 * refuses to answer `true` without the context that access requires).
 */
export function canAccessDownlinePIIAudited(
  role: Role,
  audit: AuditedAccessContext | null | undefined
): boolean {
  if (role !== Role.ADMIN) return false;
  if (!audit || !audit.actorId || !audit.reason) return false;
  return true;
}

/**
 * §16.6 row 9's RVP exception: cross-org visibility is "gated behind admin approval" for RVP — not
 * a flat grant. ADMIN gets it directly (`MATRIX.cross_org.read` lists ADMIN). RVP only gets it when
 * the caller supplies the id of the admin who approved the specific access.
 */
export function canAccessCrossOrg(role: Role, approvedByAdminId: string | null | undefined): boolean {
  if (can(role, 'cross_org', 'read')) return true;
  if (role === Role.RVP && !!approvedByAdminId) return true;
  return false;
}
