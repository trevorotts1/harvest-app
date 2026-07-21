import {
  SEVEN_WHYS_LEVELS,
  SEVEN_WHYS_RESONANCE_GATE,
  SEVEN_WHYS_MODEL_ID,
  SevenWhysLevel,
  LocalSevenWhysConversationClient,
  SevenWhysConversationClient,
  SevenWhysConverseRequest,
  SevenWhysConverseResult,
  startSevenWhys,
  submitSevenWhysAnswer,
  renderCurrentTurn,
  SevenWhysEngineState,
  routeAnchorToOutreach,
  CFEContentEvaluator,
  saveSevenWhysProgress,
  setOutreachConsent,
  decryptAnchorStatement,
  decryptTranscript,
  WhySessionPrismaClient,
  WhySessionRow,
  SonnetConversationClient,
  SevenWhysConversationError,
  MissingClaudeCredentialError,
  SevenWhysAnchorVocabViolationError,
  finalizeAnchorStatement,
  aggregateResonance,
  estimateDepthSignal,
} from '../../src/services/onboarding/wp01/seven-whys';
import type { CFEInput, CFEVerdict } from '../../src/types/compliance';
import { Role } from '@prisma/client';

/**
 * Deep, specific, emotionally-grounded answers for all seven levels — should clear the invisible
 * >70 completion gate (§6.4).
 */
const DEEP_ANSWERS: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]:
    'I want to replace my income within eighteen months so my family has real breathing room.',
  [SevenWhysLevel.URGENCY]:
    "Because my daughter starts school next year and I'm tired of missing every morning drop-off for a job that doesn't love me back.",
  [SevenWhysLevel.HISTORY]:
    'I grew up watching my dad work every single day and never had enough time for us — I promised myself it would be different.',
  [SevenWhysLevel.CHALLENGE]:
    "I'm scared of the awkward conversations with people I love, and I don't know how to bring this up without sounding like I'm selling something.",
  [SevenWhysLevel.FEAR]:
    "I'm afraid that if nothing changes, I'll wake up in ten years having never even tried, and I'll never forgive myself for that.",
  [SevenWhysLevel.TRANSFORMATION]:
    'I become the parent who is actually present, and my kids grow up watching someone who kept a promise instead of making excuses.',
  [SevenWhysLevel.COMMITMENT]:
    "Starting this week I promise to show up every single day, even when I'm scared, because my family is watching and I won't let them down.",
};

/** Short, generic, deflecting answers — should NOT clear the gate. */
const SHALLOW_ANSWERS: Record<SevenWhysLevel, string> = {
  [SevenWhysLevel.GOAL]: 'More money.',
  [SevenWhysLevel.URGENCY]: 'Just because.',
  [SevenWhysLevel.HISTORY]: 'Nothing really.',
  [SevenWhysLevel.CHALLENGE]: 'Not sure.',
  [SevenWhysLevel.FEAR]: 'I dunno.',
  [SevenWhysLevel.TRANSFORMATION]: 'Better I guess.',
  [SevenWhysLevel.COMMITMENT]: 'Sure, fine.',
};

async function runFullConversation(
  client: SevenWhysConversationClient,
  answers: Record<SevenWhysLevel, string>,
  extraDeepenAnswer?: string
) {
  let outcome = await startSevenWhys('rep-1', client);
  const renderedTurns = [outcome.rendered];

  for (const level of SEVEN_WHYS_LEVELS) {
    outcome = await submitSevenWhysAnswer(outcome.state, answers[level], client);
    renderedTurns.push(outcome.rendered);
  }

  // If the gate didn't pass and a deepening answer was supplied, submit it (possibly more than once
  // is out of scope for this helper — callers needing multiple rounds drive the loop themselves).
  if (!outcome.rendered.complete && extraDeepenAnswer) {
    outcome = await submitSevenWhysAnswer(outcome.state, extraDeepenAnswer, client);
    renderedTurns.push(outcome.rendered);
  }

  return { outcome, renderedTurns };
}

