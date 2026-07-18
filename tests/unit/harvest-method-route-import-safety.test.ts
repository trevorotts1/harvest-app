// T-26 QC build-integration regression guard.
//
// The QC blocker: all 7 `src/app/api/harvest-method/*/route.ts` files used to construct their
// service (`new PrioritizedQueueService()` / `new MethodStateService()`) at MODULE SCOPE — a
// top-level `const service = new XService();` outside any request handler. Both constructors take
// `encryptionKey` as a DEFAULT PARAMETER (`encryptionKey: string = getContactEncryptionKey()`),
// which fail-closed THROWS when `CONTACT_ENCRYPTION_KEY` is unset (§7.1/§16.4, the WP02 critical
// failure "unencrypted PII"). A default parameter only evaluates when the constructor actually
// runs — so constructing at module scope meant the throw fired the instant the route MODULE was
// imported, not when a request was served.
//
// `next build`'s page-data collection step imports every route module to discover its exports,
// with no request in flight and (in CI's `ci.yml`) no `CONTACT_ENCRYPTION_KEY` set — so the build
// itself failed with "Error: CONTACT_ENCRYPTION_KEY is not set", before a single request was ever
// served. The fix moved construction INSIDE each handler (matching the existing lazy-construction
// convention already used by `src/app/api/contacts/import/route.ts` and
// `src/app/api/contacts/agent-queue/route.ts`) — so the key is only read when a real request
// actually reaches the handler.
//
// This test proves the regression can't recur silently: every fixed route module must be
// IMPORTABLE with `CONTACT_ENCRYPTION_KEY` unset (mirroring exactly what `next build`'s page-data
// collection does), while the underlying service constructors must STILL fail closed at
// construction time — the point of the fix is WHERE the key is read, never whether it's enforced.
describe('harvest-method route modules import safely without CONTACT_ENCRYPTION_KEY (T-26)', () => {
  const routeModulePaths = [
    '@/app/api/harvest-method/action-complete/route',
    '@/app/api/harvest-method/action-queue/route',
    '@/app/api/harvest-method/background-matching/route',
    '@/app/api/harvest-method/blank-canvas/route',
    '@/app/api/harvest-method/prioritized-queue/route',
    '@/app/api/harvest-method/qualities-flip/route',
    '@/app/api/harvest-method/state/route',
  ];

  const originalKey = process.env.CONTACT_ENCRYPTION_KEY;

  beforeEach(() => {
    delete process.env.CONTACT_ENCRYPTION_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    process.env.CONTACT_ENCRYPTION_KEY = originalKey;
    jest.resetModules();
  });

  it.each(routeModulePaths)(
    '%s imports (module-scope evaluation) without throwing when CONTACT_ENCRYPTION_KEY is unset',
    (modulePath) => {
      expect(() => require(modulePath)).not.toThrow();
    }
  );

  it('sanity check: this is not vacuous — the constructors still fail closed when actually constructed without the key', () => {
    // Proves the test above is meaningful: it is the TIMING of the key read that moved (module
    // scope → in-handler), not the fail-closed guarantee itself. If this assertion ever stops
    // throwing, `getContactEncryptionKey()`'s fail-closed behavior has regressed independently of
    // T-26's build-integration fix.
    const { PrioritizedQueueService } = require('@/services/harvest-method/prioritized-queue.service');
    const { MethodStateService } = require('@/services/harvest-method/method-state.service');
    expect(() => new PrioritizedQueueService()).toThrow(/CONTACT_ENCRYPTION_KEY is not set/);
    expect(() => new MethodStateService()).toThrow(/CONTACT_ENCRYPTION_KEY is not set/);
  });
});
