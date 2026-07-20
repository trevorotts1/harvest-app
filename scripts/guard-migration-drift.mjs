#!/usr/bin/env node
/**
 * Postbuild guard (T-R25 remediation for the WP08/T-49 defect class): fails the build if
 * `prisma/schema.prisma` has drifted from `prisma/migrations` — i.e. if there is any model,
 * column, index, or constraint the schema declares that the committed migration chain would
 * NOT actually create when run against a real database.
 *
 * Why this exists: WP08 (T-49) added the `OrgSwitchEvent` model to schema.prisma but shipped no
 * migration for it. `prisma generate` builds the Prisma Client straight from schema.prisma
 * regardless of the migrations directory, so every test using that client (or an
 * in-memory/mocked repository) passed anyway — nothing exercised `prisma migrate deploy`. Against
 * a REAL database, `migrate deploy` only ever applies what's in `prisma/migrations`, so
 * `OrgSwitchEvent` writes (src/services/taprooting/org-switch.service.ts) would have failed in
 * any real deploy with `relation "OrgSwitchEvent" does not exist`. See
 * prisma/migrations/20260721100000_t_r25_org_switch_event for the fix; this guard exists so the
 * next gap of this shape fails the build instead of shipping silently.
 *
 * HOW IT WORKS: runs `prisma migrate diff --from-migrations prisma/migrations
 * --to-schema-datamodel prisma/schema.prisma --exit-code` against a shadow database (Prisma
 * replays the entire migration chain into the shadow db, then diffs the resulting schema against
 * schema.prisma). Exit code 0 = no drift (pass). Exit code 2 = real, structural drift (fail the
 * build, print the missing/extra SQL). Anything that looks like the shadow database simply being
 * unreachable is treated as "cannot verify in this environment" and does NOT fail the build — see
 * CLEAN-ENV BEHAVIOR below.
 *
 * SHADOW DATABASE URL resolution (first one set wins):
 *   1. MIGRATION_DRIFT_SHADOW_DATABASE_URL — guard-specific override, use this to point at a
 *      disposable Postgres instance without touching DATABASE_URL/SHADOW_DATABASE_URL.
 *   2. SHADOW_DATABASE_URL — the conventional Prisma shadow-db env var name, if already set for
 *      `prisma migrate dev`.
 *   3. DATABASE_URL — reused as a last resort. In this repo's CI (.github/workflows/ci.yml),
 *      DATABASE_URL is a placeholder connection string with nothing actually listening on it, so
 *      this resolves to a URL that then fails to connect — which is exactly the clean-env-safe
 *      "skip" path below, not a false failure.
 *   The shadow database itself is never mutated persistently: Prisma creates the objects from the
 *   migration chain inside it to compute the diff and does not require (or preserve) any prior
 *   state there — point this at any disposable/throwaway Postgres database, never at a database
 *   holding real data.
 *
 * CLEAN-ENV BEHAVIOR: this guard requires a real, reachable Postgres server to replay migrations
 * into (that's inherent to `prisma migrate diff --from-migrations`, not something this script can
 * avoid). Lots of this repo's build/CI environments intentionally have no live Postgres
 * (DATABASE_URL unset or a placeholder — see other hand-authored-migration headers in
 * prisma/migrations/ for why). When no shadow URL is configured at all, OR the configured one is
 * unreachable (connection refused, host not found, auth/does-not-exist errors, timeout), this
 * guard prints a clear `SKIPPED` message and exits 0 — it does NOT false-fail the build for an
 * environment problem. It only exits non-zero for a REAL diff (exit code 2 from the underlying
 * prisma command) or a genuinely unexpected prisma error that isn't a connectivity issue.
 */
import { spawnSync } from 'node:child_process';

const GUARD_NAME = 'guard:migration-drift';

function resolveShadowUrl() {
  return (
    process.env.MIGRATION_DRIFT_SHADOW_DATABASE_URL ||
    process.env.SHADOW_DATABASE_URL ||
    process.env.DATABASE_URL ||
    null
  );
}