describe('Seven Whys — level ordering (§6.4)', () => {
  test('the seven levels are exactly Goal→Urgency→History→Challenge→Fear→Transformation→Commitment', () => {
    expect(SEVEN_WHYS_LEVELS).toEqual([
      'GOAL',
      'URGENCY',
      'HISTORY',
      'CHALLENGE',
      'FEAR',
      'TRANSFORMATION',
      'COMMITMENT',
    ]);
  });

  test('the model id is Sonnet 5 (§4.4)', () => {
    expect(SEVEN_WHYS_MODEL_ID).toBe('claude-sonnet-5');
  });
});

describe('Seven Whys — (a) one question per turn, never all seven at once', () => {
  test('starting the conversation returns exactly one question, not a list', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { rendered } = await startSevenWhys('rep-a', client);

    expect(typeof rendered.question).toBe('string');
    expect(Array.isArray(rendered.question)).toBe(false);
    expect(rendered.filledLevels).toEqual([]); // no seed has filled yet — first question unanswered
    // The single question must not itself enumerate every level (no batch dump).
    const otherLevels = SEVEN_WHYS_LEVELS.slice(1);
    for (const level of otherLevels) {
      expect(rendered.question).not.toContain(level);
    }
  });

  test('each subsequent answer yields exactly one NEXT question, and progress fills one seed at a time', async () => {
    const client = new LocalSevenWhysConversationClient();
    let outcome = await startSevenWhys('rep-a2', client);

    for (let i = 0; i < SEVEN_WHYS_LEVELS.length - 1; i++) {
      const level = SEVEN_WHYS_LEVELS[i];
      outcome = await submitSevenWhysAnswer(outcome.state, DEEP_ANSWERS[level], client);
      expect(typeof outcome.rendered.question).toBe('string');
      expect(outcome.rendered.filledLevels).toEqual(SEVEN_WHYS_LEVELS.slice(0, i + 1));
      expect(outcome.rendered.complete).toBe(false);
    }
  });
});

describe('Seven Whys — (b) the resonance score is computed but NEVER user-facing; a low score is care, not failure', () => {
  test('the rendered turn never contains a score/resonance field or leaks the hidden number', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { renderedTurns } = await runFullConversation(client, DEEP_ANSWERS);

    for (const turn of renderedTurns) {
      const keys = Object.keys(turn);
      for (const key of keys) {
        expect(key.toLowerCase()).not.toMatch(/score/);
        expect(key.toLowerCase()).not.toMatch(/resonance/);
      }
      const serialized = JSON.stringify(turn);
      expect(serialized.toLowerCase()).not.toMatch(/resonance/);
      expect(serialized.toLowerCase()).not.toMatch(/"score"/);
    }
  });

  test('a shallow, low-resonance transcript cannot complete — it renders a caring re-prompt, never a failure message', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { outcome } = await runFullConversation(client, SHALLOW_ANSWERS);

    expect(outcome.rendered.complete).toBe(false);
    expect(outcome.rendered.reprompt).toBe(true);
    expect(outcome.rendered.anchorStatement).toBeNull();
    expect(outcome.rendered.pulsingLevel).toBe(SevenWhysLevel.COMMITMENT);
    // The Commitment seed pulses instead of filling (uiux §5.1 O-5).
    expect(outcome.rendered.filledLevels).not.toContain(SevenWhysLevel.COMMITMENT);

    // Framed as care, never as a rejection/failure/invalid-input message.
    const text = `${outcome.rendered.question ?? ''} ${outcome.rendered.acknowledgment ?? ''}`.toLowerCase();
    for (const bannedWord of ['fail', 'invalid', 'error', 'blocked', 'reject', 'score', 'resonance']) {
      expect(text).not.toContain(bannedWord);
    }
  });

  test('re-analysis: an otherwise-deep conversation dragged down by one shallow Commitment answer re-prompts, then completes once answered with real depth', async () => {
    const client = new LocalSevenWhysConversationClient();
    // Six deep, resonant levels + one shallow Commitment answer — the holistic gate is dragged
    // below the threshold by Commitment alone, so it (correctly) cannot complete yet.
    const mostlyDeepWithShallowCommitment: Record<SevenWhysLevel, string> = {
      ...DEEP_ANSWERS,
      [SevenWhysLevel.COMMITMENT]: SHALLOW_ANSWERS[SevenWhysLevel.COMMITMENT],
    };
    let { outcome } = await runFullConversation(client, mostlyDeepWithShallowCommitment);
    expect(outcome.rendered.complete).toBe(false);
    expect(outcome.rendered.reprompt).toBe(true);
    expect(outcome.rendered.pulsingLevel).toBe(SevenWhysLevel.COMMITMENT);

    // Re-analyze: answering the SAME caring re-prompt with real depth pushes the holistic score
    // over the gate without reopening any earlier level.
    outcome = await submitSevenWhysAnswer(
      outcome.state,
      DEEP_ANSWERS[SevenWhysLevel.COMMITMENT],
      client
    );

    expect(outcome.rendered.complete).toBe(true);
    expect(outcome.rendered.anchorStatement).toEqual(expect.any(String));
  });
});

