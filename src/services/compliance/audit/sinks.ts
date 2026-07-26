import { Role } from '@prisma/client';
import type { CFEAuditSink } from './audit-sink';
import type { CFEAuditEvent } from '@/types/compliance';
import type { LicensingEventSink } from '../licensing/licensing-audit';
import type { LicensingAuditEvent } from '@/types/licensing';
import type { DataRightsAuditSink, DataRightsAuditEvent } from '../data-rights/audit-emit';
import { AuditService, deriveRegulationTag, type RecordAuditEventInput } from './audit-service';

/**
 * The funnel (§5.7 "integration points"): bridge adapters that let the CFE (T-08), licensing
 * (T-13), and data-rights (T-11) units keep emitting through their OWN existing sink interfaces
 * (`CFEAuditSink.emit`, `LicensingEventSink.record`, `DataRightsAuditSink.record`) — untouched,
 * their tests still construct `InMemory*Sink`s directly — while production wiring plugs one of
 * these Durable* adapters in instead, so every event actually lands in the durable, hash-chained
 * store (`AuditService.recordAuditEvent`, `./audit-service.ts`).
 *
 * None of this touches CFE fail-closed logic, licensing gate logic, or data-rights scrub logic:
 * each adapter only translates an already-built domain event into `RecordAuditEventInput` and
 * calls `AuditService.recordAuditEvent`. A future T-12 account-security sink follows the exact
 * same shape (`domain: 'account_security'`) once `SecurityEvent` exists to adapt from.
 */

/** LicensingAuditEvent/DataRightsAuditEvent don't carry the data subject's `Role` (only an
 *  optional free-text `actor_role`/no role field at all) — see the module doc in each domain's
 *  own audit-emit file. Defaults to REP (the licensing state machine and the large majority of
 *  data-rights self-service requests are reps); a caller with the real role available can always
 *  go through `AuditService.recordAuditEvent` directly instead of this adapter. */
function coerceRole(candidate: string | undefined): Role {
  if (candidate && (Object.values(Role) as string[]).includes(candidate)) {
    return candidate as Role;
  }
  return Role.REP;
}

// ── CFE (T-08) ────────────────────────────────────────────────────────────────────────────────

/** Adapts a `CFEAuditEvent` (§5.6's per-decision evidence record) onto `RecordAuditEventInput`. */
export function mapCfeEventToAuditInput(event: CFEAuditEvent): RecordAuditEventInput {
  return {
    domain: 'cfe',
    user_id: event.user_id,
    role: event.role,
    content_id: event.content_id,
    content_text: event.content_text,
    content_hash: event.content_hash,
    channel: event.channel,
    risk_score: event.risk_score,
    outcome: event.outcome,
    event_data: {
      band: event.band,
      held: event.held,
      held_reason: event.held_reason,
      classifier_results: event.classifier_results,
      classifiers_triggered: event.classifiers_triggered,
      safe_harbor_injected: event.safe_harbor_injected,
      safe_harbor_disclaimers: event.safe_harbor_disclaimers,
      // T-R51 OBSERVE mode: additive-only. Present (non-empty) only when the engine's
      // `vocabularyMode==='observe'` (default) AND a §0.5 doctrine-vocabulary term matched — see
      // `engine.ts`'s `buildVerdict` for where this is populated. This is the durable record the
      // compliance-review "vocabulary observability" surface aggregates by term; it never feeds
      // back into any block/release decision — that decision is already final by the time a
      // `CFEAuditEvent` exists at all.
      vocabulary_violations: event.vocabulary_violations ?? [],
      vocabulary_mode: event.vocabulary_mode ?? null,
    },
    regulation: deriveRegulationTag(event.regulation),
    rule_version: event.rule_version,
    reviewer_id: event.reviewer_id ?? null,
    reviewer_action: event.reviewer_action ?? null,
    timestamp: event.timestamp,
  };
}

/**
 * Durable `CFEAuditSink` — plug into `ComplianceFilterEngine`'s `auditSink` dependency in
 * production wiring. `emit()` is synchronous (matching the `CFEAuditSink` contract the CFE calls
 * without awaiting, §5.2 fail-closed timing is never gated on audit persistence); persistence is
 * fire-and-forget with a logged failure — losing an audit write must never block or fail a CFE
 * decision (that would turn an observability gap into an outage of the compliance gate itself).
 */
export class DurableCFEAuditSink implements CFEAuditSink {
  constructor(private store: AuditService) {}

  emit(event: CFEAuditEvent): void {
    void this.store.recordAuditEvent(mapCfeEventToAuditInput(event)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[audit-store] failed to persist CFE audit event (§5.6)', err);
    });
  }
}

// ── Licensing (T-13) ─────────────────────────────────────────────────────────────────────────

