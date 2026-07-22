// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — small per-domain "raw backend token -> localized
// DISPLAY string" mappers for the `/team/*` surfaces (every-rep-facing roster/agenda pages and the
// upline/RVP-facing calendar, rep drill-in, and Sponsor Cockpit — RG5-QC's correction that these are
// NOT niche admin). Same shape as `error-display.ts`/`reason-display.ts`/`channel-display.ts`: a
// small `Record<token, catalogKey>` plus a generic, always-localized fallback for anything outside
// the known set — never the raw/humanized machine token.

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `team/calendar/page.tsx`'s `BroadcastEvent.type` (the same free-`String` column
 *  `CalendarStrip.tsx`'s own local `eventTypeLabel` maps — REUSES that file's `team.calendar.
 *  eventType.*` catalog keys, single source of truth for the 4 known values, per that file's own
 *  header note). Falls back to a generic "Team event" label for any future/unrecognized value. */
const EVENT_TYPE_CATALOG_KEY: Readonly<Record<string, string>> = {
  opportunity_night: 'team.calendar.eventType.opportunityNight',
  training: 'team.calendar.eventType.training',
  team_call: 'team.calendar.eventType.teamCall',
  big_event: 'team.calendar.eventType.bigEvent',
};

export function eventTypeLabel(t: Translate, type: string): string {
  const key = EVENT_TYPE_CATALOG_KEY[type];
  return t(key ?? 'team.calendar.eventTypeGeneric');
}

/** `team/calendar/page.tsx`'s personal-agenda `Appointment.status` / `CoachingSession.status`
 *  (prisma/schema.prisma: `PROPOSED|CONFIRMED|RESCHEDULED|DECLINED|HELD|NO_SHOW` for an appointment,
 *  `PROPOSED|CONFIRMED|DECLINED|CANCELLED|COMPLETED|NO_SHOW` for a coaching session — a superset
 *  covers both, since both render through the same agenda list). Generic fallback for any future
 *  value never renders the raw token. */
const AGENDA_STATUS_CATALOG_KEY: Readonly<Record<string, string>> = {
  PROPOSED: 'team.calendar.status.proposed',
  CONFIRMED: 'team.calendar.status.confirmed',
  RESCHEDULED: 'team.calendar.status.rescheduled',
  DECLINED: 'team.calendar.status.declined',
  HELD: 'team.calendar.status.held',
  NO_SHOW: 'team.calendar.status.noShow',
  CANCELLED: 'team.calendar.status.cancelled',
  COMPLETED: 'team.calendar.status.completed',
};

export function agendaStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return t('team.calendar.status.generic');
  const key = AGENDA_STATUS_CATALOG_KEY[status];
  return t(key ?? 'team.calendar.status.generic');
}

/** `team/rep/[userId]/page.tsx` + `RepDataPanels.tsx`'s `PipelineStage` (prisma/schema.prisma's
 *  10-value enum). `CLOSED_RECRUIT`'s label deliberately avoids the doctrine-forbidden word
 *  "recruit" (`src/services/compliance/vocabulary.ts` FORBIDDEN_TERMS / `guard-i18n.mjs`'s
 *  catalog copy-lint) — "New teammate" mirrors `celebration.service.ts`'s own
 *  `MilestoneKey.FIRST_RECRUIT` -> "First teammate" doctrine fix (same underlying event, same
 *  corrected word choice). Generic fallback for any future stage never renders the raw token. */
const PIPELINE_STAGE_CATALOG_KEY: Readonly<Record<string, string>> = {
  IDENTIFIED: 'team.rep.pipelineStage.identified',
  INTRODUCED: 'team.rep.pipelineStage.introduced',
  RESPONDED: 'team.rep.pipelineStage.responded',
  APPOINTMENT_PROPOSED: 'team.rep.pipelineStage.appointmentProposed',
  APPOINTMENT_CONFIRMED: 'team.rep.pipelineStage.appointmentConfirmed',
  MET: 'team.rep.pipelineStage.met',
  CLOSED_CLIENT: 'team.rep.pipelineStage.closedClient',
  CLOSED_RECRUIT: 'team.rep.pipelineStage.closedTeammate',
  DORMANT: 'team.rep.pipelineStage.dormant',
  DO_NOT_CONTACT: 'team.rep.pipelineStage.doNotContact',
};

export function pipelineStageLabel(t: Translate, stage: string | null | undefined): string {
  if (!stage) return t('team.rep.pipelineStage.generic');
  const key = PIPELINE_STAGE_CATALOG_KEY[stage];
  return t(key ?? 'team.rep.pipelineStage.generic');
}

/** `team/cockpit/page.tsx`'s enterprise seat-pool `EnterpriseSeatAssignment.status` (prisma/
 *  schema.prisma: a free `String @default("ACTIVE")` column, documented `ACTIVE | REVOKED`).
 *  Generic fallback for any future value never renders the raw token. */
const SEAT_STATUS_CATALOG_KEY: Readonly<Record<string, string>> = {
  ACTIVE: 'team.cockpit.seatStatus.active',
  REVOKED: 'team.cockpit.seatStatus.revoked',
};

export function enterpriseSeatStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return t('team.cockpit.seatStatus.generic');
  const key = SEAT_STATUS_CATALOG_KEY[status];
  return t(key ?? 'team.cockpit.seatStatus.generic');
}
