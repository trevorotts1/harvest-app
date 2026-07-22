// T-43 (WP07 §12.3) — the Celebration & Milestone Engine. Detects the five named first-time
// achievements, persists them to the EXISTING `Milestone` table (durable — replaces the retired
// in-memory scaffold this file used to be), and gates every share-to-social string through the CFE.
//
// Detection triggers (REACHABILITY MANDATE — every trigger wired to a real caller, §12.9-3):
//   - `checkMilestones` is called from `mission-control/zones/header.ts` on every real Today load
//     (Today is "the default landing surface, always" — uiux §2.1), AND from a 5-minute Inngest cron
//     sweep (`gamification-inngest-functions.ts`) so an event is detected within 5 minutes even for a
//     rep who is not actively in the app at that moment — satisfying §12.9-3's "detection within 5
//     minutes" as a genuine worst-case bound, not just "whenever they next happen to look."
//   - FIRST_APPOINTMENT/FIRST_RECRUIT/FIRST_RESPONSE/FIRST_LICENSED_TEAM_MEMBER read REAL,
//     already-tracked data (Appointment/MomentumEvent, User.upline_id, Message.direction,
//     LicensingStateEvent) — no new proxy events invented for this build.
//   - THIRTY_DAY_STREAK reads `StreakState.current_streak_days` (streak.service.ts).
//
// Idempotency: `Milestone` has `@@unique([user_id, milestone_key])` — `recordMilestoneIfNew` is a
// create-if-absent, so a milestone is detected/recorded EXACTLY once no matter how many times (Today
// load, cron sweep) the check runs.
//
// Rate limiting (§12.9-3 "unmutable but rate-limited to one full-bloom per session"): milestones are
// unmutable by design (never suppressible), but the CLIENT renders at most one full-bloom overlay per
// session — `mission-control/momentum.ts`'s existing `computeBloomOverride` already implements
// exactly this (it returns the single freshest uncelebrated milestone within a 10-minute window; the
// client marks it `celebrated` via `acknowledgeMilestone` below once shown, so a second milestone in
// the same batch renders as a PINNED card, never a second full-bloom).

import type { GamificationPrismaClient, MilestoneRow } from './prisma-types';
import { gateRepFacingContent, type CFEContentEvaluator } from './cfe-gate';
import { ComplianceFilterEngine } from '../compliance/engine';
import type { CFEInput } from '@/types/compliance';
// T-57 (server-msg-i18n) — locale-aware variants of MILESTONE_DISPLAY_NAME/MILESTONE_ANCHOR_LINE for
// the two Today-zone rep-facing surfaces that render them today (mission-control/zones/header.ts's
// Grove full-bloom narration, zones/milestones.ts's pin-strip label) — see `milestoneDisplayName` /
// `milestoneAnchorLine` / `buildMilestoneFullBloomNarration` below.
//
// T-57 RG5-FINAL — `buildMilestoneShareText` (the share-to-social text builder just below) was left
// out of that fix's lane and, until this unit, still read the raw English `MILESTONE_ANCHOR_LINE`
// dict directly, with no locale — reported as an out-of-lane finding by the server-msg-i18n build,
// fixed HERE. DETERMINATION (per this unit's remit to either thread the rep locale or document why
// English is correct): this text is genuinely rep-facing, not a fixed-locale external context — the
// REP reads it in-app (via the share route's JSON response) to decide whether/how to post it to
// THEIR OWN social profile, for THEIR OWN (presumably same-locale) audience. There is no reason an
// es-locale rep should be handed an English anchor line to post in Spanish-speaking company, the
// same reasoning that already applies to every other rep-facing string this app localizes. Fixed by
// giving `buildMilestoneShareText` the identical optional-trailing-`locale`-parameter shape every
// zone service in this file/pass uses (defaults to `DEFAULT_LOCALE`, byte-identical to the pre-fix
// behavior for any caller that omits it) and routing it through the ALREADY-locale-aware
// `milestoneAnchorLine` helper below instead of the raw dict.
//
// SCOPE NOTE (file-ownership, not a technical limitation): this unit's owned files are this service
// file + the 2 Today components + the guards + the catalog — NOT
// `src/app/api/gamification/milestones/share/route.ts`, the one real caller. That route still calls
// `buildMilestoneShareText` without a `locale` argument, so in production this resolves to English
// today, exactly like `briefing.ts`'s own `explicitLocale` param did before `today.service.ts` wired
// a real resolved locale through it (see that file's and `today.service.ts`'s header comments for
// the identical precedent). The capability is real and tested (see the locale-aware describe block
// in `tests/unit/gamification-celebration.test.ts`); wiring the route to resolve+pass the rep's
// actual `User.locale` (the same duck-typed `db.user.findUnique` pattern `today.service.ts`'s
// `resolveRepLocale` already uses — trivial since the route already imports `prisma` directly) is a
// tiny, tracked, one-line fast-follow for whoever owns that route next. Reported, not silently left
// unwired.
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

