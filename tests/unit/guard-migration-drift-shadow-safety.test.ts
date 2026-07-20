import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * T-R25R regression test — proves the destructive-shadow-DB defect that got T-R25's original
 * guard rejected cannot reappear: `guard-migration-drift.mjs`'s shadow-URL resolution must NEVER
 * resolve to `process.env.DATABASE_URL`, under any of the ways DATABASE_URL might be the only
 * (or an accidentally-matching) DB var set in the environment.
 *
 * All three cases here are exercised via this guard's own SKIP paths, which by design never touch
 * a live database (see the script's CLEAN-ENV BEHAVIOR header comment) — so this suite needs no
 * Postgres server and is safe to run in this repo's default test/CI environment. The destructive
 * `prisma migrate diff` real-drift / no-drift paths (exit 1 with missing SQL / exit 0 clean) were
 * verified against a disposable, throwaway Postgres instance as part of the T-R25R fix — not
 * repeated here since they require a live shadow database this suite intentionally does not spin
 * up.
 */
describe('guard:migration-drift — shadow DB resolution never falls back to DATABASE_URL (T-R25R)', () => {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'guard-migration-drift.mjs');

  function run(overrides: Record<string, string | undefined>): { status: number; output: string } {
    const fullEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...overrides })) {
      if (value !== undefined) fullEnv[key] = value;
    }
    try {
      const stdout = execFileSync('node', [scriptPath], {
        encoding: 'utf8',
        env: fullEnv as NodeJS.ProcessEnv,
      });
      return { status: 0, output: stdout };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? 1, output: `${e.stdout || ''}\n${e.stderr || ''}` };
    }
  }

  it('no shadow var and no DATABASE_URL at all — SKIPs cleanly, exit 0', () => {
    const { status, output } = run({
      MIGRATION_DRIFT_SHADOW_DATABASE_URL: undefined,
      SHADOW_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
    });
    expect(status).toBe(0);
    expect(output).toMatch(/SKIPPED/);
  });

  it('ONLY DATABASE_URL set (the T-R25 defect scenario) — SKIPs, exit 0, and says it never falls back to DATABASE_URL', () => {
    const { status, output } = run({
      MIGRATION_DRIFT_SHADOW_DATABASE_URL: undefined,
      SHADOW_DATABASE_URL: undefined,
      DATABASE_URL: 'postgresql://user:pw@127.0.0.1:59999/would_be_wiped_if_ever_used_as_shadow',
    });
    expect(status).toBe(0);
    expect(output).toMatch(/SKIPPED/);
    expect(output).toMatch(/never falls back to DATABASE_URL/);
  });

  it('SHADOW_DATABASE_URL set identical to DATABASE_URL — refuses via defense-in-depth check, exit 0', () => {
    const sameUrl = 'postgresql://user:pw@127.0.0.1:59999/same_db_would_be_wiped';
    const { status, output } = run({
      MIGRATION_DRIFT_SHADOW_DATABASE_URL: undefined,
      SHADOW_DATABASE_URL: sameUrl,
      DATABASE_URL: sameUrl,
    });
    expect(status).toBe(0);
    expect(output).toMatch(/SKIPPED/);
    expect(output).toMatch(/identical to DATABASE_URL/);
  });
});
