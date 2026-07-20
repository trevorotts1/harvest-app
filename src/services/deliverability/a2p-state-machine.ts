// T-36 (§10.3) — the A2P 10DLC brand/campaign lifecycle (pure logic, no I/O). Mirrors
// src/services/compliance/licensing/licensing-state-machine.ts's design exactly: one legal-
// transition table, a typed result instead of throwing, and a single fail-closed capability query
// ("is this thing actually sendable"). Both A2PBrandRegistration and A2PCampaignRegistration share
// this exact same table — §10.3 names identical lifecycle vocabulary for both ("UNREGISTERED ->
// PENDING -> APPROVED/REJECTED").

import { A2PAction, A2PProvisioningStatus, A2PTransitionResult } from '../../types/deliverability';

const A2P_TRANSITIONS: Record<A2PProvisioningStatus, Partial<Record<A2PAction, A2PProvisioningStatus>>> = {
  UNREGISTERED: { SUBMIT: 'PENDING' },
  PENDING: { APPROVE: 'APPROVED', REJECT: 'REJECTED' },
  APPROVED: {},
  REJECTED: { RESUBMIT: 'PENDING' },
};

/** Returns the legal target state for (from, action), or null if the transition is illegal. */
export function legalA2PTargetState(from: A2PProvisioningStatus, action: A2PAction): A2PProvisioningStatus | null {
  return A2P_TRANSITIONS[from][action] ?? null;
}

/** The set of actions legal from a given state — used to build a helpful rejection message. */
export function legalA2PActionsFrom(from: A2PProvisioningStatus): A2PAction[] {
  return Object.keys(A2P_TRANSITIONS[from]) as A2PAction[];
}

/**
 * Attempts a transition. Legal transitions succeed and return the new state; illegal transitions
 * are rejected — ok: false, never throws, mirroring licensing-state-machine.ts's applyTransition
 * contract exactly. In particular: APPROVED and REJECTED cannot be reached except via PENDING (no
 * shortcut from UNREGISTERED straight to APPROVED), and only a REJECTED registration may be
 * RESUBMIT-ted — an already-APPROVED registration cannot be "resubmitted" through this table.
 */
export function applyA2PTransition(from: A2PProvisioningStatus, action: A2PAction): A2PTransitionResult {
  const to = legalA2PTargetState(from, action);
  if (!to) {
    const legal = legalA2PActionsFrom(from);
    return {
      ok: false,
      from,
      action,
      error:
        `Illegal A2P provisioning transition: cannot apply "${action}" from state "${from}". ` +
        (legal.length > 0
          ? `Legal actions from "${from}": ${legal.join(', ')}.`
          : `"${from}" is a terminal state for this action set.`),
    };
  }
  return { ok: true, from, to, action };
}

/**
 * The single fail-closed capability query: a brand or campaign is only "sendable" once its status
 * is APPROVED. Every other value — including PENDING, and any value outside the known union —
 * returns false. This is the exact property §10.3's "not-approved -> not sendable" launch gate
 * depends on; do not weaken this to also accept PENDING as "close enough."
 */
export function isA2PApproved(status: A2PProvisioningStatus): boolean {
  return status === 'APPROVED';
}

/** Runtime guard — true iff the value is one of the four known A2PProvisioningStatus values. */
export function isA2PProvisioningStatus(value: unknown): value is A2PProvisioningStatus {
  return typeof value === 'string' && value in A2P_TRANSITIONS;
}
