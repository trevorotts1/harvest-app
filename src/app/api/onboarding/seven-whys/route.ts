// R-09 — the Seven Whys conversation API: wires the O-5 step to the REAL engine
// (src/services/onboarding/wp01/seven-whys/engine.ts) and the operator-directed Agnes
// conversation client (`AgnesConversationClient`, `agnes-2.0-flash`, `AGNES_AI_API_KEY` — T-R55b).
//
// Before this route, the live step was a fixed local script: OnboardingFlow.tsx fabricated every
// turn from hard-coded English literals (`SEVEN_WHYS_QUESTIONS`), never called the engine, never
// evaluated the invisible >70 resonance gate, and completed with a single hard-coded anchor
// ("You build so the people you love never have to worry.") identical for every rep. The engine,
// Agnes client, persistence, and outreach CFE gate all existed (fully built and unit-tested) but
// had NO runtime call path — `grep -rn "startSevenWhys" src/app` returned nothing before this file.
//
// This route is that path. It drives the conversation turn-by-turn exactly like the engine's own
// unit suite (tests/unit/seven-whys.test.ts) drives it, and persists real progress to `WhySession`
// (encrypted at rest, `use_in_outreach_consent` default false — §6.4, §16.3) via the same
// `saveSevenWhysProgress` the persistence tests exercise.
//
// INVISIBLE-SCORE CONTRACT (§6.4, uiux AC-5.1-4): everything this route emits is a
// `SevenWhysRenderedTurn` — the engine's rendered shape, which structurally carries NO score,
// resonance, or depth-signal field. A low resonance surfaces to the rep as `reprompt` (a caring
// re-ask), never as a failure and never as a number. The hidden `resonanceScore`/`depthSignal`s
// stay in server-side engine state and are persisted (encrypted) to `WhySession.resonance_score`
// and the encrypted transcript envelope — the exact columns §3.3 defines — never rendered.
//
// FAIL-CLOSED, NOT FAIL-CRASH (§0.3, provider-independent): a missing `AGNES_AI_API_KEY`, a
// timeout, or an Agnes transport error throws inside the client — this route catches the credential
// case and answers 200 with `turn: null` + an honest `unavailable: 'no_key'` reason (same graceful
// pause posture as `contacts/memory-jogger/route.ts`; the rep keeps a clear "engine unavailable"
// surface, never a 500, never a fabricated question). It NEVER silently substitutes
// `LocalSevenWhysConversationClient` or any other provider — that substitution is exactly the hard
// requirement the memory-jogger route's header warns against, and this route follows it verbatim.
//
// A missing `WHY_SESSION_ENCRYPTION_KEY` is the one case this route treats as a genuine 503: the
// transcript/anchor cannot be safely persisted at all (§16.3's "refusing to store ... without
// application-layer encryption at rest"), the same fail-closed posture the Vault routes take for a
// missing CONTACT_ENCRYPTION_KEY.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { Role } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { withRole } from '@/lib/auth/with-role';
import {
  AgnesConversationClient,
  MissingClaudeCredentialError,
  SevenWhysConversationError,
  SevenWhysRenderedTurn,
  startSevenWhys,
  submitSevenWhysAnswer,
  renderCurrentTurn,
  saveSevenWhysProgress,
  decryptTranscriptEnvelope,
  stateFromPersistedTranscript,
  getWhySessionEncryptionKey,
  type SevenWhysEngineState,
} from '@/services/onboarding/wp01/seven-whys';

const ALL_ROLES = Object.values(Role);

// Force per-request (dynamic) rendering — this route reads/writes live per-user state on every
// request (same rationale as every sibling /api/onboarding/* route).
export const dynamic = 'force-dynamic';

interface TurnBody {
  action?: 'start' | 'submit';
  answer?: unknown;
}

function toRenderedTurn(state: SevenWhysEngineState): SevenWhysRenderedTurn {
  return renderCurrentTurn(state);
}

/**
 * Hydrates engine state from a persisted `WhySession` row. The transcript envelope is stored
 * encrypted (per §16.3) and carries the engine's exact resume metadata (status, open level, depth
 * signals, hidden resonance score), so a resumed conversation replays EXACTLY — including the
 * >70 gate's `AWAITING_DEEPER_ANSWER` position. A missing row (never started) yields null and the
 * caller starts fresh. A decrypt failure (missing key) throws — the route's 503 branch owns that,
 * never a silent plaintext fallback.
 */
function stateFromWhySession(
  userId: string,
  row: { transcript: unknown; resonance_score: number }
): SevenWhysEngineState | null {
  if (!row.transcript) return null;
  const envelope = decryptTranscriptEnvelope(row);
  if (envelope.entries.length === 0) return null;
  const state = stateFromPersistedTranscript(envelope);
  return { ...state, userId };
}

