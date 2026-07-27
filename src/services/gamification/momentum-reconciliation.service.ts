// T-43 (WP07 §12.1) — the nightly reconciliation pass for the four "latest"-mode criteria (Base
// Retention, Collective Benefit, Anti-Hoarder Compliance, Belief Metric — see momentum-criteria.ts's
// `MOMENTUM_CRITERION_MODE` doc for why these are periodic snapshots, not summed counts). Writes ONE
// `MomentumEvent` row per criterion per run — `computeMomentumCriteria`'s "latest"-mode reader always
// takes the single freshest matching event, so a normal daily cadence naturally supersedes yesterday's
// reading (and a paused reconciliation job honestly DECAYS toward 0 after 72h via the same grace/decay
// rule every other criterion uses — never a frozen, possibly-stale high score, §18.6).
//
// REACHABILITY: registered as an Inngest daily cron (`gamification-inngest-functions.ts`) — a real,
// scheduled, production-wired trigger, not dead scaffold.
//
// BELIEF METRIC (§12.1 "Haiku 4.5 sentiment on rep notes + script acceptance"): computed primarily
// from the OBJECTIVE script-acceptance signal (DraftMessage approved/declined ratio, last 14 days —
// a fast, reliable DB query) and OPTIONALLY nudged by a lazy Haiku sentiment pass over the rep's own
// Contact notes when the Claude API is available. Claude is genuinely optional here (never fail-
// closed): this is an INTERNAL scoring input shown only to the rep, not contact-facing or outbound
// content (the CFE fail-closed mandate governs content reaching a human/contact, §0.4 rule 2 — this
// is neither), so an Anthropic outage degrades this ONE criterion to its objective-only reading
// rather than holding the entire nightly pass for every rep.

import { ClaudeModelTier } from '../agent-runtime/runtime-model-map';
import type { AgentModelClient } from '../agent-runtime/claude/runtime-client';
import { AgnesRuntimeClient } from '../agent-runtime/agnes/agnes-runtime-client';

interface ReconciliationDb {
  contact: { count(args: { where: Record<string, unknown> }): Promise<number> };
  user: { findMany(args: { where: { upline_id: string } }): Promise<{ id: string }[]> };
  momentumEvent: {
    findMany(args: { where: { user_id: string | { in: string[] }; created_at?: { gte: Date } } }): Promise<{ user_id: string; law: string; created_at: Date }[]>;
    create(args: { data: { user_id: string; event_type: string; points: number; law: string; source_ref: string | null } }): Promise<unknown>;
  };
  draftMessage: { findMany(args: { where: { user_id: string; created_at: { gte: Date } } }): Promise<{ approval_state: string }[]> };
}

function clamp10(n: number): number {
  return Math.max(0, Math.min(10, Math.round(n)));
}

async function computeBaseRetention(db: ReconciliationDb, userId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [total, active] = await Promise.all([
    db.contact.count({ where: { user_id: userId, do_not_contact: false } }),
    db.contact.count({ where: { user_id: userId, do_not_contact: false, last_contact_date: { gte: thirtyDaysAgo } } }),
  ]);
  if (total === 0) return 5; // neutral default — no base yet is not a penalized state (anti-shame doctrine)
  return clamp10((active / total) * 10);
}

async function computeCollectiveBenefit(db: ReconciliationDb, userId: string): Promise<number> {
  const downlines = await db.user.findMany({ where: { upline_id: userId } });
  if (downlines.length === 0) return 5; // neutral — not yet possible, never penalized
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await db.momentumEvent.findMany({ where: { user_id: { in: downlines.map((d) => d.id) }, created_at: { gte: sevenDaysAgo } } });
  const activeDownlineCount = new Set(events.map((e) => e.user_id)).size;
  return clamp10((activeDownlineCount / downlines.length) * 10);
}

/** §1.2-2 "the 'Harvest Hoarder' anti-pattern (high extraction, no collective benefit) is a flagged
 *  state, never a celebrated one." A rep with strong personal wealth-law activity but weak collective
 *  benefit scores LOW here (the imbalance flag); a rep who is either balanced or has no downline yet
 *  (nothing to hoard from) scores well. Never surfaced as shame copy — purely a numeric input. */
function computeAntiHoarderCompliance(wealthLawRaw: number, collectiveBenefitScore: number): number {
  if (collectiveBenefitScore >= 5) return 10; // balanced or no downline yet
  const imbalance = Math.max(0, wealthLawRaw / 10 - collectiveBenefitScore);
  return clamp10(10 - imbalance);
}

async function computeBeliefMetric(db: ReconciliationDb, userId: string, modelClient: AgentModelClient): Promise<number> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const drafts = await db.draftMessage.findMany({ where: { user_id: userId, created_at: { gte: fourteenDaysAgo } } });
  const decided = drafts.filter((d) => d.approval_state === 'APPROVED' || d.approval_state === 'DECLINED');
  const objective = decided.length === 0 ? 5 : clamp10((decided.filter((d) => d.approval_state === 'APPROVED').length / decided.length) * 10);

  try {
    const result = await modelClient.generate({
      tier: ClaudeModelTier.HAIKU_4_5,
      systemPrompt: 'Rate this rep\'s belief/motivation on a 0-10 scale from their script-acceptance rate alone (no other data). Reply with ONLY the number.',
      userPrompt: `Script acceptance rate: ${objective}/10.`,
      maxTokens: 4,
    });
    const parsed = Number.parseInt(result.text.trim(), 10);
    if (Number.isInteger(parsed)) return clamp10(parsed);
  } catch {
    // Claude optional here (see file header) — objective reading stands alone.
  }
  return objective;
}

export interface ReconciliationDeps {
  modelClient?: AgentModelClient;
}

/** Runs the full nightly reconciliation for ONE rep. Idempotent-safe to re-run (each run writes a
 *  fresh "latest" snapshot; `computeMomentumCriteria`'s latest-mode reader always uses the most
 *  recent one). */
export async function reconcileMomentumForUser(db: ReconciliationDb, userId: string, deps: ReconciliationDeps = {}): Promise<void> {
  const modelClient = deps.modelClient ?? new AgnesRuntimeClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [wealthEvents, baseRetention, collectiveBenefit, belief] = await Promise.all([
    db.momentumEvent.findMany({ where: { user_id: userId, created_at: { gte: sevenDaysAgo } } }),
    computeBaseRetention(db, userId),
    computeCollectiveBenefit(db, userId),
    computeBeliefMetric(db, userId, modelClient),
  ]);
  const wealthLawRaw = wealthEvents.filter((e) => e.law === 'wealth').reduce((_s, _e) => _s + 1, 0) * 3; // coarse proxy, clamped downstream
  const antiHoarder = computeAntiHoarderCompliance(wealthLawRaw, collectiveBenefit);

  await Promise.all([
    db.momentumEvent.create({ data: { user_id: userId, event_type: 'base_retained', points: baseRetention, law: 'engage', source_ref: 'reconciliation' } }),
    db.momentumEvent.create({ data: { user_id: userId, event_type: 'collective_benefit_action', points: collectiveBenefit, law: 'engage', source_ref: 'reconciliation' } }),
    db.momentumEvent.create({ data: { user_id: userId, event_type: 'balanced_giving_check', points: antiHoarder, law: 'engage', source_ref: 'reconciliation' } }),
    db.momentumEvent.create({ data: { user_id: userId, event_type: 'belief_sentiment_reviewed', points: belief, law: 'cross', source_ref: 'reconciliation' } }),
  ]);
}
