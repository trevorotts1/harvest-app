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
};