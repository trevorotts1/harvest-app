// T-43 (WP07 §12.4) — the Quote Engine. `QuoteLibrary` scoped `all`/`primerica`; org-conditional mix;
// timed delivery (morning/midday/evening); anchor-personalized; Haiku 4.5 selects; EVERY quote
// passes the CFE before it can reach the rep (§0.4 rule 2, §12.9-4 — "a motivational line that
// promises income is still an income claim").
//
// CRITICAL DOCTRINE (§0.4 rule 4 / §18.7): a non-Primerica rep must NEVER see a Primerica-scoped
// quote. `candidatesForOrg` is the ONE filter point — it is a hard allow-list (deny-by-default),
// not a weighting nudge, so there is no code path that lets a Primerica quote leak into a non-
// Primerica rep's candidate pool at all, regardless of what the selector picks afterward.

import { ClaudeModelTier } from '../agent-runtime/runtime-model-map';
import type { AgentModelClient } from '../agent-runtime/claude/runtime-client';
import { AnthropicRuntimeClient } from '../agent-runtime/claude/anthropic-runtime-client';
import { ComplianceFilterEngine } from '../compliance/engine';
import type { CFEInput } from '@/types/compliance';
import { gateRepFacingContent, type CFEContentEvaluator } from './cfe-gate';
import { staticQuotesForOrg, type StaticQuote } from './quote-library-seed';
import type { QuoteRow } from './prisma-types';

export type QuoteTimeSlot = 'morning' | 'midday' | 'evening';

export interface QuoteDeliveryDeps {
  db?: { quoteLibrary: { findMany(args: { where: Record<string, unknown> }): Promise<QuoteRow[]> } };
  cfe?: CFEContentEvaluator;
  modelClient?: AgentModelClient;
}

export type QuoteDeliveryResult =
  | { status: 'ok'; quoteId: string; text: string; attribution: string | null }
  | { status: 'held'; reason: string };

/** The last-resort, always-CFE-safe evergreen line if every real candidate is held/flagged/blocked
 *  (never blank — SC9). Contains no income/earnings language whatsoever. */
const SAFE_FALLBACK_TEXT = 'Show up today — that is the whole mission.';

function weightedCandidateOrder(isPrimerica: boolean, general: StaticQuote[], primerica: StaticQuote[]): StaticQuote[] {
  if (!isPrimerica) return [...general];
  // §12.4 "a weighted mix of general motivation + Primerica leadership/field language" — a FIXED
  // (not seed-dependent) roughly-50/50 interleave. Deliberately NOT parameterized by the same `seed`
  // used to pick an index below: an earlier version alternated the interleave's own starting side by
  // `seed % 2`, which made every primerica-holding index share the OPPOSITE parity of `seed` itself —
  // so `candidates[seed % length]` could mathematically never land on a primerica index (any seed's
  // parity always excludes the primerica slots). Keeping this order fixed and letting `seed` vary
  // only the PICK removes that coupling entirely.
  const combined: StaticQuote[] = [];
  const maxLen = Math.max(general.length, primerica.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (general[i]) combined.push(general[i]);
    if (primerica[i]) combined.push(primerica[i]);
  }
  return combined;
}

