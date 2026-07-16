// WP01 §6.2 — the five-role architecture + DUAL persona isolation.
//
// The five roles are the canonical Prisma `Role` (§3.1): REP (business owner), UPLINE (team leader),
// RVP (regional/org leader — a tier above upline), ADMIN (system), and DUAL (concurrent rep + upline;
// union permissions; loads upline steps in addition to rep steps; an explicit persona switcher whose
// state is preserved PER PERSONA and NEVER BLENDED).
//
// The load-bearing invariant this module enforces with teeth is the WP01 "dual-role bleed" critical
// failure (§6.2 / §17.2 / uiux §5.9-9): a DUAL user's rep-context data must never leak into their
// upline-context views and vice-versa. Two mechanisms:
//
//   1. CAPABILITY isolation (`canInPersona`): while a DUAL user is acting in a persona, their
//      effective capability is EXACTLY that persona's base role — never the REP∪UPLINE union. The
//      union (`rbac.ts`/`rbac-matrix.ts` `can()`) is the right model for "what a DUAL account is
//      entitled to overall"; it is the WRONG model for "what this user may do RIGHT NOW while the
//      switcher is on 'rep'." Acting-as-rep must not exercise an upline-only capability.
//   2. DATA isolation (`PersonaScopedStore` / `personaScopeKey`): rep-persona rows and upline-persona
//      rows for the SAME user id live in distinct namespaces, so a read in one persona cannot return
//      the other's rows. This is the concrete partition a bleed would have to cross.
//
// Plus the §17.2 conflict-of-interest rule (`resolveApprovalReviewer`): a DUAL user's rep-persona
// approval never routes to themselves as their own upline reviewer.

import { Role } from '@prisma/client';

import { can, type Action, type Resource } from '@/lib/auth/rbac-matrix';

/** The five canonical roles (§3.1), in matrix order. */
export const ALL_ROLES: readonly Role[] = [Role.REP, Role.UPLINE, Role.RVP, Role.ADMIN, Role.DUAL];

/**
 * A persona is the "hat" a user is wearing right now. Only DUAL genuinely switches between two; every
 * other role has a single, fixed persona. Kept to the two §6.2 personas (rep / upline) because those
 * are the two a DUAL user concurrently holds.
 */
export type Persona = 'rep' | 'upline';

export function isDualRole(role: Role): boolean {
  return role === Role.DUAL;
}

/**
 * The persona(s) a role legitimately operates in. DUAL is the only multi-persona role. REP is
 * rep-side; UPLINE and RVP are upline-side; ADMIN (a system role) may act on either side.
 */
export function personasForRole(role: Role): Persona[] {
  switch (role) {
    case Role.REP:
      return ['rep'];
    case Role.UPLINE:
    case Role.RVP:
      return ['upline'];
    case Role.DUAL:
    case Role.ADMIN:
      return ['rep', 'upline'];
    default: {
      // Fail-closed for any value outside the enum (defensive; TS exhausts the union above).
      const _exhaustive: never = role;
      return [];
    }
  }
}

/**
 * The base role whose capabilities apply while a DUAL user acts in a given persona. This is what
 * decomposes the DUAL union back into a single active hat: acting-as-'rep' ⇒ REP capabilities only;
 * acting-as-'upline' ⇒ UPLINE capabilities only.
 */
export function baseRoleForPersona(persona: Persona): Role {
  return persona === 'rep' ? Role.REP : Role.UPLINE;
}

/**
 * The capability check for a user ACTING in a specific persona — the anti-bleed capability gate.
 *
 *  - The user must actually hold the persona (`personasForRole`), else deny (fail-closed): a REP
 *    can never act in an 'upline' persona at all.
 *  - For a DUAL user, the check uses ONLY the active persona's base role, never the union — so a DUAL
 *    user with the switcher on 'rep' is denied every upline-only capability (e.g. reading downline
 *    visibility), exactly as a plain REP would be, and vice-versa. This is the difference from
 *    `can(Role.DUAL, …)`, which (correctly, for the "overall entitlement" question) grants REP∪UPLINE.
 *  - For a non-DUAL role, the role's own grant applies (RVP keeps its org-wide upline capabilities;
 *    decomposing it to a bare UPLINE would wrongly under-grant it).
 */
export function canInPersona(
  role: Role,
  persona: Persona,
  resource: Resource | string,
  action: Action | string
): boolean {
  if (!personasForRole(role).includes(persona)) return false;
  if (role === Role.DUAL) return can(baseRoleForPersona(persona), resource, action);
  return can(role, resource, action);
}

// ─── Persona-scoped data partition (the concrete no-bleed boundary) ─────────────────────────────

/**
 * The namespace key that separates one persona's data from the other's for the SAME user. Any store
 * that keys writes/reads by this value cannot serve rep-persona rows to an upline-persona read.
 */
export function personaScopeKey(userId: string, persona: Persona): string {
  return `${userId}::persona:${persona}`;
}

/**
 * A generic persona-partitioned in-memory store. It exists to make the no-bleed invariant testable
 * and enforceable rather than aspirational: a `put` in one persona is invisible to a `list`/`get` in
 * the other persona for the same user. WP01's fuller build (T-20) persists per-persona state; this is
 * the reference partition that build must preserve.
 */
export class PersonaScopedStore<T> {
  private readonly byScope = new Map<string, T[]>();

  put(userId: string, persona: Persona, item: T): void {
    const key = personaScopeKey(userId, persona);
    const bucket = this.byScope.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      this.byScope.set(key, [item]);
    }
  }

  /** Rows visible to this user WHILE ACTING in this persona — never the other persona's rows. */
  list(userId: string, persona: Persona): readonly T[] {
    return this.byScope.get(personaScopeKey(userId, persona)) ?? [];
  }

  clear(): void {
    this.byScope.clear();
  }
}

// ─── §17.2 conflict-of-interest: a DUAL user is never their own reviewer ────────────────────────

export interface ApprovalRoutingInput {
  /** The user who submitted the item (as rep). */
  submitterUserId: string;
  /** The submitter's own upline (the natural reviewer of a rep-submitted item). */
  submitterUplineId: string | null;
  /** The upline ABOVE the submitter's upline — the escalation target if the submitter is their own upline. */
  nextUplineId: string | null;
}

export interface ApprovalRoutingResult {
  /** Who should review the item; null when no eligible upline exists (caller falls back per §5.3). */
  reviewerUserId: string | null;
  /** True when routing had to skip the submitter-as-their-own-upline conflict. */
  escalated: boolean;
}

/**
 * §17.2: "dual-role approvals a user sends as rep never route to themselves as their own upline
 * reviewer (conflict-of-interest → route to the next upline)." If the rep-submitted item's natural
 * reviewer (the submitter's upline) IS the submitter themselves — the exact self-review a DUAL,
 * self-sponsored user could create — routing escalates to the next upline instead.
 */
export function resolveApprovalReviewer(input: ApprovalRoutingInput): ApprovalRoutingResult {
  const { submitterUserId, submitterUplineId, nextUplineId } = input;
  if (submitterUplineId && submitterUplineId !== submitterUserId) {
    return { reviewerUserId: submitterUplineId, escalated: false };
  }
  // Either there is no upline, or the submitter is their own upline (conflict): escalate.
  return { reviewerUserId: nextUplineId ?? null, escalated: true };
}
