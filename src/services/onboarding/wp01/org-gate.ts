// WP01 §6.3 + §17.1 — the organization gate: the single switch that shapes the entire product.
//
// Organization is selected once at onboarding (`User.org_type`, the canonical Prisma `OrgType`) and
// LOCKS a branch for that user for the life of the account (an org switch is the separate §18.7
// archive-and-rewipe flow, not WP01). This module is the AUTHORITATIVE branch-lock the whole
// platform consumes: WP03's Primerica overlay, WP08's orchard/phased-timeline/multiplication math,
// WP12's Primerica-weighted quotes, and every solution-number feature are all guarded behind the
// org-branch check "locked at the WP01 level before any dependent feature initiates" (§17.1, §8).
//
// THE LAW (§17.1, QC critical failure "Primerica leak", SC8): a non-Primerica (universal) user must
// NEVER see a Primerica string, datum, or surface — and the gate is enforced at the DATA/API layer,
// not merely hidden in the UI. Two enforcement primitives back that here:
//
//   1. `assertPrimericaGate` / `gatePrimericaValue` — guard a Primerica-only service or field so it
//      simply does not execute / is omitted for a universal user (branch enforcement).
//   2. `assertNoPrimericaLeak` / `scanForPrimericaTerms` — a defense-in-depth data-layer tripwire: it
//      scans an already-assembled, about-to-be-returned payload and refuses (throws) if any
//      Primerica-gated term is present in a universal user's payload. This is what turns "we intended
//      not to leak" into "a leak is structurally caught before it reaches the wire."

import { OrgType } from '@prisma/client';

/** The two branches org selection locks the product into. */
export type OrgBranch = 'primerica' | 'universal';

/**
 * The single mapping from the persisted `OrgType` to the locked branch. PRIMERICA => the Primerica
 * branch; every other org type (EXTERNAL / independent / other) => the universal branch. Fail-closed:
 * anything that is not explicitly PRIMERICA is universal (never leaks Primerica by default).
 */
export function lockOrgBranch(orgType: OrgType): OrgBranch {
  return orgType === OrgType.PRIMERICA ? 'primerica' : 'universal';
}

export function isPrimericaBranch(orgType: OrgType): boolean {
  return lockOrgBranch(orgType) === 'primerica';
}

export class OrgBranchViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgBranchViolation';
  }
}

/**
 * Guard a Primerica-gated service/surface at the org-branch check (§17.1). Throws for a non-Primerica
 * user, so a Primerica-only code path cannot run for a universal user even if a UI or caller bug
 * reached it. `feature` names the guarded surface for the error/audit trail (never a secret).
 */
export function assertPrimericaGate(orgType: OrgType, feature: string): void {
  if (!isPrimericaBranch(orgType)) {
    throw new OrgBranchViolation(
      `Primerica-gated feature "${feature}" is not available to a non-Primerica (universal) user (§17.1).`
    );
  }
}

/**
 * Non-throwing counterpart for assembling a payload: returns `value` only for a Primerica user, and
 * `undefined` for a universal user — so a Primerica-only field is simply absent (not null-with-a-
 * Primerica-shaped-key) from a universal user's data.
 */
export function gatePrimericaValue<T>(orgType: OrgType, value: T): T | undefined {
  return isPrimericaBranch(orgType) ? value : undefined;
}

// ─── The Primerica-gated vocabulary (§0.5 "Primerica terms only behind the org gate", §17.1) ─────

/**
 * Distinctive, unambiguously-Primerica tokens that must never surface for a universal user. Kept to
 * brand/program-specific strings (not generic business words) so the scanner does not false-positive
 * on ordinary universal copy. Lower-cased; matching is case-insensitive and substring-based.
 */
export const PRIMERICA_GATED_TERMS: readonly string[] = [
  'primerica',
  'solution number',
  'a.l. williams',
  'al williams',
  'pfsu', // Primerica Financial Services University (pre-licensing program, §13.3)
];

