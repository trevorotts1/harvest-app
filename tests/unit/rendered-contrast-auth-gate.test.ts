import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Regression test for `scripts/verify-rendered-contrast-auth.mjs` (T-R49) — the harness that closes
 * the ~40 auth-gated (target x viewport x theme) combinations `verify-rendered-contrast.mjs` itself
 * documents as SKIP (no seeded-test-session harness) by actually seeding a local Postgres, logging in
 * through the real `/auth` Credentials form, and re-running that script's own worst-case composited-
 * contrast measurement against the 9 §5 marquee auth-gated surfaces.
 *
 * WHY THIS TEST DOESN'T RUN THE FULL DB-BACKED HARNESS. Unlike `rendered-contrast-gate.test.ts`
 * (the PUBLIC gate, which needs nothing but a browser), the auth-gated harness needs a real local
 * Postgres — heavier and more environment-dependent than anything else `npm test` exercises today.
 * Wiring the full seed-DB-and-login run into the default suite would mean every future `npm test` in
 * every environment either (a) silently depends on a local Postgres nobody asked it to depend on, or
 * (b) is flaky/slow wherever one happens to be reachable but shaped differently. `npm run
 * verify:rendered-contrast:auth` is the explicit, opt-in way to run the real thing (see that script's
 * own header comment for the manual proof this build unit ran against a real seeded session).
 *
 * What THIS test locks in instead is the harness's own most safety-critical property: its HONEST
 * DEGRADATION contract. A future edit to this script must not turn "Postgres isn't reachable" into
 * either a false PASS (silently reporting 0 checked nodes as if everything passed) or a false FAIL
 * (treating missing infrastructure as an AA violation) — it must degrade into a loud, itemized SKIP
 * and exit 0. This is exercised for REAL (the actual script, actually spawned, actually attempting a
 * real `psql` connection) against a deliberately unreachable Postgres host (`TR49_SEED_PGHOST`
 * override below, a non-routable TCP-testnet address per RFC 5737/RFC 5735 conventions, with a short
 * `PGCONNECT_TIMEOUT` the script itself sets) — fast and fully deterministic, no real database
 * required, and no risk of accidentally hitting a real local instance a CI box happens to have.
 */
describe('Render-based WCAG AA contrast gate — auth-gated harness (T-R49)', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const scriptPath = path.join(repoRoot, 'scripts', 'verify-rendered-contrast-auth.mjs');

  it(
    'degrades honestly (itemized SKIP, exit 0) when no seed Postgres is reachable — never a false PASS or false FAIL',
    () => {
      let output = '';
      let threw = false;
      try {
        output = execFileSync('node', [scriptPath], {
          stdio: 'pipe',
          timeout: 30000,
          env: {
            ...process.env,
            // TEST-NET-1 (RFC 5737) — guaranteed non-routable, so the connection attempt fails fast
            // and deterministically rather than depending on this box's real ambient Postgres state.
            TR49_SEED_PGHOST: '192.0.2.1',
            TR49_SEED_PGPORT: '5432',
          },
        }).toString();
      } catch (err: any) {
        threw = true;
        output = (err?.stdout ?? '').toString() + (err?.stderr ?? '').toString();
      }

      // Honest degrade means the process must exit 0 — execFileSync must NOT throw.
      expect(threw).toBe(false);
      expect(output).toContain('HARNESS UNAVAILABLE');
      expect(output).toMatch(/\d+ combination\(s\) skipped \(harness unavailable\)/);
      // Never claim a real measurement happened when the harness itself never ran.
      expect(output).toContain('0 text node(s) checked');
      expect(output).not.toMatch(/\[PASS\]/);
      expect(output).not.toMatch(/\[FAIL\]/);
    },
    30000
  );
});
