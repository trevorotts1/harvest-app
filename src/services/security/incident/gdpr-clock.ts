import { BreachClass, GdprClock, GdprClockStatus } from '../../../types/incident';

/** GDPR Art. 33 / master-spec §16.7 item 4: "notify the supervisory authority without undue delay
 *  and within 72 hours of becoming aware." */
export const GDPR_NOTIFICATION_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Surfacing threshold for "approaching deadline" (build-brief item 2: "surface which incidents
 *  are approaching/over deadline") — two-thirds of the 72h window elapsed with no notification
 *  sent yet. */
export const GDPR_APPROACHING_THRESHOLD_MS = (GDPR_NOTIFICATION_WINDOW_MS * 2) / 3; // 48h

/**
 * True for every `BreachClass` except the one explicit, triaged "this was not a personal-data
 * breach" ruling — see types/incident.ts's `BreachClass` doc for the fail-toward-caution
 * rationale (SUSPECTED/CONFIRMED/UNDETERMINED all keep the clock running).
 */
export function isClockApplicable(breachClass: BreachClass): boolean {
  return breachClass !== 'NOT_PERSONAL_DATA';
}

export interface ComputeGdprClockInput {
  breachClass: BreachClass;
  /** ISO 8601 timestamp of the event that first made this incident breach-class (the DECLARED
   *  event — §16.7 item 4's "within 72 hours of becoming aware" means awareness is DETECTION, not
   *  the end of triage; see incident-classifier.ts's module doc). Required whenever `breachClass`
   *  is clock-applicable — `IncidentService.declare` always stamps it for anything but
   *  NOT_PERSONAL_DATA, so a `null` here on an applicable breach is treated as a fail-safe (see
   *  below), never as "no clock". */
  clockStartedAt: string | null;
  notifiedAt?: string | null;
  resolvedAt?: string | null;
  now?: Date;
}

/**
 * Pure clock arithmetic — no I/O, exhaustively testable. This is the function whose absence (or
 * whose `overDeadline`/`applicable` logic being silently disabled) build-brief PROVE items (b) and
 * (c) exist to catch: remove the 72h math or loosen the NOT_PERSONAL_DATA-only gate here and those
 * tests fail.
 */
export function computeGdprClock(input: ComputeGdprClockInput): GdprClock {
  const now = input.now ?? new Date();
  const applicable = isClockApplicable(input.breachClass);

  if (!applicable) {
    return {
      applicable: false,
      status: 'NOT_APPLICABLE',
      clockStartedAt: null,
      deadline: null,
      elapsedMs: null,
      remainingMs: null,
      overDeadline: false,
      approachingDeadline: false,
    };
  }

  if (!input.clockStartedAt) {
    // Defensive fail-safe: a clock-applicable incident with no recorded start time would be an
    // upstream bug (declare() always stamps clockStartedAt for anything but NOT_PERSONAL_DATA).
    // Report it as maximally urgent rather than silently reporting "no clock" — fail-open would be
    // the wrong direction for a regulatory deadline.
    return {
      applicable: true,
      status: 'OPEN',
      clockStartedAt: null,
      deadline: null,
      elapsedMs: null,
      remainingMs: null,
      overDeadline: true,
      approachingDeadline: true,
    };
  }

  const startMs = new Date(input.clockStartedAt).getTime();
  const deadlineMs = startMs + GDPR_NOTIFICATION_WINDOW_MS;
  const nowMs = now.getTime();
  const notifiedMs = input.notifiedAt ? new Date(input.notifiedAt).getTime() : null;
  const resolvedAt = input.resolvedAt ?? null;

  // Once notified, "elapsed"/"overDeadline" freeze at the notification instant — historically
  // informative evidence of whether the notification ITSELF was timely, rather than continuing to
  // grow with wall-clock `now` after the obligation was already met.
  const referenceMs = notifiedMs ?? nowMs;
  const elapsedMs = Math.max(0, referenceMs - startMs);
  const remainingMs = deadlineMs - referenceMs;
  const overDeadline = referenceMs > deadlineMs;

  let status: GdprClockStatus;
  if (resolvedAt) status = 'CLOSED';
  else if (notifiedMs !== null) status = 'NOTIFIED';
  else status = 'OPEN';

  const approachingDeadline = status === 'OPEN' && !overDeadline && elapsedMs >= GDPR_APPROACHING_THRESHOLD_MS;

  return {
    applicable: true,
    status,
    clockStartedAt: input.clockStartedAt,
    deadline: new Date(deadlineMs).toISOString(),
    elapsedMs,
    remainingMs,
    overDeadline,
    approachingDeadline,
  };
}
