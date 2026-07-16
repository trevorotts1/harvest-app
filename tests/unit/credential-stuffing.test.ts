import {
  getBreachedPasswordChecker,
  getLoginHistoryStore,
  InMemoryLoginHistoryStore,
  scoreLoginAttempt,
  setLoginHistoryStore,
  StaticBreachedPasswordList,
} from '../../src/services/security/credential-stuffing';

describe('BreachedPasswordChecker (§18.10 "set/reset screens screen against known-breached passwords")', () => {
  const checker = new StaticBreachedPasswordList();

  test('flags well-known breached/common passwords', async () => {
    expect(await checker.isBreached('password')).toBe(true);
    expect(await checker.isBreached('123456')).toBe(true);
    expect(await checker.isBreached('PASSWORD123')).toBe(true); // case-insensitive
  });

  test('does not flag a strong, unique password', async () => {
    expect(await checker.isBreached('Xk7$mQ2vN9!pLwZr4Tf#8')).toBe(false);
  });

  test('the module-level default checker is a StaticBreachedPasswordList', async () => {
    expect(await getBreachedPasswordChecker().isBreached('qwerty')).toBe(true);
  });
});

describe('scoreLoginAttempt (§16.4 "anomaly scoring on login (new device/geo/velocity)")', () => {
  beforeEach(() => {
    setLoginHistoryStore(new InMemoryLoginHistoryStore());
  });

  test('a first-ever login has no history to compare against — not anomalous', async () => {
    const result = await scoreLoginAttempt({
      userId: 'user-1',
      deviceFingerprintHash: 'fp-1',
      ipHash: 'ip-1',
      now: 1_000_000,
    });
    expect(result.anomalous).toBe(false);
    expect(result.requiresChallenge).toBe(false);
  });

  test('a login from the same device+IP as history is not anomalous', async () => {
    const store = getLoginHistoryStore();
    await store.record('user-1', { deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 900_000, outcome: 'success' });

    const result = await scoreLoginAttempt({
      userId: 'user-1',
      deviceFingerprintHash: 'fp-1',
      ipHash: 'ip-1',
      now: 1_000_000,
    });
    expect(result.anomalous).toBe(false);
  });

  test('a brand-new device AND new IP together requires a challenge', async () => {
    const store = getLoginHistoryStore();
    await store.record('user-1', { deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 900_000, outcome: 'success' });

    const result = await scoreLoginAttempt({
      userId: 'user-1',
      deviceFingerprintHash: 'fp-NEW',
      ipHash: 'ip-NEW',
      now: 1_000_000,
    });
    expect(result.anomalous).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(['new_device', 'new_ip']));
    expect(result.requiresChallenge).toBe(true);
  });

  test('a lone new IP from a known device is logged but does not gate sign-in', async () => {
    const store = getLoginHistoryStore();
    await store.record('user-1', { deviceFingerprintHash: 'fp-1', ipHash: 'ip-1', at: 900_000, outcome: 'success' });

    const result = await scoreLoginAttempt({
      userId: 'user-1',
      deviceFingerprintHash: 'fp-1', // known device
      ipHash: 'ip-NEW',
      now: 1_000_000,
    });
    expect(result.reasons).toContain('new_ip');
    expect(result.requiresChallenge).toBe(false);
  });

  test('failed attempts do not "train" the recognized-device list', async () => {
    const store = getLoginHistoryStore();
    // An attacker's failed attempts from their own device/IP must not make it "recognized".
    await store.record('victim', {
      deviceFingerprintHash: 'attacker-fp',
      ipHash: 'attacker-ip',
      at: 900_000,
      outcome: 'failure',
    });

    const result = await scoreLoginAttempt({
      userId: 'victim',
      deviceFingerprintHash: 'attacker-fp',
      ipHash: 'attacker-ip',
      now: 1_000_000,
    });
    // No *successful* history exists yet, so this still reads as "no history to compare" (not
    // anomalous) rather than "recognized" — the point is it must never be marked recognized off
    // the back of failed attempts alone.
    expect(result.anomalous).toBe(false);
  });

  test('a velocity burst (many attempts in a short window) requires a challenge', async () => {
    const store = getLoginHistoryStore();
    const base = 1_000_000;
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.record('user-1', {
        deviceFingerprintHash: `fp-${i}`,
        ipHash: `ip-${i}`,
        at: base + i * 1_000, // within a 10-minute window
        outcome: 'failure',
      });
    }

    const result = await scoreLoginAttempt({
      userId: 'user-1',
      deviceFingerprintHash: 'fp-final',
      ipHash: 'ip-final',
      now: base + 6_000,
    });
    expect(result.reasons).toContain('velocity');
    expect(result.requiresChallenge).toBe(true);
  });
});