describe('Seven Whys — (c) a >70 conversation composes an anchor statement', () => {
  test('a deep, resonant transcript completes and composes a non-empty anchor statement', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { outcome } = await runFullConversation(client, DEEP_ANSWERS);

    expect(outcome.rendered.complete).toBe(true);
    expect(outcome.rendered.question).toBeNull();
    expect(outcome.rendered.anchorStatement).toEqual(expect.any(String));
    expect((outcome.rendered.anchorStatement as string).length).toBeGreaterThan(0);
    expect(outcome.rendered.filledLevels).toEqual(SEVEN_WHYS_LEVELS);
  });

  test('the composed anchor statement is doctrine-vocab-clean (§0.5) — a violation is rejected, not persisted', async () => {
    const dirtyClient: SevenWhysConversationClient = {
      async converse(req: SevenWhysConverseRequest): Promise<SevenWhysConverseResult> {
        return new LocalSevenWhysConversationClient().converse(req);
      },
      async composeAnchor() {
        return { anchorStatement: "Let's talk about this business opportunity — join my team as a lead!" };
      },
    };

    await expect(
      finalizeAnchorStatement(dirtyClient, [
        { level: SevenWhysLevel.GOAL, question: 'q', answer: 'a' },
      ])
    ).rejects.toBeInstanceOf(SevenWhysAnchorVocabViolationError);
  });
});

describe('Seven Whys — (d) use_in_outreach_consent defaults FALSE', () => {
  function makeMockPrisma(): { prisma: WhySessionPrismaClient; rows: WhySessionRow[] } {
    const rows: WhySessionRow[] = [];
    const prisma: WhySessionPrismaClient = {
      whySession: {
        async findFirst({ where }) {
          return rows.find((r) => r.user_id === where.user_id) ?? null;
        },
        async create({ data }) {
          const row = { id: `row-${rows.length + 1}`, ...data } as WhySessionRow;
          rows.push(row);
          return row;
        },
        async update({ where, data }) {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      },
    };
    return { prisma, rows };
  }

  test('a freshly-saved WhySession has use_in_outreach_consent === false, with no way to pass it true', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { outcome } = await runFullConversation(client, DEEP_ANSWERS);
    expect(outcome.rendered.complete).toBe(true);

    const { prisma, rows } = makeMockPrisma();
    const saved = await saveSevenWhysProgress(prisma, outcome.state);

    expect(saved.use_in_outreach_consent).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].use_in_outreach_consent).toBe(false);

    // Encrypted at rest: the anchor statement is never stored as plaintext.
    expect(saved.anchor_statement).not.toEqual(outcome.state.anchorStatement);
    expect(decryptAnchorStatement(saved)).toEqual(outcome.state.anchorStatement);

    const transcript = decryptTranscript(saved);
    expect(transcript).toHaveLength(SEVEN_WHYS_LEVELS.length);
  });

  test('consent can only change via the explicit, separate setOutreachConsent call — never as a side effect of a progress save', async () => {
    const client = new LocalSevenWhysConversationClient();
    const { outcome } = await runFullConversation(client, DEEP_ANSWERS);

    const { prisma } = makeMockPrisma();
    await saveSevenWhysProgress(prisma, outcome.state);

    const opted = await setOutreachConsent(prisma, outcome.state.userId, true);
    expect(opted.use_in_outreach_consent).toBe(true);

    // A subsequent progress save (e.g. re-persisting the same completed state) must not reset it.
    const resaved = await saveSevenWhysProgress(prisma, outcome.state);
    expect(resaved.use_in_outreach_consent).toBe(true);
  });

  test('the Prisma schema itself defaults use_in_outreach_consent to false (belt-and-suspenders)', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(__dirname, '../../prisma/schema.prisma'),
      'utf8'
    ) as string;
    const modelMatch = schema.match(/model WhySession \{[\s\S]*?\n\}/);
    expect(modelMatch).not.toBeNull();
    expect(modelMatch![0]).toMatch(/use_in_outreach_consent\s+Boolean\s+@default\(false\)/);
  });
});

