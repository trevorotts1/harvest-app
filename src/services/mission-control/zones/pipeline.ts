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
// T-57 (server-msg-i18n) — `BUCKET_LABELS` below used to be bare English literals composed
// server-side and rendered raw by PipelineGlance.tsx (only the zone HEADING is client-translated —
// see today-zones-i18n.test.ts's own note that "Pipeline" itself stays untranslated business
// vocabulary; the four bucket labels are a distinct gap this fix closes). `locale` is an OPTIONAL
// trailing param (defaulting to `DEFAULT_LOCALE`) threaded in from today.service.ts; every existing
// caller/test that omits it keeps compiling and rendering byte-identical English.
import { t } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';

const DAY_MS = 24 * 60 * 60 * 1000;

const BUCKET_STAGES: Record<PipelineBucket['key'], string[]> = {
  introduced: ['INTRODUCED'],
  responded: ['RESPONDED'],
  appointment: ['APPOINTMENT_PROPOSED', 'APPOINTMENT_CONFIRMED', 'MET'],
  closed: ['CLOSED_CLIENT', 'CLOSED_RECRUIT'],
};

const BUCKET_LABEL_KEYS: Record<PipelineBucket['key'], string> = {
  introduced: 'today.zones.pipeline.label.introduced',
  responded: 'today.zones.pipeline.label.responded',
  appointment: 'today.zones.pipeline.label.appointment',
  closed: 'today.zones.pipeline.label.closed',
};

function countInWindow(contacts: ContactRow[], stages: string[], from: Date, to: Date): number {
  return contacts.filter(
    (c) => stages.includes(c.pipeline_stage) && c.updated_at.getTime() >= from.getTime() && c.updated_at.getTime() < to.getTime()
  ).length;
}

export async function buildPipelineZone(
  db: MissionControlPrismaClient,
  userId: string,
  now: Date = new Date(),
  locale: Locale = DEFAULT_LOCALE
): Promise<PipelineZoneData> {
  const contacts = await db.contact.findMany({ where: { user_id: userId } });

  const last7Start = new Date(now.getTime() - 7 * DAY_MS);
  const prior7Start = new Date(now.getTime() - 14 * DAY_MS);

  const buckets: PipelineBucket[] = (Object.keys(BUCKET_STAGES) as PipelineBucket['key'][]).map((key) => {
    const stages = BUCKET_STAGES[key];
    const count = contacts.filter((c) => stages.includes(c.pipeline_stage)).length;
    const thisWeek = countInWindow(contacts, stages, last7Start, now);
    const priorWeek = countInWindow(contacts, stages, prior7Start, last7Start);
    return { key, label: t(locale, BUCKET_LABEL_KEYS[key]), count, deltaLast7d: thisWeek - priorWeek };
  });

  return { buckets };
}
