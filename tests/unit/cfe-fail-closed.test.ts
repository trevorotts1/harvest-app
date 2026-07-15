import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  HaikuClassifierClient,
  LocalDeterministicClassifierClient,
  ClaudeClassifierError,
} from '../../src/services/compliance/claude';
import { InMemoryCFEAuditSink } from '../../src/services/compliance/audit/audit-sink';
import { ClassifierVerdict, CFEInput, Classifier } from '../../src/types/compliance';

/**
 * FAIL-CLOSED PROOF (master-spec §5.2, §2.3; AC §5.8-3/§5.8-5).
 *
 * The single most important CFE behavior: when the engine cannot obtain a
 * confident CLEAR result, it must HOLD the item (held===true, released===false,
 * blocked===true → zero outbound). No classifier failure, timeout, or missing
 * key may ever yield an approved/released verdict.
 *
 * FAIL-OPEN COUNTERFACTUAL: every assertion below (`held===true`,
 * `released===false`, `band !== 'clear'`, legacy `blocked===true`) is exactly
 * what a fail-OPEN engine would violate. If the catch-block default in
 * evaluateContent() were flipped to return a clear/released verdict on error,
 * tests a–c and the availability test would FAIL. That is the point of the
 * suite.
 */

const ctx: CFEInput['userContext'] = { user_id: 'u1', role: 'REP' };
const input = (content: string): CFEInput => ({ content, channel: 'SMS', userContext: ctx });

/** A classifier client that always throws (simulates a downstream classifier error). */
class ThrowingClient implements ClaudeClassifierClient {
  async classify(_req: ClassifierRequest): Promise<ClassifierVerdict> {
    throw new ClaudeClassifierError('simulated classifier failure');
  }
}

/** A classifier client that never resolves (simulates a hang / timeout). */
class HangingClient implements ClaudeClassifierClient {
  classify(_req: ClassifierRequest): Promise<ClassifierVerdict> {
    return new Promise<ClassifierVerdict>(() => {
      /* never settles */
    });
  }
}