function daySeed(userId: string, now: Date): number {
  const key = `${userId}:${now.toISOString().slice(0, 10)}`;
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

async function haikuSelect(
  modelClient: AgentModelClient,
  candidates: StaticQuote[],
  timeSlot: QuoteTimeSlot,
  fallbackIndex: number
): Promise<StaticQuote> {
  try {
    const listing = candidates.map((c, i) => `${i}. ${c.text}`).join('\n');
    const result = await modelClient.generate({
      tier: ClaudeModelTier.HAIKU_4_5,
      systemPrompt:
        'You select ONE motivational line index for a warm-market sales rep\'s ' +
        `${timeSlot} check-in. Reply with ONLY the number of the best line, nothing else.`,
      userPrompt: listing,
      maxTokens: 8,
    });
    const idx = Number.parseInt(result.text.trim(), 10);
    if (Number.isInteger(idx) && candidates[idx]) return candidates[idx];
  } catch {
    // Selection is NOT a fail-closed gate (it never blocks the rep from seeing SOME quote — only
    // the CFE decision on the final text is fail-closed). Degrade to deterministic below.
  }
  return candidates[fallbackIndex % candidates.length];
}

export interface DeliverQuoteOptions {
  userId: string;
  isPrimerica: boolean;
  timeSlot: QuoteTimeSlot;
  anchorStatement: string | null;
  userContext: CFEInput['userContext'];
  now?: Date;
}

/** Selects, personalizes, and CFE-clears ONE quote for delivery. Tries every candidate in weighted
 *  order until one clears the CFE; if none do (or the CFE is unavailable), returns `held` — the
 *  surface renders the honest "agents resting" copy, never a fabricated quote (§18.6). */
export async function deliverQuote(opts: DeliverQuoteOptions, deps: QuoteDeliveryDeps = {}): Promise<QuoteDeliveryResult> {
  const cfe = deps.cfe ?? new ComplianceFilterEngine();
  const modelClient = deps.modelClient ?? new AnthropicRuntimeClient();
  const now = opts.now ?? new Date();

  const general = staticQuotesForOrg(false).filter((q) => q.tags.includes(opts.timeSlot)).length
    ? staticQuotesForOrg(false).filter((q) => q.tags.includes(opts.timeSlot))
    : staticQuotesForOrg(false);
  const primerica = opts.isPrimerica
    ? staticQuotesForOrg(true).filter((q) => q.org_scope === 'PRIMERICA' && q.tags.includes(opts.timeSlot)).length
      ? staticQuotesForOrg(true).filter((q) => q.org_scope === 'PRIMERICA' && q.tags.includes(opts.timeSlot))
      : staticQuotesForOrg(true).filter((q) => q.org_scope === 'PRIMERICA')
    : [];

  // Optional DB-curated additions, org-scope-filtered with the SAME hard allow-list.
  let dbCandidates: StaticQuote[] = [];
  if (deps.db) {
    try {
      const rows = await deps.db.quoteLibrary.findMany({
        where: opts.isPrimerica ? {} : { org_scope: 'ALL' },
      });
      dbCandidates = rows
        .filter((r) => opts.isPrimerica || r.org_scope === 'ALL')
        .map((r) => ({ id: r.id, text: r.text, attribution: r.attribution, org_scope: r.org_scope as 'ALL' | 'PRIMERICA', tags: r.tags }));
    } catch {
      dbCandidates = [];
    }
  }

  const seed = daySeed(opts.userId, now);
  const staticOrdered = weightedCandidateOrder(opts.isPrimerica, general, primerica);
  const candidates = [...staticOrdered, ...dbCandidates];
  if (candidates.length === 0) {
    return { status: 'held', reason: 'no_candidates' };
  }

  const picked = await haikuSelect(modelClient, candidates, opts.timeSlot, seed);

  // Try the picked candidate first, then every remaining candidate in order, until one clears CFE.
  const ordered = [picked, ...candidates.filter((c) => c.id !== picked.id)];
  for (const candidate of ordered) {
    const text = opts.anchorStatement
      ? `${candidate.text}\n\nRemember: ${opts.anchorStatement}`
      : candidate.text;
    const gate = await gateRepFacingContent(text, cfe, opts.userContext);
    if (gate.pass) {
      return { status: 'ok', quoteId: candidate.id, text, attribution: candidate.attribution };
    }
  }

  // Every real candidate held/flagged/blocked — try the safe evergreen fallback (still CFE-checked,
  // never assumed clean).
  const fallbackGate = await gateRepFacingContent(SAFE_FALLBACK_TEXT, cfe, opts.userContext);
  if (fallbackGate.pass) {
    return { status: 'ok', quoteId: 'safe-fallback', text: SAFE_FALLBACK_TEXT, attribution: null };
  }
  return { status: 'held', reason: 'cfe_unavailable' };
}