export const POST = withRole(ALL_ROLES, async (req: NextRequest, _ctx, authSession) => {
  const userId = authSession.user.id;

  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'start' && action !== 'submit') {
    return NextResponse.json(
      { error: '"action" must be "start" or "submit"' },
      { status: 400 }
    );
  }
  const answer = body.answer;
  if (action === 'submit' && (typeof answer !== 'string' || answer.trim().length === 0)) {
    return NextResponse.json(
      { error: 'A non-empty "answer" string is required to submit a turn.' },
      { status: 400 }
    );
  }

  let encryptionKey: string;
  try {
    encryptionKey = getWhySessionEncryptionKey();
  } catch {
    return NextResponse.json(
      {
        error: 'The Seven Whys session is not configured on this environment yet.',
        code: 'WHY_SESSION_ENCRYPTION_KEY_MISSING',
      },
      { status: 503 }
    );
  }

  // Production client is ALWAYS Agnes (`agnes-2.0-flash`, AGNES_AI_API_KEY — T-R55b). The local
  // client is a test/dev seam only and is deliberately never substituted on error.
  const client = new AgnesConversationClient();

  try {
    const whySession = await prisma.whySession.findFirst({
      where: { user_id: userId },
      select: { transcript: true, resonance_score: true },
    });

    let state: SevenWhysEngineState;
    let rendered: SevenWhysRenderedTurn;

    if (action === 'start') {
      const existing = stateFromWhySession(userId, {
        transcript: whySession?.transcript,
        resonance_score: whySession?.resonance_score ?? 0,
      });
      if (existing) {
        // Resume-exact: a returning rep replays the open turn (or the completed anchor) from
        // persisted state — no fresh Agnes call, no state change, and a completed conversation is
        // NEVER silently wiped by a fresh start (§6.4: re-onboarding, the only path that should
        // re-run Flow C, clears the session elsewhere — this route never destroys a completed
        // WhySession just because the client asked for a start).
        return NextResponse.json({ turn: toRenderedTurn(existing) });
      }
      const outcome = await startSevenWhys(userId, client);
      state = outcome.state;
      rendered = outcome.rendered;
    } else {
      if (!whySession) {
        // The engine requires prior state to accept an answer. The UI only submits after a turn
        // was started; a caller with no session gets an honest 409, never a fabricated conversation.
        return NextResponse.json({ error: 'No Seven Whys conversation in progress.' }, { status: 409 });
      }
      const current = stateFromWhySession(userId, {
        transcript: whySession.transcript,
        resonance_score: whySession.resonance_score ?? 0,
      });
      if (!current) {
        return NextResponse.json({ error: 'No Seven Whys conversation in progress.' }, { status: 409 });
      }
      if (current.status === 'COMPLETE') {
        return NextResponse.json(
          { error: 'The Seven Whys conversation is already complete.' },
          { status: 409 }
        );
      }
      const outcome = await submitSevenWhysAnswer(current, answer as string, client);
      state = outcome.state;
      rendered = outcome.rendered;
    }

    // Persist real progress (encrypted transcript envelope + anchor, hidden resonance score,
    // consent default false — saveSevenWhysProgress enforces all of these).
    await saveSevenWhysProgress(prisma, state, encryptionKey);

    return NextResponse.json({ turn: rendered });
  } catch (error) {
    if (error instanceof MissingClaudeCredentialError) {
      // §0.3 graceful pause — never a 500, never a fabricated turn, never a provider fallback.
      return NextResponse.json({ turn: null, unavailable: 'no_key' });
    }
    if (error instanceof SevenWhysConversationError) {
      // Any other Agnes transport/timeout/parse error — same graceful pause posture.
      return NextResponse.json({ turn: null, unavailable: 'error' });
    }
    throw error;
  }
});

// GET — the current turn, resumed from persisted state (or null when nothing is in progress yet).
// The client calls this on mount so a returning rep replays the open question without losing their
// place, and never needs a live Agnes key just to see where they were.
export const GET = withRole(ALL_ROLES, async (_req: NextRequest, _ctx, authSession) => {
  const userId = authSession.user.id;

  try {
    const whySession = await prisma.whySession.findFirst({
      where: { user_id: userId },
      select: { transcript: true, resonance_score: true },
    });
    if (!whySession) {
      return NextResponse.json({ turn: null });
    }
    const state = stateFromWhySession(userId, {
      transcript: whySession.transcript,
      resonance_score: whySession.resonance_score ?? 0,
    });
    if (!state) {
      return NextResponse.json({ turn: null });
    }
    return NextResponse.json({ turn: toRenderedTurn(state) });
  } catch (error) {
    if (error instanceof MissingClaudeCredentialError) {
      return NextResponse.json({ turn: null, unavailable: 'no_key' });
    }
    if (error instanceof SevenWhysConversationError) {
      return NextResponse.json({ turn: null, unavailable: 'error' });
    }
    throw error;
  }
});
