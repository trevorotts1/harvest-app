// T-38 (master-spec §10.4 "Global opt-out registry ... propagates platform-wide within 60s";
// §3.4 "a match hard-blocks the send regardless of any other state"; qc-checklist WP05 checkpoint
// 4 + critical-failure condition "A platform send with no opt-out check, or opt-out not
// propagating by hashed identifier").
//
// PROOF (a): an opted-out contact is BLOCKED — permanently, globally (by hashed identifier, not
// user/contact id), and across EVERY channel that identifier type can send on. Uses the same
// plain-mock-Prisma-delegate pattern as `tests/unit/vault.test.ts`'s `optOutRegistry` mock — no
// real database.
//
// TEETH: `isOptedOut` fails closed on ANY read failure (thrown error, or a delegate with no
// `findUnique` at all) — the load-bearing property `SendComplianceGate` depends on. If this
// fail-closed branch were ever changed to `return false` (the exact "unknown state resolves to
// safe to send" regression this build's brief calls out), the "DB error never reads as safe to
// send" test below fails immediately.

import { MessageChannel } from '@prisma/client';

import {
  OptOutRegistryService,
  isStopKeyword,
  type OptOutRegistryPrismaClient,
  type OptOutRegistryRow,
} from '../../src/services/compliance/opt-out/opt-out-registry';

function makeFakeRegistry() {
  const rows = new Map<string, OptOutRegistryRow>();

  const client: OptOutRegistryPrismaClient = {
    optOutRegistry: {
      upsert: jest.fn(async ({ where, create }) => {
        const key = `${where.identifier_hash_channel.identifier_hash}::${where.identifier_hash_channel.channel}`;
        if (!rows.has(key)) {
          rows.set(key, { ...create, created_at: new Date() });
        }
        return rows.get(key);
      }),
      findUnique: jest.fn(async ({ where }) => {
        const key = `${where.identifier_hash_channel.identifier_hash}::${where.identifier_hash_channel.channel}`;
        return rows.get(key) ?? null;
      }),
    },
  };

  return { client, rows };
}

