/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // T-20: CSS-module imports in the O-1..O-9 onboarding components resolve to a class-name proxy
    // stub under Jest (there is no CSS pipeline in the node test env). `styles.foo` returns the
    // string `'foo'`, so class names stay visible in `renderToStaticMarkup` output for the
    // score-never-rendered / reveal / org-gate assertions. Must precede the `@/` mapper.
    '\\.(css|scss|sass)$': '<rootDir>/tests/styleMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Seeds a dummy CONTACT_HASH_PEPPER (T-03 QC fix, defect 3) so hmacForMatch() has a pepper to
  // key against during the suite — hmacForMatch() fails closed (throws) without one, and several
  // warm-market tests exercise contact import paths that call it.
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  // T-12: `otplib`'s dependency chain (`@otplib/plugin-base32-scure` → `@scure/base`, and
  // transitively `@otplib/plugin-crypto-noble` → `@noble/*`) ships pure-ESM-only packages (`"type":
  // "module"`, no CommonJS build) — Jest's default CJS test runtime can't `require()` them, and by
  // default Jest never transforms anything under node_modules at all, so without this override
  // every test that imports src/services/security/totp.ts (directly or transitively, e.g. via
  // src/lib/auth/mfa.ts) fails with "SyntaxError: Unexpected token 'export'" the moment it reaches
  // one of those packages. Un-ignoring just this dependency family (`transformIgnorePatterns`) and
  // routing plain `.js` through the same `ts-jest` transform already used for `.ts`/`.tsx` (tsconfig
  // already has `allowJs: true`) lets ts-jest compile their ESM syntax down to CommonJS like
  // everything else in the suite — the standard fix for a pure-ESM dependency under Jest's default
  // (non-ESM) mode, and lower-risk than switching the whole suite to Jest's experimental-VM-modules
  // ESM mode just for one dependency.
  transformIgnorePatterns: ['node_modules/(?!(otplib|@otplib|@scure|@noble)/)'],
  transform: {
    // T-20: override only `jsx` (to the automatic runtime) for the test compile, so the O-1..O-9
    // onboarding components (`src/app/onboarding/**/*.tsx`) can be server-rendered with
    // `react-dom/server`'s `renderToStaticMarkup` and their output scanned (the Seven Whys
    // "never renders a score" test, the Reveal safe-harbor/no-share test, the org-gate no-leak test).
    // The app itself is built by Next.js's own SWC pipeline (tsconfig's `jsx: preserve`) — this
    // override affects the Jest compile ONLY, and only files that actually contain JSX.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
    '^.+\\.jsx?$': ['ts-jest', {}],
  },
};