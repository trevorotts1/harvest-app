// T-33 build-safety regression guard (mirrors tests/unit/contact-flags-route-import-safety.test.ts /
// tests/unit/harvest-method-route-import-safety.test.ts, the T-26 build-integration fix this charter
// names as "learned from T-26").
//
// `next build`'s page-data collection step imports every route module with no request in flight and
// no secrets set. Every T-33 route constructs its service (and, for the edit route, the
// ComplianceFilterEngine buried inside ApprovalInboxService's default) INSIDE the handler, never at
// module scope, precisely so import alone can never throw. These are plain, unmocked `require()`s of
// the REAL route modules (unlike the other T-33 route tests, which mock `@/lib/prisma` to exercise
// auth wiring) so a regression back to module-scope construction would actually be caught here.
describe('T-33 approval-inbox / activity-ledger / contact-controls routes import safely with no env vars set', () => {
  const originalKeys: Record<string, string | undefined> = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    CONTACT_ENCRYPTION_KEY: process.env.CONTACT_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.CONTACT_ENCRYPTION_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalKeys)) {
      if (value !== undefined) process.env[key] = value;
    }
    jest.resetModules();
  });

  const routeModules = [
    ['@/app/api/approval-inbox/route', 'GET'],
    ['@/app/api/approval-inbox/approve/route', 'POST'],
    ['@/app/api/approval-inbox/decline/route', 'POST'],
    ['@/app/api/approval-inbox/edit/route', 'POST'],
    ['@/app/api/activity-ledger/route', 'GET'],
    ['@/app/api/contacts/controls/route', 'PATCH'],
  ] as const;

  test.each(routeModules)('%s imports (module-scope evaluation) without throwing, with no env vars set', (modPath) => {
    expect(() => require(modPath)).not.toThrow();
  });

  test.each(routeModules)('%s exports the %s handler as a function (the surface next build discovers)', (modPath, exportName) => {
    const mod = require(modPath);
    expect(typeof mod[exportName]).toBe('function');
  });
});
