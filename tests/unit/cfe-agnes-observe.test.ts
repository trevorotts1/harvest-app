// T-R51 (OBSERVE variant) — proof tests for:
//   (1) Agnes (`agnes-2.0-flash`, Sapiens AI) wired as the CFE's default classifier client for the
//       five §5.3 SEMANTIC classifiers, with the exact same PASS/FLAG/BLOCK banding engine.ts has
//       always defined (banding logic is completely unchanged — only the client producing the
//       per-classifier confidence score changed).
//   (2) The §0.5 doctrine-vocabulary OBSERVE mode: the hard-block is IDENTICAL in 'block' and
//       'observe' modes (parity) — the mode only controls whether the catch is ALSO recorded on the
//       audit event + surfaced via `CfeAdjudicationService.listVocabularyObservability`.
//   (3) FAIL-CLOSED is preserved end-to-end under the new default (Agnes error / missing key /
//       CFE-unavailable / a generic unexpected throw all → HELD, zero-send — never fail-open).
//   (4) Deny-by-default: `released` is true ONLY for `band==='clear' && !held`, under the new
//       Agnes-defaulted engine — the single release path from `cfe-fail-closed.test.ts` still holds.
//
// Does NOT touch or weaken any pre-existing CFE test — this is a wholly additive suite.

import { Role } from '@prisma/client';

import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import {
  ClaudeClassifierClient,
  ClassifierRequest,
} from '../../src/services/compliance/claude';
import {
  AgnesClassifierClient,
  MissingAgnesCredentialError,
  AgnesClassifierError,
} from '../../src/services/compliance/agnes';
import { InMemoryCFEAuditSink } from '../../src/services/compliance/audit/audit-sink';
import { mapCfeEventToAuditInput } from '../../src/services/compliance/audit/sinks';
import { AuditService, InMemoryAuditRepository } from '../../src/services/compliance/audit/audit-service';
import { CfeAdjudicationService, type CfeAdjudicationPrismaClient } from '../../src/services/compliance/adjudication';
import { ClassifierVerdict, CFEInput, Classifier, AGNES_MODEL_ID, AGNES_ENDPOINT, AGNES_API_KEY_ENV_VAR } from '../../src/types/compliance';

const ctx: CFEInput['userContext'] = { user_id: 'rep-1', role: 'REP' };
const input = (content: string, over: Partial<CFEInput['userContext']> = {}): CFEInput => ({
  content,
  channel: 'SMS',
  userContext: { ...ctx, ...over },
});

/** Stands in for a live Agnes response: implements the SAME `ClaudeClassifierClient` interface
 *  `AgnesClassifierClient` implements, returning a caller-supplied confidence per classifier — the
 *  engine's banding logic is provider-agnostic by construction, so this double exercises exactly
 *  the same code path a real Agnes response would. */
class AgnesDouble implements ClaudeClassifierClient {
  constructor(private readonly map: Partial<Record<Classifier, number>>) {}
  async classify(req: ClassifierRequest): Promise<ClassifierVerdict> {
    const confidence = this.map[req.classifier] ?? 0;
    return { flagged: confidence >= 0.5, confidence, rationale: 'agnes-double' };
  }
}
class ThrowingAgnesDouble implements ClaudeClassifierClient {
  async classify(): Promise<ClassifierVerdict> {
    throw new AgnesClassifierError('simulated Agnes failure');
  }
}

