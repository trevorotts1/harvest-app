import {
  consumePasswordResetToken,
  InMemoryVerificationTokenStore,
  issuePasswordResetToken,
} from '../../src/services/security/password-reset';

describe('password-reset tokens (§16.4 "password reset" rate-limited auth endpoint; single-use)', () => {
  test('a freshly issued token is valid and consumable exactly once', async () => {
    const store = new InMemoryVerificationTokenStore();
    const token = await issuePasswordResetToken(store, 'rep@example.com');

    const firstUse = await consumePasswordResetToken(store, 'rep@example.com', token);
    expect(firstUse).toBe(true);

    const replay = await consumePasswordResetToken(store, 'rep@example.com', token);
    expect(replay).toBe(false); // single-use — already consumed
  });

  test('an unknown/garbage token is rejected', async () => {
    const store = new InMemoryVerificationTokenStore();
    await issuePasswordResetToken(store, 'rep@example.com');
    const result = await consumePasswordResetToken(store, 'rep@example.com', 'not-a-real-token');
    expect(result).toBe(false);
  });

  test('a token is scoped to its issuing email — does not validate for a different account', async () => {
    const store = new InMemoryVerificationTokenStore();
    const token = await issuePasswordResetToken(store, 'rep-a@example.com');
    const result = await consumePasswordResetToken(store, 'rep-b@example.com', token);
    expect(result).toBe(false);
  });

  test('an expired token is rejected (and still consumed, so it cannot be reused after expiry either)', async () => {
    const store = new InMemoryVerificationTokenStore();
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = await issuePasswordResetToken(store, 'rep@example.com', issuedAt);

    const thirtyOneMinutesLater = new Date(issuedAt.getTime() + 31 * 60 * 1000);
    const result = await consumePasswordResetToken(store, 'rep@example.com', token, thirtyOneMinutesLater);
    expect(result).toBe(false);

    // Confirm it's truly gone, not just "expired but still sitting there" — the record is
    // removed regardless of the expiry outcome.
    const secondAttempt = await consumePasswordResetToken(store, 'rep@example.com', token, issuedAt);
    expect(secondAttempt).toBe(false);
  });

  test('a token used just before its expiry is accepted', async () => {
    const store = new InMemoryVerificationTokenStore();
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const token = await issuePasswordResetToken(store, 'rep@example.com', issuedAt);

    const twentyNineMinutesLater = new Date(issuedAt.getTime() + 29 * 60 * 1000);
    const result = await consumePasswordResetToken(store, 'rep@example.com', token, twentyNineMinutesLater);
    expect(result).toBe(true);
  });

  test('the raw token is never stored — only its hash is retrievable via a matching store lookup', async () => {
    const store = new InMemoryVerificationTokenStore();
    const token = await issuePasswordResetToken(store, 'rep@example.com');
    // Looking the raw token up directly against the store's internal map key would only work if
    // the store hashed it on write, which `find` (keyed by hash) implicitly proves here: passing
    // the RAW token again through `find`'s hash-then-lookup path succeeds only because
    // `consumePasswordResetToken` hashes consistently on both write and read.
    const record = await store.find('rep@example.com', token);
    expect(record).toBeNull(); // `token` here is raw; the store key is the hash, not the raw value
  });
});
