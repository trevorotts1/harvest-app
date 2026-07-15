# CI/CD (T-06)

## Quality-gate workflow (`.github/workflows/ci.yml`)

Runs on every push to `main` / `build/**` and every pull request into `main`:

1. `npm ci`
2. `npx prisma generate`
3. `npm run typecheck`
4. `npm run lint`
5. `npm test`
6. `npm run build` — which runs the `postbuild` guards `verify:middleware` and `verify:api-auth`
   (added in T-04) as part of the same step; a failed guard fails the build and therefore the job.
7. `actionlint` against every file in `.github/workflows/` — catches workflow defects (such as
   referencing the `secrets` context in a job-level `if:`, which GitHub Actions rejects) at CI
   time instead of only discovering them on push to `main`.

Any step failing fails the job. No live secret is used: `DATABASE_URL` is set at the job level to a
placeholder connection string (not a credential) because `prisma generate` needs the env var
present to validate the schema's datasource block; `CONTACT_HASH_PEPPER` for tests is seeded by
`tests/jest.setup.ts` with a committed dummy value and needs no CI env var. Real secrets
(`DATABASE_URL`, `NEXTAUTH_SECRET`, `STRIPE_*`, `TWILIO_*`, Vercel tokens, etc.) live only in GitHub
Actions secrets and Vercel project environment variables, and are wired in starting at T-02.

## Deploy workflow (`.github/workflows/deploy.yml`) — deferred stub

Present but inert until the operator adds three GitHub Actions repo secrets: `VERCEL_TOKEN`,
`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (T-02/T-60). GitHub Actions does not allow the `secrets`
context inside a job-level `if:` condition, so the guard is implemented as a preliminary `gate`
job that reads the three secrets via `env:` (where `secrets` is allowed) and emits a `deployable`
output; the `deploy` job then runs `needs: [gate]` with `if: needs.gate.outputs.deployable ==
'true'`. While any of the three secrets is unset, `gate` emits `deployable=false` and GitHub
Actions marks the `deploy` job **skipped**, not failed — this file never breaks the pipeline in
the meantime. Once all three secrets exist, the gate flips on automatically with no file edit
required, and production promotion runs from `main` per master spec §2.2 (Vercel hosting; preview
deploys on PRs are a follow-on once the Vercel project is linked).

## Per-unit ledger snapshot convention (master spec §19.4)

`ledgers/` holds synced snapshots of the live build-state files: `harvest-LEDGER.md`,
`harvest-SESSION-LOG.md`, `harvest-todo.md`. Per §19.4, the authoritative live copies are
maintained by the operator in `~/Downloads`; after each build unit completes, the merge-writer
refreshes and commits the matching snapshot under `ledgers/` in this repo so any resumption or
audit can reconstruct build state from the repo alone. CI does not write to `ledgers/` — it only
validates that the application installs, typechecks, lints, tests, and builds green on the commit
that carries a given snapshot.
