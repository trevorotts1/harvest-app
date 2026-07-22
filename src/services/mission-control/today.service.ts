// WP04 (T-32) — the Mission Control / Today aggregator (master-spec §9.5, uiux §5.2).
//
// THE INDEPENDENT-ZONE-FAILURE GUARANTEE (master-spec §9.5 "one zone failing must NOT take down the
// others"; uiux AC-5.2-6): `buildMissionControlToday` calls all six zone builders through `safeZone`,
// which wraps EACH call in its own try/catch. A zone builder throwing (its data source failing) is
// caught right there and turned into that zone's `{ status: 'error' }` result — it can never reject
// the aggregator's own `Promise.all`, and it can never touch a sibling zone's result. This is an
// architectural property, not a hope: every zone builder (zones/*.ts) also issues its OWN
// independent Prisma reads — no zone's query is shared with another's — so a broken query for one
// zone has no path to affect another's. tests/unit/mission-control-today-service.test.ts proves this
// with teeth: it swaps in a fake DB whose ONE query throws and asserts the other five zones still
// return real data.

import { prisma } from '@/lib/prisma';
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locale';
import type { MissionControlPrismaClient } from './prisma-types';
import type { MissionControlToday, ZoneResult } from './types';
import { buildHeaderZone } from './zones/header';
import { buildBriefingZone } from './zones/briefing';
import { buildActionQueueZone } from './zones/action-queue';
import { buildPipelineZone } from './zones/pipeline';
import { buildRatiosZone } from './zones/ratios';
import { buildCalendarZone } from './zones/calendar';
import { buildMilestonesZone } from './zones/milestones';

/** Never leaks internals (stack traces, query shapes) into the zone's error message — the honest,
 *  non-shaming copy every degraded zone shows while its siblings keep working (uiux §4.1 error
 *  states / master spec §18.6 "no fabricated content" cuts both ways: no fabricated failure detail
 *  either).
 *
 *  T-57 (server-msg-i18n): this message used to be a bare English literal — the one string EVERY
 *  degraded zone's component renders verbatim via `result.message` (AnchorHeader/BriefingCard/
 *  ActionQueue/PipelineGlance/RatioCards/CalendarStrip — the 6 Today zone components RG4-hardening
 *  flagged). Now resolved through the catalog (`today.zones.error.generic`), keyed to the already-
 *  resolved rep locale (see `resolveRepLocale` below) — an es-locale rep sees a genuine Spanish
 *  degraded-zone message, not silently-still-English text, exactly like every other zone fix in this
 *  pass. */
async function safeZone<T>(fn: () => Promise<T>, locale: Locale): Promise<ZoneResult<T>> {
  try {
    const data = await fn();
    return { status: 'ok', data };
  } catch {
    return { status: 'error', message: t(locale, 'today.zones.error.generic') };
  }
}

/**
 * T-57 (server-msg-i18n) — locale resolution, HOISTED here from each zone re-deriving its own (the
 * approach `zones/briefing.ts`'s module header documents as the "DOCUMENTED GAP ... for the next unit
 * with route.ts/today.service.ts in its lane": "the instant today.service.ts starts threading a real
 * locale argument through ... that value should simply be passed to buildBriefingZone as the optional
 * 4th explicitLocale parameter"). This is that one-line change (see the buildBriefingZone call below)
 * plus the same duck-typed lookup, done ONCE for all seven zones instead of once per zone.
 *
 * Same duck-typed shape/rationale as briefing.ts's own (private, still in place there for any direct
 * caller that omits `explicitLocale`): `MissionControlPrismaClient` (prisma-types.ts) is a narrow,
 * intentionally-minimal DI surface shared by every zone and declares no `user` accessor; widening it
 * is out of this fix's lane. In production `db` is always the real Prisma client (this function's own
 * `opts.db ?? (prisma as unknown as MissionControlPrismaClient)` fallback below — never overridden by
 * the one real caller, `/api/mission-control/today`'s route.ts), which really does have
 * `.user.findUnique`, so this resolves the rep's actual `User.locale` with zero changes to any file
 * outside this unit's lane. Any `db` lacking `.user` (every existing zone test's in-memory fake)
 * safely falls through to `DEFAULT_LOCALE`. Never throws — a locale-lookup hiccup degrades to
 * English, it must never fail the whole Today response.
 */
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
    return DEFAULT_LOCALE;
  }
}