const prevAgnesKey = process.env.AGNES_AI_API_KEY;
const prevVocabMode = process.env.CFE_VOCABULARY_MODE;
afterEach(() => {
  if (prevAgnesKey === undefined) delete process.env.AGNES_AI_API_KEY;
  else process.env.AGNES_AI_API_KEY = prevAgnesKey;
  if (prevVocabMode === undefined) delete process.env.CFE_VOCABULARY_MODE;
  else process.env.CFE_VOCABULARY_MODE = prevVocabMode;
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (a) The five §5.3 semantic classifiers still BLOCK via an Agnes-double — banding unchanged.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — semantic classifiers enforced via Agnes (banding unchanged)', () => {
  const engineWith = (map: Partial<Record<Classifier, number>>) =>
    new ComplianceFilterEngine({ classifierClient: new AgnesDouble(map) });

  it('INCOME_CLAIM 0.9 (Agnes-double) → blocked (§5.3-1 auto-block ≥0.8)', async () => {
    const v = await engineWith({ INCOME_CLAIM: 0.9 }).evaluateContent(input('Guaranteed $10k/mo!'));
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
  });

  it('INSURANCE 0.6 unlicensed (Agnes-double) → blocked (§5.5 hard-block)', async () => {
    const v = await engineWith({ INSURANCE: 0.6 }).evaluateContent(input('You need whole life.'));
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
  });

  it('TESTIMONIAL 0.9 no release on file (Agnes-double) → blocked (§5.3-2)', async () => {
    const v = await engineWith({ TESTIMONIAL: 0.9 }).evaluateContent(input('I made $10K my first month!'));
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
  });

  it('all-clean (Agnes-double all-zero) → released (proves no over-block from the swap)', async () => {
    const v = await engineWith({}).evaluateContent(input('Great seeing you Saturday — lunch soon?'));
    expect(v.band).toBe('clear');
    expect(v.released).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Real Agnes wire-shape proof — endpoint/model/headers/parse, driven with a fake transport.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — AgnesClassifierClient real call path, fake transport', () => {
  it('POSTs the Agnes endpoint + model + Bearer auth, parses {flagged,confidence,rationale}', async () => {
    process.env.AGNES_AI_API_KEY = 'test-only-not-a-real-key';
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
            choices: [{ message: { content: JSON.stringify({ flagged: true, confidence: 0.87, rationale: 'income claim' }) } }],
          }),
      };
    });

    const client = new AgnesClassifierClient({ fetchImpl: fakeFetch });
    const verdict = await client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 'sys', content: 'earn $10k/mo guaranteed' });

    expect(verdict.flagged).toBe(true);
    expect(verdict.confidence).toBeCloseTo(0.87);
    expect(capturedUrl).toBe(AGNES_ENDPOINT);
    expect(AGNES_ENDPOINT).toBe('https://apihub.agnes-ai.com/v1/chat/completions');
    expect(AGNES_MODEL_ID).toBe('agnes-2.0-flash');
    expect(AGNES_API_KEY_ENV_VAR).toBe('AGNES_AI_API_KEY'); // key read by NAME only (§0.4)
    const body = JSON.parse(capturedInit!.body as string);
    expect(body.model).toBe('agnes-2.0-flash'); // defensive: only the intended Agnes model is sent
    expect(body.temperature).toBe(0);
    expect(body.response_format.type).toBe('json_object');
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-only-not-a-real-key');
  });

  it('a non-OK Agnes response throws AgnesClassifierError (→ engine holds closed, never clear)', async () => {
    process.env.AGNES_AI_API_KEY = 'test-only-not-a-real-key';
    const fakeFetch = jest.fn(async () => ({ ok: false, status: 503, text: async () => 'err' }));
    const client = new AgnesClassifierClient({ fetchImpl: fakeFetch });
    await expect(
      client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
    ).rejects.toBeInstanceOf(AgnesClassifierError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (d) FAIL-CLOSED preserved end-to-end under the new Agnes default.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — FAIL-CLOSED preserved (Agnes error / missing key / unavailable → HELD, zero-send)', () => {
  it('Agnes double throws → held (not released, blocked, zero-send)', async () => {
    const audit = new InMemoryCFEAuditSink();
    const engine = new ComplianceFilterEngine({ classifierClient: new ThrowingAgnesDouble(), auditSink: audit });
    const v = await engine.evaluateContent(input('Hello, want to connect?'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.band).not.toBe('clear');
    expect(v.heldReason).toBe('classifier_error');

    const r = await engine.review(input('Hello, want to connect?'));
    expect(r.blocked).toBe(true);
    expect(r.held).toBe(true);
    expect(audit.last()!.held).toBe(true); // AC §5.8-4: even a held decision emits an audit event
  });

  it("missing AGNES_AI_API_KEY → held, and the DEFAULT engine (no classifierClient override) fails closed too — proves Agnes IS the default", async () => {
    delete process.env.AGNES_AI_API_KEY;
    const fetchSpy = jest.fn(async () => {
      throw new Error('network must NOT be called when the key is missing');
    });

    const explicit = new ComplianceFilterEngine({ classifierClient: new AgnesClassifierClient({ fetchImpl: fetchSpy }) });
    const v = await explicit.evaluateContent(input('Just checking in!'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.heldReason).toBe('missing_credentials');
    expect(fetchSpy).not.toHaveBeenCalled(); // fail-closed: no network attempt, no fallback provider

    // The DEFAULT engine — no `classifierClient` passed at all — must ALSO fail closed with no
    // AGNES_AI_API_KEY. If the default were still Haiku, this would depend on ANTHROPIC_API_KEY
    // instead; either way it holds, but this proves Agnes is genuinely the new default seam.
    const defaultEngine = new ComplianceFilterEngine();
    const dv = await defaultEngine.evaluateContent(input('Just checking in!'));
    expect(dv.held).toBe(true);
    expect(dv.released).toBe(false);
    expect(dv.heldReason).toBe('missing_credentials');
  });

  it('MissingAgnesCredentialError instance is thrown synchronously with no fetch attempted', async () => {
    delete process.env.AGNES_AI_API_KEY;
    const client = new AgnesClassifierClient();
    await expect(
      client.classify({ classifier: 'INCOME_CLAIM', systemPrompt: 's', content: 'x' })
    ).rejects.toBeInstanceOf(MissingAgnesCredentialError);
  });

  it('CFE forced offline → held for review (unchanged §5.2/AC §5.8-5 behavior under the new default)', async () => {
    const engine = new ComplianceFilterEngine({ classifierClient: new AgnesDouble({}) });
    engine.setAvailability(false);
    const v = await engine.evaluateContent(input('Totally clean message.'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.heldReason).toBe('cfe_unavailable');
  });

  // (e) Deny-by-default: an entirely generic, undomained error (not one of the recognized classes)
  // must STILL resolve to held/blocked — never fail-open just because the error type is unrecognized.
  it('a generic unexpected throw (not MissingAgnesCredentialError/AgnesClassifierError/timeout) → held (deny-by-default)', async () => {
    class WeirdThrowingClient implements ClaudeClassifierClient {
      async classify(): Promise<ClassifierVerdict> {
        throw new TypeError('completely unrelated failure');
      }
    }
    const engine = new ComplianceFilterEngine({ classifierClient: new WeirdThrowingClient() });
    const v = await engine.evaluateContent(input('Anything.'));
    expect(v.held).toBe(true);
    expect(v.released).toBe(false);
    expect(v.heldReason).toBe('engine_exception');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (e) Deny-by-default release-path invariant, re-proven under the Agnes-defaulted engine.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — deny-by-default: released is true ONLY for band==="clear" && !held', () => {
  it.each([
    ['review band', { INCOME_CLAIM: 0.5 }, false],
    ['blocked band', { INCOME_CLAIM: 0.9 }, false],
    ['clear band', {}, true],
  ] as const)('%s → released=%s', async (_label, map, expectedReleased) => {
    const engine = new ComplianceFilterEngine({ classifierClient: new AgnesDouble(map) });
    const v = await engine.evaluateContent(input('Neutral message body.'));
    expect(v.released).toBe(expectedReleased);
    if (expectedReleased) {
      expect(v.band).toBe('clear');
      expect(v.held).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// (b)/(c) §0.5 vocabulary OBSERVE mode: block decision unchanged in BOTH modes; observability is
// additive-only and gated to 'observe'.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — vocabulary OBSERVE mode (block decision unchanged; observability additive)', () => {
  const VOCAB_CONTENT = 'Send this pitch to every prospect on our cold outreach list.';

  it("(b) mode='observe' (default) → STILL BLOCKED, and an observability event is recorded", async () => {
    delete process.env.CFE_VOCABULARY_MODE; // unset → default is 'observe'
    const audit = new InMemoryCFEAuditSink();
    const engine = new ComplianceFilterEngine({ classifierClient: new AgnesDouble({}), auditSink: audit });

    const v = await engine.evaluateContent(input(VOCAB_CONTENT));

    // Blocked — the vocabulary hard-block itself is unchanged.
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.reason).toContain('forbidden_vocabulary');

    // Observability event recorded on the SAME audit event (additive, not a second event).
    expect(audit.events.length).toBe(1);
    const event = audit.last()!;
    expect(event.vocabulary_violations).toBeDefined();
    expect(event.vocabulary_violations!.length).toBeGreaterThan(0);
    expect(event.vocabulary_violations!.map((x) => x.forbidden)).toEqual(
      expect.arrayContaining(['prospect', 'pitch', 'cold outreach'])
    );
    expect(event.vocabulary_mode).toBe('observe');

    // Surfaced: the durable-audit adapter carries it into `event_data` (what the review view reads).
    const auditInput = mapCfeEventToAuditInput(event);
    expect(auditInput.event_data.vocabulary_violations).toEqual(event.vocabulary_violations);
  });

  it("(c) mode='block' (legacy) → SAME term → still blocked, NO divergence in the block decision, no observability record", async () => {
    process.env.CFE_VOCABULARY_MODE = 'block';
    const audit = new InMemoryCFEAuditSink();
    const engine = new ComplianceFilterEngine({ classifierClient: new AgnesDouble({}), auditSink: audit });

    const v = await engine.evaluateContent(input(VOCAB_CONTENT));

    // PARITY: identical block decision to the 'observe' run above.
    expect(v.band).toBe('blocked');
    expect(v.released).toBe(false);
    expect(v.held).toBe(false);
    expect(v.reason).toContain('forbidden_vocabulary');

    // No observability record in 'block' mode — byte-identical to pre-T-R51 behavior.
    const event = audit.last()!;
    expect(event.vocabulary_violations).toBeUndefined();
    expect(event.vocabulary_mode).toBeUndefined();
  });

  it('a vocabularyMode override on the engine constructor takes precedence over the env var', async () => {
    process.env.CFE_VOCABULARY_MODE = 'observe';
    const audit = new InMemoryCFEAuditSink();
    const engine = new ComplianceFilterEngine({
      classifierClient: new AgnesDouble({}),
      auditSink: audit,
      vocabularyMode: 'block',
    });
    await engine.evaluateContent(input(VOCAB_CONTENT));
    expect(audit.last()!.vocabulary_violations).toBeUndefined();
  });

  it('clean content (no vocabulary term) is unaffected by mode either way', async () => {
    for (const mode of ['block', 'observe'] as const) {
      const audit = new InMemoryCFEAuditSink();
      const engine = new ComplianceFilterEngine({
        classifierClient: new AgnesDouble({}),
        auditSink: audit,
        vocabularyMode: mode,
      });
      const v = await engine.evaluateContent(input('Great seeing you Saturday — lunch soon?'));
      expect(v.band).toBe('clear');
      expect(v.released).toBe(true);
      expect(audit.last()!.vocabulary_violations).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Surfaced-in-review-view proof: the durable audit trail → CfeAdjudicationService aggregation the
// compliance-review page's vocabulary-watch panel reads. End-to-end through the SAME
// `AuditService.recordAuditEvent` contract production wiring uses (`DurableCFEAuditSink` /
// `mapCfeEventToAuditInput`) — not a bespoke test-only shortcut.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('T-R51 — vocabulary catches are surfaced via CfeAdjudicationService.listVocabularyObservability', () => {
  function makeFakePrisma(userRows: { id: string; upline_id: string | null; organization_id: string | null }[]) {
    const auditEntries: Record<string, unknown>[] = [];
    let seq = 0;
    const client = {
      draftMessage: { findMany: async () => [], findFirst: async () => null, update: async () => { throw new Error('unused'); } },
      complianceReviewQueue: { findMany: async () => [], findFirst: async () => null, create: async () => { throw new Error('unused'); }, update: async () => { throw new Error('unused'); } },
      complianceUplineReview: { create: async () => { throw new Error('unused'); } },
      user: {
        async findMany({ where }: { where: Record<string, unknown> }) {
          return userRows
            .filter((u) => {
              if (where.upline_id !== undefined && u.upline_id !== where.upline_id) return false;
              if (where.organization_id !== undefined && u.organization_id !== where.organization_id) return false;
              if (where.id && typeof where.id === 'object' && 'not' in (where.id as object)) {
                if (u.id === (where.id as { not: string }).not) return false;
              }
              return true;
            })
            .map((u) => ({ id: u.id }));
        },
      },
      contact: { findMany: async () => [] },
      auditEntry: {
        async create({ data }: { data: Record<string, unknown> }) {
          const row = { sequence: ++seq, prev_hash: null, entry_hash: `h${seq}`, ...data };
          auditEntries.push(row);
          return row;
        },
        async findMany({ where }: { where?: Record<string, unknown> }) {
          const userIds = where?.user_id && typeof where.user_id === 'object' ? (where.user_id as { in: string[] }).in : null;
          return auditEntries.filter((e) => !userIds || userIds.includes(e.user_id as string));
        },
        async findUnique({ where }: { where: { id: string } }) {
          return auditEntries.find((e) => e.id === where.id) ?? null;
        },
        async findFirst({ orderBy }: { orderBy?: Record<string, unknown> }) {
          if (orderBy?.sequence === 'desc') return [...auditEntries].sort((a, b) => (b.sequence as number) - (a.sequence as number))[0] ?? null;
          return auditEntries[0] ?? null;
        },
      },
    };
    return { client: client as unknown as CfeAdjudicationPrismaClient, auditEntries };
  }

  it('aggregates recorded vocabulary catches by term for the caller\'s downline, org-scoped', async () => {
    const { client } = makeFakePrisma([
      { id: 'up-1', upline_id: null, organization_id: 'org-1' },
      { id: 'rep-1', upline_id: 'up-1', organization_id: 'org-1' },
      { id: 'rep-2', upline_id: 'up-1', organization_id: 'org-1' },
      { id: 'other-rep', upline_id: 'someone-else', organization_id: 'org-2' }, // out of scope
    ]);

    // Seed the SAME durable-audit path production wiring uses: engine → auditSink → recordAuditEvent.
    const repo = new InMemoryAuditRepository();
    const auditService = new AuditService(repo);
    const engineFor = (userId: string) =>
      new ComplianceFilterEngine({
        classifierClient: new AgnesDouble({}),
        auditSink: { emit: (event) => void auditService.recordAuditEvent(mapCfeEventToAuditInput(event)) },
      });

    await engineFor('rep-1').evaluateContent(input('Send this pitch to every prospect.', { user_id: 'rep-1' }));
    await engineFor('rep-1').evaluateContent(input('Another prospect pitch here.', { user_id: 'rep-1' }));
    await engineFor('rep-2').evaluateContent(input('Cold outreach to a new prospect.', { user_id: 'rep-2' }));
    await engineFor('rep-1').evaluateContent(input('Perfectly clean message, no issues.', { user_id: 'rep-1' })); // PASS — no catch
    await engineFor('other-rep').evaluateContent(input('Send this pitch to every prospect.', { user_id: 'other-rep' })); // out of scope

    // Now re-point the AuditService's own repository through the fake-Prisma-backed service too,
    // by feeding the SAME rows into the service's internal PrismaAuditRepository via its `auditEntry`
    // delegate (the service constructs its own AuditService from `deps.prisma`).
    const prismaAuditEntry = (client as unknown as { auditEntry: { create: (a: { data: Record<string, unknown> }) => Promise<unknown> } }).auditEntry;
    for (const row of repo.all()) {
      await prismaAuditEntry.create({ data: { ...row } });
    }

    const service = new CfeAdjudicationService({ prisma: client });
    const result = await service.listVocabularyObservability({ id: 'up-1', role: Role.UPLINE, organizationId: 'org-1' });

    expect(result.mode).toBe('observe');
    expect(result.totalCatches).toBe(3); // rep-1 x2 + rep-2 x1; the clean message and the out-of-scope rep are excluded
    const prospectStat = result.byTerm.find((t) => t.forbidden === 'prospect');
    expect(prospectStat?.count).toBe(3); // "prospect" appears in all three in-scope blocked messages
    const pitchStat = result.byTerm.find((t) => t.forbidden === 'pitch');
    expect(pitchStat?.count).toBe(2);
    const coldOutreachStat = result.byTerm.find((t) => t.forbidden === 'cold outreach');
    expect(coldOutreachStat?.count).toBe(1);
    // No entry for the out-of-scope rep's identical-content catch — proves org-scoping held.
    expect(result.recentEvents.every((e) => e.repId === 'rep-1' || e.repId === 'rep-2')).toBe(true);
  });

  it('mode="block" reflects on the read side too — reads still work but nothing is recorded to find', async () => {
    process.env.CFE_VOCABULARY_MODE = 'block';
    const { client } = makeFakePrisma([{ id: 'up-1', upline_id: null, organization_id: 'org-1' }]);
    const service = new CfeAdjudicationService({ prisma: client });
    const result = await service.listVocabularyObservability({ id: 'up-1', role: Role.UPLINE, organizationId: 'org-1' });
    expect(result.mode).toBe('block');
    expect(result.totalCatches).toBe(0);
    expect(result.byTerm).toEqual([]);
  });
});
