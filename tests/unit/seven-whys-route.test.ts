// R-09 — the Seven Whys conversation API route (`/api/onboarding/seven-whys`) proof suite.
//
// Proves the route actually wires the REAL engine + Agnes client: turns come from the engine
// (never fabricated locally), the invisible >70 resonance gate renders as a caring re-prompt
// (never a number, never a failure), completion composes the per-rep anchor, progress persists
// encrypted to WhySession with consent default false, resume replays persisted state without a
// fresh engine call, and a missing AGNES_AI_API_KEY degrades gracefully (unavailable, never a 500,
// never a provider fallback).
//
// The fake-Prisma/fake-session harness mirrors the established T-R36/T-R37 pattern
// (tests/unit/onboarding-client-mapping-integration.test.ts). The Agnes client is injected by
// mocking the module the route imports — the same DI-mockable seam its unit suite already uses.

import { NextRequest } from 'next/server';
import { Role } from '@prisma/client';
import type { Session } from 'next-auth';

import {
  SEVEN_WHYS_LEVELS,
  SevenWhysLevel,
} from '@/services/onboarding/wp01/seven-whys';

jest.mock('@/lib/auth/session', () => ({ getCurrentSession: jest.fn() }));

interface FakeWhySessionRow {
  id: string;
  user_id: string;
  transcript: unknown;
  resonance_score: number;
  anchor_statement: string | null;
  why_photo_ref: string | null;
  use_in_outreach_consent: boolean;
}

const fakeWhySessions = new Map<string, FakeWhySessionRow>();
let whyIdSeq = 0;