export interface BuildTodayOptions {
  db?: MissionControlPrismaClient;
  greetingName: string;
  organizationId: string | null;
  now?: Date;
  /** Optional explicit locale override — skips the duck-typed `db.user` lookup above. Every existing
   *  caller (the real `/api/mission-control/today` route, every existing test) omits this and gets
   *  IDENTICAL behavior to before this fix (English, unless a real `User.locale` says otherwise). */
  locale?: Locale;
}

export async function buildMissionControlToday(userId: string, opts: BuildTodayOptions): Promise<MissionControlToday> {
  const db = opts.db ?? (prisma as unknown as MissionControlPrismaClient);
  const now = opts.now ?? new Date();
  const locale = await resolveRepLocale(db, userId, opts.locale);

  const [header, briefing, actionQueue, pipeline, ratios, calendar, milestones] = await Promise.all([
    safeZone(() => buildHeaderZone(db, userId, opts.greetingName, now, locale), locale),
    // The resolved `locale` is passed as briefing.ts's own `explicitLocale` 4th param — this is the
    // "one-line change" that file's module header anticipated; it skips buildBriefingZone's internal
    // duck-typed lookup entirely rather than duplicating it.
    safeZone(() => buildBriefingZone(db, userId, now, locale), locale),
    safeZone(() => buildActionQueueZone(db, userId, locale), locale),
    safeZone(() => buildPipelineZone(db, userId, now, locale), locale),
    safeZone(() => buildRatiosZone(db, userId, locale), locale),
    // Calendar zone's own data (event type/attendance state) carries no server-composed prose — see
    // the T-57 server-msg-i18n build report — so only the shared `safeZone` error message needs
    // `locale` here, not the builder call itself.
    safeZone(() => buildCalendarZone(db, userId, opts.organizationId, now), locale),
    safeZone(() => buildMilestonesZone(db, userId, locale), locale),
  ]);

  return { generatedAt: now.toISOString(), header, briefing, actionQueue, pipeline, ratios, calendar, milestones };
}

// ── Mutations: the real IPAs this screen performs directly ─────────────────────────────────────
// §12.1's momentum formula is WP07's full engine (Wave 5, not yet built) — see momentum.ts's header
// comment. These mutations emit the SAME `MomentumEvent` shape WP07 will populate at full fidelity,
// using the conservative LOW end of §12.1's stated point ranges for the real actions THIS screen
// performs, so the Grove is genuinely responsive to the rep's real actions today rather than frozen
// at "Seed" until WP07 ships.

async function recordMomentumEvent(
  db: MissionControlPrismaClient,
  userId: string,
  eventType: string,
  points: number,
  law: 'grow' | 'engage' | 'wealth',
  sourceRef?: string
): Promise<void> {
  await db.momentumEvent.create({ data: { user_id: userId, event_type: eventType, points, law, source_ref: sourceRef ?? null } });
}

export type QueueDraftAction = 'approve' | 'decline';

export type QueueDraftResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'invalid_state' | 'requires_review' };