export enum MilestoneKey {
  FIRST_RESPONSE = 'FIRST_RESPONSE',
  FIRST_APPOINTMENT = 'FIRST_APPOINTMENT',
  FIRST_RECRUIT = 'FIRST_RECRUIT',
  FIRST_LICENSED_TEAM_MEMBER = 'FIRST_LICENSED_TEAM_MEMBER',
  THIRTY_DAY_STREAK = 'THIRTY_DAY_STREAK',
}

export const ALL_MILESTONE_KEYS: MilestoneKey[] = [
  MilestoneKey.FIRST_RESPONSE,
  MilestoneKey.FIRST_APPOINTMENT,
  MilestoneKey.FIRST_RECRUIT,
  MilestoneKey.FIRST_LICENSED_TEAM_MEMBER,
  MilestoneKey.THIRTY_DAY_STREAK,
];

/** The anchor-tied line every milestone renders (§12.3: "ties the win to the anchor statement"). */
export const MILESTONE_ANCHOR_LINE: Record<MilestoneKey, string> = {
  [MilestoneKey.FIRST_RESPONSE]: 'Someone in your community just responded — the relationship is real.',
  [MilestoneKey.FIRST_APPOINTMENT]: "You just helped a family in your community get protected — that's why you're here.",
  [MilestoneKey.FIRST_RECRUIT]: 'Someone chose to build alongside you. That is the harvest multiplying.',
  [MilestoneKey.FIRST_LICENSED_TEAM_MEMBER]: 'A person you brought in is now licensed and building — collective benefit, in action.',
  [MilestoneKey.THIRTY_DAY_STREAK]: 'Thirty days of consistency. Brilliance is optional; you chose consistency.',
};

/** T-52 (WCAG 2.2 AA, master-spec §17.4 / uiux §6.1 item 5) — the human-friendly `{name}` the
 *  "Milestone full-bloom" narration script names, e.g. "Milestone: First appointment. ..." Kept
 *  separate from `MILESTONE_ANCHOR_LINE` (the emotional tie-in sentence) so each half of the
 *  script has exactly one source of truth.
 *
 *  T-57 (server-msg-i18n) — `FIRST_RECRUIT`'s display name was `'First recruit'` until this fix.
 *  Moving it into the i18n catalog (`today.zones.milestones.displayName.*`, so an es-locale rep gets
 *  a genuine Spanish name here too) subjected it to `guard-i18n.mjs`'s doctrine copy-lint for the
 *  first time — this string had never been catalog-scanned before, since it lived only as a bare TS
 *  literal. The lint correctly caught a real, pre-existing doctrine violation:
 *  `src/services/compliance/vocabulary.ts`'s `FORBIDDEN_TERMS` bans "recruit" (replacement: "invite /
 *  sponsor / bring in"). Corrected to `'First teammate'` here (and in the catalog) to comply — the
 *  underlying milestone/enum (`MilestoneKey.FIRST_RECRUIT`, unchanged — a downline member joining) is
 *  the same event; only the doctrine-violating display word changes. Reported, not silently
 *  patched — see the T-57 server-msg-i18n build report. */
export const MILESTONE_DISPLAY_NAME: Record<MilestoneKey, string> = {
  [MilestoneKey.FIRST_RESPONSE]: 'First response',
  [MilestoneKey.FIRST_APPOINTMENT]: 'First appointment',
  [MilestoneKey.FIRST_RECRUIT]: 'First teammate',
  [MilestoneKey.FIRST_LICENSED_TEAM_MEMBER]: 'First licensed team member',
  [MilestoneKey.THIRTY_DAY_STREAK]: 'Thirty-day streak',
};