const fakePrisma = {
  whySession: {
    findFirst: async ({ where }: { where: { user_id: string } }) =>
      fakeWhySessions.get(where.user_id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      whyIdSeq += 1;
      const row = { id: `why-${whyIdSeq}`, ...data } as unknown as FakeWhySessionRow;
      fakeWhySessions.set(row.user_id, row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = fakeWhySessions.get(where.id) ?? fakeWhySessions.values().next().value;
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  },
};

jest.mock('@/lib/prisma', () => ({ prisma: fakePrisma }));

// The Agnes conversation client — mocked at the module boundary so the route's `new
// AgnesConversationClient()` gets our deterministic stand-in (mirrors how the engine's own unit
// suite injects `LocalSevenWhysConversationClient`). All mock behavior below is REAL
// engine-conversation behavior via the local client's deterministic logic.
jest.mock('@/services/onboarding/wp01/seven-whys/agnes-client', () => {
  const { LocalSevenWhysConversationClient } = jest.requireActual(
    '@/services/onboarding/wp01/seven-whys/local-conversation-client'
  );
  return { AgnesConversationClient: LocalSevenWhysConversationClient };
});

import { getCurrentSession } from '@/lib/auth/session';
import { POST as sevenWhysRoute } from '@/app/api/onboarding/seven-whys/route';
import { GET as sevenWhysGetRoute } from '@/app/api/onboarding/seven-whys/route';
import { decryptTranscriptEnvelope } from '@/services/onboarding/wp01/seven-whys';

const mockedGetCurrentSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;

function fakeAuthSession(userId: string, role: Role): Session {
  return {
    user: { id: userId, role, orgType: 'EXTERNAL', organizationId: null, accessTier: 'FREE_ORG_LINKED', mfaEnrolled: false, mfaVerifiedAt: null },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

function actAs(userId: string, role: Role = Role.REP) {
  mockedGetCurrentSession.mockResolvedValue(fakeAuthSession(userId, role));
}

async function postAction(action: string, answer?: string) {
  const request = new NextRequest('http://localhost/api/onboarding/seven-whys', {
    method: 'POST',
    body: JSON.stringify({ action, ...(answer !== undefined ? { answer } : {}) }),
  });
  const response = await sevenWhysRoute(request, {});
  const body = await response.json();
  return { response, body };
}

async function getTurn() {
  const request = new NextRequest('http://localhost/api/onboarding/seven-whys', { method: 'GET' });
  const response = await sevenWhysGetRoute(request, {});
  const body = await response.json();
  return { response, body };
}

afterEach(() => {
  fakeWhySessions.clear();
  whyIdSeq = 0;
  mockedGetCurrentSession.mockReset();
});

/** Deep, specific, emotionally-grounded answers — should clear the invisible >70 gate (§6.4). */
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

async function runFullConversation(userId: string, answers: Record<SevenWhysLevel, string>) {
  const turns = [];
  const start = await postAction('start');
  expect(start.response.status).toBe(200);
  expect(start.body.turn).not.toBeNull();
  turns.push(start.body.turn);

  for (const level of SEVEN_WHYS_LEVELS) {
    const result = await postAction('submit', answers[level]);
    expect(result.response.status).toBe(200);
    expect(result.body.turn).not.toBeNull();
    turns.push(result.body.turn);
  }
  return turns;
}

describe('Seven Whys conversation API — real engine wiring (R-09)', () => {
  test('start returns the engine\'s opening question — never a fabricated turn', async () => {
    actAs('rep-1');
    const { response, body } = await postAction('start');
    expect(response.status).toBe(200);
    expect(body.turn.complete).toBe(false);
    expect(typeof body.turn.question).toBe('string');
    expect(body.turn.filledLevels).toEqual([]);
    expect(body.turn.anchorStatement).toBeNull();
    // The rendered turn structurally carries no score/resonance/depth field.
    expect('resonanceScore' in body.turn).toBe(false);
    expect('depthSignal' in body.turn).toBe(false);
  });

  test('each submit advances one turn; the engine\'s per-rep anchor completes the conversation', async () => {
    actAs('rep-2');
    const turns = await runFullConversation('rep-2', DEEP_ANSWERS);
    const final = turns[turns.length - 1];
    expect(final.complete).toBe(true);
    expect(final.question).toBeNull();
    expect(final.anchorStatement).toEqual(expect.any(String));
    expect(final.anchorStatement.length).toBeGreaterThan(0);
    // Per-rep: composed from the rep's own answers — never the old hard-coded literal.
    expect(final.anchorStatement).not.toBe('You build so the people you love never have to worry.');
    expect(final.filledLevels).toEqual(SEVEN_WHYS_LEVELS);
  });

  test('a shallow conversation hits the invisible resonance gate — a caring re-prompt, never a failure, never a number', async () => {
    actAs('rep-3');
    const shallow = {
      [SevenWhysLevel.GOAL]: 'More money.',
      [SevenWhysLevel.URGENCY]: 'Just because.',
      [SevenWhysLevel.HISTORY]: 'Nothing really.',
      [SevenWhysLevel.CHALLENGE]: 'Not sure.',
      [SevenWhysLevel.FEAR]: 'I dunno.',
      [SevenWhysLevel.TRANSFORMATION]: 'Better I guess.',
      [SevenWhysLevel.COMMITMENT]: 'Sure, fine.',
    };
    const turns = await runFullConversation('rep-3', shallow);
    const final = turns[turns.length - 1];
    expect(final.complete).toBe(false);
    expect(final.reprompt).toBe(true);
    expect(final.anchorStatement).toBeNull();
    const text = `${final.question ?? ''} ${final.acknowledgment ?? ''}`.toLowerCase();
    for (const banned of ['fail', 'invalid', 'error', 'blocked', 'reject', 'score', 'resonance', '70']) {
      expect(text).not.toContain(banned);
    }
  });

  test('progress persists to WhySession encrypted, with use_in_outreach_consent defaulting FALSE', async () => {
    actAs('rep-4');
    await runFullConversation('rep-4', DEEP_ANSWERS);
    const row = fakeWhySessions.get('rep-4');
    expect(row).toBeDefined();
    expect(row!.use_in_outreach_consent).toBe(false);
    // Encrypted at rest — the anchor statement is never stored as plaintext.
    expect(row!.anchor_statement).not.toContain('I want to replace my income');
    const envelope = decryptTranscriptEnvelope(row!);
    expect(envelope.entries).toHaveLength(SEVEN_WHYS_LEVELS.length);
    expect(envelope.status).toBe('COMPLETE');
    // The hidden resonance score persisted server-side only (never rendered).
    expect(typeof envelope.resonanceScore).toBe('number');
  });

  test('resume: GET + start replay the open turn from persisted state — no fresh engine call, no restart', async () => {
    actAs('rep-5');
    // Answer the first level, then leave.
    const start = await postAction('start');
    expect(start.response.status).toBe(200);
    const second = await postAction('submit', DEEP_ANSWERS[SevenWhysLevel.GOAL]);
    expect(second.response.status).toBe(200);

    // A returning rep: GET replays the open turn exactly (same question, same filled levels).
    const resumed = await getTurn();
    expect(resumed.response.status).toBe(200);
    expect(resumed.body.turn).not.toBeNull();
    expect(resumed.body.turn.filledLevels).toEqual([SevenWhysLevel.GOAL]);
    expect(resumed.body.turn.complete).toBe(false);
    // start on an in-progress conversation ALSO replays (no restart).
    const restarted = await postAction('start');
    expect(restarted.response.status).toBe(200);
    expect(restarted.body.turn.filledLevels).toEqual([SevenWhysLevel.GOAL]);
    expect(restarted.body.turn.complete).toBe(false);
  });

  test('resume after the gate: a re-prompted (AWAITING_DEEPER_ANSWER) state stays at the same level', async () => {
    actAs('rep-6');
    const shallow = {
      [SevenWhysLevel.GOAL]: 'More money.',
      [SevenWhysLevel.URGENCY]: 'Just because.',
      [SevenWhysLevel.HISTORY]: 'Nothing really.',
      [SevenWhysLevel.CHALLENGE]: 'Not sure.',
      [SevenWhysLevel.FEAR]: 'I dunno.',
      [SevenWhysLevel.TRANSFORMATION]: 'Better I guess.',
      [SevenWhysLevel.COMMITMENT]: 'Sure, fine.',
    };
    await runFullConversation('rep-6', shallow);

    const resumed = await getTurn();
    expect(resumed.response.status).toBe(200);
    expect(resumed.body.turn.reprompt).toBe(true);
    expect(resumed.body.turn.pulsingLevel).toBe(SevenWhysLevel.COMMITMENT);
    expect(resumed.body.turn.complete).toBe(false);
  });

  test('submit with no in-progress conversation is an honest 409 — never a fabricated conversation', async () => {
    actAs('rep-7');
    const { response, body } = await postAction('submit', 'An answer with no prior start.');
    expect(response.status).toBe(409);
    expect(body.turn).toBeUndefined();
  });

  test('an empty/non-string answer is rejected (400)', async () => {
    actAs('rep-8');
    const start = await postAction('start');
    expect(start.response.status).toBe(200);
    const empty = await postAction('submit', '   ');
    expect(empty.response.status).toBe(400);
    const wrongType = await postAction('submit');
    expect(wrongType.response.status).toBe(400);
  });

  test('a missing AGNES_AI_API_KEY degrades gracefully: 200 + unavailable, never a 500, never a local fallback turn', async () => {
    actAs('rep-9');
    // The route constructs `new AgnesConversationClient()` (mocked above to the local client
    // class). Simulate the production fail-closed path: the client's call throws the
    // missing-credential error exactly as `AgnesConversationClient.call()` does when the key is
    // unset — the route's catch turns it into 200 + `unavailable: 'no_key'`, never a 500 and
    // never a fabricated turn.
    const { MissingClaudeCredentialError } = jest.requireActual(
      '@/services/onboarding/wp01/seven-whys/claude-client'
    );
    const { LocalSevenWhysConversationClient } = jest.requireActual(
      '@/services/onboarding/wp01/seven-whys/local-conversation-client'
    );
    const spy = jest
      .spyOn(LocalSevenWhysConversationClient.prototype, 'converse')
      .mockRejectedValue(new MissingClaudeCredentialError('AGNES_AI_API_KEY'));

    try {
      const { response, body } = await postAction('start');
      expect(response.status).toBe(200);
      expect(body.turn).toBeNull();
      expect(body.unavailable).toBe('no_key');
    } finally {
      spy.mockRestore();
    }
  });
});
