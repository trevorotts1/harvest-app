import { Role } from '@prisma/client';

import {
  IncidentAuthorizationError,
  IncidentService,
  type IncidentEventSink,
} from '../../src/services/security/incident/incident-service';
import { InMemoryIncidentRepository } from '../../src/services/security/incident/incident-repository';
import { IncidentActor, IncidentEventRecord } from '../../src/types/incident';
import { AuditService, InMemoryAuditRepository } from '../../src/services/compliance/audit/audit-service';
import { DurableIncidentAuditSink } from '../../src/services/security/incident/incident-audit-sink';

const ADMIN: IncidentActor = { actorId: 'admin-1', role: Role.ADMIN };
const RVP: IncidentActor = { actorId: 'rvp-1', role: Role.RVP };
const REP: IncidentActor = { actorId: 'rep-1', role: Role.REP };
const UPLINE: IncidentActor = { actorId: 'upline-1', role: Role.UPLINE };
const DUAL: IncidentActor = { actorId: 'dual-1', role: Role.DUAL };

function newService(sinks: IncidentEventSink[] = []): { service: IncidentService; repo: InMemoryIncidentRepository } {
  const repo = new InMemoryIncidentRepository();
  return { service: new IncidentService(repo, sinks), repo };
}

async function declareBreach(service: IncidentService, overrides: Partial<Parameters<IncidentService['declare']>[0]> = {}) {
  return service.declare({
    correlationKey: 'user:victim-1',
    userId: 'victim-1',
    severity: 'SEV-3',
    breachClass: 'SUSPECTED_PERSONAL_DATA_BREACH',
    score: 12,
    evidenceEventIds: ['se-1', 'se-2', 'se-3'],
    reason: 'test cluster',
    source: 'security_event_correlation',
    ...overrides,
  });
}

