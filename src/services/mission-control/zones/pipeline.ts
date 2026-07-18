// WP04 (T-32) — Zone 4: Pipeline glance (uiux §5.2 item 4).
//
// Real `Contact.pipeline_stage` counts for this rep, bucketed per the master-spec's four-stage
// glance (introduced → responded → appointment → closed). No history/snapshot table exists yet to
// track stage TRANSITIONS over time, so the 7-day delta is defined honestly and simply as: contacts
// currently in that bucket whose `updated_at` (bumped by Prisma's `@updatedAt` on every
// pipeline_stage write) falls in the trailing 7 days, minus the same count for the PRIOR 7-day
// window. This is a real, live-computed signal — not a fabricated number — documented here so a
// future WP that adds real stage-transition history can replace it without guessing this unit's
// intent. The UI never renders this red regardless of sign (uiux AC-5.2-8); framing is a display
// concern, not this builder's.

import type { ContactRow, MissionControlPrismaClient } from '../prisma-types';
import type { PipelineBucket, PipelineZoneData } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const BUCKET_STAGES: Record<PipelineBucket['key'], string[]> = {
  introduced: ['INTRODUCED'],
  responded: ['RESPONDED'],
  appointment: ['APPOINTMENT_PROPOSED', 'APPOINTMENT_CONFIRMED', 'MET'],
  closed: ['CLOSED_CLIENT', 'CLOSED_RECRUIT'],
};

const BUCKET_LABELS: Record<PipelineBucket['key'], string> = {
  introduced: 'Introduced',
  responded: 'Responded',
  appointment: 'Appointment',
  closed: 'Closed',
};

function countInWindow(contacts: ContactRow[], stages: string[], from: Date, to: Date): number {
  return contacts.filter(
    (c) => stages.includes(c.pipeline_stage) && c.updated_at.getTime() >= from.getTime() && c.updated_at.getTime() < to.getTime()
  ).length;
}

export async function buildPipelineZone(
  db: MissionControlPrismaClient,
  userId: string,
  now: Date = new Date()
): Promise<PipelineZoneData> {
  const contacts = await db.contact.findMany({ where: { user_id: userId } });

  const last7Start = new Date(now.getTime() - 7 * DAY_MS);
  const prior7Start = new Date(now.getTime() - 14 * DAY_MS);

  const buckets: PipelineBucket[] = (Object.keys(BUCKET_STAGES) as PipelineBucket['key'][]).map((key) => {
    const stages = BUCKET_STAGES[key];
    const count = contacts.filter((c) => stages.includes(c.pipeline_stage)).length;
    const thisWeek = countInWindow(contacts, stages, last7Start, now);
    const priorWeek = countInWindow(contacts, stages, prior7Start, last7Start);
    return { key, label: BUCKET_LABELS[key], count, deltaLast7d: thisWeek - priorWeek };
  });

  return { buckets };
}
