import { BreachClass, IncidentSeverity } from '../../../types/incident';

/**
 * SecurityEvent correlation & threshold classification (§16.7 item 1 "Detect & triage. Sources:
 * SecurityEvent anomalies...", build-brief items 1/5). Deterministic and pure — no I/O, no clock
 * reads — so it is exhaustively unit-testable: the same input events always produce the same
 * declare/no-declare decision, and a below-threshold cluster never declares.
 *
 * Structurally decoupled from src/services/security/security-event.ts's exact `SecurityEventType`
 * union (only the fields actually needed are named in `SecurityEventLike` below) so this module
 * can be built/tested without importing T-12's module at all. `./security-event-bridge.ts` is what
 * actually connects the two, and it does so entirely through T-12's existing, untouched
 * `SecurityEventSink` contract.
 */

export interface SecurityEventLike {
  id: string;
  user_id: string | null;
  type: string;
  ip_hash: string | null;
  severity: string;
  /** ISO 8601. */
  created_at: string;
}

/**
 * Per-type contribution to a correlation cluster's score. `breach_incident` alone (weight 10)
 * already crosses `INCIDENT_DECLARE_THRESHOLD` — a single explicit "this is a breach" signal
 * (e.g. an upstream detector that has already confirmed compromise) is incident-worthy on its
 * own, no clustering required. Every other type needs to co-occur — multiple events, same
 * correlation key, inside the rolling window — to cross the threshold, which is what proves the
 * "below threshold does not declare / crossing threshold does" contract (build-brief PROVE item a).
 */
export const INCIDENT_SIGNAL_WEIGHTS: Record<string, number> = {
  breach_incident: 10,
  suspected_takeover: 4,
  privilege_escalation_denied: 3,
  mfa_verify_failed: 2,
  login_failure: 1,
  rate_limited: 1,
};

export const INCIDENT_DECLARE_THRESHOLD = 10;

/** Rolling correlation window (§16.7's "cluster ... anomaly events" is a time-boxed pattern, not
 *  an all-time sum — a suspected_takeover from six months ago is not evidence of a breach today). */
export const INCIDENT_CORRELATION_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

/** Groups by user when known (the common, PII-relevant case); falls back to the hashed IP when no
 *  user is attached (an unauthenticated credential-stuffing burst); falls back to a single shared
 *  bucket only when neither is present (defensive — every real SecurityEvent carries at least
 *  one). */
export function correlationKeyFor(event: Pick<SecurityEventLike, 'user_id' | 'ip_hash'>): string {
  if (event.user_id) return `user:${event.user_id}`;
  if (event.ip_hash) return `ip:${event.ip_hash}`;
  return 'platform:unidentified';
}

function severityForScore(score: number): IncidentSeverity {
  if (score >= 40) return 'SEV-1';
  if (score >= 25) return 'SEV-2';
  if (score >= INCIDENT_DECLARE_THRESHOLD) return 'SEV-3';
  return 'SEV-4';
}

/**
 * A correlation key with an identified user is presumed to implicate that user's personal data
 * (SUSPECTED, not CONFIRMED — confirmation is a human triage act; §16.7's "Detect & triage" is the
 * FIRST stage of the lifecycle, not the last). A key with no identified user (IP-only noise, e.g.
 * an unauthenticated credential-stuffing burst against many unknown accounts) is UNDETERMINED —
 * still clock-applicable (fail-toward-caution; see types/incident.ts's `BreachClass` doc), just
 * not presumptively tied to one specific data subject yet.
 */
function initialBreachClass(correlationKey: string): BreachClass {
  return correlationKey.startsWith('user:') ? 'SUSPECTED_PERSONAL_DATA_BREACH' : 'UNDETERMINED';
}

export interface ClassificationResult {
  declared: boolean;
  correlationKey: string;
  userId: string | null;
  score: number;
  severity: IncidentSeverity | null;
  breachClass: BreachClass | null;
  evidenceEventIds: string[];
  /** ISO 8601 timestamp of the event that first tipped the cluster over the threshold — the GDPR
   *  Art. 33 "becoming aware" instant when `declared` is true; `null` otherwise. */
  declaredAt: string | null;
  reason: string;
}

