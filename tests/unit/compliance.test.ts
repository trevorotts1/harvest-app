import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { LocalDeterministicClassifierClient } from '../../src/services/compliance/claude';
import { InMemoryCFEAuditSink } from '../../src/services/compliance/audit/audit-sink';
import { CFEInput } from '../../src/types/compliance';

/**
 * CFE core behavior (master-spec §5.3/§5.4). Uses the deterministic local
 * classifier client so banding is exercised without a live key. Fail-closed is
 * proven separately in cfe-fail-closed.test.ts.
 */
describe('ComplianceFilterEngine — banding & release (§5.3/§5.4)', () => {
  let audit: InMemoryCFEAuditSink;
  let engine: ComplianceFilterEngine;

  const ctx = (over: Partial<CFEInput['userContext']> = {}): CFEInput['userContext'] => ({
    user_id: 'u1',
    role: 'REP',
    ...over,
  });

  beforeEach(() => {
    audit = new InMemoryCFEAuditSink();
    engine = new ComplianceFilterEngine({
      classifierClient: new LocalDeterministicClassifierClient(),
      auditSink: audit,
    });
  });

  it('blocks an explicit income guarantee (§5.3-1, ≥0.8 auto-block)', async () => {
    const v = await engine.evaluateContent({
      content: 'Make guaranteed income today! Earn so much money!',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.safeHarbor.injected).toBe(true); // FTC safe-harbor injected
  });

  it('flags a business-opportunity statement for review (§5.3-3)', async () => {
    const v = await engine.evaluateContent({
      content: 'I have a business opportunity for you.',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(v.band).toBe('review');
    expect(v.released).toBe(false);
  });

  it('releases genuinely clean content — the ONLY release path (§5.4 clear)', async () => {
    const v = await engine.evaluateContent({
      content: 'Hey, want to grab coffee this week?',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(v.band).toBe('clear');
    expect(v.held).toBe(false);
    expect(v.released).toBe(true);
  });

  it('detects an insurance recommendation (§5.3-4) and blocks an unlicensed rep (AC §5.8-7)', async () => {
    const v = await engine.evaluateContent({
      content: 'You need whole life insurance. Get $500K coverage; this policy is cheaper.',
      channel: 'SMS',
      userContext: ctx(), // no insurance_licensed → unlicensed by default (fail-closed)
    });
    const insurance = v.classifierResults.find((r) => r.classifier === 'INSURANCE');
    expect(insurance!.confidence).toBeGreaterThan(0);
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
  });

  it('blocks forbidden doctrine vocabulary (§0.5 / §5.3 vocabulary classifier)', async () => {
    const v = await engine.evaluateContent({
      content: 'Add this prospect to my funnel and pitch them.',
      channel: 'EMAIL',
      userContext: ctx(),
    });
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toMatch(/forbidden_vocabulary/);
  });

  it('emits exactly one audit event per decision (§5.6, AC §5.8-4)', async () => {
    await engine.evaluateContent({ content: 'Hello there', channel: 'SMS', userContext: ctx() });
    expect(audit.events).toHaveLength(1);
    const e = audit.last()!;
    expect(e.rule_version).toBeDefined();
    expect(e.content_hash).toBeDefined();
    expect(e.timestamp).toBeDefined();
  });

  it('legacy review() facade maps band → PASS/FLAG/BLOCK + blocked flag', async () => {
    const pass = await engine.review({ content: 'Hey, coffee soon?', channel: 'SMS', userContext: ctx() });
    expect(pass.outcome).toBe('PASS');
    expect(pass.blocked).toBe(false);

    const block = await engine.review({
      content: 'Guaranteed income, join my team!',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(block.outcome).toBe('BLOCK');
    expect(block.blocked).toBe(true);
  });

  it('escalates the band under a regulation multiplier (§5.4)', async () => {
    const base = await engine.evaluateContent({
      content: 'Some extra income potential here.',
      channel: 'SMS',
      userContext: ctx(),
    });
    const finra = await engine.evaluateContent({
      content: 'Some extra income potential here.',
      channel: 'SMS',
      userContext: ctx({ regulations: ['FINRA'] }),
    });
    expect(finra.score).toBeGreaterThanOrEqual(base.score);
  });
});