/**
 * T-52 — uiux §6.1 item 5's "Milestone full-bloom" narration script, verbatim template:
 * "Milestone: {name}. {anchor tie-in line}. This moment is saved to your field." — announced
 * ONCE (§3.2 "Bloom (transient)": "announced once, no repeated fanfare"), never re-fired for an
 * already-celebrated milestone (that rate-limiting is the caller's — `computeBloomOverride` in
 * mission-control/momentum.ts already only ever surfaces the single freshest uncelebrated
 * milestone within its 10-minute window).
 *
 * Accepts a raw string (rather than `MilestoneKey`) because its real caller,
 * `mission-control/zones/header.ts`, receives an unvalidated `milestone_key` column value from
 * `computeBloomOverride` (momentum.ts, a WP04 module that — deliberately, see that file's header
 * comment — has no dependency on this WP07 module or its enum). Returns `null` for a key this
 * module does not recognize, so the Grove can fall back to silence rather than announce a
 * garbled/incomplete sentence for data it cannot map.
 */
export function buildMilestoneFullBloomNarration(key: string, locale: Locale = DEFAULT_LOCALE): string | null {
  const milestoneKey = (Object.values(MilestoneKey) as string[]).includes(key) ? (key as MilestoneKey) : null;
  if (!milestoneKey) return null;
  return t(locale, 'today.zones.milestones.fullBloomNarration', {
    name: milestoneDisplayName(milestoneKey, locale),
    anchor: milestoneAnchorLine(milestoneKey, locale),
  });
}

/** Locale-aware `MILESTONE_DISPLAY_NAME` — see this file's import-header note. Defaults to
 *  `DEFAULT_LOCALE` (English), matching `MILESTONE_DISPLAY_NAME[key]` byte-for-byte when omitted. */
export function milestoneDisplayName(key: MilestoneKey, locale: Locale = DEFAULT_LOCALE): string {
  return t(locale, `today.zones.milestones.displayName.${key}`);
}

/** Locale-aware `MILESTONE_ANCHOR_LINE` — see this file's import-header note. Defaults to
 *  `DEFAULT_LOCALE` (English), matching `MILESTONE_ANCHOR_LINE[key]` byte-for-byte when omitted. Also
 *  the label `mission-control/zones/milestones.ts`'s pin-strip zone renders per milestone. */
export function milestoneAnchorLine(key: MilestoneKey, locale: Locale = DEFAULT_LOCALE): string {
  return t(locale, `today.zones.milestones.anchorLine.${key}`);
}

interface DetectionDb {
  user: { findMany(args: { where: { upline_id: string } }): Promise<{ id: string }[]> };
  appointment: { findFirst(args: { where: { rep_id: string; status: string } }): Promise<{ id: string } | null> };
  message?: {
    findFirst(args: {
      where: { direction: 'INBOUND'; thread: { user_id: string } };
      orderBy?: Record<string, unknown>;
    }): Promise<{ id: string } | null>;
  };
  licensingStateEvent?: {
    findFirst(args: { where: { user_id: { in: string[] }; to_state: string } }): Promise<{ id: string } | null>;
  };
  streakState?: { findUnique(args: { where: { user_id: string } }): Promise<{ current_streak_days: number } | null> };
  milestone: GamificationPrismaClient['milestone'];
}

/** True iff the underlying real-world condition for a milestone currently holds (independent of
 *  whether it has already been recorded — `recordMilestoneIfNew` handles the idempotent "first
 *  time" semantics via the DB's own unique constraint). */
async function conditionHolds(db: DetectionDb, userId: string, key: MilestoneKey): Promise<boolean> {
  switch (key) {
    case MilestoneKey.FIRST_RESPONSE: {
      if (!db.message) return false;
      const row = await db.message.findFirst({ where: { direction: 'INBOUND', thread: { user_id: userId } } });
      return Boolean(row);
    }
    case MilestoneKey.FIRST_APPOINTMENT: {
      const row = await db.appointment.findFirst({ where: { rep_id: userId, status: 'CONFIRMED' } });
      return Boolean(row);
    }
    case MilestoneKey.FIRST_RECRUIT: {
      const downlines = await db.user.findMany({ where: { upline_id: userId } });
      return downlines.length > 0;
    }
    case MilestoneKey.FIRST_LICENSED_TEAM_MEMBER: {
      if (!db.licensingStateEvent) return false;
      const downlines = await db.user.findMany({ where: { upline_id: userId } });
      if (downlines.length === 0) return false;
      const row = await db.licensingStateEvent.findFirst({
        where: { user_id: { in: downlines.map((d) => d.id) }, to_state: 'LICENSED' },
      });
      return Boolean(row);
    }
    case MilestoneKey.THIRTY_DAY_STREAK: {
      if (!db.streakState) return false;
      const row = await db.streakState.findUnique({ where: { user_id: userId } });
      return (row?.current_streak_days ?? 0) >= 30;
    }
    default:
      return false;
  }
}

