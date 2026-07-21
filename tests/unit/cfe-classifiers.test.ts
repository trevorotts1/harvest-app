import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
  HaikuClassifierClient,
  ClaudeClassifierError,
} from '../../src/services/compliance/claude';
import {
  IncomeClaimClassifier,
  TestimonialClassifier,
  OpportunityClassifier,
  InsuranceClassifier,
  ReferralRequestClassifier,
} from '../../src/services/compliance/classifiers';
import { HAIKU_MODEL_ID, ClassifierVerdict, Classifier, CFEInput } from '../../src/types/compliance';

/** A client that returns a caller-supplied confidence per classifier. */
class MapClient implements ClaudeClassifierClient {
  constructor(private readonly map: Partial<Record<Classifier, number>>) {}
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const confidence = this.map[req.classifier] ?? 0;
    return { flagged: confidence >= 0.5, confidence };
  }
}

const ctx = (over: Partial<CFEInput['userContext']> = {}): CFEInput['userContext'] => ({
  user_id: 'u1',
  role: 'REP',
  ...over,
});

describe('CFE — the five §5.3 classifiers run on Haiku 4.5 (§4.4)', () => {
  it('exposes exactly the five §5.3 classifier ids', () => {
    const c = new MapClient({});
    expect(new IncomeClaimClassifier(c).classifier).toBe('INCOME_CLAIM');
    expect(new TestimonialClassifier(c).classifier).toBe('TESTIMONIAL');
    expect(new OpportunityClassifier(c).classifier).toBe('OPPORTUNITY');
    expect(new InsuranceClassifier(c).classifier).toBe('INSURANCE');
    expect(new ReferralRequestClassifier(c).classifier).toBe('REFERRAL');
  });

  it('pins the Haiku 4.5 runtime model id (§4.4)', () => {
    expect(HAIKU_MODEL_ID).toBe('claude-haiku-4-5-20251001');
  });

  it('classifiers delegate to the injected Claude client (mockable, no key)', async () => {
    const client = new MapClient({ INSURANCE: 0.9 });
    const result = await new InsuranceClassifier(client).classify('anything');
    expect(result.classifier).toBe('INSURANCE');
    expect(result.confidence).toBe(0.9);
  });
});

describe('CFE — real Haiku call path (§4.4), driven with a fake transport', () => {
  it('POSTs the Haiku model id + Messages API contract and parses {flagged,confidence}', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    let capturedUrl = '';
    let capturedInit: RequestInit | null = null;

    const fakeFetch = jest.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [
              { type: 'text', text: JSON.stringify({ flagged: true, confidence: 0.87, rationale: 'income claim' }) },
            ],
          }),
      };
    });

    try {
      const client = new HaikuClassifierClient({ fetchImpl: fakeFetch });
      const verdict = await client.classify({
        classifier: 'INCOME_CLAIM',
        systemPrompt: 'sys',
        content: 'earn $10k/mo guaranteed',
      });

      expect(verdict.flagged).toBe(true);
      expect(verdict.confidence).toBeCloseTo(0.87);

      expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(capturedInit!.body as string);
      expect(body.model).toBe('claude-haiku-4-5-20251001'); // Claude-only, Haiku 4.5
      expect(body.output_config.format.type).toBe('json_schema');
      const headers = capturedInit!.headers as Record<string, string>;
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['x-api-key']).toBeDefined();
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  it('throws (→ engine holds closed) on a non-200 Haiku response — never returns clear', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    const fakeFetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'err' }));
    try {
      const client = new HaikuClassifierClient({ fetchImpl: fakeFetch });
      await expect(
        client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
      ).rejects.toBeInstanceOf(ClaudeClassifierError);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  // Regression (T-R2 lint-refactor QC reject): a degenerate JSON response body — the literal
  // `"null"` (or a text block whose JSON parses to `null`) — must still throw the domain error
  // (ClaudeClassifierError('Haiku verdict missing required fields.')) that the pre-refactor
  // `payload?.flagged`/`payload?.confidence` optional chaining produced. A lint pass that dropped
  // the `?.` in favor of bare `payload.flagged` would instead throw a raw
  // `TypeError: Cannot read properties of null` here — this must never regress.
  it('a degenerate ("null") Haiku JSON body throws ClaudeClassifierError, never a raw TypeError', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    const fakeFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: 'null' }],
        }),
    }));
    try {
      const client = new HaikuClassifierClient({ fetchImpl: fakeFetch });
      await expect(
        client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
      ).rejects.toThrow(ClaudeClassifierError);
      await expect(
        client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
      ).rejects.toThrow('Haiku verdict missing required fields.');
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  // Same regression, but the OUTER Messages API envelope itself is the degenerate `"null"` body
  // (no `content` array at all) — a second, independent path into the same bug.
  it('an outer "null" Messages API body throws ClaudeClassifierError, never a raw TypeError', async () => {
    const prevKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    const fakeFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'null',
    }));
    try {
      const client = new HaikuClassifierClient({ fetchImpl: fakeFetch });
      await expect(
        client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
      ).rejects.toThrow(ClaudeClassifierError);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });
});

describe('CFE — risk scoring & banding (§5.4) + §5.3 rules', () => {
  const engine = (map: Partial<Record<Classifier, number>>) =>
    new ComplianceFilterEngine({ classifierClient: new MapClient(map) });

  it('all-zero confidences → clear + released', async () => {
    const v = await engine({}).evaluateContent({ content: 'x', channel: 'SMS', userContext: ctx() });
    expect(v.score).toBe(0);
    expect(v.band).toBe('clear');
    expect(v.released).toBe(true);
  });

  it('income 0.5 alone → review + FTC disclaimer (§5.3-1)', async () => {
    const v = await engine({ INCOME_CLAIM: 0.5 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(v.band).toBe('review');
    expect(v.safeHarbor.injected).toBe(true);
    expect(v.released).toBe(false);
  });

  it('income 0.9 → blocked (§5.3-1 auto-block ≥0.8)', async () => {
    const v = await engine({ INCOME_CLAIM: 0.9 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(v.band).toBe('blocked');
  });

  it('insurance 0.6 unlicensed → blocked; licensed → review (AC §5.8-7, §5.3-4)', async () => {
    const unlicensed = await engine({ INSURANCE: 0.6 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx(),
    });
    expect(unlicensed.band).toBe('blocked');

    const licensed = await engine({ INSURANCE: 0.6 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx({ insurance_licensed: true }),
    });
    expect(licensed.band).toBe('review');
  });

  it('regulation multiplier raises the score deterministically (§5.4)', async () => {
    const base = await engine({ INCOME_CLAIM: 0.4 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx(),
    });
    const finra = await engine({ INCOME_CLAIM: 0.4 }).evaluateContent({
      content: 'x',
      channel: 'SMS',
      userContext: ctx({ regulations: ['FINRA'] }),
    });
    // base: 0.4*100*0.30 = 12 ; finra: 12 * 1.4 = 16.8 → 17
    expect(base.score).toBe(12);
    expect(finra.score).toBe(17);
  });
});
