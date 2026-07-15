import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  HaikuClassifierClient,
  LocalDeterministicClassifierClient,
  ClaudeClassifierError,
} from '../../src/services/compliance/claude';
import { InMemoryCFEAuditSink } from '../../src/services/compliance/audit/audit-sink';
import { ClassifierVerdict, CFEInput } from '../../src/types/compliance';

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
