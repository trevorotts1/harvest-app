// WP04 (T-32) — Zone 3: Action Queue (uiux §5.2 item 3 / §4.2 Action Queue Item).
//
// Sourced directly from real `DraftMessage` (approve-draft / review-flagged) and `Appointment`
// (confirm-appointment) rows for this rep — the same tables the T-30 seam comment names as T-33's
// (Approval Inbox), read here ONLY for Today's summary projection. This zone does not build the full
// Approval Inbox screen (classifier drawer, adjudication note, swipe gestures, upline-review banner —
// that is T-33's lane); it gives the rep a real, actionable "Today" queue with a working
// approve/decline/confirm action using the SAME `DraftMessage.approval_state` / `Appointment.status`
// vocabulary T-33 will also drive, so nothing here needs to change when T-33 ships its fuller screen.

import type { AppointmentRow, ContactRow, DraftMessageRow, MissionControlPrismaClient } from '../prisma-types';
import type { ActionQueueZoneData, QueueItem } from '../types';
// T-57 (server-msg-i18n) — `title`/`why` below used to be bare English literals composed server-side
// (ActionQueue.tsx renders both raw, with no client-side translation layer over them — unlike the
// component's OWN badge/CTA copy, which T-R32b already routed through the catalog). `locale` is an
// OPTIONAL trailing param (defaulting to `DEFAULT_LOCALE`) threaded in from today.service.ts; every
// existing caller/test that omits it keeps compiling and rendering byte-identical English.
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

const DISPLAY_CAP = 5;

/** uiux §5.2 "each item shows an estimated minute cost" — a simple, documented per-kind heuristic. */
function minutesFor(kind: QueueItem['kind']): number {
  switch (kind) {
    case 'review_flagged':
      return 3;
    case 'confirm_appointment':
      return 1;
    case 'approve_draft':
    default:
      return 2;
  }
}

function contactLabel(contact: ContactRow | undefined): string | null {
  if (!contact) return null;
  const lastInitial = contact.last_name ? `${contact.last_name.charAt(0).toUpperCase()}.` : '';
  return [contact.first_name, lastInitial].filter(Boolean).join(' ');
}

export async function buildActionQueueZone(
  db: MissionControlPrismaClient,
  userId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<ActionQueueZoneData> {
  const [drafts, appointments] = await Promise.all([
    db.draftMessage.findMany({
      where: { user_id: userId, approval_state: { in: ['PENDING', 'HELD'] } },
      orderBy: { created_at: 'asc' },
    }),
    db.appointment.findMany({ where: { rep_id: userId, status: 'PROPOSED' } }),
  ]);

  const contactIds = [...new Set([...drafts.map((d) => d.contact_id), ...appointments.map((a) => a.contact_id)])];
  const contacts = contactIds.length > 0 ? await db.contact.findMany({ where: { user_id: userId, id: { in: contactIds } } }) : [];
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const draftItems: QueueItem[] = drafts.map((d) => draftToItem(d, contactById.get(d.contact_id), locale));
  const appointmentItems: QueueItem[] = appointments.map((a) => appointmentToItem(a, contactById.get(a.contact_id), locale));

  // Priority order (§5.2 "priority-ordered"): flagged review first (time-sensitive/compliance-
  // adjacent), then appointments (calendar-bound), then ordinary approve-drafts.
  const flagged = draftItems.filter((i) => i.kind === 'review_flagged');
  const approve = draftItems.filter((i) => i.kind === 'approve_draft');
  const all = [...flagged, ...appointmentItems, ...approve];

  return {
    totalMinutes: all.reduce((sum, i) => sum + i.minutes, 0),
    items: all.slice(0, DISPLAY_CAP),
    totalCount: all.length,
  };
}

function draftToItem(d: DraftMessageRow, contact: ContactRow | undefined, locale: Locale): QueueItem {
  // T-R12 (defense-in-depth hardening): review_flagged on ANY non-PASS `cfe_outcome` — not just
  // 'FLAG' — plus the pre-existing `approval_state === 'HELD'` check. Today BLOCK always implies
  // HELD by construction (agent-runtime.ts's `bandToOutcome`/`held` derivation) and the service-
  // layer `actOnQueueDraft` is separately fail-closed on `cfe_outcome !== 'PASS'` regardless of what
  // this classifier decides — so this widening changes no behavior today. It exists so that if that
  // BLOCK-implies-HELD invariant ever drifted, this UI classifier still could not surface a
  // one-tap Approve affordance for a non-PASS draft: only a clean PASS is ever 'approve_draft'.
  const kind: QueueItem['kind'] = d.cfe_outcome !== 'PASS' || d.approval_state === 'HELD' ? 'review_flagged' : 'approve_draft';
  return {
    id: d.id,
    kind,
    title: t(locale, kind === 'review_flagged' ? 'today.zones.actionQueue.title.reviewFlagged' : 'today.zones.actionQueue.title.approveDraft'),
    why: t(locale, kind === 'review_flagged' ? 'today.zones.actionQueue.why.reviewFlagged' : 'today.zones.actionQueue.why.approveDraft'),
    contactLabel: contactLabel(contact),
    minutes: minutesFor(kind),
    cfeBand: d.cfe_outcome,
    channel: d.channel,
  };
}

function appointmentToItem(a: AppointmentRow, contact: ContactRow | undefined, locale: Locale): QueueItem {
  return {
    id: a.id,
    kind: 'confirm_appointment',
    title: t(locale, 'today.zones.actionQueue.title.confirmAppointment'),
    why: t(locale, 'today.zones.actionQueue.why.confirmAppointment'),
    contactLabel: contactLabel(contact),
    minutes: minutesFor('confirm_appointment'),
    cfeBand: null,
    channel: null,
  };
}