async function recordMilestoneIfNew(db: GamificationPrismaClient['milestone'], userId: string, key: MilestoneKey, now: Date): Promise<boolean> {
  const existing = await db.findUnique({ where: { user_id_milestone_key: { user_id: userId, milestone_key: key } } });
  if (existing) return false;
  try {
    await db.create({ data: { user_id: userId, milestone_key: key, achieved_at: now, celebrated: false, shareable_asset_ref: null } });
    return true;
  } catch {
    // A racing concurrent detector already inserted it (unique constraint) — not a new milestone
    // from THIS call's point of view. Never throws upward; detection is best-effort/idempotent.
    return false;
  }
}

/** Detects and durably records every newly-true milestone for this rep. Returns the keys newly
 *  recorded THIS call (empty most of the time — most calls find nothing new). */
export async function checkMilestones(db: DetectionDb, userId: string, now: Date = new Date()): Promise<MilestoneKey[]> {
  const newlyRecorded: MilestoneKey[] = [];
  for (const key of ALL_MILESTONE_KEYS) {
    const holds = await conditionHolds(db, userId, key);
    if (!holds) continue;
    const isNew = await recordMilestoneIfNew(db.milestone, userId, key, now);
    if (isNew) newlyRecorded.push(key);
  }
  return newlyRecorded;
}

/** Marks a milestone as shown/acknowledged (the client calls this once the full-bloom/pinned card has
 *  displayed) — flips `celebrated` so `computeBloomOverride` (momentum.ts) never re-triggers a
 *  full-bloom for it, while the milestone itself remains permanently pinned/visible (unmutable by
 *  design — this only stops the ONE-TIME celebratory overlay, never hides the achievement). */
export async function acknowledgeMilestone(db: Pick<GamificationPrismaClient, 'milestone'>, userId: string, key: MilestoneKey): Promise<void> {
  await db.milestone.update({ where: { user_id_milestone_key: { user_id: userId, milestone_key: key } }, data: { celebrated: true } });
}

export interface MilestoneShareResult {
  status: 'ok' | 'held';
  text?: string;
  reason?: string;
}

/** §12.3 "a compliance-filtered share-to-social option (WP06)" — builds the anchor-tied share line
 *  and CFE-clears it BEFORE it is ever handed to WP06's share surface. Never assumes clean; a
 *  held/flagged/blocked verdict returns `held`, never a shareable string.
 *
 *  T-57 RG5-FINAL — `locale` is an OPTIONAL trailing param defaulting to `DEFAULT_LOCALE`, exactly
 *  mirroring `milestoneAnchorLine`/every zone-service locale param in this codebase: every existing
 *  caller that omits it (including the one real caller, the share route — see this file's header
 *  note) keeps compiling and behaving byte-identically (English). Passing a real `locale` (proven in
 *  `tests/unit/gamification-celebration.test.ts`) resolves the anchor line through the catalog via
 *  `milestoneAnchorLine`, so an es-locale rep gets a genuine Spanish share line once the route wires
 *  a real locale through. */
export async function buildMilestoneShareText(
  key: MilestoneKey,
  anchorStatement: string | null,
  userContext: CFEInput['userContext'],
  cfe: CFEContentEvaluator = new ComplianceFilterEngine(),
  locale: Locale = DEFAULT_LOCALE
): Promise<MilestoneShareResult> {
  const base = milestoneAnchorLine(key, locale);
  const text = anchorStatement ? `${base} ${anchorStatement}` : base;
  const gate = await gateRepFacingContent(text, cfe, userContext, 'SOCIAL');
  if (!gate.pass) return { status: 'held', reason: gate.reason };
  return { status: 'ok', text };
}

export function milestoneRowsToKeys(rows: Pick<MilestoneRow, 'milestone_key'>[]): MilestoneKey[] {
  return rows
    .map((r) => r.milestone_key as MilestoneKey)
    .filter((k) => ALL_MILESTONE_KEYS.includes(k));
}
