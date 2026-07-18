// T-28 build-safety regression guard (mirrors tests/unit/harvest-method-route-import-safety.test.ts,
// the T-26 build-integration fix this charter names as "learned from T-26").
//
// `next build`'s page-data collection step imports every route module to discover its exports, with
// no request in flight and no secrets set. `/api/contacts/flags/route.ts` constructs
// `ContactFlagsService` INSIDE the PATCH handler (never at module scope) precisely so that import
// alone can never throw — this is a plain, unmocked `require()` of the REAL route module (unlike
// contact-flags.test.ts, which mocks `@/lib/prisma` to exercise the handler's auth wiring) so a
// regression back to module-scope construction would actually be caught here.
describe('contacts/flags route module imports safely with no env vars set (T-28)', () => {
  const originalContactKey = process.env.CONTACT_ENCRYPTION_KEY;
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.CONTACT_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.CONTACT_ENCRYPTION_KEY = originalContactKey;
    process.env.DATABASE_URL = originalDbUrl;
    jest.resetModules();
  });

  it('imports (module-scope evaluation) without throwing when no env vars are set', () => {
    expect(() => require('@/app/api/contacts/flags/route')).not.toThrow();
  });

  it('the exported PATCH handler is a function (the module surface next build discovers)', () => {
    const mod = require('@/app/api/contacts/flags/route');
    expect(typeof mod.PATCH).toBe('function');
  });
});
