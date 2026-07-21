// T-09 (master-spec §5.5 AC-5 48-hour SLA escalation). Proof tests for `runSlaEscalationSweep` — the
// package-free, directly-unit-testable handler behind the hourly Inngest cron. Never imports the
// `inngest` package (only the handler + an in-memory store + the real in-memory AuditService), per
// the same convention as tests/unit/scheduled-dispatch.test.ts. Each block names its mutation.

import {
  AuditService,
  InMemoryAuditRepository,
} from '@/services/compliance/audit/audit-service';
import {
  runSlaEscalationSweep,
  type SlaEscalationStore,
  type OverdueQueueRow,
  type DraftAuditContext,
  type ComplianceEscalationAlert,
} from '@/services/compliance/adjudication';

// ── In-memory SLA store (records the escalate/hold calls so the fail-closed direction is provable) ─
class FakeSlaStore implements SlaEscalationStore {
  escalatedCalls: { queueId: string; draftId: string | null; contactId: string }[] = [];
  heldCalls: { queueId: string; draftId: string | null }[] = [];
  constructor(
    private overdue: OverdueQueueRow[],
    private contactByRep: Record<string, string | null>,
    private draftById: Record<string, DraftAuditContext>,
    private throwOnList = false
  ) {}
  async listOverdueRows(): Promise<OverdueQueueRow[]> {
    if (this.throwOnList) throw new Error('DB unreachable');
    return this.overdue;
  }
  async resolveComplianceContactId(repId: string): Promise<string | null> {
    return this.contactByRep[repId] ?? null;
  }
  async getDraftForAudit(draftId: string): Promise<DraftAuditContext | null> {
    return this.draftById[draftId] ?? null;
  }
  async markEscalated(queueId: string, draftId: string | null, contactId: string): Promise<void> {
    this.escalatedCalls.push({ queueId, draftId, contactId });
  }
  async markHeldNoContact(queueId: string, draftId: string | null): Promise<void> {
    this.heldCalls.push({ queueId, draftId });
  }
}

function draft(id: string, userId: string): DraftAuditContext {
  return { id, user_id: userId, body: 'Aged flagged draft.', channel: 'SMS_HANDOFF', cfe_risk_score: 40 };
}
function newAudit() {
  return new AuditService(new InMemoryAuditRepository());
}

describe('T-09 48h SLA escalation (AC-5)', () => {
  it('escalates an overdue item to the org compliance contact: HOLD + NOTIFY, audited', async () => {
    const store = new FakeSlaStore(
      [{ queueId: 'q1', draftId: 'd1', repId: 'rep-1', riskScore: 42 }],
      { 'rep-1': 'compliance-officer-1' },
      { d1: draft('d1', 'rep-1') }
    );
    const audit = newAudit();
    const alerts: ComplianceEscalationAlert[] = [];
    const res = await runSlaEscalationSweep({ store, audit, alertComplianceContact: (a) => { alerts.push(a); } });

    expect(res).toMatchObject({ ok: true, considered: 1, escalated: 1, held: 0 });
    expect(store.escalatedCalls).toEqual([{ queueId: 'q1', draftId: 'd1', contactId: 'compliance-officer-1' }]);
    expect(store.heldCalls).toEqual([]); // NOT the un-escalatable path
    // Notified the compliance contact (§5.5 "notify").
    expect(alerts[0]).toMatchObject({ queueId: 'q1', complianceContactId: 'compliance-officer-1' });
    // Immutable audit record of the escalation.
    const rows = await audit.query({});
    expect(rows.some((r) => r.reviewer_action === 'SLA_ESCALATED_TO_COMPLIANCE_CONTACT')).toBe(true);
  });

  it('FAIL-CLOSED: an un-escalatable item (no org compliance contact) STAYS HELD, never auto-cleared', async () => {
    const store = new FakeSlaStore(
      [{ queueId: 'q2', draftId: 'd2', repId: 'rep-2', riskScore: 55 }],
      { 'rep-2': null }, // no compliance contact configured for this rep's org
      { d2: draft('d2', 'rep-2') }
    );
    const audit = newAudit();
    const alerts: ComplianceEscalationAlert[] = [];
    const res = await runSlaEscalationSweep({ store, audit, alertComplianceContact: (a) => { alerts.push(a); } });

    expect(res).toMatchObject({ ok: true, considered: 1, escalated: 0, held: 1 });
    expect(store.heldCalls).toEqual([{ queueId: 'q2', draftId: 'd2' }]); // held, never escalated
    expect(store.escalatedCalls).toEqual([]);
    expect(alerts).toEqual([]); // nobody to notify — but the item is NOT cleared
    const rows = await audit.query({});
    expect(rows.some((r) => r.reviewer_action === 'SLA_HELD_NO_COMPLIANCE_CONTACT')).toBe(true);
    // The critical invariant: NO audit record ever records an auto-approval/clear on this path.
    expect(rows.some((r) => String(r.reviewer_action).includes('APPROVE'))).toBe(false);
  });

  it('mixed batch: escalates those with a contact, holds those without', async () => {
    const store = new FakeSlaStore(
      [
        { queueId: 'q1', draftId: 'd1', repId: 'rep-1', riskScore: 42 },
        { queueId: 'q2', draftId: 'd2', repId: 'rep-2', riskScore: 55 },
      ],
      { 'rep-1': 'officer-1', 'rep-2': null },
      { d1: draft('d1', 'rep-1'), d2: draft('d2', 'rep-2') }
    );
    const res = await runSlaEscalationSweep({ store, audit: newAudit() });
    expect(res).toMatchObject({ ok: true, considered: 2, escalated: 1, held: 1 });
    expect(store.escalatedCalls.map((c) => c.queueId)).toEqual(['q1']);
    expect(store.heldCalls.map((c) => c.queueId)).toEqual(['q2']);
  });

  it('FAIL-SAFE: an unreachable store is a graceful no-op (the next hourly tick retries), never a throw', async () => {
    const store = new FakeSlaStore([], {}, {}, /* throwOnList */ true);
    const res = await runSlaEscalationSweep({ store, audit: newAudit() });
    expect(res).toMatchObject({ ok: false, skippedReason: 'infra_unavailable', escalated: 0, held: 0 });
  });
});