function groupByCorrelationKey(events: SecurityEventLike[]): Map<string, SecurityEventLike[]> {
  const groups = new Map<string, SecurityEventLike[]>();
  for (const event of events) {
    const key = correlationKeyFor(event);
    const bucket = groups.get(key) ?? [];
    bucket.push(event);
    groups.set(key, bucket);
  }
  return groups;
}

/**
 * Classifies a batch of SecurityEvents into per-correlation-key results. Only event types present
 * in `INCIDENT_SIGNAL_WEIGHTS` contribute to a score; every other type is evidence-irrelevant
 * noise for THIS classifier (`login_success`, `mfa_enrolled`, `password_reset`, `session_revoked`
 * never push a cluster toward "incident").
 *
 * Sliding-window algorithm: for each correlation key's events sorted by time, maintain a trailing
 * window of at most `INCIDENT_CORRELATION_WINDOW_MS`. The FIRST event whose window-sum crosses
 * `INCIDENT_DECLARE_THRESHOLD` is the declare moment — its timestamp is "when the system became
 * aware" (GDPR Art. 33's clock-start trigger), not the timestamp of whichever event happens to be
 * last in the input batch. This deliberately anchors the clock as early as the evidence allows,
 * never later: a classifier that only checked "the last event's time" could let a slow batch job
 * silently delay when the clock is deemed to have started, which is exactly the wrong direction to
 * be wrong in for a regulatory deadline.
 *
 * Severity, separately, is driven by the PEAK trailing-window score observed from the declare
 * moment onward (never before it — evidence that had already rolled out of the window by the
 * crossing point never counts toward severity either): the clock starts the instant we become
 * aware, but how severe the incident turns out to be reflects the fullest picture the batch gives
 * us, including correlated evidence that kept arriving after that first crossing.
 */
export function classifySecurityEvents(events: SecurityEventLike[]): ClassificationResult[] {
  const groups = groupByCorrelationKey(
    events.filter((e) => INCIDENT_SIGNAL_WEIGHTS[e.type] !== undefined)
  );
  const results: ClassificationResult[] = [];

  for (const [key, groupEvents] of groups) {
    const sorted = [...groupEvents].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let windowStart = 0;
    let windowScore = 0;
    let declaredIndex = -1;

    // Peak window (score + bounds) observed from the declare moment onward.
    let peakScore = 0;
    let peakWindowStart = -1;
    let peakIndex = -1;

    for (let i = 0; i < sorted.length; i++) {
      windowScore += INCIDENT_SIGNAL_WEIGHTS[sorted[i].type] ?? 0;

      while (
        windowStart < i &&
        new Date(sorted[i].created_at).getTime() - new Date(sorted[windowStart].created_at).getTime() >
          INCIDENT_CORRELATION_WINDOW_MS
      ) {
        windowScore -= INCIDENT_SIGNAL_WEIGHTS[sorted[windowStart].type] ?? 0;
        windowStart++;
      }

      if (declaredIndex === -1 && windowScore >= INCIDENT_DECLARE_THRESHOLD) {
        declaredIndex = i;
      }

      if (declaredIndex !== -1 && windowScore > peakScore) {
        peakScore = windowScore;
        peakWindowStart = windowStart;
        peakIndex = i;
      }
    }

    if (declaredIndex === -1) {
      results.push({
        declared: false,
        correlationKey: key,
        userId: sorted[0]?.user_id ?? null,
        score: windowScore,
        severity: null,
        breachClass: null,
        evidenceEventIds: [],
        declaredAt: null,
        reason: `weighted signal score ${windowScore} is below the declare threshold ${INCIDENT_DECLARE_THRESHOLD} (§16.7)`,
      });
      continue;
    }

    const evidence = sorted.slice(peakWindowStart, peakIndex + 1);
    results.push({
      declared: true,
      correlationKey: key,
      userId: sorted[declaredIndex].user_id,
      score: peakScore,
      severity: severityForScore(peakScore),
      breachClass: initialBreachClass(key),
      evidenceEventIds: evidence.map((e) => e.id),
      declaredAt: sorted[declaredIndex].created_at,
      reason:
        `weighted signal score ${peakScore} crossed the declare threshold ${INCIDENT_DECLARE_THRESHOLD} ` +
        `across ${evidence.length} correlated SecurityEvent(s) within ${INCIDENT_CORRELATION_WINDOW_MS / 60000} minutes (§16.7)`,
    });
  }

  return results;
}
