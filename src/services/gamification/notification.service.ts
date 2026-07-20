// T-43 (WP07 §12.6, §12.9-6) — Notification architecture. Morning Briefing / Midday Motivation /
// Evening Recap / Action Alerts / Inactivity Nudges / Milestone Celebrations. The rep controls
// timing/frequency of ALL NON-CRITICAL notifications; Action Alerts, Milestone Celebrations, and
// Billing/security are UNMUTABLE by design — there is deliberately no preference column for them at
// all (see `NotificationPreference`'s schema comment). Notification quiet hours are the rep's OWN and
// are DISTINCT from recipient TCPA quiet hours (`src/services/compliance/quiet-hours/quiet-hours.ts`,
// §10.4) — this module never reads or writes that service's state, and vice versa.

import { gateRepFacingContent, type CFEContentEvaluator } from './cfe-gate';
import { ComplianceFilterEngine } from '../compliance/engine';
import type { CFEInput } from '@/types/compliance';
import type { NotificationLogRow, NotificationPreferenceRow } from './prisma-types';

export type NotificationType =
  | 'MORNING_BRIEFING'
  | 'MIDDAY_MOTIVATION'
  | 'EVENING_RECAP'
  | 'ACTION_ALERT'
  | 'INACTIVITY_NUDGE'
  | 'MILESTONE_CELEBRATION'
  | 'APPROVAL_WAITING'
  | 'BILLING_SECURITY';

/** §12.6 "Action Alerts (real-time...) — always on", "Milestone Celebrations (unmutable)", and
 *  billing/security (critical) — no rep control exists for any of these three. Everything else is
 *  rep-controllable non-critical timing/frequency. */
export const UNMUTABLE_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  'ACTION_ALERT',
  'MILESTONE_CELEBRATION',
  'BILLING_SECURITY',
]);

export function isUnmutable(type: NotificationType): boolean {
  return UNMUTABLE_NOTIFICATION_TYPES.has(type);
}

interface PreferenceDb {
  notificationPreference: {
    findUnique(args: { where: { user_id: string } }): Promise<NotificationPreferenceRow | null>;
    upsert(args: { where: { user_id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<NotificationPreferenceRow>;
  };
}

const DEFAULT_PREFS: Omit<NotificationPreferenceRow, 'user_id'> = {
  morning_briefing_enabled: true,
  morning_briefing_time: '07:00',
  midday_motivation_enabled: true,
  evening_recap_enabled: true,
  quiet_hours_start: '21:00',
  quiet_hours_end: '07:00',
  timezone: 'UTC',
};

export async function getOrCreatePreferences(db: PreferenceDb, userId: string): Promise<NotificationPreferenceRow> {
  const existing = await db.notificationPreference.findUnique({ where: { user_id: userId } });
  if (existing) return existing;
  return db.notificationPreference.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...DEFAULT_PREFS },
    update: {},
  });
}

/** §12.6 "The rep controls timing/frequency of all non-critical notifications." Rejects any attempt
 *  to set a preference for an unmutable type — there is nothing to update for those (defense in
 *  depth: even if a caller mistakenly tries). */
export type MutablePreferencePatch = Partial<
  Pick<
    NotificationPreferenceRow,
    | 'morning_briefing_enabled'
    | 'morning_briefing_time'
    | 'midday_motivation_enabled'
    | 'evening_recap_enabled'
    | 'quiet_hours_start'
    | 'quiet_hours_end'
    | 'timezone'
  >
>;

export async function updatePreferences(db: PreferenceDb, userId: string, patch: MutablePreferencePatch): Promise<NotificationPreferenceRow> {
  return db.notificationPreference.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...DEFAULT_PREFS, ...patch },
    update: patch,
  });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** The rep's OWN notification quiet hours (§12.6) — NOT the recipient TCPA quiet-hours gate. Handles
 *  an overnight window (e.g. 21:00-07:00) correctly. */
export function isWithinOwnQuietHours(prefs: Pick<NotificationPreferenceRow, 'quiet_hours_start' | 'quiet_hours_end'>, nowLocalHHMM: string): boolean {
  const start = toMinutes(prefs.quiet_hours_start);
  const end = toMinutes(prefs.quiet_hours_end);
  const now = toMinutes(nowLocalHHMM);
  if (start === end) return false;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight wrap
}

interface LogDb {
  notificationLog: {
    findUnique(args: { where: { user_id_type_dedupe_key: { user_id: string; type: string; dedupe_key: string } } }): Promise<NotificationLogRow | null>;
    create(args: { data: Omit<NotificationLogRow, 'id' | 'created_at'> }): Promise<NotificationLogRow>;
  };
}

export interface NotificationDispatchResult {
  sent: boolean;
  reason?: 'already_sent' | 'quiet_hours' | 'disabled' | 'cfe_held';
}

/** Records ONE notification send, idempotent per (user, type, dedupeKey) — a retried cron tick or a
 *  double page-load never double-sends the same logical notification. */
async function recordSendOnce(db: LogDb, userId: string, type: NotificationType, dedupeKey: string, deepLink: string | null): Promise<boolean> {
  const existing = await db.notificationLog.findUnique({ where: { user_id_type_dedupe_key: { user_id: userId, type, dedupe_key: dedupeKey } } });
  if (existing) return false;
  await db.notificationLog.create({ data: { user_id: userId, type, unmutable: isUnmutable(type), dedupe_key: dedupeKey, deep_link: deepLink } });
  return true;
}