describe('Seven Whys — (e) routing the anchor to outreach is CFE-gated, fail-closed, no bypass', () => {
  function mockCFE(verdict: CFEVerdict): CFEContentEvaluator & { calls: CFEInput[] } {
    const calls: CFEInput[] = [];
    return {
      calls,
      async evaluateContent(input: CFEInput) {
        calls.push(input);
        return verdict;
      },
    };
  }

  const userContext: CFEInput['userContext'] = { user_id: 'rep-1', role: Role.REP };

  test('consent=false never calls the CFE and is refused', async () => {
    const cfe = mockCFE({ released: true } as CFEVerdict);
    const decision = await routeAnchorToOutreach(
      { anchorStatementPlain: 'I show up for my family every day.', useInOutreachConsent: false },
      cfe,
      userContext
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('consent_required');
    expect(cfe.calls).toHaveLength(0);
  });

  test('consent=true ALWAYS calls the CFE — no bypass — and releases only when the CFE releases', async () => {
    const cfe = mockCFE({ released: true, held: false, band: 'clear' } as CFEVerdict);
    const decision = await routeAnchorToOutreach(
      { anchorStatementPlain: 'I show up for my family every day.', useInOutreachConsent: true },
      cfe,
      userContext
    );
    expect(cfe.calls).toHaveLength(1);
    expect(cfe.calls[0].content).toBe('I show up for my family every day.');
    expect(decision.allowed).toBe(true);
  });

  test('consent=true but the CFE holds (fail-closed / unavailable) → refused, still no bypass', async () => {
    const cfe = mockCFE({ released: false, held: true, band: 'blocked' } as CFEVerdict);
    const decision = await routeAnchorToOutreach(
      { anchorStatementPlain: 'Anything at all.', useInOutreachConsent: true },
      cfe,
      userContext
    );
    expect(cfe.calls).toHaveLength(1);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('cfe_held');
  });

  test('consent=true but the CFE blocks the content → refused', async () => {
    const cfe = mockCFE({ released: false, held: false, band: 'blocked' } as CFEVerdict);
    const decision = await routeAnchorToOutreach(
      { anchorStatementPlain: 'Anything at all.', useInOutreachConsent: true },
      cfe,
      userContext
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('cfe_blocked');
  });
});

describe('Seven Whys — Claude-only, DI-mockable conversation client (§0.3, §4.4)', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test('a missing ANTHROPIC_API_KEY throws — never falls back to a non-Claude provider', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const client = new SonnetConversationClient();
    await expect(
      client.converse({
        respondingToLevel: null,
        answer: null,
        nextLevel: SevenWhysLevel.GOAL,
        isDeepening: false,
        transcript: [],
      })
    ).rejects.toBeInstanceOf(MissingClaudeCredentialError);
  });

  test('the real client targets claude-sonnet-5 in its request body', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const calls: unknown[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  acknowledgment: null,
                  question: 'What matters most to you right now?',
                  depth_signal: 0,
                }),
              },
            ],
          }),
      };
    };
    const client = new SonnetConversationClient({ fetchImpl });
    await client.converse({
      respondingToLevel: null,
      answer: null,
      nextLevel: SevenWhysLevel.GOAL,
      isDeepening: false,
      transcript: [],
    });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { model: string }).model).toBe('claude-sonnet-5');
  });

  // Regression (T-R2 lint-refactor QC reject): a degenerate JSON response body — the literal
  // `"null"` — must still throw the domain error (SevenWhysConversationError) the pre-refactor
  // `payload?.question`/`payload?.depth_signal` optional chaining produced, never a raw
  // `TypeError: Cannot read properties of null`.
  test('converse(): a degenerate ("null") Sonnet JSON body throws SevenWhysConversationError, never a raw TypeError', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: 'text', text: 'null' }] }),
    });
    const client = new SonnetConversationClient({ fetchImpl });
    await expect(
      client.converse({
        respondingToLevel: null,
        answer: null,
        nextLevel: SevenWhysLevel.GOAL,
        isDeepening: false,
        transcript: [],
      })
    ).rejects.toThrow(SevenWhysConversationError);
    await expect(
      client.converse({
        respondingToLevel: null,
        answer: null,
        nextLevel: SevenWhysLevel.GOAL,
        isDeepening: false,
        transcript: [],
      })
    ).rejects.toThrow('Sonnet conversation turn missing required fields.');
  });

  // Same regression, on the sibling composeAnchor() call path — a distinct domain-error message,
  // proving the null-guard was restored at BOTH read sites, not just the first one.
  test('composeAnchor(): a degenerate ("null") Sonnet JSON body throws SevenWhysConversationError, never a raw TypeError', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ content: [{ type: 'text', text: 'null' }] }),
    });
    const client = new SonnetConversationClient({ fetchImpl });
    await expect(client.composeAnchor({ transcript: [] })).rejects.toThrow(
      SevenWhysConversationError
    );
    await expect(client.composeAnchor({ transcript: [] })).rejects.toThrow(
      'Sonnet anchor composition returned no statement.'
    );
  });
});

