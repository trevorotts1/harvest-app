import {
  INCIDENT_DECLARE_THRESHOLD,
  INCIDENT_CORRELATION_WINDOW_MS,
  classifySecurityEvents,
  correlationKeyFor,
  type SecurityEventLike,
} from '../../src/services/security/incident/incident-classifier';

/**
 * Proves build-brief PROVE item (a): "a cluster of security events crossing the §16.7 threshold
 * DECLARES an incident (below threshold does not)."
 */
function evt(overrides: Partial<SecurityEventLike> & { id: string; type: string }): SecurityEventLike {
  return {
    user_id: 'user-1',
    ip_hash: null,
    severity: 'WARNING',
    created_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('classifySecurityEvents — §16.7 threshold correlation (PROVE item a)', () => {
  test('below-threshold cluster does NOT declare an incident', () => {
    // Two suspected_takeover events (weight 4 each = 8) is below INCIDENT_DECLARE_THRESHOLD (10).
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'suspected_takeover', created_at: '2026-07-16T00:00:00.000Z' }),
      evt({ id: 'e2', type: 'suspected_takeover', created_at: '2026-07-16T00:05:00.000Z' }),
    ];
    const [result] = classifySecurityEvents(events);
    expect(result.declared).toBe(false);
    expect(result.score).toBe(8);
    expect(result.severity).toBeNull();
    expect(result.breachClass).toBeNull();
    expect(result.evidenceEventIds).toEqual([]);
    expect(result.reason).toMatch(/below the declare threshold/);
  });

  test('a third correlated suspected_takeover event crosses the threshold and DECLARES', () => {
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'suspected_takeover', created_at: '2026-07-16T00:00:00.000Z' }),
      evt({ id: 'e2', type: 'suspected_takeover', created_at: '2026-07-16T00:05:00.000Z' }),
      evt({ id: 'e3', type: 'suspected_takeover', created_at: '2026-07-16T00:10:00.000Z' }),
    ];
    const [result] = classifySecurityEvents(events);
    expect(result.declared).toBe(true);
    expect(result.score).toBe(12); // 4 + 4 + 4
    expect(result.severity).toBe('SEV-3'); // score in [10, 25)
    expect(result.breachClass).toBe('SUSPECTED_PERSONAL_DATA_BREACH'); // user-identified cluster
    expect(result.evidenceEventIds).toEqual(['e1', 'e2', 'e3']);
    expect(result.declaredAt).toBe('2026-07-16T00:10:00.000Z'); // the tipping event's own timestamp
    expect(result.reason).toMatch(/crossed the declare threshold/);
  });

  test('a single explicit breach_incident event declares on its own (weight 10 = threshold)', () => {
    const events: SecurityEventLike[] = [evt({ id: 'e1', type: 'breach_incident', severity: 'CRITICAL' })];
    const [result] = classifySecurityEvents(events);
    expect(result.declared).toBe(true);
    expect(result.score).toBe(10);
    expect(result.evidenceEventIds).toEqual(['e1']);
  });

  test('events outside the correlation window do not combine to cross the threshold', () => {
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'suspected_takeover', created_at: '2026-07-16T00:00:00.000Z' }),
      evt({ id: 'e2', type: 'suspected_takeover', created_at: '2026-07-16T00:05:00.000Z' }),
      // e3 arrives well outside the 60-minute window from e1/e2 — the window should have evicted
      // them by the time e3 is scored, so the cumulative-since-forever sum (12) must NOT be used.
      evt({
        id: 'e3',
        type: 'suspected_takeover',
        created_at: new Date(
          new Date('2026-07-16T00:05:00.000Z').getTime() + INCIDENT_CORRELATION_WINDOW_MS + 60_000
        ).toISOString(),
      }),
    ];
    const [result] = classifySecurityEvents(events);
    expect(result.declared).toBe(false);
    expect(result.score).toBe(4); // only e3's own weight remains in the trailing window
  });

  test('noise-only types (login_success, mfa_enrolled) never contribute to a cluster score', () => {
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'login_success' }),
      evt({ id: 'e2', type: 'mfa_enrolled' }),
      evt({ id: 'e3', type: 'session_revoked' }),
    ];
    expect(classifySecurityEvents(events)).toEqual([]); // filtered out entirely — no correlation group formed
  });

  test('distinct users are classified as separate correlation groups', () => {
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'suspected_takeover', user_id: 'user-a', created_at: '2026-07-16T00:00:00.000Z' }),
      evt({ id: 'e2', type: 'suspected_takeover', user_id: 'user-a', created_at: '2026-07-16T00:01:00.000Z' }),
      evt({ id: 'e3', type: 'suspected_takeover', user_id: 'user-a', created_at: '2026-07-16T00:02:00.000Z' }),
      // user-b only has a single event — should stay below threshold independently of user-a.
      evt({ id: 'e4', type: 'suspected_takeover', user_id: 'user-b', created_at: '2026-07-16T00:02:00.000Z' }),
    ];
    const results = classifySecurityEvents(events);
    expect(results).toHaveLength(2);
    const byKey = new Map(results.map((r) => [r.correlationKey, r]));
    expect(byKey.get('user:user-a')?.declared).toBe(true);
    expect(byKey.get('user:user-b')?.declared).toBe(false);
  });

  test('an IP-only cluster (no known user) classifies as UNDETERMINED, not SUSPECTED', () => {
    const events: SecurityEventLike[] = [
      evt({ id: 'e1', type: 'rate_limited', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:00:00.000Z' }),
      evt({ id: 'e2', type: 'rate_limited', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:01:00.000Z' }),
      evt({ id: 'e3', type: 'login_failure', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:02:00.000Z' }),
      evt({ id: 'e4', type: 'login_failure', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:03:00.000Z' }),
      evt({ id: 'e5', type: 'privilege_escalation_denied', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:04:00.000Z' }),
      evt({ id: 'e6', type: 'privilege_escalation_denied', user_id: null, ip_hash: 'iphash-1', created_at: '2026-07-16T00:05:00.000Z' }),
    ];
    // scores: 1+1+1+1+3+3 = 10
    const [result] = classifySecurityEvents(events);
    expect(result.declared).toBe(true);
    expect(result.correlationKey).toBe('ip:iphash-1');
    expect(result.breachClass).toBe('UNDETERMINED');
  });

  test('severity escalates with score (SEV-1/SEV-2/SEV-3)', () => {
    const many = (n: number, idPrefix: string) =>
      Array.from({ length: n }, (_, i) =>
        evt({
          id: `${idPrefix}${i}`,
          type: 'suspected_takeover',
          created_at: new Date(new Date('2026-07-16T00:00:00.000Z').getTime() + i * 1000).toISOString(),
        })
      );

    // 3 events = score 12 -> SEV-3
    expect(classifySecurityEvents(many(3, 'a'))[0].severity).toBe('SEV-3');
    // 7 events = score 28 -> SEV-2
    expect(classifySecurityEvents(many(7, 'b'))[0].severity).toBe('SEV-2');
    // 10 events = score 40 -> SEV-1
    expect(classifySecurityEvents(many(10, 'c'))[0].severity).toBe('SEV-1');
  });

  test('correlationKeyFor prefers user_id, falls back to ip_hash, then a platform bucket', () => {
    expect(correlationKeyFor({ user_id: 'u1', ip_hash: 'ip1' })).toBe('user:u1');
    expect(correlationKeyFor({ user_id: null, ip_hash: 'ip1' })).toBe('ip:ip1');
    expect(correlationKeyFor({ user_id: null, ip_hash: null })).toBe('platform:unidentified');
  });

  test('INCIDENT_DECLARE_THRESHOLD is exactly 10 (documents the contract the tests above assume)', () => {
    expect(INCIDENT_DECLARE_THRESHOLD).toBe(10);
  });
});