/** Dispatches a NON-CRITICAL, content-bearing notification (Morning Briefing / Midday Motivation /
 *  Evening Recap) — respects the rep's own enabled flag + quiet hours, CFE-gates the body, and is
 *  idempotent per day. */
export async function dispatchNonCriticalNotification(
  db: PreferenceDb & LogDb,
  opts: {
    userId: string;
    type: 'MORNING_BRIEFING' | 'MIDDAY_MOTIVATION' | 'EVENING_RECAP';
    body: string;
    dedupeKey: string;
    deepLink: string | null;
    nowLocalHHMM: string;
    userContext: CFEInput['userContext'];
  },
  cfe: CFEContentEvaluator = new ComplianceFilterEngine()
): Promise<NotificationDispatchResult> {
  const prefs = await getOrCreatePreferences(db, opts.userId);
  const enabledKey =
    opts.type === 'MORNING_BRIEFING'
      ? 'morning_briefing_enabled'
      : opts.type === 'MIDDAY_MOTIVATION'
        ? 'midday_motivation_enabled'
        : 'evening_recap_enabled';
  if (!prefs[enabledKey]) return { sent: false, reason: 'disabled' };
  if (isWithinOwnQuietHours(prefs, opts.nowLocalHHMM)) return { sent: false, reason: 'quiet_hours' };

  const gate = await gateRepFacingContent(opts.body, cfe, opts.userContext);
  if (!gate.pass) return { sent: false, reason: 'cfe_held' };

  const isNew = await recordSendOnce(db, opts.userId, opts.type, opts.dedupeKey, opts.deepLink);
  return { sent: isNew, reason: isNew ? undefined : 'already_sent' };
}

/** Dispatches an UNMUTABLE, always-on notification (Action Alert / Milestone Celebration /
 *  Billing-security) — no preference check, no quiet-hours check (§12.6 "always on" / "unmutable").
 *  Still idempotent per dedupe key and still CFE-gated when it carries free-text content bound for
 *  the rep (milestone copy) — an alert whose body is a fixed system string (e.g. billing) may pass
 *  `skipCfe: true` since it carries no AI-generated or otherwise variable content. */
export async function dispatchUnmutableNotification(
  db: LogDb,
  opts: {
    userId: string;
    type: 'ACTION_ALERT' | 'MILESTONE_CELEBRATION' | 'BILLING_SECURITY';
    body: string;
    dedupeKey: string;
    deepLink: string | null;
    userContext: CFEInput['userContext'];
    skipCfe?: boolean;
  },
  cfe: CFEContentEvaluator = new ComplianceFilterEngine()
): Promise<NotificationDispatchResult> {
  if (!opts.skipCfe) {
    const gate = await gateRepFacingContent(opts.body, cfe, opts.userContext);
    if (!gate.pass) return { sent: false, reason: 'cfe_held' };
  }
  const isNew = await recordSendOnce(db, opts.userId, opts.type, opts.dedupeKey, opts.deepLink);
  return { sent: isNew, reason: isNew ? undefined : 'already_sent' };
}

const INACTIVITY_NUDGE_DAYS = [3, 5, 7] as const;

interface InactivityDb extends LogDb {
  momentumEvent: { findMany(args: { where: { user_id: string }; orderBy: { created_at: 'desc' }; take: number }): Promise<{ created_at: Date }[]> };
  user: { findUnique(args: { where: { id: string } }): Promise<{ intensity_setting: string } | null> };
}

/** §12.6/§12.9-6 "Inactivity nudges fire at EXACTLY 3/5/7 days" — never a range, never a repeat.
 *  Computes days since the rep's last recorded IPA and fires ONLY when that count lands exactly on
 *  3, 5, or 7 (idempotent per day-threshold via the dedupe key, so a cron re-run the same day is a
 *  no-op, and days 4/6/8+ never fire at all). */
export async function checkInactivityNudge(
  db: InactivityDb,
  userId: string,
  anchorLine: string | null,
  userContext: CFEInput['userContext'],
  now: Date = new Date(),
  cfe: CFEContentEvaluator = new ComplianceFilterEngine()
): Promise<NotificationDispatchResult & { daysInactive?: number }> {
  const [latest] = await db.momentumEvent.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 1 });
  if (!latest) return { sent: false, reason: 'disabled' }; // no activity history yet — nothing to measure against

  const daysInactive = Math.floor((now.getTime() - latest.created_at.getTime()) / (1000 * 60 * 60 * 24));
  if (!(INACTIVITY_NUDGE_DAYS as readonly number[]).includes(daysInactive)) {
    return { sent: false, daysInactive };
  }

  const body = anchorLine
    ? `Your field misses you — 10 minutes? ${anchorLine}`
    : 'Your field misses you — 10 minutes?';
  const gate = await gateRepFacingContent(body, cfe, userContext);
  if (!gate.pass) return { sent: false, reason: 'cfe_held', daysInactive };

  const isNew = await recordSendOnce(db, userId, 'INACTIVITY_NUDGE', `day-${daysInactive}`, '/shift?mode=short');
  return { sent: isNew, reason: isNew ? undefined : 'already_sent', daysInactive };
}