describe('Seven Whys — resonance heuristics (pure functions)', () => {
  test('estimateDepthSignal scores a deep answer higher than a shallow one', () => {
    const deep = estimateDepthSignal(DEEP_ANSWERS[SevenWhysLevel.FEAR]);
    const shallow = estimateDepthSignal(SHALLOW_ANSWERS[SevenWhysLevel.FEAR]);
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeGreaterThan(0.5);
    expect(shallow).toBeLessThan(0.5);
  });

  test('aggregateResonance ignores unanswered levels and clamps to 0-100', () => {
    const score = aggregateResonance({ [SevenWhysLevel.GOAL]: 1 });
    expect(score).toBe(100);
    const empty = aggregateResonance({});
    expect(empty).toBe(0);
  });

  test('a fully-deep transcript aggregates above the gate; a fully-shallow one does not', () => {
    const deepSignals: Partial<Record<SevenWhysLevel, number>> = {};
    const shallowSignals: Partial<Record<SevenWhysLevel, number>> = {};
    for (const level of SEVEN_WHYS_LEVELS) {
      deepSignals[level] = estimateDepthSignal(DEEP_ANSWERS[level]);
      shallowSignals[level] = estimateDepthSignal(SHALLOW_ANSWERS[level]);
    }
    expect(aggregateResonance(deepSignals)).toBeGreaterThan(SEVEN_WHYS_RESONANCE_GATE);
    expect(aggregateResonance(shallowSignals)).toBeLessThanOrEqual(SEVEN_WHYS_RESONANCE_GATE);
  });
});

describe('Seven Whys — resume replays state without a fresh Claude call', () => {
  test('renderCurrentTurn reflects the persisted state and last acknowledgment', async () => {
    const client = new LocalSevenWhysConversationClient();
    let outcome = await startSevenWhys('rep-resume', client);
    outcome = await submitSevenWhysAnswer(outcome.state, DEEP_ANSWERS[SevenWhysLevel.GOAL], client);

    const replay = renderCurrentTurn(outcome.state as SevenWhysEngineState);
    expect(replay.question).toBe(outcome.rendered.question);
    expect(replay.acknowledgment).toBe(outcome.rendered.acknowledgment);
    expect(replay.filledLevels).toEqual(outcome.rendered.filledLevels);
  });
});
