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
  userId: string
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

  const draftItems: QueueItem[] = drafts.map((d) => draftToItem(d, contactById.get(d.contact_id)));
  const appointmentItems: QueueItem[] = appointments.map((a) => appointmentToItem(a, contactById.get(a.contact_id)));

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

function draftToItem(d: DraftMessageRow, contact: ContactRow | undefined): QueueItem {
  const kind: QueueItem['kind'] = d.cfe_outcome === 'FLAG' || d.approval_state === 'HELD' ? 'review_flagged' : 'approve_draft';
  return {
    id: d.id,
    kind,
    title: kind === 'review_flagged' ? 'Review flagged draft' : 'Approve draft',
    why: kind === 'review_flagged'
      ? 'This draft needs your review before it can send.'
      : 'Your agent drafted this community introduction — approve to hand it off.',
    contactLabel: contactLabel(contact),
    minutes: minutesFor(kind),
    cfeBand: d.cfe_outcome,
    channel: d.channel,
  };
}

function appointmentToItem(a: AppointmentRow, contact: ContactRow | undefined): QueueItem {
  return {
    id: a.id,
    kind: 'confirm_appointment',
    title: 'Confirm appointment window',
    why: 'A proposed appointment time is waiting for your confirmation.',
    contactLabel: contactLabel(contact),
    minutes: minutesFor('confirm_appointment'),
    cfeBand: null,
    channel: null,
  };
}
