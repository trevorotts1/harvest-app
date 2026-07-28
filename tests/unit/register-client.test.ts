// T-R39 — proves the REAL registration client (src/app/auth/register-client.ts). Before this unit,
// the register wizard (src/app/auth/page.tsx) was a plain `<form action="/onboarding">` GET
// navigation carrying hardcoded demo defaults (name="Spaulding Demo", email="demo@theharvest.local")
// that never touched the network — no account was ever created, so a real new person could never
// sign in or reach onboarding (`/api/onboarding/step`'s `withRole` gate requires a real session).
//
// `registerAndSignIn` is framework-free (no React import), so — mirroring
// `resolveFirstTouchDraftId` (composer-handoff-wiring.test.ts) and `onboarding-step-client.ts`'s
// established pattern — it is exercised here by injecting a stub `fetch` and a stub `signIn`,
// entirely in this repo's plain `testEnvironment: 'node'` Jest env (no jsdom, no
// @testing-library/react needed).

import {
  registerAccount,
  registerAndSignIn,
  registerErrorCatalogKey,
  type RegisterFailure,
  type RegisterFields,
} from '@/app/auth/register-client';

const REAL_FIELDS: RegisterFields = {
  name: 'Pat Rep',
  email: 'pat@example.com',
  password: 'A-Genuinely-Strong-Passw0rd!',
  orgType: 'EXTERNAL',
};

function fetchStub(status: number, body: unknown) {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function fetchThrows() {
  return jest.fn(async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
}

describe('registerAccount — POSTs /api/auth/register with the REAL field set (never the old demo defaults)', () => {
  test('sends name/email/password/orgType for a plain EXTERNAL registrant', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u1', email: REAL_FIELDS.email, name: REAL_FIELDS.name, role: 'REP' } });
    const result = await registerAccount(REAL_FIELDS, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/auth/register');
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body);
    expect(sentBody).toEqual({
      name: 'Pat Rep',
      email: 'pat@example.com',
      password: 'A-Genuinely-Strong-Passw0rd!',
      orgType: 'EXTERNAL',
    });
    // The demo defaults this unit replaces must never be sent, from any call site.
    expect(sentBody.email).not.toBe('demo@theharvest.local');
    expect(sentBody.name).not.toBe('Spaulding Demo');
    expect(result).toEqual({ ok: true, user: { id: 'u1', email: 'pat@example.com', name: 'Pat Rep', role: 'REP' } });
  });

  test('includes solutionNumber ONLY for a PRIMERICA registrant who supplied one', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u2', email: 'p@example.com', name: 'P', role: 'REP' } });
    await registerAccount(
      { ...REAL_FIELDS, email: 'p@example.com', orgType: 'PRIMERICA', solutionNumber: '1234567' },
      fetchImpl
    );
    const sentBody = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(sentBody.orgType).toBe('PRIMERICA');
    expect(sentBody.solutionNumber).toBe('1234567');
  });

  test('omits solutionNumber for an EXTERNAL registrant even if one happens to be present on the fields object', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u3', email: 'e@example.com', name: 'E', role: 'REP' } });
    await registerAccount({ ...REAL_FIELDS, email: 'e@example.com', solutionNumber: '1234567' }, fetchImpl);
    const sentBody = JSON.parse((fetchImpl as jest.Mock).mock.calls[0][1].body);
    expect(sentBody).not.toHaveProperty('solutionNumber');
  });

  test('a 409 duplicate-email response is reported as a failure, never coerced into success', async () => {
    const fetchImpl = fetchStub(409, { error: 'Email already registered' });
    const result = await registerAccount(REAL_FIELDS, fetchImpl);
    expect(result).toEqual({ ok: false, status: 409, error: 'Email already registered' });
  });

  test('a network exception (fetch throws) is reported fail-closed, never thrown to the caller', async () => {
    const result = await registerAccount(REAL_FIELDS, fetchThrows());
    expect(result).toEqual({ ok: false, status: null });
  });
});

describe('registerErrorCatalogKey — maps failures to on-vocabulary catalog keys (never the raw server string)', () => {
  test.each<[RegisterFailure, string]>([
    [{ ok: false, status: 409, error: 'Email already registered' }, 'auth.registerEmailTaken'],
    [{ ok: false, status: 400, error: 'That password appears in known data breaches. Please choose a different one.' }, 'auth.registerWeakPassword'],
    [{ ok: false, status: 400, error: 'Enter your solution number.' }, 'auth.registerSolutionNumberInvalid'],
    [{ ok: false, status: 400, error: 'email, password, and name are required' }, 'auth.registerMissingFields'],
    [{ ok: false, status: 500, error: 'Internal server error' }, 'auth.registerGenericError'],
    [{ ok: false, status: null }, 'auth.registerGenericError'],
  ])('%j -> %s', (failure, key) => {
    expect(registerErrorCatalogKey(failure)).toBe(key);
  });
});

describe('registerAndSignIn — fail-closed orchestration: account THEN session, both-or-neither', () => {
  test('success: creates the account, signs in, and reports navigate', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u1', email: REAL_FIELDS.email, name: REAL_FIELDS.name, role: 'REP' } });
    const signInFn = jest.fn(async () => ({ ok: true, error: undefined }));

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'navigate' });
    expect(signInFn).toHaveBeenCalledTimes(1);
    expect(signInFn).toHaveBeenCalledWith(REAL_FIELDS.email, REAL_FIELDS.password);
  });

  test('a duplicate-email registration failure reports an error and NEVER calls signIn', async () => {
    const fetchImpl = fetchStub(409, { error: 'Email already registered' });
    const signInFn = jest.fn(async () => ({ ok: true }));

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'error', catalogKey: 'auth.registerEmailTaken' });
    expect(signInFn).not.toHaveBeenCalled();
  });

  test('a breached/weak-password registration failure reports an error and NEVER calls signIn', async () => {
    const fetchImpl = fetchStub(400, { error: 'That password appears in known data breaches. Please choose a different one.' });
    const signInFn = jest.fn(async () => ({ ok: true }));

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'error', catalogKey: 'auth.registerWeakPassword' });
    expect(signInFn).not.toHaveBeenCalled();
  });

  test('a server error (500) reports the generic error and NEVER calls signIn', async () => {
    const fetchImpl = fetchStub(500, { error: 'Internal server error' });
    const signInFn = jest.fn(async () => ({ ok: true }));

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'error', catalogKey: 'auth.registerGenericError' });
    expect(signInFn).not.toHaveBeenCalled();
  });

  test('account created but sign-in fails (e.g. rate-limited/anomaly): reports an error, NEVER a fake navigate', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u1', email: REAL_FIELDS.email, name: REAL_FIELDS.name, role: 'REP' } });
    const signInFn = jest.fn(async () => ({ ok: false, error: 'CredentialsSignin' }));

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'error', catalogKey: 'auth.registerSignInFailed' });
  });

  test('account created but signIn resolves undefined: reports an error, NEVER a fake navigate', async () => {
    const fetchImpl = fetchStub(201, { user: { id: 'u1', email: REAL_FIELDS.email, name: REAL_FIELDS.name, role: 'REP' } });
    const signInFn = jest.fn(async () => undefined);

    const outcome = await registerAndSignIn(REAL_FIELDS, signInFn, fetchImpl);

    expect(outcome).toEqual({ outcome: 'error', catalogKey: 'auth.registerSignInFailed' });
  });
});
