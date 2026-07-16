import { Role } from '@prisma/client';

import {
  InMemorySecurityEventSink,
  emitSecurityEvent,
  getSecurityEventSink,
  setSecurityEventSink,
} from '../../src/services/security/security-event';
import { IncidentDetectingSecurityEventSink } from '../../src/services/security/incident/security-event-bridge';
import { IncidentService } from '../../src/services/security/incident/incident-service';
import { InMemoryIncidentRepository } from '../../src/services/security/incident/incident-repository';
import { IncidentActor } from '../../src/types/incident';

const ADMIN: IncidentActor = { actorId: 'admin-1', role: Role.ADMIN };

/**
 * Proves build-brief item 5: "Wire it so T-12's existing SecurityEvent emissions actually flow
 * into detection (adapt/consume its sink interface WITHOUT breaking T-12's tests)." This test
 * drives T-12's own public API (`emitSecurityEvent`/`setSecurityEventSink`) — the exact call-sites
 * every real auth/session code path already uses — and proves an incident is auto-declared without
 * touching src/services/security/security-event.ts at all.
 */
describe('IncidentDetectingSecurityEventSink — wires T-12 SecurityEvent emissions into detection', () => {
  afterEach(() => {
    setSecurityEventSink(new InMemorySecurityEventSink());
  });

  test('a correlated cluster emitted through emitSecurityEvent auto-declares an incident', async () => {
    const underlying = new InMemorySecurityEventSink();
    const incidentRepo = new InMemoryIncidentRepository();
    const incidents = new IncidentService(incidentRepo);
    const bridge = new IncidentDetectingSecurityEventSink(underlying, incidents);
    setSecurityEventSink(bridge);

    // Below threshold: 2 suspected_takeover events for the same user (score 8 < 10).
    await emitSecurityEvent({ userId: 'victim-9', type: 'suspected_takeover', severity: 'CRITICAL' });
    await emitSecurityEvent({ userId: 'victim-9', type: 'suspected_takeover', severity: 'CRITICAL' });
    expect(await incidents.listIncidents(ADMIN)).toHaveLength(0);

    // Crossing: a third event tips the cluster over threshold (score 12 >= 10).
    await emitSecurityEvent({ userId: 'victim-9', type: 'suspected_takeover', severity: 'CRITICAL' });
    const declared = await incidents.listIncidents(ADMIN);
    expect(declared).toHaveLength(1);
    expect(declared[0].userId).toBe('victim-9');
    expect(declared[0].breachClass).toBe('SUSPECTED_PERSONAL_DATA_BREACH');
    expect(declared[0].gdprClock.applicable).toBe(true);

    // The underlying sink still received every real SecurityEvent — the bridge decorates, it
    // never swallows.
    expect(underlying.all()).toHaveLength(3);
    expect(getSecurityEventSink()).toBe(bridge);
  });

  test('does not re-declare a second incident for the same still-open correlation key', async () => {
    const incidentRepo = new InMemoryIncidentRepository();
    const incidents = new IncidentService(incidentRepo);
    const bridge = new IncidentDetectingSecurityEventSink(new InMemorySecurityEventSink(), incidents);
    setSecurityEventSink(bridge);

    for (let i = 0; i < 3; i++) {
      await emitSecurityEvent({ userId: 'victim-repeat', type: 'suspected_takeover', severity: 'CRITICAL' });
    }
    // A 4th and 5th event keep the same correlation key crossing threshold repeatedly.
    await emitSecurityEvent({ userId: 'victim-repeat', type: 'suspected_takeover', severity: 'CRITICAL' });
    await emitSecurityEvent({ userId: 'victim-repeat', type: 'suspected_takeover', severity: 'CRITICAL' });

    expect(await incidents.listIncidents(ADMIN)).toHaveLength(1);
  });

  test('an isolated single breach_incident SecurityEvent declares immediately (no clustering needed)', async () => {
    const incidentRepo = new InMemoryIncidentRepository();
    const incidents = new IncidentService(incidentRepo);
    const bridge = new IncidentDetectingSecurityEventSink(new InMemorySecurityEventSink(), incidents);
    setSecurityEventSink(bridge);

    await emitSecurityEvent({ userId: 'victim-single', type: 'breach_incident', severity: 'CRITICAL' });
    const declared = await incidents.listIncidents(ADMIN);
    expect(declared).toHaveLength(1);
    expect(declared[0].userId).toBe('victim-single');
  });

  test("T-12's own SecurityEvent sink contract is untouched — InMemorySecurityEventSink still works standalone", async () => {
    // This is exactly what tests/unit/security-event.test.ts does in its own beforeEach — proving
    // the bridge is purely additive and T-12's tests need zero changes.
    setSecurityEventSink(new InMemorySecurityEventSink());
    await emitSecurityEvent({ type: 'login_failure', userId: 'user-1', severity: 'WARNING' });
    const sink = getSecurityEventSink() as InMemorySecurityEventSink;
    expect(sink.all()).toHaveLength(1);
    expect(sink.ofType('login_failure')).toHaveLength(1);
  });
});
