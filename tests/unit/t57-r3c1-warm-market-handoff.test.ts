// T-57 R3c-1 (BLOCKER-E1 terminal-exit fix) — "Hand to my agent" was a pure no-op:
// `WarmMarketRitual.tsx`'s `onHandToAgent` prop passed to `RitualConfirmation` was an empty
// function body (a comment claiming no write was needed — false, see the fix's own doc comment).
// This proves the REAL decision logic the fix now drives: `actionableForHandoff` — the pure,
// hook-free function extracted specifically so it's testable in this repo's no-DOM Jest
// environment (same convention as ShiftView.tsx's `applyOptimisticAction`/`OfflineActionQueue`).

import { ReadinessTier } from '@prisma/client';

import { actionableForHandoff, type WarmMarketDispatchBody } from '@/app/ritual/warm-market/WarmMarketRitual';
import type { PublicQueueItem } from '@/types/harvest-method';

function item(contactId: string, tier: ReadinessTier): PublicQueueItem {
  return {
    contactId,
    firstName: 'Test',
    lastInitial: 'T.',
    clusters: [],
    tiles: {},
    tier,
    label: 'Ready',
    needsAcknowledgment: false,
    needsJurisdiction: false,
    layersCompleted: [],
  };
}

describe('T-57 R3c-1 — actionableForHandoff (the real "Hand to my agent" dispatch decision)', () => {
  test('RED (pre-fix) would be: nothing dispatched at all — this proves REAL dispatch bodies are produced for actionable tiers', () => {
    const queue = [item('c1', ReadinessTier.A), item('c2', ReadinessTier.B), item('c3', ReadinessTier.SLOW_BURN)];
    const result = actionableForHandoff(queue);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.contactId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  test('every dispatch body targets the REAL warm_market_sub agent, SMS_HANDOFF channel, the ritual trigger — never fabricated/placeholder values', () => {
    const [body] = actionableForHandoff([item('c1', ReadinessTier.A)]);
    expect(body).toEqual<WarmMarketDispatchBody>({
      agentKey: 'warm_market_sub',
      contactId: 'c1',
      channel: 'SMS_HANDOFF',
      trigger: 'ritual_hand_to_agent',
      idempotencyKey: 'ritual_hand_to_agent:c1',
    });
  });

  test('EXCLUDED contacts are NEVER dispatched (mirrors §8.2 "never actionable")', () => {
    const result = actionableForHandoff([item('excluded-1', ReadinessTier.EXCLUDED)]);
    expect(result).toHaveLength(0);
  });

  test('NEEDS_JURISDICTION contacts are NEVER dispatched (unknown jurisdiction — can\'t draft compliant outreach)', () => {
    const result = actionableForHandoff([item('needs-juris-1', ReadinessTier.NEEDS_JURISDICTION)]);
    expect(result).toHaveLength(0);
  });

  test('a mixed queue dispatches ONLY the actionable subset', () => {
    const queue = [
      item('ok-1', ReadinessTier.A),
      item('excluded-1', ReadinessTier.EXCLUDED),
      item('ok-2', ReadinessTier.B),
      item('needs-juris-1', ReadinessTier.NEEDS_JURISDICTION),
    ];
    const result = actionableForHandoff(queue);
    expect(result.map((r) => r.contactId).sort()).toEqual(['ok-1', 'ok-2']);
  });

  test('idempotencyKey is stable and unique per contact — a re-tap can never double-dispatch the same contact', () => {
    const queue = [item('same-contact', ReadinessTier.A)];
    const first = actionableForHandoff(queue);
    const second = actionableForHandoff(queue);
    expect(first[0].idempotencyKey).toBe(second[0].idempotencyKey);
    expect(first[0].idempotencyKey).toBe('ritual_hand_to_agent:same-contact');
  });

  test('an empty queue produces zero dispatch calls (never a crash, never a fabricated dispatch)', () => {
    expect(actionableForHandoff([])).toEqual([]);
  });
});

// ─── Source-level proof the REAL wiring calls the REAL route (fetch is not executable here — no
// DOM/jsdom in this repo's Jest env, matching every other WarmMarketRitual.tsx test's own
// constraint, stated in that file's header) ─────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('T-57 R3c-1 — WarmMarketRitual.tsx source: onHandToAgent is wired, not a no-op', () => {
  const source = readFileSync(
    path.join(__dirname, '..', '..', 'src', 'app', 'ritual', 'warm-market', 'WarmMarketRitual.tsx'),
    'utf8'
  );

  test('onHandToAgent passed to RitualConfirmation is the real handToAgent function, not an inline no-op', () => {
    expect(source).toMatch(/onHandToAgent=\{handToAgent\}/);
    // The OLD RED shape (an inline arrow function with only a comment in its body) is gone.
    expect(source).not.toMatch(/onHandToAgent=\{\(\)\s*=>\s*\{\s*\/\*/);
  });

  test('handToAgent calls the REAL dispatch route (POST /api/agents/dispatch), never a stub', () => {
    const fnMatch = source.match(/async function handToAgent\(\)[\s\S]*?\n  \}/);
    expect(fnMatch).not.toBeNull();
    expect(fnMatch?.[0]).toMatch(/postJson\('\/api\/agents\/dispatch', body\)/);
    expect(fnMatch?.[0]).toMatch(/actionableForHandoff\(queue\)/);
  });

  test('a repeat tap while a dispatch is already in flight/done is a guarded no-op (handoffStatus !== \'idle\')', () => {
    expect(source).toMatch(/if \(handoffStatus !== 'idle'\) return;/);
  });
});
