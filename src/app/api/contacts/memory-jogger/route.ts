// T-57 R3c-1 (MAJOR-M3, master-spec §7.4 Memory Jogger) — the FIRST HTTP surface for
// `MemoryJoggerService` (`src/services/warm-market/memory-jogger.service.ts`). That service, its
// Haiku 4.5 category-selection client (`memory-jogger/category-client.ts`), and the
// `memory_jogger_skip_count` schema column have existed since T-23 — fully built, fully
// unit-tested (`tests/unit/warm-market.test.ts`) — but were NEVER reachable over HTTP: `grep -rn
// "MemoryJoggerService" src/app/api` returned nothing before this file. §7.4's own words describe a
// UI feature ("category prompt cards ... as a swipeable 2-minute 'gardening' mini-flow the Today
// queue can suggest") that had no route to render against. This wires the REAL, already-injected
// Haiku client (`HaikuMemoryJoggerCategoryClient` — the same class `agent-runtime.ts`'s
// `buildMemoryJoggerService()` defaults to, never the `LocalDeterministicMemoryJoggerCategoryClient`
// test/dev fallback) to `src/app/community/jogger/page.tsx`.
//
// Session-gated (`withOnboardingGate`, never a client-forged header) — every read/write below is
// scoped to the caller's OWN Vault (`identity.userId`), matching every sibling `/api/contacts/*`
// route's convention (compare `hidden-earnings/route.ts`).
//
// FAIL-CLOSED, NOT FAIL-CRASH (§0.3 "Claude-only ... a missing credential throws — never a
// non-Claude fallback" + §4.6 "Claude API outage: agents pause gracefully"): a missing
// `ANTHROPIC_API_KEY` (or a transient Haiku timeout/error) throws inside the category client — this
// route catches that and answers 200 with `prompt: null` + an honest `unavailable` reason, never a
// 500, and never silently substitutes the local heuristic client (that substitution is exactly the
// HARD REQ agent-runtime.ts's header warns against). A missing `CONTACT_ENCRYPTION_KEY` (PII can't
// be safely read/written at all) is the one case this route DOES treat as a genuine 503 — the
// service cannot function at all without it, the same fail-closed posture
// `contacts/hidden-earnings`'s sibling routes take for the same missing-key class.

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';
import {
  HaikuMemoryJoggerCategoryClient,
  MemoryJoggerCategory,
  MissingClaudeCredentialError,
  shouldTriggerMemoryJogger,
} from '@/services/warm-market/memory-jogger';
import { MemoryJoggerService, MemoryJoggerVocabViolationError } from '@/services/warm-market/memory-jogger.service';
import { getContactEncryptionKey } from '@/services/warm-market/vault/vault-encryption';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set<string>(Object.values(MemoryJoggerCategory));

export const GET = withOnboardingGate(async (req, _ctx, _session, identity) => {
  const onDemand = req.nextUrl.searchParams.get('onDemand') === '1';
  // Optional: the categories this rep has already seen this session (client-tracked — there is no
  // persisted "recently shown" column; §7.4 only requires avoiding repeats, not remembering them
  // across sessions), so the Haiku selection genuinely varies instead of always picking category 1.
  const recentParam = req.nextUrl.searchParams.get('recent');
  const recentCategories = (recentParam ? recentParam.split(',') : []).filter((c): c is MemoryJoggerCategory =>
    VALID_CATEGORIES.has(c)
  );

  const contactCount = await prisma.contact.count({ where: { user_id: identity.userId } });
  const trigger = shouldTriggerMemoryJogger(contactCount, onDemand);
  if (!trigger) {
    return NextResponse.json({ trigger: false, contactCount, prompt: null });
  }

  let encryptionKey: string;
  try {
    encryptionKey = getContactEncryptionKey();
  } catch {
    return NextResponse.json(
      { error: 'The Memory Jogger is not configured on this environment yet.', code: 'ENCRYPTION_KEY_MISSING' },
      { status: 503 }
    );
  }

  const service = new MemoryJoggerService(prisma, new HaikuMemoryJoggerCategoryClient(), encryptionKey);
  try {
    const prompt = await service.selectNextCategoryPrompt(recentCategories);
    return NextResponse.json({ trigger: true, contactCount, prompt });
  } catch (error) {
    if (error instanceof MissingClaudeCredentialError) {
      return NextResponse.json({ trigger: true, contactCount, prompt: null, unavailable: 'no_key' });
    }
    if (error instanceof MemoryJoggerVocabViolationError) {
      // Defensive-only (§0.5 re-check on top of hardcoded-clean prompt text, mirroring
      // finalizeAnchorStatement) — never surfaces the violating text; treated as unavailable.
      return NextResponse.json({ trigger: true, contactCount, prompt: null, unavailable: 'vocab_violation' });
    }
    // Any other Haiku transport/timeout error (MemoryJoggerCategoryError /
    // MemoryJoggerCategoryTimeoutError) — agents "pause gracefully" (§4.6), never a 500.
    return NextResponse.json({ trigger: true, contactCount, prompt: null, unavailable: 'error' });
  }
});

export const POST = withOnboardingGate(async (req, _ctx, _session, identity) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { rawName } = body as { rawName?: unknown };
  if (!rawName || typeof rawName !== 'string' || !rawName.trim()) {
    return NextResponse.json({ error: '"rawName" (a non-empty string) is required.' }, { status: 400 });
  }

  let encryptionKey: string;
  try {
    encryptionKey = getContactEncryptionKey();
  } catch {
    return NextResponse.json(
      { error: 'The Memory Jogger is not configured on this environment yet.', code: 'ENCRYPTION_KEY_MISSING' },
      { status: 503 }
    );
  }

  const service = new MemoryJoggerService(prisma, new HaikuMemoryJoggerCategoryClient(), encryptionKey);
  const result = await service.captureNamedMemory(identity.userId, rawName.trim());
  return NextResponse.json(result);
});
