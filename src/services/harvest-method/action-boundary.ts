// WP03 §8.5 — anti-patterns ARCHITECTURALLY BLOCKED at the action-queue boundary (T-27).
//
// T-26 already blocks the two biggest §8.5 anti-patterns structurally, by omission + the queue
// engine itself: "short-circuiting the three layers" (the queue simply returns `available:false`
// until all three layers are complete, prioritized-queue.service.ts) and "excluded contact in
// queue" (eligibility.ts's hard-exclusion filter + the EXCLUDED-tier filter in getQueue). This
// module is the NEXT layer: the three §8.5 anti-patterns that are only preventable by rejecting a
// caller's REQUEST SHAPE before it ever reaches the queue engine, because nothing in the engine
// itself would otherwise refuse them:
//
//   1. "manual A-tier override -> striped (score-based tiering is immutable)" — a request body
//      attempting to smuggle a client-supplied tier/score/priority field.
//   2. "batch cold outreach (select-N-and-blast) -> not supported" — a request attempting to act on
//      more than one contact per call (an array-shaped contactId, or a plural contactIds field).
//   3. "extraction-first sorting (by perceived wealth) -> not a permitted sort mode" — a request
//      attempting to select an alternate queue ordering via a sort/sortBy/orderBy query param.
//
// Per this build unit's brief: these must be REJECTED (4xx), never silently warned about or
// silently stripped. A silent strip/ignore is indistinguishable, from the outside, from "this
// input isn't wired up yet" — it gives no signal if a future refactor accidentally started
// honoring it. An explicit rejection is a permanent, testable tripwire: the anti-pattern attempt
// itself fails, by design, every time it's tried — which is what "architecturally blocked" means
// here, as opposed to "discouraged in copy" (a UI hint, a comment, a lint rule that ships bypassed).

export type BlockedAntiPattern = 'manual_tier_override' | 'batch_cold_outreach' | 'extraction_first_sorting';

export class AntiPatternBlockedError extends Error {
  constructor(
    public readonly antiPattern: BlockedAntiPattern,
    message: string
  ) {
    super(message);
    this.name = 'AntiPatternBlockedError';
  }
}

// T-27 QC fast-follow: every guard below is CASE-INSENSITIVE over its OWN already-defined forbidden
// key set, and scans exactly ONE level of object nesting (a body's own top-level keys, plus the
// top-level keys of any of ITS OWN object-shaped values) — so `{Tier: 'A'}` and
// `{override: {tier: 'A'}}` are both caught, not just the exact-case top-level form. This
// deliberately does NOT walk deeper than one level, and does NOT widen the key sets themselves with
// open-ended semantic synonyms (e.g. "rank"/"ranking"/"targets"/"ids") — no route in this codebase
// ever reads those names, so matching them would guard against an input that can't occur rather than
// closing a real gap. Scope is intentionally: same keys, case-insensitive, one level of nesting.

/** Case-insensitively finds the first own-key of `obj` (and, one level down, of any of its own
 *  object-shaped — non-array, non-null — values) that case-insensitively equals one of `forbidden`.
 *  Returns the actual (as-typed) key name found, or undefined if none match. */
function findForbiddenKey(obj: Record<string, unknown>, forbidden: readonly string[], depth = 0): string | undefined {
  const lowerForbidden = forbidden.map((f) => f.toLowerCase());
  for (const key of Object.keys(obj)) {
    if (lowerForbidden.includes(key.toLowerCase())) return key;
  }
  if (depth === 0) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = findForbiddenKey(value as Record<string, unknown>, forbidden, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/** §8.5 "manual A-tier override -> striped (score-based tiering is immutable)." The readiness
 *  tier/score are ALWAYS computed server-side by readiness-engine.ts — no route in this codebase
 *  exposes a way to set one directly, and this guard makes that a REJECTION rather than a mere
 *  absence: any caller attempting to pass one of these fields (whatever the actual route does with
 *  it) is refused before the request reaches the queue engine at all. */
const TIER_OVERRIDE_KEYS = ['tier', 'overrideTier', 'forceTier', 'readinessTier', 'readinessScore', 'score', 'priority'] as const;

export function rejectTierOverride(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  const hit = findForbiddenKey(body, TIER_OVERRIDE_KEYS);
  if (hit) {
    throw new AntiPatternBlockedError(
      'manual_tier_override',
      `"${hit}" is not an accepted field on this route — the readiness tier/score is always ` +
        'server-computed and immutable (§8.5 "manual A-tier override -> striped").'
    );
  }
}

/** §8.5 "batch cold outreach (select-N-and-blast) -> not supported." Every action-queue mutation
 *  in this codebase acts on exactly ONE contact per call. An array-shaped `contactId`, or a plural
 *  `contactIds` field — case-insensitively, and one level of nesting deep (see module header) — is
 *  rejected outright rather than silently processed as a batch (which is the only way "not
 *  supported" is a real architectural block instead of an accident of what the handler happens to
 *  destructure). */
function findBatchHit(obj: Record<string, unknown>, depth = 0): { key: string; isArrayContactId: boolean } | undefined {
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower === 'contactid' && Array.isArray(value)) return { key, isArrayContactId: true };
    if (lower === 'contactids') return { key, isArrayContactId: false };
  }
  if (depth === 0) {
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = findBatchHit(value as Record<string, unknown>, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

export function rejectBatchPayload(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return;
  const hit = findBatchHit(body);
  if (!hit) return;
  if (hit.isArrayContactId) {
    throw new AntiPatternBlockedError(
      'batch_cold_outreach',
      `"${hit.key}" must be a single id, not an array — batch/select-N-and-blast actions are not ` +
        'supported (§8.5 "batch cold outreach ... not supported").'
    );
  }
  throw new AntiPatternBlockedError(
    'batch_cold_outreach',
    `"${hit.key}" (batch) is not an accepted field — batch/select-N-and-blast actions are not ` +
      'supported (§8.5 "batch cold outreach ... not supported").'
  );
}

/** §8.5 "extraction-first sorting (by perceived wealth) -> not a permitted sort mode." The action
 *  queue has exactly one ordering (tier precedence, hidden score breaks ties only within a tier —
 *  prioritized-queue.service.ts's own `TIER_SORT_RANK`) and no client-selectable sort mode at all.
 *  A request naming any alternate sort param — case-insensitively; query strings have no nesting, so
 *  there is no nested-object case to scan here — is rejected rather than silently ignored. */
const SORT_OVERRIDE_PARAMS = ['sort', 'sortBy', 'orderBy', 'order_by', 'sort_by'] as const;

export function rejectSortOverride(searchParams: URLSearchParams): void {
  const lowerForbidden = new Set(SORT_OVERRIDE_PARAMS.map((p) => p.toLowerCase()));
  for (const key of searchParams.keys()) {
    if (lowerForbidden.has(key.toLowerCase())) {
      throw new AntiPatternBlockedError(
        'extraction_first_sorting',
        `"${key}" is not an accepted query parameter — the action queue has exactly one ordering ` +
          '(readiness tier, §8.2/§8.3); a client-selectable sort mode (e.g. by perceived wealth) is ' +
          'not permitted (§8.5 "extraction-first sorting ... not a permitted sort mode").'
      );
    }
  }
}