describe('OptOutRegistryService.recordOptOut / isOptedOut (§10.4, §3.4 — PROOF a)', () => {
  test('recording a PHONE opt-out blocks BOTH SMS channels (all-channel fan-out) — the same aunt in every cousin\'s warm market', async () => {
    const { client } = makeFakeRegistry();
    const service = new OptOutRegistryService(client);

    await service.recordOptOut({ phoneHash: 'hash-aunt-phone' }, 'stop_reply');

    expect(await service.isOptedOut('hash-aunt-phone', MessageChannel.SMS_HANDOFF)).toBe(true);
    expect(await service.isOptedOut('hash-aunt-phone', MessageChannel.SMS_PLATFORM)).toBe(true);
    // EMAIL is a DIFFERENT identifier hash — a phone opt-out never blocks an email identifier that
    // was never recorded.
    expect(await service.isOptedOut('hash-aunt-phone', MessageChannel.EMAIL)).toBe(false);
  });

  test('recording an EMAIL opt-out blocks the EMAIL channel for that identifier', async () => {
    const { client } = makeFakeRegistry();
    const service = new OptOutRegistryService(client);

    await service.recordOptOut({ emailHash: 'hash-aunt-email' }, 'manual');

    expect(await service.isOptedOut('hash-aunt-email', MessageChannel.EMAIL)).toBe(true);
  });

  test('PERMANENT: no revoke/delete method exists — an opt-out cannot be undone by this service', () => {
    const service = new OptOutRegistryService(makeFakeRegistry().client);
    expect((service as unknown as Record<string, unknown>).revokeOptOut).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).deleteOptOut).toBeUndefined();
  });

  test('GLOBAL/CROSS-REP: keyed only by identifier_hash + channel — a SECOND caller checking the SAME hashed identifier sees the SAME opt-out with zero extra propagation step (no queue, no per-rep replication)', async () => {
    const { client } = makeFakeRegistry();
    // Simulates rep A's cousin recording the opt-out (e.g. via the inbound STOP webhook)...
    const repAService = new OptOutRegistryService(client);
    await repAService.recordOptOut({ phoneHash: 'hash-shared-aunt' }, 'stop_reply');

    // ...and rep B's copy of the SAME OptOutRegistryService (same underlying table) seeing it
    // instantly — the identifier_hash is the ONLY key, never scoped by user_id/contact_id.
    const repBService = new OptOutRegistryService(client);
    expect(await repBService.isOptedOut('hash-shared-aunt', MessageChannel.SMS_PLATFORM)).toBe(true);
  });

  test('idempotent: re-recording an opt-out for the same (identifier_hash, channel) keeps the FIRST reason (first opt-out wins)', async () => {
    const { client, rows } = makeFakeRegistry();
    const service = new OptOutRegistryService(client);

    await service.recordOptOut({ phoneHash: 'hash-x' }, 'stop_reply');
    await service.recordOptOut({ phoneHash: 'hash-x' }, 'manual');

    const row = rows.get(`hash-x::${MessageChannel.SMS_HANDOFF}`);
    expect(row?.reason).toBe('stop_reply');
  });

  describe('FAIL-CLOSED (§10.4, §18.1 "unknown consent/opt-out state must never resolve to sendable")', () => {
    test('a thrown error from findUnique resolves to opted-out (true), NEVER "safe to send"', async () => {
      const client: OptOutRegistryPrismaClient = {
        optOutRegistry: {
          upsert: jest.fn(),
          findUnique: jest.fn(async () => {
            throw new Error('connection reset');
          }),
        },
      };
      const service = new OptOutRegistryService(client);

      expect(await service.isOptedOut('any-hash', MessageChannel.SMS_PLATFORM)).toBe(true);
    });

    test('a delegate with NO findUnique at all (cannot confirm "not opted out") resolves to opted-out (true)', async () => {
      const client: OptOutRegistryPrismaClient = {
        optOutRegistry: { upsert: jest.fn() }, // no findUnique — mirrors vault.service.ts's own narrower delegate
      };
      const service = new OptOutRegistryService(client);

      expect(await service.isOptedOut('any-hash', MessageChannel.SMS_HANDOFF)).toBe(true);
    });

    test('a confirmed successful lookup that finds nothing is the ONLY path that resolves to false', async () => {
      const { client } = makeFakeRegistry();
      const service = new OptOutRegistryService(client);
      expect(await service.isOptedOut('never-recorded-hash', MessageChannel.SMS_PLATFORM)).toBe(false);
    });
  });
});

describe('isStopKeyword (§10.4/§10.9-4 inbound STOP-keyword capture seam)', () => {
  test.each(['STOP', 'stop', '  Stop  ', 'Unsubscribe', 'CANCEL', 'End', 'Quit', 'StopAll'])(
    'recognizes %p as an exact opt-out keyword',
    (text) => {
      expect(isStopKeyword(text)).toBe(true);
    }
  );

  test.each(['please stop texting me', 'stop sending me this', 'hello', '', 'stopped by the store'])(
    'does NOT treat %p as an opt-out keyword (exact-match only — avoids false-positive silencing)',
    (text) => {
      expect(isStopKeyword(text)).toBe(false);
    }
  );
});

describe('OptOutRegistryService.recordInboundMessage (the inbound STOP seam)', () => {
  test('a STOP-keyword inbound message records a phone opt-out and returns true', async () => {
    const { client } = makeFakeRegistry();
    const service = new OptOutRegistryService(client);

    const optedOut = await service.recordInboundMessage('hash-inbound', MessageChannel.SMS_PLATFORM, 'STOP');

    expect(optedOut).toBe(true);
    expect(await service.isOptedOut('hash-inbound', MessageChannel.SMS_PLATFORM)).toBe(true);
  });

  test('a non-STOP inbound message is a no-op — never records an opt-out', async () => {
    const { client } = makeFakeRegistry();
    const service = new OptOutRegistryService(client);

    const optedOut = await service.recordInboundMessage('hash-inbound-2', MessageChannel.SMS_PLATFORM, 'Sounds great, see you then!');

    expect(optedOut).toBe(false);
    expect(await service.isOptedOut('hash-inbound-2', MessageChannel.SMS_PLATFORM)).toBe(false);
  });
});
