// WP11 §16.5 — LicensingService: the stateful entry point WP01/WP03/WP08 (and, indirectly, the
// CFE's Insurance-Recommendation classifier via getLicensedJurisdictions) use to read and mutate
// a rep's per-jurisdiction licensing status.
//
// A rep with no LicensingRecord row for a jurisdiction is UNLICENSED there by fail-closed
// default — absence of a record never implies a license. Every successful transition is
// persisted through the injected LicensingRepository and emitted to every injected
// LicensingEventSink (who/when/from/to/why); illegal transitions are rejected before either side
// effect happens — no record is written, no event is emitted.

import {
  LicensingAction,
  LicensingActorContext,
  LicensingAuditEvent,
  LicensingRecordData,
  LicensingState,
  LicensingTransitionOutcome,
} from '../../../types/licensing';
import {
  applyTransition,
  canPerformLicensedActivity as canPerformLicensedActivityForState,
  strictestState,
} from './licensing-state-machine';
import { LicensingRepository } from './licensing-repository';
import { LicensingEventSink } from './licensing-audit';

function newId(): string {
  // crypto.randomUUID is available in the Node 18+ / Next.js runtime this repo targets (see
  // audit-service.ts's identical use).
  return crypto.randomUUID();
}

export class LicensingService {
  constructor(
    private readonly repository: LicensingRepository,
    private readonly eventSinks: LicensingEventSink[] = []
  ) {}

  /** The raw record for one (user, jurisdiction) pair, or null if none exists yet. */
  async getRecord(userId: string, jurisdiction: string): Promise<LicensingRecordData | null> {
    return this.repository.get(userId, jurisdiction);
  }

  /** All jurisdiction records a rep has ever had a transition in. */
  async getAllRecords(userId: string): Promise<LicensingRecordData[]> {
    return this.repository.getAllForUser(userId);
  }

  /**
   * The effective LicensingState for a rep.
   *   - With a jurisdiction: that jurisdiction's state, or UNLICENSED if no record exists there.
   *   - Without a jurisdiction: the strictest (most restrictive) state across every jurisdiction
   *     the rep has a record in (§16.5 "the strictest state governs a multi-state rep"); a rep
   *     with zero records anywhere is UNLICENSED.
   */
  async getEffectiveState(userId: string, jurisdiction?: string): Promise<LicensingState> {
    if (jurisdiction) {
      const record = await this.repository.get(userId, jurisdiction);
      return record ? record.state : 'UNLICENSED';
    }
    const all = await this.repository.getAllForUser(userId);
    return strictestState(all.map((r) => r.state));
  }

  /**
   * The capability query WP01/WP03/WP08 call to hard-block unlicensed reps from insurance/
   * financial activities. jurisdiction, when passed, should be the state the activity is being
   * performed in (e.g. the recipient/contact's resident state per §5.5's "state-specific
   * restrictions key to the rep's declared state"); omit it to apply the strictest-state-governs
   * default for a multi-state rep.
   */
  async canPerformLicensedActivity(userId: string, jurisdiction?: string): Promise<boolean> {
    return canPerformLicensedActivityForState(await this.getEffectiveState(userId, jurisdiction));
  }

  /**
   * The jurisdictions in which a rep currently holds an active LICENSED status — feed this
   * directly into the CFE's UserContext.licensed_states (src/types/compliance.ts), which the
   * Insurance-Recommendation classifier already reads (§5.3 item 4).
   */
  async getLicensedJurisdictions(userId: string): Promise<string[]> {
    const all = await this.repository.getAllForUser(userId);
    return all.filter((r) => r.state === 'LICENSED').map((r) => r.jurisdiction);
  }

  /**
   * Attempts a guarded transition for one (user, jurisdiction) pair. On success: the record is
   * upserted and one LicensingAuditEvent is emitted to every configured sink, recording who
   * (actor.actor_id/actor_role), when (occurred_at), and the from/to/action/reason. On failure —
   * an illegal transition — neither side effect occurs and the current state is returned
   * unchanged alongside the rejection reason.
   */
  async applyTransition(
    userId: string,
    jurisdiction: string,
    action: LicensingAction,
    actor: LicensingActorContext
  ): Promise<LicensingTransitionOutcome> {
    const existing = await this.repository.get(userId, jurisdiction);
    const from: LicensingState = existing ? existing.state : 'UNLICENSED';

    const result = applyTransition(from, action);
    if (!result.ok) {
      return { ok: false, state: from, error: result.error };
    }

    const now = new Date().toISOString();
    const record: LicensingRecordData = {
      id: existing?.id ?? newId(),
      user_id: userId,
      jurisdiction,
      state: result.to,
      license_number: existing?.license_number ?? null,
      issued_at: existing?.issued_at ?? null,
      expires_at: existing?.expires_at ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await this.repository.upsert(record);

    const event: LicensingAuditEvent = {
      id: newId(),
      user_id: userId,
      jurisdiction,
      from_state: result.from,
      to_state: result.to,
      action: result.action,
      actor_id: actor.actor_id,
      actor_role: actor.actor_role,
      reason: actor.reason,
      occurred_at: now,
    };
    await Promise.all(this.eventSinks.map((sink) => sink.record(event)));

    return { ok: true, state: result.to, record };
  }
}
