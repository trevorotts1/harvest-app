// T-R39 — the REAL registration client. `src/app/auth/page.tsx`'s register wizard used to be a
// plain `<form action="/onboarding">` — a GET navigation carrying hardcoded demo defaults
// (name="Spaulding Demo", email="demo@theharvest.local") that never touched the network. No
// account was ever created, so a genuinely new person could never sign in afterward — and
// `/api/onboarding/step` (with-role.ts's `withRole`) requires a real authenticated session, so
// they could not progress through onboarding either. This module is the fix's testable core: it
// creates the account (`POST /api/auth/register`), then signs the new user in, and reports back a
// single fail-closed outcome the page component turns into either a navigation or an honest error.
//
// Deliberately framework-free (no React import) so it can be unit-tested by stubbing `fetch` (and
// the injected `signInFn`) directly, mirroring `resolveFirstTouchDraftId`
// (src/app/community/components/resolve-first-touch-draft.ts) and `onboarding-step-client.ts` —
// this repo's established pattern for testing a fetch-calling client helper without a DOM/jsdom
// (jest.config.js: `testEnvironment: 'node'`, no `@testing-library/react`).

export interface RegisterFields {
  name: string;
  email: string;
  password: string;
  /** Register only ever writes `EXTERNAL`/`PRIMERICA` (the two `OrgType` values the route itself
   *  resolves to — see `src/app/api/auth/register/route.ts`). Full org/industry/business-model
   *  classification and sponsor matching stay WP01 onboarding territory (T-R39 discovery: the
   *  register route reads no `role`/`industry`/`businessModel` field at all; `role` always
   *  defaults to REP at the schema level, and no self-service role-elevation path exists anywhere
   *  in this codebase). */
  orgType: 'EXTERNAL' | 'PRIMERICA';
  /** Primerica-only; ignored by the route for an EXTERNAL registrant. */
  solutionNumber?: string;
}

export interface RegisterSuccess {
  ok: true;
  user: { id: string; email: string; name: string; role: string };
}
export interface RegisterFailure {
  ok: false;
  /** HTTP status, or `null` if the request never reached the server (network exception). */
  status: number | null;
  /** The route's raw `{ error }` text, when available — used ONLY to pick an on-vocabulary
   *  catalog key below; NEVER rendered directly as UI copy (that would bypass the i18n catalog and
   *  break ES parity). */
  error?: string;
}
export type RegisterResult = RegisterSuccess | RegisterFailure;

type FetchLike = typeof fetch;

async function parseJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** POST `/api/auth/register`. Never throws — a network-level failure comes back as a `status:
 *  null` `RegisterFailure`, same fail-closed contract as `postOnboardingStep`. */
export async function registerAccount(
  fields: RegisterFields,
  fetchImpl: FetchLike = fetch
): Promise<RegisterResult> {
  try {
    const response = await fetchImpl('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: fields.name,
        email: fields.email,
        password: fields.password,
        orgType: fields.orgType,
        ...(fields.orgType === 'PRIMERICA' && fields.solutionNumber
          ? { solutionNumber: fields.solutionNumber }
          : {}),
      }),
    });
    const body = await parseJsonBody(response);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof body.error === 'string' ? body.error : undefined,
      };
    }
    return { ok: true, user: body.user as RegisterSuccess['user'] };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * Maps a failed registration attempt to an on-vocabulary catalog key — never echoes the route's
 * raw `error` text as UI copy (that would both leak an un-localized string into an ES render and
 * couple the UI to the exact server wording). Unlike login's deliberately-generic
 * `auth.invalidCredentials` (§16.4 "never reveal whether an email exists" — an anti-enumeration
 * posture that applies to SIGN-IN), revealing "this email is already registered" at REGISTRATION
 * is the standard, non-sensitive pattern the route itself already chose (a dedicated 409) — this
 * just carries that same decision through to the UI.
 */
export function registerErrorCatalogKey(result: RegisterFailure): string {
  if (result.status === 409) return 'auth.registerEmailTaken';
  const error = result.error?.toLowerCase() ?? '';
  if (result.status === 400 && error.includes('breach')) return 'auth.registerWeakPassword';
  if (result.status === 400 && error.includes('digit')) return 'auth.registerSolutionNumberInvalid';
  if (result.status === 400 && error.includes('required')) return 'auth.registerMissingFields';
  return 'auth.registerGenericError';
}

/** The `next-auth/react` `signIn('credentials', ...)` call, narrowed to just the shape this module
 *  needs — lets `registerAndSignIn` be tested with a plain async stub instead of importing
 *  next-auth/react (which requires a mounted App Router at call time). `error` is `string | null`
 *  to match next-auth's own `SignInResponse` shape exactly (its `error` field is nullable, not
 *  merely optional). */
export type SignInFn = (
  email: string,
  password: string
) => Promise<{ ok?: boolean; error?: string | null } | undefined>;

export type RegisterAndSignInOutcome =
  | { outcome: 'navigate' }
  | { outcome: 'error'; catalogKey: string };

/**
 * The full fail-closed orchestration: create the account, THEN sign in, and only ever report
 * `'navigate'` when BOTH succeeded. A registration failure (duplicate email / weak password /
 * malformed solution number / server error / network exception) never calls `signInFn` at all —
 * and a registration success whose immediate sign-in nonetheless fails (e.g. a rate limit or an
 * anomaly-scoring edge case) is reported as an error too, never a silent/fake success, since
 * `/api/onboarding/step`'s `withRole` gate requires a REAL session to exist before onboarding can
 * do anything.
 */
export async function registerAndSignIn(
  fields: RegisterFields,
  signInFn: SignInFn,
  fetchImpl: FetchLike = fetch,
  registerFn: typeof registerAccount = registerAccount
): Promise<RegisterAndSignInOutcome> {
  const result = await registerFn(fields, fetchImpl);
  if (!result.ok) {
    return { outcome: 'error', catalogKey: registerErrorCatalogKey(result) };
  }

  const signInResult = await signInFn(fields.email, fields.password);
  if (!signInResult || signInResult.error || !signInResult.ok) {
    return { outcome: 'error', catalogKey: 'auth.registerSignInFailed' };
  }

  return { outcome: 'navigate' };
}
