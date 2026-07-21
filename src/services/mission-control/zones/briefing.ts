// WP04 (T-32) — Zone 2: Overnight Briefing (uiux §5.2 item 2 / §4.1 Briefing Card).
//
// KNOWN SEAM GAP (stated, not silently worked around): the T-30 agent runtime (agent-runtime.ts,
// out of this unit's lane — "CONSUME T-30, do NOT modify the runtime core") persists a plain-
// language `reasoning_log` DESCRIPTION per AgentRun (e.g. "Reporting Agent composed the briefing
// narrative on claude-sonnet-5. CFE clear (score 4) -> entered the Approval Inbox.") but never
// persists the Reporting Agent's actual Sonnet-5-composed prose anywhere (`output.text` is
// generated, CFE-evaluated, and then discarded once the request completes — there is no DraftMessage
// for `rep_facing` output, since one is only created for `contact_outbound` surfaces with a
// `contactId`). So this zone cannot "replay" the Reporting Agent's literal sentence. Rather than
// fabricate prose to fill that gap (a doctrine violation — master spec §18.6 "no fabricated content
// ever"), this builder composes its narrative lines DETERMINISTICALLY from real, aggregated Activity
// Ledger rows (AgentRun grouped by agent_key/status, DraftMessage counts by CFE outcome) for this
// rep's real overnight window — genuinely real data, off the real T-30 stream, exactly as the ticket
// requires; it just does not literally quote Sonnet's discarded raw text. Each line still carries
// real receipts resolving to real AgentRun rows (uiux AC-5.2-9 / AC-4-10).
//
// T-57 R4-residual2 (dimension-B i18n re-gate) — this narrative IS deterministic template
// composition (see the paragraph above: "composes its narrative lines DETERMINISTICALLY", never a
// live Claude call), so the fix here is the template-composed branch of that remediation spec: every
// line now composes through the catalog's `t()` (namespace `briefing.line.*`, en.json/es.json), with
// CLDR one/other plural (`pluralCategory`/the `_one`/`_other` catalog-key convention,
// `src/lib/i18n/catalog.ts`) replacing the bare `count === 1 ? '' : 's'` English-only pluralization
// bug — so an es-locale rep genuinely gets a Spanish briefing, not silently-still-English text.
//
// Locale resolution: this zone's `db` parameter is typed `MissionControlPrismaClient`
// (`../prisma-types`) — a narrow, shared, intentionally-minimal DI surface every Today zone AND
// `today.service.ts` import; it declares no `user` accessor, and widening that shared cross-zone type
// (or threading a `locale` argument through `today.service.ts`/the `/api/mission-control/today`
// route) is outside this fix's owned-files lane (briefing.ts + OpenPhase.tsx + HiddenEarningsReveal.tsx
// + the catalog, ONLY — see the T-57 R4-residual2 remediation note). `resolveRepLocale` below instead
// duck-types the REAL capability: in production `db` is always the genuine Prisma client
// (`today.service.ts`: `opts.db ?? (prisma as unknown as MissionControlPrismaClient)` — `opts.db` is
// never overridden by the one real caller, the Today API route), which really does have
// `.user.findUnique`, so this resolves the rep's actual `User.locale` with ZERO changes to any file
// outside this unit's lane. Any `db` that lacks `.user` (every existing zone test's in-memory fake,
// `testing/in-memory-db.ts`) safely falls through to `DEFAULT_LOCALE` — never throws, matching this
// codebase's universal "never fabricate, never blank-crash a render" fallback posture (§17.7). This
// is intentionally NOT routed through the shared `db.agentRun`/`db.draftMessage` calls' fail path —
// a locale-lookup hiccup must not turn a real, working briefing into this zone's error state.
//
// DOCUMENTED GAP (for the next unit with route.ts/today.service.ts in its lane, not this one): the
// instant `today.service.ts` starts threading a real `locale` argument through from
// `identity`/session, that value should simply be passed to `buildBriefingZone` as the optional 4th
// `explicitLocale` parameter below (skipping the duck-typed DB lookup entirely) — a one-line change
// in `today.service.ts`'s `safeZone(() => buildBriefingZone(db, userId, now))` call, requiring no
// further change here.

import { AgentKey, getAgentSpec } from '@/services/agent-runtime';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';
import type { AgentRunRow, DraftMessageRow, MissionControlPrismaClient } from '../prisma-types';
import type { BriefingLine, BriefingReceipt, BriefingZoneData } from '../types';

const OVERNIGHT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CFE_BAND_RE = /CFE (clear|review|blocked)/;

function cfeBandOf(run: AgentRunRow): string | null {
  const m = run.reasoning_log?.match(CFE_BAND_RE);
  return m ? m[1] : null;
}

function receiptOf(run: AgentRunRow): BriefingReceipt {
  const spec = Object.values(AgentKey).includes(run.agent_key as AgentKey)
    ? getAgentSpec(run.agent_key as AgentKey)
    : null;
  return {
    agentRunId: run.id,
    agentKey: run.agent_key,
    agentDisplayName: spec?.displayName ?? run.agent_key,
    action: run.reasoning_log ?? `${run.agent_key} ran (${run.status}).`,
    when: (run.finished_at ?? run.created_at).toISOString(),
    cfeBand: cfeBandOf(run),
  };
}