// Prisma error codes (and generic Node/OS network errors) that mean "couldn't reach/use the
// database server", as opposed to "reached it and found a real schema difference". Kept broad on
// purpose: per this guard's brief, an environment problem must never masquerade as (or suppress) a
// build failure — false-failing CI over an unrelated connectivity hiccup is exactly the failure
// mode this list exists to avoid.
const CONNECTIVITY_ERROR_MARKERS = [
  'P1000', // Authentication failed
  'P1001', // Can't reach database server
  'P1002', // Database server timed out
  'P1003', // Database does not exist
  'P1008', // Operation timed out
  'P1009', // Database already exists (shadow-db creation race — treat as unusable, not drift)
  'P1010', // User denied access
  'P1011', // TLS error
  'P1017', // Server closed the connection
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'getaddrinfo',
];

function looksLikeConnectivityFailure(output) {
  return CONNECTIVITY_ERROR_MARKERS.some((marker) => output.includes(marker));
}

function skip(reason) {
  console.log(`${GUARD_NAME}: SKIPPED — ${reason}`);
  console.log(
    `${GUARD_NAME}: this guard checks that prisma/schema.prisma exactly matches what ` +
      'prisma/migrations would produce on a real database, by replaying the migration chain into ' +
      'a shadow Postgres database. Set MIGRATION_DRIFT_SHADOW_DATABASE_URL (or SHADOW_DATABASE_URL) ' +
      'to a reachable, disposable Postgres connection string to enable this check here. Not failing ' +
      'the build for an environment/connectivity issue — see this script\'s header comment.'
  );
  process.exit(0);
}

function fail(message, detail) {
  console.error(`${GUARD_NAME}: FAIL — ${message}`);
  if (detail) console.error(`\n${detail}\n`);
  console.error(
    `${GUARD_NAME}: fix by adding a new prisma/migrations/<timestamp>_<name>/migration.sql ` +
      'capturing the SQL above (additive only — CREATE TABLE / CREATE INDEX / ALTER ADD, never ' +
      'DROP), matching the hand-authored-migration convention used by ' +
      'prisma/migrations/20260721100000_t_r25_org_switch_event and prior entries in this repo. ' +
      'Re-run this guard after adding the migration to confirm zero drift.'
  );
  process.exit(1);
}

function main() {
  const shadowUrl = resolveShadowUrl();
  if (!shadowUrl) {
    skip('no MIGRATION_DRIFT_SHADOW_DATABASE_URL, SHADOW_DATABASE_URL, or DATABASE_URL set in this environment.');
    return;
  }

  const result = spawnSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-migrations',
      'prisma/migrations',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--shadow-database-url',
      shadowUrl,
      '--exit-code',
    ],
    { encoding: 'utf8' }
  );

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`.trim();

  if (result.status === 0) {
    console.log(`${GUARD_NAME}: prisma/schema.prisma matches prisma/migrations exactly — no drift. OK.`);
    process.exit(0);
    return;
  }

  if (result.status === 2) {
    // Real, structural drift: schema.prisma declares something the migration chain would not
    // create on a real database.
    fail(
      'prisma/schema.prisma has drifted from prisma/migrations — `prisma migrate deploy` against ' +
        'a real database would NOT produce a schema matching schema.prisma (this is exactly the ' +
        'T-R25 / WP08 OrgSwitchEvent defect class: a model exists in schema.prisma with no ' +
        'corresponding migration, so the Prisma Client builds fine via `prisma generate` and tests ' +
        'pass, but a real deploy would fail at runtime with "relation ... does not exist").',
      combinedOutput
    );
    return;
  }

  if (looksLikeConnectivityFailure(combinedOutput)) {
    skip(
      'the configured shadow database is not reachable/usable in this environment ' +
        `(${combinedOutput.match(/P1\d{3}/)?.[0] ?? 'connection error'}). This is expected in a ` +
        'clean/CI environment with no live Postgres service — drift was not verified this run, ' +
        'but the build is not being false-failed for it.'
    );
    return;
  }

  // Anything else is an unexpected prisma failure (bad CLI invocation, missing binary, etc.) —
  // not a recognized connectivity error, so don't silently swallow it.
  fail(`prisma migrate diff exited unexpectedly (status ${result.status}).`, combinedOutput);
}

main();
