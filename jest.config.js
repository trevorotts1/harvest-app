/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
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
    '^.+\\.tsx?$': ['ts-jest', {}],
    '^.+\\.jsx?$': ['ts-jest', {}],
  },
};