describe('IncidentService — orchestration, RBAC gating, append-only, fail-safe', () => {
  // ── RBAC gating (PROVE item d) ────────────────────────────────────────────────────────────────
  describe('RBAC gating — incident management is ADMIN/RVP only (PROVE item d)', () => {
    test('a REP is denied triage/contain/notify/resolve and every read view', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);

      await expect(service.triage(REP, snap.id, { notes: 'x' })).rejects.toBeInstanceOf(IncidentAuthorizationError);
      await expect(service.getIncidentAs(REP, snap.id)).rejects.toBeInstanceOf(IncidentAuthorizationError);
      await expect(service.listIncidents(REP)).rejects.toBeInstanceOf(IncidentAuthorizationError);
      await expect(service.listBreachWatchlist(REP)).rejects.toBeInstanceOf(IncidentAuthorizationError);
      await expect(service.listUntriagedBreachIncidents(REP)).rejects.toBeInstanceOf(IncidentAuthorizationError);
    });

    test('UPLINE and DUAL are also denied (stricter than compliance_audit — see rbac-matrix.ts)', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await expect(service.triage(UPLINE, snap.id, { notes: 'x' })).rejects.toBeInstanceOf(IncidentAuthorizationError);
      await expect(service.triage(DUAL, snap.id, { notes: 'x' })).rejects.toBeInstanceOf(IncidentAuthorizationError);
    });

    test('ADMIN and RVP are allowed to triage and to read', async () => {
      const { service } = newService();
      const asAdmin = await declareBreach(service);
      const asRvp = await declareBreach(service, { correlationKey: 'user:victim-2', userId: 'victim-2' });

      await expect(service.triage(ADMIN, asAdmin.id, { notes: 'looked at it' })).resolves.toMatchObject({
        lifecycleState: 'TRIAGED',
      });
      await expect(service.triage(RVP, asRvp.id, { notes: 'looked at it' })).resolves.toMatchObject({
        lifecycleState: 'TRIAGED',
      });
      await expect(service.listIncidents(ADMIN)).resolves.toHaveLength(2);
      await expect(service.listIncidents(RVP)).resolves.toHaveLength(2);
    });

    test('a manual (human-triggered) declare is RBAC-gated exactly like every other mutation', async () => {
      const { service } = newService();
      await expect(
        service.declare({
          correlationKey: 'user:manual-1',
          userId: 'manual-1',
          severity: 'SEV-4',
          breachClass: 'UNDETERMINED',
          score: 1,
          evidenceEventIds: [],
          reason: 'manual open from a provider-status alert',
          source: 'manual',
          actor: REP,
        })
      ).rejects.toBeInstanceOf(IncidentAuthorizationError);

      await expect(
        service.declare({
          correlationKey: 'user:manual-2',
          userId: 'manual-2',
          severity: 'SEV-4',
          breachClass: 'UNDETERMINED',
          score: 1,
          evidenceEventIds: [],
          reason: 'manual open from a provider-status alert',
          source: 'manual',
          actor: ADMIN,
        })
      ).resolves.toMatchObject({ lifecycleState: 'DETECTED' });
    });

    test('the automated correlation-engine declare path (no actor) is never RBAC-gated', async () => {
      const { service } = newService();
      await expect(declareBreach(service)).resolves.toMatchObject({ lifecycleState: 'DETECTED' });
    });
  });

  // ── Append-only enforcement (PROVE item e) ────────────────────────────────────────────────────
  describe('append-only enforcement — no update/delete API exists (PROVE item e)', () => {
    test('IncidentRepository and IncidentService expose no update or delete method', () => {
      const repo = new InMemoryIncidentRepository();
      const { service } = newService();
      expect((repo as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((repo as unknown as Record<string, unknown>).delete).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
      expect((service as unknown as Record<string, unknown>).delete).toBeUndefined();
    });

    test('appending a duplicate event id is rejected, never silently overwritten', async () => {
      const repo = new InMemoryIncidentRepository();
      const event: IncidentEventRecord = {
        id: 'dup-1',
        incident_id: 'inc-1',
        sequence: 1,
        kind: 'DECLARED',
        actor_id: null,
        actor_role: null,
        occurred_at: new Date().toISOString(),
        payload: { correlationKey: 'user:x', userId: 'x', severity: 'SEV-3', breachClass: 'UNDETERMINED', evidenceEventIds: [] },
      };
      await repo.append(event);
      await expect(repo.append(event)).rejects.toThrow(/already exists|append-only/i);
    });

    test('a row returned by getEvents/allEvents is frozen — mutating it throws', async () => {
      const { service, repo } = newService();
      const snap = await declareBreach(service);
      const events = await repo.getEvents(snap.id);
      expect(() => {
        (events[0] as unknown as { kind: string }).kind = 'RESOLVED';
      }).toThrow();

      const all = await repo.allEvents();
      expect(() => {
        (all[0] as unknown as { sequence: number }).sequence = 999;
      }).toThrow();
    });
  });

  // ── GDPR fail-safe: un-triaged breach never silently dropped (PROVE item c) ─────────────────
  describe('fail-safe — an un-triaged breach-class incident is flagged, never silently dropped (PROVE item c)', () => {
    test('a freshly-declared breach appears in EVERY listing surface before triage', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);

      const all = await service.listIncidents(ADMIN);
      const watchlist = await service.listBreachWatchlist(ADMIN);
      const untriaged = await service.listUntriagedBreachIncidents(ADMIN);

      expect(all.map((s) => s.id)).toContain(snap.id);
      expect(watchlist.map((s) => s.id)).toContain(snap.id);
      expect(untriaged.map((s) => s.id)).toContain(snap.id);
      expect(all.find((s) => s.id === snap.id)?.needsTriage).toBe(true);
      expect(all.find((s) => s.id === snap.id)?.gdprClock.applicable).toBe(true);
    });

    test('triaging clears needsTriage but the clock keeps it on the watchlist until closed', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'confirmed, working it' });

      const untriaged = await service.listUntriagedBreachIncidents(ADMIN);
      const watchlist = await service.listBreachWatchlist(ADMIN);
      expect(untriaged.map((s) => s.id)).not.toContain(snap.id); // triaged — no longer "un-triaged"
      expect(watchlist.map((s) => s.id)).toContain(snap.id); // still open, clock still applicable
    });

    test('a breach that is contained, notified, and resolved finally drops off the watchlist', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'x' });
      await service.contain(ADMIN, snap.id, { actions: ['revoked_sessions'], notes: 'contained' });
      await service.notify(ADMIN, snap.id, {
        notifiedParties: ['supervisory_authority', 'affected_data_subjects'],
        dataCategories: ['email', 'name'],
        method: 'email+regulator-portal',
        notes: 'notified within window',
      });
      const resolved = await service.resolve(ADMIN, snap.id, {
        rootCause: 'credential stuffing against a stale password',
        remediationItems: ['forced reset', 'breached-password screen tightened'],
        notes: 'closed',
      });

      expect(resolved.lifecycleState).toBe('RESOLVED');
      expect(resolved.gdprClock.status).toBe('CLOSED');
      const watchlist = await service.listBreachWatchlist(ADMIN);
      expect(watchlist.map((s) => s.id)).not.toContain(snap.id);
    });

    test('a manually-declared NOT_PERSONAL_DATA incident never appears on the breach watchlist or untriaged list', async () => {
      const { service } = newService();
      const snap = await declareBreach(service, {
        breachClass: 'NOT_PERSONAL_DATA',
        correlationKey: 'user:not-a-breach',
        userId: 'not-a-breach',
      });
      const watchlist = await service.listBreachWatchlist(ADMIN);
      const untriaged = await service.listUntriagedBreachIncidents(ADMIN);
      expect(watchlist.map((s) => s.id)).not.toContain(snap.id);
      expect(untriaged.map((s) => s.id)).not.toContain(snap.id);
      // ...but it is NEVER dropped from the general listing — visibility is never all-or-nothing.
      const all = await service.listIncidents(ADMIN);
      expect(all.map((s) => s.id)).toContain(snap.id);
    });
  });

  // ── Runbook orchestration + the notify-before-resolve guard, wired through the service ──────
  describe('runbook orchestration', () => {
    test('the full lifecycle produces a correctly-projected final snapshot', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'confirmed', breachClassDecision: 'CONFIRMED_PERSONAL_DATA_BREACH' });
      await service.contain(ADMIN, snap.id, { actions: ['revoked_sessions', 'rotated_secret:STRIPE_WEBHOOK_SECRET'], notes: 'contained' });
      await service.notify(ADMIN, snap.id, {
        notifiedParties: ['supervisory_authority'],
        dataCategories: ['email'],
        method: 'regulator-portal',
        notes: 'notified',
      });
      const final = await service.resolve(ADMIN, snap.id, { rootCause: 'x', remediationItems: ['y'], notes: 'z' });

      expect(final.lifecycleState).toBe('RESOLVED');
      expect(final.breachClass).toBe('CONFIRMED_PERSONAL_DATA_BREACH');
      expect(final.notification?.notifiedParties).toEqual(['supervisory_authority']);
      expect(final.triagedAt).toBeTruthy();
      expect(final.containedAt).toBeTruthy();
      expect(final.notifiedAt).toBeTruthy();
      expect(final.resolvedAt).toBeTruthy();
    });

    test('cannot RESOLVE a breach-class incident straight from CONTAINED — must NOTIFY first', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'x' }); // breachClass stays SUSPECTED (clock-applicable)
      await service.contain(ADMIN, snap.id, { actions: ['revoked_sessions'], notes: 'x' });

      await expect(
        service.resolve(ADMIN, snap.id, { rootCause: 'x', remediationItems: [], notes: 'x' })
      ).rejects.toThrow(/must be NOTIFIED before it can be RESOLVED/);
    });

    test('CAN resolve straight from CONTAINED once triage rules the incident NOT_PERSONAL_DATA', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'reviewed — no personal data was involved', breachClassDecision: 'NOT_PERSONAL_DATA' });
      await service.contain(ADMIN, snap.id, { actions: ['rotated_secret:API_KEY'], notes: 'x' });

      const resolved = await service.resolve(ADMIN, snap.id, { rootCause: 'x', remediationItems: [], notes: 'x' });
      expect(resolved.lifecycleState).toBe('RESOLVED');
      expect(resolved.gdprClock.applicable).toBe(false);
    });

    test('acting on a nonexistent incident throws a clear error', async () => {
      const { service } = newService();
      await expect(service.getIncidentAs(ADMIN, 'does-not-exist')).rejects.toThrow(/no incident found/);
    });

    test('an illegal transition (e.g. triaging an already-resolved incident) is rejected', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'x', breachClassDecision: 'NOT_PERSONAL_DATA' });
      await service.contain(ADMIN, snap.id, { actions: [], notes: 'x' });
      await service.resolve(ADMIN, snap.id, { rootCause: 'x', remediationItems: [], notes: 'x' });

      await expect(service.triage(ADMIN, snap.id, { notes: 'too late' })).rejects.toThrow(/Illegal incident transition/);
    });

    test('findOpenByCorrelationKey supports the security-event-bridge idempotency check', async () => {
      const { service } = newService();
      const snap = await declareBreach(service);
      expect(await service.findOpenByCorrelationKey('user:victim-1')).toBe(snap.id);
      expect(await service.findOpenByCorrelationKey('user:no-such-key')).toBeNull();

      await service.triage(ADMIN, snap.id, { notes: 'x', breachClassDecision: 'NOT_PERSONAL_DATA' });
      await service.contain(ADMIN, snap.id, { actions: [], notes: 'x' });
      await service.resolve(ADMIN, snap.id, { rootCause: 'x', remediationItems: [], notes: 'x' });
      // Once resolved, the key is no longer "open" — a fresh cluster for the same user should be
      // able to open a NEW incident rather than being conflated with the closed one.
      expect(await service.findOpenByCorrelationKey('user:victim-1')).toBeNull();
    });
  });

  // ── Wiring into T-10's durable, hash-chained audit store ────────────────────────────────────
  describe('DurableIncidentAuditSink — mirrors every incident event into T-10 (domain: account_security)', () => {
    test('every lifecycle event is mirrored into the audit store with the right evidentiary shape', async () => {
      const auditRepo = new InMemoryAuditRepository();
      const auditService = new AuditService(auditRepo);
      const { service } = newService([new DurableIncidentAuditSink(auditService)]);

      const snap = await declareBreach(service);
      await service.triage(ADMIN, snap.id, { notes: 'x' });

      const rows = await auditService.query({});
      expect(rows).toHaveLength(2); // DECLARED + TRIAGED
      expect(rows[0]).toMatchObject({
        user_id: 'victim-1',
        outcome: 'RECORDED',
        regulation: 'GDPR',
        rule_version: 'incident-response-§16.7-v1',
      });
      expect(rows[0].classifier_data).toMatchObject({ kind: 'DECLARED', incident_event_id: expect.any(String) });
      expect(rows[1]).toMatchObject({ reviewer_id: 'admin-1', reviewer_action: 'TRIAGED' });

      // The mirrored copy inherits T-10's own tamper-evidence — a live proof this isn't a second,
      // independently-mutable trail.
      const verification = await auditService.verifyStoredChain();
      expect(verification.valid).toBe(true);
    });

    test('a system-declared (no-actor) event is mirrored with a system/ADMIN attribution, never a forged REP', async () => {
      const auditRepo = new InMemoryAuditRepository();
      const auditService = new AuditService(auditRepo);
      const { service } = newService([new DurableIncidentAuditSink(auditService)]);

      await declareBreach(service, { userId: null, correlationKey: 'ip:iphash-x' });
      const rows = await auditService.query({});
      expect(rows[0].user_id).toBe('system');
      expect(rows[0].role).toBe(Role.ADMIN);
    });
  });
});
