import { assertAuthSecretConfigured } from '../../src/lib/auth/env';

/**
 * Unit coverage for the T-04 QC fix, defect 2: `assertAuthSecretConfigured()` must fail loudly at
 * request time when `NEXTAUTH_SECRET`/`AUTH_SECRET` is missing in production, but must be a no-op
 * everywhere else (dev/test/CI, and in production once a secret is present) — including with no
 * secret set at all, since that's exactly the env a `next build`/`npm test` run has and it must
 * never break those. See src/lib/auth/env.ts and the callers in src/lib/auth/session.ts and
 * src/app/api/auth/[...nextauth]/route.ts for why this is gated on NODE_ENV rather than checked at
 * module import/build time.
 */

// Next.js's own global type augmentation (node_modules/next/types/global.d.ts) declares
// `ProcessEnv.NODE_ENV` `readonly`, so a plain `process.env.NODE_ENV = ...` doesn't typecheck here
// even though it works fine at runtime. `setEnv` routes through an untyped view instead of
// weakening that (correct, load-bearing elsewhere) declaration. It always reads `process.env`
// live at call time — rather than caching a reference — so it keeps working regardless of
// whether anything elsewhere replaces the whole `process.env` object between calls.
function setEnv(key: string, value: string | undefined): void {
  const env = process.env as unknown as Record<string, string | undefined>;
  if (value === undefined) {
    delete env[key];
  } else {
    env[key] = value;
  }
}

describe('assertAuthSecretConfigured', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
  const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

  afterEach(() => {
    setEnv('NODE_ENV', ORIGINAL_NODE_ENV);
    setEnv('NEXTAUTH_SECRET', ORIGINAL_NEXTAUTH_SECRET);
    setEnv('AUTH_SECRET', ORIGINAL_AUTH_SECRET);
  });

  test('is a no-op outside production, even with no secret set', () => {
    setEnv('NODE_ENV', 'test');
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('AUTH_SECRET', undefined);

    expect(() => assertAuthSecretConfigured()).not.toThrow();
  });

  test('is a no-op in production when NEXTAUTH_SECRET is set', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NEXTAUTH_SECRET', 'unit-test-secret-value');
    setEnv('AUTH_SECRET', undefined);

    expect(() => assertAuthSecretConfigured()).not.toThrow();
  });

  test('is a no-op in production when only AUTH_SECRET (the v5-name fallback) is set', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('AUTH_SECRET', 'unit-test-secret-value');

    expect(() => assertAuthSecretConfigured()).not.toThrow();
  });

  test('throws a clear, descriptive fatal error in production with no secret set', () => {
    setEnv('NODE_ENV', 'production');
    setEnv('NEXTAUTH_SECRET', undefined);
    setEnv('AUTH_SECRET', undefined);

    expect(() => assertAuthSecretConfigured()).toThrow(/NEXTAUTH_SECRET/);
    expect(() => assertAuthSecretConfigured()).toThrow(/production/i);
  });
});