describe('CFE fail-closed (§5.2)', () => {
  // (a) classifier throws → held===true, not approved, zero-send.
  it('a. classifier throws → held (not released, blocked, zero-send)', async () => {
    const audit = new InMemoryCFEAuditSink();
    const engine = new ComplianceFilterEngine({
      classifierClient: new ThrowingClient(),
      auditSink: audit,
    });

    const v = await engine.evaluateContent(input('Hello, want to connect?'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false); // would be true under fail-open
    expect(v.band).not.toBe('clear'); // would be 'clear' under fail-open
    expect(v.heldReason).toBe('classifier_error');

    // Zero-send at the legacy facade too: messaging marks CFE_BLOCKED, never QUEUED.
    const r = await engine.review(input('Hello, want to connect?'));
    expect(r.blocked).toBe(true);
    expect(r.held).toBe(true);

    // AC §5.8-4: even a held decision emits an audit event.
    expect(audit.events.length).toBeGreaterThanOrEqual(1);
    expect(audit.last()!.held).toBe(true);
  });

  // (b) classifier times out → held.
  it('b. classifier times out → held', async () => {
    const engine = new ComplianceFilterEngine({
      classifierClient: new HangingClient(),
      timeoutMs: 25, // small so the test is fast; a slow classifier holds (§5.2)
    });

    const v = await engine.evaluateContent(input('Any news for me?'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.heldReason).toBe('classifier_timeout');
  });

  // (c) missing/unset API key → held (NOT open), and NEVER a non-Claude fallback.
  it('c. missing ANTHROPIC_API_KEY → held, and no network/fallback attempted', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    // fetch spy that fails the test if the client ever tries to reach the network.
    const fetchSpy = jest.fn(async () => {
      throw new Error('network must NOT be called when the key is missing');
    });

    try {
      const engine = new ComplianceFilterEngine({
        classifierClient: new HaikuClassifierClient({ fetchImpl: fetchSpy as any }),
      });

      const v = await engine.evaluateContent(input('Just checking in!'));
      expect(v.held).toBe(true);
      expect(v.released).toBe(false);
      expect(v.heldReason).toBe('missing_credentials');
      // Claude-only (§0.3): missing key fails closed, never falls back off-provider.
      expect(fetchSpy).not.toHaveBeenCalled();

      // The DEFAULT engine (real Haiku client) also fails closed with no key.
      const defaultEngine = new ComplianceFilterEngine();
      const dv = await defaultEngine.evaluateContent(input('Just checking in!'));
      expect(dv.held).toBe(true);
      expect(dv.released).toBe(false);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  // (d) clearly-prohibited input (income claim / forbidden vocab) → blocked band.
  it('d. prohibited input (income claim / forbidden vocab) → blocked', async () => {
    const engine = new ComplianceFilterEngine({
      classifierClient: new LocalDeterministicClassifierClient(),
    });

    const income = await engine.evaluateContent(
      input('You are guaranteed income of $10,000 per month!')
    );
    expect(income.band).toBe('blocked');
    expect(income.released).toBe(false);

    const vocab = await engine.evaluateContent(input('Send this pitch to every prospect.'));
    expect(vocab.band).toBe('blocked');
    expect(vocab.released).toBe(false);
  });

  // (e) clean input, classifier clear → released (the ONLY release path).
  it('e. clean input, classifiers clear → released', async () => {
    const engine = new ComplianceFilterEngine({
      classifierClient: new LocalDeterministicClassifierClient(),
    });

    const v = await engine.evaluateContent(input('Great seeing you Saturday — lunch soon?'));
    expect(v.band).toBe('clear');
    expect(v.held).toBe(false);
    expect(v.released).toBe(true); // the sole path that authorizes a send
  });

  // §5.2 / AC §5.8-5: force the CFE offline → held (agent output pauses, 0 sends).
  it('CFE forced offline → held for review', async () => {
    const engine = new ComplianceFilterEngine({
      classifierClient: new LocalDeterministicClassifierClient(),
    });
    engine.setAvailability(false);

    const v = await engine.evaluateContent(input('Totally clean message.'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.heldReason).toBe('cfe_unavailable');
  });
});

/**
 * LICENSING-PHASE / UNLICENSED INSURANCE HARD-BLOCK (master-spec §5.5, §2.1/§2.4
 * "unlicensed = zero insurance product discussion"; AC §5.8-7; qc-checklist WP11
 * named critical failure: "an unlicensed rep producing insurance-recommendation
 * content").
 *
 * Insurance-recommendation content for an unlicensed / licensing-phase rep must
 * be blocked REGARDLESS of score/confidence — NOT only at confidence ≥0.5.
 *
 * PRE-FIX COUNTERFACTUAL: test (a) below — INSURANCE confidence 0.3 +
 * licensing_phase:true + unlicensed — returned band 'clear', released:true under
 * the pre-fix code (the only insurance escalation was gated behind the ≥0.5
 * `conditionalBlock` threshold, so a 0.3 signal fell through to a clean release).
 * That is exactly the CRITICAL defect this suite now proves is closed: it asserts
 * band 'blocked' / released:false, which the pre-fix engine would FAIL.
 */
describe('CFE licensing-phase / unlicensed insurance hard-block (§5.5, AC §5.8-7)', () => {
  /** Returns a caller-supplied confidence per classifier (0 for the rest). */
  class MapClient implements ClaudeClassifierClient {
    constructor(private readonly map: Partial<Record<Classifier, number>>) {}
    async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
      const confidence = this.map[req.classifier] ?? 0;
      return { flagged: confidence >= 0.5, confidence };
    }
  }

  const engineFor = (map: Partial<Record<Classifier, number>>) =>
    new ComplianceFilterEngine({ classifierClient: new MapClient(map) });

  const evalWith = (
    map: Partial<Record<Classifier, number>>,
    userContext: CFEInput['userContext'],
    content = 'You need whole life insurance for your family.'
  ) => engineFor(map).evaluateContent({ content, channel: 'SMS', userContext });

  // (a) THE REPRODUCED CRITICAL CASE: INSURANCE 0.3 + licensing_phase + unlicensed.
  //     Pre-fix: band 'clear', released:true. Post-fix: MUST be blocked, not released.
  it('a. INSURANCE 0.3 + licensing_phase:true + unlicensed → blocked (regardless of score)', async () => {
    const v = await evalWith(
      { INSURANCE: 0.3 },
      { user_id: 'u1', role: 'REP', licensing_phase: true } // insurance_licensed unset → unlicensed
    );
    expect(v.band).toBe('blocked'); // pre-fix: 'clear'
    expect(v.released).toBe(false); // pre-fix: true
    expect(v.reason).toContain('insurance_block_unlicensed_or_licensing_phase');
  });

  // (b) Low-confidence insurance signal + unlicensed (NOT in licensing phase) → blocked.
  it('b. INSURANCE 0.3 (low) + unlicensed (insurance_licensed !== true) → blocked', async () => {
    const v = await evalWith(
      { INSURANCE: 0.3 },
      { user_id: 'u2', role: 'REP' } // no insurance_licensed, no licensing_phase → unlicensed default
    );
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
  });

  // (c) Insurance signal + LICENSED rep → NOT force-blocked by this rule (proves no over-block).
  it('c. INSURANCE signal + LICENSED (insurance_licensed:true, licensing_phase:false) → not force-blocked', async () => {
    // 0.6 licensed → normal banding: review (contrast with 0.6 unlicensed → blocked).
    const review = await evalWith(
      { INSURANCE: 0.6 },
      { user_id: 'u3', role: 'REP', insurance_licensed: true, licensing_phase: false }
    );
    expect(review.band).toBe('review');
    expect(review.band).not.toBe('blocked');

    // 0.3 licensed → clean release (a low signal from a licensed rep is not blocked).
    const clear = await evalWith(
      { INSURANCE: 0.3 },
      { user_id: 'u3', role: 'REP', insurance_licensed: true, licensing_phase: false }
    );
    expect(clear.band).toBe('clear');
    expect(clear.released).toBe(true);
  });

  // (d) Clean, non-insurance content + unlicensed/licensing_phase → still releases (no over-block).
  it('d. clean non-insurance message + unlicensed/licensing_phase → released', async () => {
    const v = await evalWith(
      {}, // all classifiers report 0 → zero insurance signal
      { user_id: 'u4', role: 'REP', licensing_phase: true },
      'Thanks so much for meeting me on Saturday — great to reconnect!'
    );
    expect(v.band).toBe('clear');
    expect(v.released).toBe(true);
  });
});

/**
 * CONFIDENCE-RANGE VALIDATION (§5.2 fail-closed hardening). A Haiku verdict whose
 * confidence is outside the [0,1] contract (NaN/±Infinity/negative/>1) is
 * out-of-contract: parse() must THROW (→ engine holds CLOSED), never silently
 * clamp the fabricated value to 0/1 and act on it.
 */
describe('Haiku confidence-range validation (§5.2 hardening)', () => {
  const withKey = async (fn: () => Promise<void>) => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  };

  const fetchReturning = (confidence: unknown) =>
    jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify({ flagged: true, confidence }) }],
        }),
    }));

  it.each([
    ['>1', 5],
    ['negative', -0.5],
    ['Infinity', 1e999], // JSON.parse('1e999') === Infinity
  ])('parse() throws ClaudeClassifierError on out-of-range confidence (%s)', async (_label, conf) => {
    await withKey(async () => {
      const client = new HaikuClassifierClient({ fetchImpl: fetchReturning(conf) as any });
      await expect(
        client.classify({ classifier: 'INSURANCE', systemPrompt: 's', content: 'x' })
      ).rejects.toBeInstanceOf(ClaudeClassifierError);
    });
  });

  it('an out-of-range confidence from Haiku → engine HOLDS closed (fail-closed, not released)', async () => {
    await withKey(async () => {
      const engine = new ComplianceFilterEngine({
        classifierClient: new HaikuClassifierClient({ fetchImpl: fetchReturning(9) as any }),
      });
      const v = await engine.evaluateContent({
        content: 'x',
        channel: 'SMS',
        userContext: { user_id: 'u1', role: 'REP' },
      });
      expect(v.held).toBe(true);
      expect(v.released).toBe(false);
      expect(v.heldReason).toBe('classifier_error');
    });
  });
});
