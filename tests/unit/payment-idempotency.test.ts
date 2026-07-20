// WP10 (T-47) — idempotency (§15.5 / §15.7-7). A duplicate/replayed Stripe webhook must NEVER
// double-act; a genuinely-failed event must remain retriable.

import {
  STRIPE_WEBHOOK_SOURCE,
  stripeEventIdempotencyKey,
  withIdempotency,
  type IdempotencyLogDelegate,
} from '@/services/payment/idempotency';

class FakeIdempotencyLog implements IdempotencyLogDelegate {
  rows = new Set<string>();
  createCalls = 0;
  deleteCalls = 0;

  async create({ data }: { data: { key: string; source: string } }) {
    this.createCalls += 1;
    if (this.rows.has(data.key)) {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    this.rows.add(data.key);
    return {};
  }
  async findUnique({ where }: { where: { key: string } }) {
    return this.rows.has(where.key) ? { key: where.key } : null;
  }
  async delete({ where }: { where: { key: string } }) {
    this.deleteCalls += 1;
    this.rows.delete(where.key);
    return {};
  }
}

const KEY = stripeEventIdempotencyKey('evt_123');

describe('withIdempotency', () => {
  test('runs the side effect exactly once; a duplicate delivery is skipped safely', async () => {
    const log = new FakeIdempotencyLog();
    const fn = jest.fn().mockResolvedValue('provisioned');

    const first = await withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, fn);
    expect(first).toEqual({ deduplicated: false, result: 'provisioned' });

    const second = await withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, fn);
    expect(second).toEqual({ deduplicated: true, result: null });

    // The side effect ran only ONCE despite two deliveries of the same event id.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a failed side effect RELEASES the claim so a Stripe retry can re-run it', async () => {
    const log = new FakeIdempotencyLog();
    const failing = jest.fn().mockRejectedValueOnce(new Error('provisioning blew up'));

    await expect(withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, failing)).rejects.toThrow(
      'provisioning blew up'
    );
    // Claim released — the key is no longer present.
    expect(log.rows.has(KEY)).toBe(false);
    expect(log.deleteCalls).toBe(1);

    // The retry now succeeds (not swallowed as "already processed").
    const retry = jest.fn().mockResolvedValue('ok');
    const outcome = await withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, retry);
    expect(outcome).toEqual({ deduplicated: false, result: 'ok' });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('concurrent duplicate deliveries: exactly one wins the claim, the other dedups', async () => {
    const log = new FakeIdempotencyLog();
    const fn = jest.fn().mockResolvedValue('done');
    const [a, b] = await Promise.all([
      withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, fn),
      withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, fn),
    ]);
    const deduped = [a, b].filter((r) => r.deduplicated).length;
    expect(deduped).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a non-unique-violation error from the claim propagates (not treated as a dup)', async () => {
    const log: IdempotencyLogDelegate = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
      findUnique: jest.fn(),
      delete: jest.fn(),
    };
    await expect(withIdempotency(log, KEY, STRIPE_WEBHOOK_SOURCE, jest.fn())).rejects.toThrow('db down');
  });

  test('keys are namespaced by source (webhook keys cannot collide with other sources)', () => {
    expect(stripeEventIdempotencyKey('evt_abc')).toBe('stripe_webhook:evt_abc');
  });
});
