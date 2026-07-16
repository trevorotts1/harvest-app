import { IncidentAction, IncidentLifecycleState } from '../../../types/incident';

/**
 * Pure runbook state machine (§16.7, build-brief item 3): detected -> triaged -> contained ->
 * {notified -> resolved | resolved}. Mirrors
 * src/services/compliance/licensing/licensing-state-machine.ts's design exactly
 * (legalTargetState/applyTransition, never throws, a typed result instead) — see that file's
 * header for the underlying rationale (pure logic, no I/O; persistence/audit emission is the
 * service layer's job, not this module's).
 *
 * The one branch this table alone can't guard: CONTAINED may go straight to RESOLVED (skip
 * notification) — legal per the table below — but that must NOT be allowed while the incident is
 * still a live personal-data-breach candidate. This table doesn't know about breach
 * classification, so `assertNotifyBeforeResolve` below layers that extra, non-negotiable guard on
 * top; `IncidentService.resolve` calls both.
 */

const INCIDENT_TRANSITIONS: Record<
  IncidentLifecycleState,
  Partial<Record<IncidentAction, IncidentLifecycleState>>
> = {
  DETECTED: { TRIAGE: 'TRIAGED' },
  TRIAGED: { CONTAIN: 'CONTAINED' },
  CONTAINED: { NOTIFY: 'NOTIFIED', RESOLVE: 'RESOLVED' },
  NOTIFIED: { RESOLVE: 'RESOLVED' },
  RESOLVED: {},
};

export interface IncidentTransitionSuccess {
  ok: true;
  from: IncidentLifecycleState;
  to: IncidentLifecycleState;
  action: IncidentAction;
}

export interface IncidentTransitionFailure {
  ok: false;
  from: IncidentLifecycleState;
  action: IncidentAction;
  error: string;
}

export type IncidentTransitionResult = IncidentTransitionSuccess | IncidentTransitionFailure;

/** Returns the legal target state for (from, action), or null if the transition is illegal. */
export function legalIncidentTargetState(
  from: IncidentLifecycleState,
  action: IncidentAction
): IncidentLifecycleState | null {
  return INCIDENT_TRANSITIONS[from][action] ?? null;
}

/** The set of actions legal from a given state — used to build a helpful rejection message. */
export function legalIncidentActionsFrom(from: IncidentLifecycleState): IncidentAction[] {
  return Object.keys(INCIDENT_TRANSITIONS[from]) as IncidentAction[];
}

/**
 * Attempts a transition. Legal transitions succeed and return the new state; illegal transitions
 * are rejected — ok: false, never throws — mirroring licensing-state-machine.ts's
 * applyTransition contract exactly.
 */
export function applyIncidentTransition(
  from: IncidentLifecycleState,
  action: IncidentAction
): IncidentTransitionResult {
  const to = legalIncidentTargetState(from, action);
  if (!to) {
    const legal = legalIncidentActionsFrom(from);
    return {
      ok: false,
      from,
      action,
      error:
        `Illegal incident transition: cannot apply "${action}" from state "${from}". ` +
        (legal.length > 0
          ? `Legal actions from "${from}": ${legal.join(', ')}.`
          : `"${from}" is a terminal state.`),
    };
  }
  return { ok: true, from, to, action };
}

/**
 * The safety property the pure transition table above cannot express on its own: a CONTAINED
 * incident whose breach classification is still clock-applicable (SUSPECTED / CONFIRMED /
 * UNDETERMINED — anything except NOT_PERSONAL_DATA, see gdpr-clock.ts's `isClockApplicable`) may
 * NOT jump straight to RESOLVED; it must pass through NOTIFY first. Returns a rejection message
 * when the jump is disallowed, or `null` when it's fine to proceed. Removing this guard (or
 * loosening it to ignore breach class) is exactly the defect
 * tests/unit/incident-state-machine.test.ts's "cannot resolve a breach-class incident without
 * notifying first" case exists to catch.
 */
export function assertNotifyBeforeResolve(
  from: IncidentLifecycleState,
  breachClassIsClockApplicable: boolean
): string | null {
  if (from === 'CONTAINED' && breachClassIsClockApplicable) {
    return (
      'A personal-data-breach incident must be NOTIFIED before it can be RESOLVED ' +
      '(GDPR Art. 33 / master-spec §16.7 item 4) — resolve is rejected from CONTAINED while the ' +
      'breach classification is still clock-applicable.'
    );
  }
  return null;
}
