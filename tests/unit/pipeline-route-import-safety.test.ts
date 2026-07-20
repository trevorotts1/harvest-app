// T-R10 build-safety regression guard (mirrors tests/unit/contact-flags-route-import-safety.test.ts,
// which itself mirrors tests/unit/harvest-method-route-import-safety.test.ts — the T-26
// build-integration fix this charter names as "learned from T-26").
//
// `next build`'s page-data collection step imports every route module to discover its exports, with
// no request in flight and no secrets set. Before T-R10, `/api/contacts/pipeline/route.ts` returned
// hardcoded demo contacts and never touched `CONTACT_ENCRYPTION_KEY` at all; now it constructs a REAL
// `PipelineService` (which reads that key via `getContactEncryptionKey()`) — but only INSIDE the GET
// handler, never at module scope, precisely so import alone can never throw. This is a plain,
// unmocked `require()` of the REAL route module (unlike pipeline-route.test.ts, which mocks
// `@/services/warm-market/pipeline.service` to exercise the handler's auth wiring) so a regression
// back to module-scope construction would actually be caught here.
describe('contacts/pipeline route module imports safely with no env vars set (T-R10)', () => {
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
    expect(() => require('@/app/api/contacts/pipeline/route')).not.toThrow();
  });

  it('the exported GET handler is a function (the module surface next build discovers)', () => {
    const mod = require('@/app/api/contacts/pipeline/route');
    expect(typeof mod.GET).toBe('function');
  });
});
