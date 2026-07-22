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

/** T-57 RG7 — `team/cockpit/page.tsx`'s per-seat `activationStatus`, now the raw `User.onboarding_status`
 *  token (`prisma/schema.prisma`'s `OnboardingStatus`: `IN_PROGRESS | GATED_COMPLETE`). Before RG7 the
 *  service mapped this to an English label server-side and the rep saw it untranslated; the service now
 *  hands the raw token and this maps it per-locale. Generic fallback (incl. a null member) never renders
 *  the raw token. */
const ACTIVATION_STATUS_CATALOG_KEY: Readonly<Record<string, string>> = {
  IN_PROGRESS: 'team.cockpit.activationStatus.inProgress',
  GATED_COMPLETE: 'team.cockpit.activationStatus.active',
};

export function activationStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return t('team.cockpit.activationStatus.generic');
  const key = ACTIVATION_STATUS_CATALOG_KEY[status];
  return t(key ?? 'team.cockpit.activationStatus.generic');
}

/** T-57 RG7 — `team/cockpit/page.tsx`'s per-seat `sponsorshipState` (raw `Sponsorship.state`,
 *  `prisma/schema.prisma`'s `SponsorshipState`: `ACTIVE | MEMBER_GRACE | SPONSOR_LAPSED |
 *  ANNIVERSARY_PENDING | CONVERTED | ENDED`). Generic fallback for any future value never renders the
 *  raw token. */
const SPONSORSHIP_STATE_CATALOG_KEY: Readonly<Record<string, string>> = {
  ACTIVE: 'team.cockpit.sponsorshipState.active',
  MEMBER_GRACE: 'team.cockpit.sponsorshipState.memberGrace',
  SPONSOR_LAPSED: 'team.cockpit.sponsorshipState.sponsorLapsed',
  ANNIVERSARY_PENDING: 'team.cockpit.sponsorshipState.anniversaryPending',
  CONVERTED: 'team.cockpit.sponsorshipState.converted',
  ENDED: 'team.cockpit.sponsorshipState.ended',
};

export function sponsorshipStateLabel(t: Translate, state: string | null | undefined): string {
  if (!state) return t('team.cockpit.sponsorshipState.generic');
  const key = SPONSORSHIP_STATE_CATALOG_KEY[state];
  return t(key ?? 'team.cockpit.sponsorshipState.generic');
}

/** T-57 RG7 — `team/calendar/page.tsx`'s `CalendarLink.status` (`prisma/schema.prisma`: a free
 *  `String @default("CONNECTED")`, documented `CONNECTED | EXPIRED | REVOKED`). A NULL/absent status
 *  means "no link on file" → the "not connected" label the page used to render via a bare
 *  `?? t('…notConnected')` fallback, so this mapper folds that fallback in. Generic fallback for any
 *  future value never renders the raw token. */
const CALENDAR_LINK_STATUS_CATALOG_KEY: Readonly<Record<string, string>> = {
  CONNECTED: 'team.calendar.linkStatus.connected',
  EXPIRED: 'team.calendar.linkStatus.expired',
  REVOKED: 'team.calendar.linkStatus.revoked',
};

export function calendarLinkStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return t('team.calendar.notConnected');
  const key = CALENDAR_LINK_STATUS_CATALOG_KEY[status];
  return t(key ?? 'team.calendar.linkStatus.generic');
}

/** T-57 RG7 — `team/calendar/page.tsx`'s per-event `myAttendanceState` (`Attendance.state`,
 *  `prisma/schema.prisma`: `rsvp_yes | rsvp_no | attended | missed`, plus the service-synthesized
 *  `'none'` for an event the viewer has no attendance row on). Generic fallback for any future value
 *  never renders the raw token. */
const ATTENDANCE_STATE_CATALOG_KEY: Readonly<Record<string, string>> = {
  none: 'team.calendar.attendanceState.none',
  rsvp_yes: 'team.calendar.attendanceState.rsvpYes',
  rsvp_no: 'team.calendar.attendanceState.rsvpNo',
  attended: 'team.calendar.attendanceState.attended',
  missed: 'team.calendar.attendanceState.missed',
};

export function attendanceStateLabel(t: Translate, state: string | null | undefined): string {
  if (!state) return t('team.calendar.attendanceState.none');
  const key = ATTENDANCE_STATE_CATALOG_KEY[state];
  return t(key ?? 'team.calendar.attendanceState.generic');
}
