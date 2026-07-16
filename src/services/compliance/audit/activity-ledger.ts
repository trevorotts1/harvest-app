import { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac-matrix';
import type { AuditEntryRecord, AuditQueryFilters, AuditRepository } from './audit-service';

/**
 * The rep-visible Agent Activity Ledger (§17.8: "the immutable compliance audit store and the
 * rep-visible Agent Activity Ledger all derive from one event stream, so operator observability
 * and rep-facing transparency never diverge"). This is the READ side over the same
 * `AuditRepository` the durable store writes to — no separate ledger table, no separate event
 * stream, by construction.
 *
 * RBAC scoping (§16.6 row 4, "Flagged-content review": rep — never; upline — team; rvp — org-wide;
 * admin — full; dual — upline-side) layered with an own-scope transparency baseline every role
 * gets regardless of that matrix row:
 *
 *   - **Own-scope is always allowed**, for every role including rep. This is deliberately NOT
 *     gated by `can(role, 'compliance_audit', 'read')` — that matrix row governs the distinct
 *     capability of reviewing SOMEONE ELSE's flagged content (which a bare rep never gets), not
 *     "can I see my own Activity Ledger" (which every role gets — the same "own export/delete"
 *     baseline pattern §16.6 row 8 uses for data-rights).
 *   - **Cross-user requests** require `can(role, 'compliance_audit', 'read')` (upline/rvp/admin
 *     only — rep and a bare dual-without-upline-side are denied by construction, matching the
 *     matrix's blank rep cell).
 *   - **Team/org-wide scope resolution** (which OTHER users an upline/rvp may see) is a data-layer
 *     concern this module deliberately does NOT own — per `rbac-matrix.ts`'s own documented rule
 *     3 ("row-level data scope... is a data-access-layer concern each WP's query/service layer
 *     owns"), knowing org-tree/team membership belongs to WP01/WP08, not the audit store. A
 *     `DownlineScopeResolver` is injected for that; the safe fail-closed default (no resolver
 *     wired) is "nobody's downline is visible yet" — never "everybody's is."
 *   - **ADMIN is `full`** per the matrix with no scope ambiguity (no org-tree knowledge required
 *     to know "admin sees everyone"), so admin bypasses the resolver entirely.
 */

export interface ActivityLedgerCaller {
  id: string;
  role: Role;
}

export interface ActivityLedgerQuery {
  /** Whose ledger to read. Defaults to the caller's own id (own-scope). */
  targetUserId?: string;
  from?: string;
  to?: string;
}

/**
 * Resolves which OTHER users' entries an upline/rvp caller may see (§16.6 row 2/4: "team
 * (aggregate)" for upline, "org-wide" for rvp). Returning `'ALL'` grants org-wide-style visibility
 * (rvp); returning a user-id array grants exactly those (upline's team). WP01/WP08 wire a real
 * org-tree-backed implementation in production; the default below is intentionally the most
 * restrictive possible answer.
 */
export interface DownlineScopeResolver {
  resolveVisibleUserIds(caller: ActivityLedgerCaller): Promise<string[] | 'ALL'>;
}

/** Fail-closed default: until a real org-tree resolver is wired in, an upline/rvp caller's
 *  cross-user requests see nobody beyond their own record — never "everybody's," which is what a
 *  naive default-allow would risk. */
export const OWN_ONLY_SCOPE_RESOLVER: DownlineScopeResolver = {
  async resolveVisibleUserIds(): Promise<string[] | 'ALL'> {
    return [];
  },
};

export class ActivityLedgerAccessDeniedError extends Error {
  constructor(caller: ActivityLedgerCaller, targetUserId: string) {
    super(
      `ActivityLedger: role '${caller.role}' (caller ${caller.id}) may not read the Activity Ledger for user '${targetUserId}' — deny-by-default per §16.6/§17.2`
    );
    this.name = 'ActivityLedgerAccessDeniedError';
  }
}

export class ActivityLedgerService {
  constructor(
    private repository: AuditRepository,
    private scopeResolver: DownlineScopeResolver = OWN_ONLY_SCOPE_RESOLVER
  ) {}

  /**
   * Reads the Activity Ledger for `query.targetUserId` (defaulting to the caller's own id),
   * enforcing the RBAC scoping documented above. Throws `ActivityLedgerAccessDeniedError` rather
   * than returning an empty/partial result on denial — a silent empty list would be
   * indistinguishable from "this user really has no activity," which is exactly the failure mode
   * §17.7's "no screen ever renders a false empty state" doctrine warns against for evidence
   * surfaces.
   */
  async listActivity(
    caller: ActivityLedgerCaller,
    query: ActivityLedgerQuery = {}
  ): Promise<AuditEntryRecord[]> {
    const targetUserId = query.targetUserId ?? caller.id;
    const filters: AuditQueryFilters = { from: query.from, to: query.to };

    if (targetUserId === caller.id) {
      // Own-scope transparency baseline — always allowed, every role.
      return this.repository.query({ ...filters, user_id: targetUserId });
    }

    if (!can(caller.role, 'compliance_audit', 'read')) {
      throw new ActivityLedgerAccessDeniedError(caller, targetUserId);
    }

    if (caller.role === Role.ADMIN) {
      // §16.6 row 4: admin = full. No org-tree knowledge needed to grant this.
      return this.repository.query({ ...filters, user_id: targetUserId });
    }

    // upline/rvp/dual(upline-side): scoped to whatever the injected resolver says is visible.
    const visible = await this.scopeResolver.resolveVisibleUserIds(caller);
    if (visible !== 'ALL' && !visible.includes(targetUserId)) {
      throw new ActivityLedgerAccessDeniedError(caller, targetUserId);
    }
    return this.repository.query({ ...filters, user_id: targetUserId });
  }

  /**
   * Reads the caller's full visible scope in one call — their own entries, plus (for
   * upline/rvp/admin) every downline user the scope resolver names. Never throws: an elevated
   * role with no team wired up yet gets their own entries back rather than an error (§17.7 "first-
   * class no-team-yet state, not an error").
   */
  async listVisibleActivity(caller: ActivityLedgerCaller, query: Omit<ActivityLedgerQuery, 'targetUserId'> = {}): Promise<AuditEntryRecord[]> {
    const filters: AuditQueryFilters = { from: query.from, to: query.to };

    if (caller.role === Role.ADMIN) {
      return this.repository.query(filters);
    }

    if (!can(caller.role, 'compliance_audit', 'read')) {
      // rep (and a bare dual with no upline-side grant): own entries only.
      return this.repository.query({ ...filters, user_id: caller.id });
    }

    const visible = await this.scopeResolver.resolveVisibleUserIds(caller);
    if (visible === 'ALL') {
      return this.repository.query(filters);
    }
    const userIds = Array.from(new Set([caller.id, ...visible]));
    return this.repository.query({ ...filters, user_ids: userIds });
  }
}
