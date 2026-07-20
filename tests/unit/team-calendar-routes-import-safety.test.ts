// T-45 (WP09, build-safety regression guard — mirrors tests/unit/contact-flags-route-import-safety
// .test.ts / harvest-method-route-import-safety.test.ts) — every new `/api/team/**` route module
// must import (module-scope evaluation) without throwing when NO env vars are set, proving nothing
// in this WP's route layer reads a secret or constructs a client at module scope (§0.4 lazy
// instantiation). This is a plain, unmocked `require()` of the REAL route modules.

const ROUTE_MODULES = [
  '@/app/api/team/dashboard/route',
  '@/app/api/team/rep/[userId]/route',
  '@/app/api/team/calendar/route',
  '@/app/api/team/calendar-link/route',
  '@/app/api/team/cockpit/route',
  '@/app/api/team/enterprise/route',
  '@/app/api/team/enterprise/seats/route',
  '@/app/api/team/enterprise/narrative/route',
  '@/app/api/team/appointments/propose/route',
  '@/app/api/team/appointments/[id]/decline/route',
  '@/app/api/team/appointments/[id]/outcome/route',
  '@/app/api/team/coaching-sessions/propose/route',
  '@/app/api/team/coaching-sessions/[id]/respond/route',
];

describe('WP09 /api/team/** route modules import safely with no env vars set (T-45)', () => {
  const envVarsToClear = [
    'CONTACT_ENCRYPTION_KEY',
    'DATABASE_URL',
    'ANTHROPIC_API_KEY',
    'GOOGLE_CALENDAR_CLIENT_ID',
    'GOOGLE_CALENDAR_CLIENT_SECRET',
    'CALENDAR_TOKEN_ENCRYPTION_KEY',
    'NEXTAUTH_SECRET',
    'AUTH_SECRET',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envVarsToClear) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    jest.resetModules();
  });

  afterEach(() => {
    for (const key of envVarsToClear) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    jest.resetModules();
  });

  test.each(ROUTE_MODULES)('%s imports without throwing when no env vars are set', (modulePath) => {
    expect(() => require(modulePath)).not.toThrow();
  });

  test.each(ROUTE_MODULES)('%s exports at least one HTTP method handler function', (modulePath) => {
    const mod = require(modulePath);
    const hasHandler = ['GET', 'POST', 'PATCH', 'DELETE'].some((m) => typeof mod[m] === 'function');
    expect(hasHandler).toBe(true);
  });
});
