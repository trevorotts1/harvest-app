import {
  emitSecurityEvent,
  getSecurityEventSink,
  InMemorySecurityEventSink,
  PrismaSecurityEventSink,
  setSecurityEventSink,
  type SecurityEventPrismaClient,
} from '../../src/services/security/security-event';

/**
 * Proves (T-12 build brief, PROVE item e): "each [protection] emits the right SecurityEvent" —
 * the module contract every scenario test (mfa-step-up, rate-limiter's callers, session-security's
 * callers, with-role-security.test.ts) relies on. Append-only: no update/delete method exists on
 * `SecurityEventSink` at all, mirroring the model's own "no update path is exposed by design".
 */
describe('SecurityEvent emission (§16.4 "every auth/session event written to SecurityEvent")', () => {
  beforeEach(() => {
    setSecurityEventSink(new InMemorySecurityEventSink());
  });

  test('emitSecurityEvent records against the active sink, hashed fields never plaintext IP', async () => {
    await emitSecurityEvent({
      userId: 'user-1',
      type: 'login_failure',
      ipHash: 'deadbeef',
      deviceFingerprintHash: 'fp-1',
      severity: 'WARNING',
    });

    const sink = getSecurityEventSink() as InMemorySecurityEventSink;
    const events = sink.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: 'user-1',
      type: 'login_failure',
      ip_hash: 'deadbeef',
      device_fingerprint_hash: 'fp-1',
      severity: 'WARNING',
    });
    expect(events[0]!.id).toBeTruthy();
    expect(events[0]!.created_at).toBeTruthy();
  });

  test('severity defaults to INFO when not specified', async () => {
    await emitSecurityEvent({ type: 'mfa_enrolled', userId: 'user-1' });
    const sink = getSecurityEventSink() as InMemorySecurityEventSink;
    expect(sink.all()[0]?.severity).toBe('INFO');
  });

  test('userId is nullable for platform-level events (e.g. an unauthenticated rate-limit hit)', async () => {
    await emitSecurityEvent({ type: 'rate_limited', severity: 'WARNING' });
    const sink = getSecurityEventSink() as InMemorySecurityEventSink;
    expect(sink.all()[0]?.user_id).toBeNull();
  });

  test('ofType filters correctly across a mix of event types', async () => {
    await emitSecurityEvent({ type: 'login_success', userId: 'a' });
    await emitSecurityEvent({ type: 'login_failure', userId: 'b' });
    await emitSecurityEvent({ type: 'login_failure', userId: 'c' });

    const sink = getSecurityEventSink() as InMemorySecurityEventSink;
    expect(sink.ofType('login_failure')).toHaveLength(2);
    expect(sink.ofType('login_success')).toHaveLength(1);
    expect(sink.ofType('session_revoked')).toHaveLength(0);
  });

  test('a sink failure does not throw out of emitSecurityEvent (fail-open for the write itself)', async () => {
    setSecurityEventSink({
      emit: async () => {
        throw new Error('simulated DB outage');
      },
    });
    await expect(emitSecurityEvent({ type: 'login_success', userId: 'a' })).resolves.toBeUndefined();
  });

  test('PrismaSecurityEventSink maps to the narrow prisma.securityEvent.create delegate', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'evt-1', created_at: new Date('2026-01-01T00:00:00Z') });
    const fakePrisma: SecurityEventPrismaClient = { securityEvent: { create } };
    const sink = new PrismaSecurityEventSink(fakePrisma);

    const record = await sink.emit({ type: 'session_revoked', userId: 'user-9', severity: 'WARNING' });

    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: 'user-9',
        type: 'session_revoked',
        ip_hash: null,
        device_fingerprint_hash: null,
        severity: 'WARNING',
      },
    });
    expect(record.id).toBe('evt-1');
  });

  test('no update/delete method is exposed anywhere on the sink surface (append-only by construction)', () => {
    const sink = new InMemorySecurityEventSink();
    expect((sink as unknown as { update?: unknown }).update).toBeUndefined();
    expect((sink as unknown as { delete?: unknown }).delete).toBeUndefined();
  });
});