const HELD_NO_KEY_MARKER = 'the Claude connection is not configured';
const HELD_CFE_DOWN_MARKER = 'double-check compliance';

/** See the module header's "Locale resolution" note. A locally-scoped duck-type — never a change to
 *  the shared `MissionControlPrismaClient` — for the one capability (`user.findUnique`) that DOES
 *  exist on every real Prisma client `db` actually is in production, but that the shared, narrow,
 *  cross-zone DI interface never declares. */
type LocaleCapableDb = {
  user?: {
    findUnique?: (args: { where: { id: string }; select: { locale: true } }) => Promise<{ locale: string | null } | null>;
  };
};

async function resolveRepLocale(db: MissionControlPrismaClient, userId: string, explicitLocale?: Locale): Promise<Locale> {
  if (explicitLocale) return explicitLocale;
  const maybeUser = (db as unknown as LocaleCapableDb).user;
  if (typeof maybeUser?.findUnique !== 'function') return DEFAULT_LOCALE;
  try {
    const user = await maybeUser.findUnique({ where: { id: userId }, select: { locale: true } });
    return isLocale(user?.locale) ? user.locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE; // a locale-lookup hiccup degrades to English, never this zone's error state.
  }
}

export async function buildBriefingZone(
  db: MissionControlPrismaClient,
  userId: string,
  now: Date = new Date(),
  /** Optional explicit override — see the module header's "DOCUMENTED GAP" note. Every existing
   *  caller (today.service.ts, every existing test) omits this and keeps compiling/behaving exactly
   *  as before; passing it skips the duck-typed DB lookup entirely. */
  explicitLocale?: Locale
): Promise<BriefingZoneData> {
  const locale = await resolveRepLocale(db, userId, explicitLocale);
  const allRuns = await db.agentRun.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: 200,
  });

  if (allRuns.length === 0) {
    return { state: 'first_day', freshnessStamp: null, lines: [] };
  }

  const freshnessStamp = (allRuns[0].finished_at ?? allRuns[0].created_at).toISOString();

  const latestReporting = allRuns.find((r) => r.agent_key === AgentKey.REPORTING);
  if (latestReporting?.status === 'HELD' && latestReporting.reasoning_log) {
    if (
      latestReporting.reasoning_log.includes(HELD_NO_KEY_MARKER) ||
      latestReporting.reasoning_log.includes(HELD_CFE_DOWN_MARKER)
    ) {
      return { state: 'agents_resting', freshnessStamp, lines: [] };
    }
  }

  const windowStart = new Date(now.getTime() - OVERNIGHT_WINDOW_MS);
  const overnightRuns = allRuns.filter((r) => (r.finished_at ?? r.created_at).getTime() >= windowStart.getTime());

  if (overnightRuns.length === 0) {
    return { state: 'empty', freshnessStamp, lines: [] };
  }

  const byAgent = new Map<string, AgentRunRow[]>();
  for (const run of overnightRuns) {
    if (run.status !== 'COMPLETED' && run.status !== 'HELD') continue; // skip still-RUNNING/transient FAILED
    const list = byAgent.get(run.agent_key) ?? [];
    list.push(run);
    byAgent.set(run.agent_key, list);
  }

  const lines: BriefingLine[] = [];
  for (const [agentKey, runs] of byAgent.entries()) {
    const spec = Object.values(AgentKey).includes(agentKey as AgentKey) ? getAgentSpec(agentKey as AgentKey) : null;
    const displayName = spec?.displayName ?? agentKey;
    const clear = runs.filter((r) => cfeBandOf(r) === 'clear').length;
    const flagged = runs.filter((r) => cfeBandOf(r) === 'review').length;
    const held = runs.filter((r) => r.status === 'HELD').length;

    // T-57 R4-residual2 (BLOCKER-B4-class fix) — each part-phrase is its own independent t() call
    // with its OWN `count`, resolved through the real CLDR one/other mechanism (never the bare
    // English `count === 1 ? '' : 's'` pattern this used to be) — ES needs number agreement on
    // "conforme(s)"/"marcado(s)"/"retenido(s)" that EN's invariant "cleared"/"flagged for
    // review"/"held" never did, so this can't be a single shared plural switch.
    const parts: string[] = [t(locale, 'briefing.line.clearedPart', { count: clear })];
    if (flagged > 0) parts.push(t(locale, 'briefing.line.flaggedPart', { count: flagged }));
    if (held > 0) parts.push(t(locale, 'briefing.line.heldPart', { count: held }));

    lines.push({
      text: t(locale, 'briefing.line.ranTimes', { agent: displayName, count: runs.length, summary: parts.join(', ') }),
      receipts: runs.map(receiptOf),
    });
  }

  const pendingDrafts = await draftsAwaitingApproval(db, userId);
  if (pendingDrafts.length > 0) {
    lines.push({
      text: t(locale, 'briefing.line.draftsWaiting', { count: pendingDrafts.length }),
      receipts: [],
    });
  }

  return { state: 'ready', freshnessStamp, lines };
}

async function draftsAwaitingApproval(db: MissionControlPrismaClient, userId: string): Promise<DraftMessageRow[]> {
  return db.draftMessage.findMany({ where: { user_id: userId, approval_state: { in: ['PENDING', 'HELD'] } } });
}
