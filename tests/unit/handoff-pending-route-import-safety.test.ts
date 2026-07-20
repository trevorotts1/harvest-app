// T-R22 build-safety regression guard (mirrors tests/unit/pipeline-route-import-safety.test.ts /
// tests/unit/contact-flags-route-import-safety.test.ts — the T-26-derived convention every new
// prisma-touching route follows). `next build`'s page-data collection imports every route module
// with no request in flight and no secrets set; this route constructs `ThreeWayHandoffService`
// and reads `prisma.user` only INSIDE the GET handler (never at module scope), so import alone must
// never throw even with a fully clean env.
describe('messaging/handoff/pending route module imports safely with no env vars set (T-R22)', () => {
  const originalDbUrl = process.env.DATABASE_URL;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalDbUrl;
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    jest.resetModules();
  });

  it('imports (module-scope evaluation) without throwing when no env vars are set', () => {
    expect(() => require('@/app/api/messaging/handoff/pending/route')).not.toThrow();
  });

  it('the exported GET handler is a function (the module surface next build discovers)', () => {
    const mod = require('@/app/api/messaging/handoff/pending/route');
    expect(typeof mod.GET).toBe('function');
  });
});