/**
 * Adapts a `LicensingAuditEvent` (§16.5 state-machine transition record) onto
 * `RecordAuditEventInput`. Licensing transitions are informational evidence, not a CFE risk-band
 * decision, so `outcome` is always `RECORDED` (never mapped onto PASS/FLAG/BLOCK).
 *
 * T-57 RG8 (i18n; server-i18n-leak) — `narrative` is PERMANENT-EXEMPT (`SERVER_I18N_LEAK_BASELINE.
 * json`, `narrative: Licensing state transition:`). It feeds ONLY `AuditService.recordAuditEvent`'s
 * durable, hash-chained COMPLIANCE audit log (§5.7) — confirmed by grep that no `.tsx` anywhere
 * renders `AuditEvent.content_text`/`narrative`; this is a write-only regulator/compliance-officer
 * evidentiary record, never rep-facing. Never localize: the audit trail's language must stay fixed
 * (auditability/consistency of the evidentiary record across every event, regardless of which
 * rep's action produced it), not follow the acting rep's UI locale.
 */
export function mapLicensingEventToAuditInput(event: LicensingAuditEvent): RecordAuditEventInput {
  const narrative = `Licensing state transition: ${event.from_state} -> ${event.to_state} (${event.action}) in ${event.jurisdiction}${event.reason ? ` — ${event.reason}` : ''}`;
  return {
    domain: 'licensing',
    user_id: event.user_id,
    role: coerceRole(event.actor_role),
    content_id: event.id,
    content_text: narrative,
    channel: null,
    risk_score: 0,
    outcome: 'RECORDED',
    event_data: {
      jurisdiction: event.jurisdiction,
      from_state: event.from_state,
      to_state: event.to_state,
      action: event.action,
      actor_id: event.actor_id,
      actor_role: event.actor_role ?? null,
      reason: event.reason ?? null,
    },
    // §16.5 licensing is the state-insurance regulatory domain.
    regulation: 'STATE_INSURANCE',
    rule_version: 'licensing-state-machine-§16.5-v1',
    reviewer_id: event.actor_id,
    reviewer_action: event.action,
    timestamp: event.occurred_at,
  };
}

/** Durable `LicensingEventSink` — plug into `LicensingService` in production wiring. */
export class DurableLicensingEventSink implements LicensingEventSink {
  constructor(private store: AuditService) {}

  async record(event: LicensingAuditEvent): Promise<void> {
    await this.store.recordAuditEvent(mapLicensingEventToAuditInput(event));
  }
}

// ── Data-rights (T-11) ───────────────────────────────────────────────────────────────────────

/**
 * Adapts a `DataRightsAuditEvent` (§16.3 export/deletion/legal-hold lifecycle record) onto
 * `RecordAuditEventInput`. Like licensing, these are informational evidence (`RECORDED`), not a
 * CFE decision.
 *
 * T-57 RG8 (i18n; server-i18n-leak) — `narrative` is PERMANENT-EXEMPT (`SERVER_I18N_LEAK_BASELINE.
 * json`, `narrative: Data-rights event:`) — same rationale as `mapLicensingEventToAuditInput`
 * above: write-only into the durable compliance audit log, never rendered to any rep, never
 * localized (the audit trail's language is fixed, not the acting rep's UI locale).
 */
export function mapDataRightsEventToAuditInput(event: DataRightsAuditEvent): RecordAuditEventInput {
  const narrative = `Data-rights event: ${event.type} for user ${event.user_id} (actor ${event.actor_id})`;
  return {
    domain: 'data_rights',
    user_id: event.user_id,
    role: coerceRole(undefined),
    content_id: null,
    content_text: narrative,
    channel: null,
    risk_score: 0,
    outcome: 'RECORDED',
    event_data: {
      type: event.type,
      actor_id: event.actor_id,
      detail: event.detail,
    },
    // The data-rights portal's own regulatory basis (§16.2/§16.3) is GDPR/CCPA, distinct from the
    // FINRA-tagged rows THIS event type may be reporting on (e.g. `deletion.completed`'s
    // `retained_fields` lists FINRA AuditEntry rows in its `detail`, but this event row itself is
    // a GDPR/CCPA-process record, not a FINRA-retained communication).
    regulation: 'GDPR',
    rule_version: 'data-rights-§16.3-v1',
    reviewer_id: event.actor_id,
    reviewer_action: event.type,
    timestamp: event.timestamp,
  };
}

/** Durable `DataRightsAuditSink` — plug into `DataRightsService`/`LegalHoldService` in production
 *  wiring. */
export class DurableDataRightsAuditSink implements DataRightsAuditSink {
  constructor(private store: AuditService) {}

  async record(event: DataRightsAuditEvent): Promise<void> {
    await this.store.recordAuditEvent(mapDataRightsEventToAuditInput(event));
  }
}

/** Convenience factory: one durable audit store, wired into all three producers' sink contracts
 *  at once. Production composition roots (WP04/05/06/07's engine constructors) import this rather
 *  than hand-wiring three separate adapters. */
export function createDurableAuditSinks(store: AuditService): {
  cfeSink: DurableCFEAuditSink;
  licensingSink: DurableLicensingEventSink;
  dataRightsSink: DurableDataRightsAuditSink;
} {
  return {
    cfeSink: new DurableCFEAuditSink(store),
    licensingSink: new DurableLicensingEventSink(store),
    dataRightsSink: new DurableDataRightsAuditSink(store),
  };
}
