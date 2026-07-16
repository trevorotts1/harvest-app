/**
 * T-12 CRITICAL fix — MFA step-up freshness is bound to a server-verified, SINGLE-USE proof, never
 * a client-set timestamp. These tests have TEETH: revert the jwt `update` path in
 * src/lib/auth/options.ts back to `token.mfaVerifiedAt = session.mfaVerifiedAt` (the shipped
 * bypass) and test (i) fails immediately — a forged client update would once again self-certify a
 * fresh step-up with no code ever entered.
 *
 * Proves the three mandated properties:
 *   (i)   `update({ mfaVerifiedAt: <forged> })` with NO genuine server-verified challenge →
 *         `requireStepUp` STILL throws (freshness never set from the client payload).
 *   (ii)  After a real step-up verify (server proof written) → `requireStepUp` passes ONCE.
 *   (iii) Replaying the same proof (a second update / second session) → rejected (single-use).
 */

// A stateful in-memory stand-in for the one User column this fix touches, keyed by user id. Lets a
// full round-trip (recordStepUpProof → jwt `update` → consumeStepUpProof) run against real code
// with no live Postgres, and lets us assert the proof is actually cleared (single-use).
const userRows = new Map<string, { mfa_stepped_up_at: Date | null }>();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => userRows.get(where.id) ?? null),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { mfa_stepped_up_at?: Date | null } }) => {
          const row = userRows.get(where.id) ?? { mfa_stepped_up_at: null };
          if ('mfa_stepped_up_at' in data) row.mfa_stepped_up_at = data.mfa_stepped_up_at ?? null;
          userRows.set(where.id, row);
          return row;
        }
      ),
      // Compare-and-swap: clears the column only if it still holds the exact Date we read — the
      // single-use guard `consumeStepUpProof` relies on. Second caller sees a mismatch → count 0.
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; mfa_stepped_up_at: Date };
          data: { mfa_stepped_up_at: Date | null };
        }) => {
          const row = userRows.get(where.id);
          const current = row?.mfa_stepped_up_at ?? null;
          if (
            row &&
            current instanceof Date &&
            where.mfa_stepped_up_at instanceof Date &&
            current.getTime() === where.mfa_stepped_up_at.getTime()
          ) {
            row.mfa_stepped_up_at = data.mfa_stepped_up_at ?? null;
            return { count: 1 };
          }
          return { count: 0 };
        }
      ),
    },
  },
}));

import { requireStepUp, StepUpRequiredError } from '../../src/lib/auth/mfa';
import { authOptions } from '../../src/lib/auth/options';
import { STEP_UP_REVALIDATION_WINDOW_MS } from '../../src/lib/auth/session-security';
import { consumeStepUpProof, recordStepUpProof } from '../../src/lib/auth/step-up-proof';

// Loose signature so the test isn't coupled to next-auth's discriminated-union JWT-callback typing.
const jwt = authOptions.callbacks!.jwt! as unknown as (params: {
  token: Record<string, unknown>;
  trigger?: string;
  session?: Record<string, unknown> | null;
  user?: unknown;
}) => Promise<Record<string, unknown>>;

const ACTION = 'data_export' as const;

beforeEach(() => {
  userRows.clear();
});

describe('jwt `update` step-up binding (§16.4 CRITICAL — server-verified single-use proof)', () => {
  test('(i) a FORGED update({ mfaVerifiedAt }) with no server proof → requireStepUp STILL throws', async () => {
    // Attacker calls useSession().update() with a future timestamp, no code ever entered. DB has
    // NO outstanding proof for this user.
    const forgedFuture = new Date(Date.now() + 5 * 60_000).toISOString();
    const token = { sub: 'user-1', mfaVerifiedAt: null as string | null };

    const result = await jwt({ token, trigger: 'update', session: { mfaVerifiedAt: forgedFuture } });

    // The client payload is ignored: freshness is neither the forged value nor anything at all.
    expect(result.mfaVerifiedAt).not.toBe(forgedFuture);
    expect(result.mfaVerifiedAt).toBeNull();
    expect(() =>
      requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: result.mfaVerifiedAt as string | null }, ACTION)
    ).toThrow(StepUpRequiredError);
  });

  test('(ii) after a real step-up verify (server proof written) → requireStepUp passes ONCE', async () => {
    // POST /api/auth/mfa/step-up wrote this after verifyMfaCode passed.
    await recordStepUpProof('user-1');

    const token = { sub: 'user-1', mfaVerifiedAt: null as string | null };
    const result = await jwt({ token, trigger: 'update', session: { mfaVerifiedAt: 'ignored-by-server' } });

    expect(typeof result.mfaVerifiedAt).toBe('string');
    expect(() =>
      requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: result.mfaVerifiedAt as string }, ACTION)
    ).not.toThrow();
    // The proof is consumed — single-use.
    expect(userRows.get('user-1')?.mfa_stepped_up_at).toBeNull();
  });

  test('(iii) REPLAYING the same proof (second session / second update) → rejected (single-use)', async () => {
    await recordStepUpProof('user-1');

    // First session consumes the proof successfully.
    const first = await jwt({
      token: { sub: 'user-1', mfaVerifiedAt: null as string | null },
      trigger: 'update',
      session: { mfaVerifiedAt: 'x' },
    });
    expect(typeof first.mfaVerifiedAt).toBe('string');

    // A second, fresh session (mfaVerifiedAt null) tries to ride the SAME proof — it is gone.
    const replay = await jwt({
      token: { sub: 'user-1', mfaVerifiedAt: null as string | null },
      trigger: 'update',
      session: { mfaVerifiedAt: 'x' },
    });
    expect(replay.mfaVerifiedAt).toBeNull();
    expect(() =>
      requireStepUp({ mfaEnrolled: true, mfaVerifiedAt: replay.mfaVerifiedAt as string | null }, ACTION)
    ).toThrow(StepUpRequiredError);
  });

  test('a non-update trigger never touches the proof or the freshness field', async () => {
    await recordStepUpProof('user-1');
    const token = { sub: 'user-1', mfaVerifiedAt: null as string | null, role: 'REP' };

    // A plain silent decode (no trigger) must not consume the proof.
    const result = await jwt({ token });
    expect(result.mfaVerifiedAt).toBeNull();
    expect(userRows.get('user-1')?.mfa_stepped_up_at).not.toBeNull();
  });
});

describe('consumeStepUpProof / recordStepUpProof (single-use + freshness at the source)', () => {
  test('consumes exactly once — a second consume of the same proof returns null', async () => {
    await recordStepUpProof('u');
    const first = await consumeStepUpProof('u');
    const second = await consumeStepUpProof('u');
    expect(typeof first).toBe('string');
    expect(second).toBeNull();
    expect(userRows.get('u')?.mfa_stepped_up_at).toBeNull();
  });

  test('a stale proof (older than the revalidation window) is consumed but returns null', async () => {
    const stale = new Date(Date.now() - (STEP_UP_REVALIDATION_WINDOW_MS + 60_000));
    await recordStepUpProof('u', stale);
    const result = await consumeStepUpProof('u');
    expect(result).toBeNull();
    // Still cleared — a spent-but-stale proof is not left lying around.
    expect(userRows.get('u')?.mfa_stepped_up_at).toBeNull();
  });

  test('no outstanding proof → consume returns null (the forged-update source condition)', async () => {
    expect(await consumeStepUpProof('nobody')).toBeNull();
  });
});