/**
 * Recursively serialize any payload to its string content and return every Primerica-gated term it
 * contains. Keys AND values are scanned (a leak can hide in either — e.g. a `solutionNumber` field
 * name is itself a leak for a universal user). Returns [] for a clean payload.
 */
export function scanForPrimericaTerms(payload: unknown): string[] {
  const haystackParts: string[] = [];

  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      haystackParts.push(node);
    } else if (typeof node === 'number' || typeof node === 'boolean') {
      haystackParts.push(String(node));
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        haystackParts.push(key); // field NAMES are part of the surface too
        walk(value);
      }
    }
  };
  walk(payload);

  // Normalize so a leak hidden in a camelCase / snake_case / kebab-case FIELD NAME is still caught:
  // `solutionNumber`, `solution_number`, and `solution-number` all normalize to `solution number`
  // and match the gated term. camelCase boundary -> space; `_`/`-` runs -> space; collapse space.
  const haystack = haystackParts
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  // Also match against a dot-free view so `A.L. Williams` and `AL Williams` both trip the same term.
  const dotless = haystack.replace(/\./g, '');
  return PRIMERICA_GATED_TERMS.filter(
    (term) => haystack.includes(term) || dotless.includes(term.replace(/\./g, ''))
  );
}

/**
 * Data-layer tripwire (§17.1 / SC8: "0 Primerica strings render for a non-Primerica user"). For a
 * universal user, throws if the payload contains ANY Primerica-gated term. For a Primerica user it is
 * a no-op (they are entitled to Primerica content). Call this on anything crossing the API boundary
 * to a universal user.
 */
export function assertNoPrimericaLeak(payload: unknown, orgType: OrgType): void {
  if (isPrimericaBranch(orgType)) return;
  const hits = scanForPrimericaTerms(payload);
  if (hits.length > 0) {
    throw new OrgBranchViolation(
      `Primerica-gated content would leak to a non-Primerica user (§17.1): ${hits.join(', ')}.`
    );
  }
}

// ─── The branch-appropriate onboarding org context (§6.3 Flow A step 3) ─────────────────────────

/** The onboarding org-context surface, assembled per branch. Primerica-only fields are OMITTED for
 *  universal users — so the very shape contains zero Primerica strings for them. */
export interface OrgContext {
  branch: OrgBranch;
  orgType: OrgType;
  /** Present ONLY for a Primerica user: the (user-declared, not-verified) solution-number field. */
  solutionNumberField?: {
    label: string;
    /** Human-readable format hint (§6.3: 7-digit). */
    formatHint: string;
    /** The "not verified" caption (§6.10-4) shown after entry. */
    caption: string;
  };
  /** Present ONLY for a Primerica user: the Primerica-gated surfaces unlocked downstream (§17.1). */
  primericaSurfaces?: readonly string[];
}

/**
 * Build the onboarding org-context for a user. This is the authored branch fork of §6.3 Flow A
 * step 3: a Primerica user gets the solution-number entry field + the list of Primerica-gated
 * surfaces; a universal user gets NEITHER — the returned object is Primerica-free by construction and
 * passes `assertNoPrimericaLeak`.
 */
export function buildOrgContext(orgType: OrgType): OrgContext {
  if (isPrimericaBranch(orgType)) {
    return {
      branch: 'primerica',
      orgType,
      solutionNumberField: {
        label: 'Solution number',
        formatHint: '7 digits',
        caption: 'Not verified — we check the format only, not with Primerica.',
      },
      primericaSurfaces: [
        'harvest_method_primerica_overlay',
        'orchard',
        'phased_timeline',
        'multiplication_math',
        'primerica_weighted_quotes',
      ],
    };
  }
  // Universal branch: no Primerica field, no Primerica surfaces, no Primerica strings.
  return { branch: 'universal', orgType };
}