/** Approve/decline a DraftMessage from the Today Action Queue zone. Ownership-checked (the draft
 *  must belong to the SESSION user — never trusts any caller-supplied id without that check). Uses
 *  the same `approval_state` vocabulary T-33 (Approval Inbox) will also drive.
 *
 *  FAIL-CLOSED (T-32 QC fix — master-spec §9.2/§18.6, uiux §5.2 "never sendable"): a draft whose CFE
 *  outcome is not `PASS` (i.e. `FLAG` or `BLOCK`) can NEVER be approved through this Mission Control
 *  queue-clear endpoint — only a clean (`PASS`) draft may be one-tap approved here. This check is
 *  DEFENSE IN DEPTH: it holds even if the calling UI is wrong, stale, or bypassed entirely (a forged
 *  request, a bug in ActionQueue.tsx) — the endpoint itself is the fail-closed authority, not the
 *  button wiring. A FLAG/BLOCK draft can only move forward through the real Approval Inbox (T-33),
 *  which re-checks CFE and shows the band/classifier to a human adjudicator. Declining a flagged/
 *  blocked draft is still allowed here — rejecting risky content is always safe, never gated. */
export async function actOnQueueDraft(
  userId: string,
  draftMessageId: string,
  action: QueueDraftAction,
  db: MissionControlPrismaClient = prisma as unknown as MissionControlPrismaClient
): Promise<QueueDraftResult> {
  const draft = await db.draftMessage.findFirst({ where: { id: draftMessageId, user_id: userId } });
  if (!draft) return { ok: false, reason: 'not_found' };
  if (draft.approval_state !== 'PENDING' && draft.approval_state !== 'HELD') return { ok: false, reason: 'invalid_state' };

  if (action === 'approve') {
    if (draft.cfe_outcome !== 'PASS') return { ok: false, reason: 'requires_review' };
    await db.draftMessage.update({
      where: { id: draftMessageId },
      data: { approval_state: 'APPROVED', approved_by: userId, approved_at: new Date() },
    });
    // §12.1: "introduction sent +1-3" — conservative low end.
    await recordMomentumEvent(db, userId, 'draft_approved', 1, 'grow', draftMessageId);
  } else {
    await db.draftMessage.update({ where: { id: draftMessageId }, data: { approval_state: 'DECLINED' } });
  }
  return { ok: true };
}

export type ConfirmAppointmentResult = { ok: true } | { ok: false; reason: 'not_found' | 'invalid_state' };

export async function confirmAppointment(
  userId: string,
  appointmentId: string,
  db: MissionControlPrismaClient = prisma as unknown as MissionControlPrismaClient
): Promise<ConfirmAppointmentResult> {
  const appt = await db.appointment.findFirst({ where: { id: appointmentId, rep_id: userId } });
  if (!appt) return { ok: false, reason: 'not_found' };
  if (appt.status !== 'PROPOSED') return { ok: false, reason: 'invalid_state' };

  await db.appointment.update({ where: { id: appointmentId }, data: { status: 'CONFIRMED' } });
  // §12.1: "appointment set +5-8" — conservative low end.
  await recordMomentumEvent(db, userId, 'appointment_confirmed', 5, 'grow', appointmentId);
  return { ok: true };
}

export type MarkAttendanceState = 'attended' | 'missed';
export type MarkAttendanceResult = { ok: true } | { ok: false; reason: 'not_found' };

export async function markAttendance(
  userId: string,
  eventId: string,
  organizationId: string | null,
  state: MarkAttendanceState,
  db: MissionControlPrismaClient = prisma as unknown as MissionControlPrismaClient
): Promise<MarkAttendanceResult> {
  // Ownership: the event must belong to the rep's own organization (never trusts a bare eventId).
  if (!organizationId) return { ok: false, reason: 'not_found' };
  const owned = await db.teamEvent.findFirst({ where: { id: eventId, organization_id: organizationId } });
  if (!owned) return { ok: false, reason: 'not_found' };

  await db.attendance.upsert({
    where: { event_id_user_id: { event_id: eventId, user_id: userId } },
    create: { event_id: eventId, user_id: userId, state },
    update: { state },
  });
  // §12.1: "daily login + review +1".
  await recordMomentumEvent(db, userId, 'attendance_marked', 1, 'engage', eventId);
  return { ok: true };
}
