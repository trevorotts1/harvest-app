# Harvest App — Deployment Readiness

**Generated:** 2026-04-28 · **Refreshed:** 2026-07-26 (T-R53)
**Project:** The Harvest — 2 Hour CEO Business Agent
**Path:** `prd-packages/harvest-app/`

> For tech stack, setup, env vars by name, scripts, testing, and compliance architecture, see the
> top-level `README.md`. This file covers deployment-specific readiness/history only.

## Current Status

| Check | Result |
|---|---|
| Framework | Next.js 14 + TypeScript + Prisma 5 |
| Frontend demo | **PRESENT** — `/`, `/auth`, `/onboarding`, `/dashboard` |
| Demo APIs | **PRESENT** — mission briefing, contact import, contact pipeline, demo seed |
| Typecheck | **PASS** — `npm run typecheck` |
| Tests | **PASS** — 4022 tests across 288 suites |
| Build | **PASS** — 173 app routes generated (incl. ~124 API routes), 11 postbuild guards green |
| Vercel CLI | Installed/authenticated on this machine when last checked |
| Vercel project | **LINKED + DEPLOYED** (`spaulding-4178s-projects/harvest-app`) |
| Production demo URL | `https://harvest-app-self.vercel.app` |

## Human Demo Path

Public demo URL:

- `https://harvest-app-self.vercel.app`

Local demo path after install/build:

```bash
npm install
npm run dev
```

Then open:

- `http://localhost:3000/` — landing page
- `http://localhost:3000/auth` — mock login/register
- `http://localhost:3000/onboarding` — clickable onboarding wizard
- `http://localhost:3000/dashboard` — Mission Control dashboard

The UI is intentionally demo-safe: no real SMS, email, payment, or external delivery side effects happen from the demo screens.

## Required Environment Variables

Copy `.env.example` to `.env.local` for local development and configure matching Vercel environment variables for hosted preview/production.

Minimum for static demo preview:

- No secret is required for the static frontend pages.

Required for full database-backed behavior (fail closed — see `.env.example` and `README.md` for
the complete, authoritative list and generation commands):

- `DATABASE_URL`
- `NEXTAUTH_SECRET` / `AUTH_SECRET`
- `NEXTAUTH_URL`
- `CONTACT_HASH_PEPPER`, `CONTACT_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`,
  `SOLUTION_NUMBER_ENCRYPTION_KEY`, `WHY_SESSION_ENCRYPTION_KEY`

Required only when enabling live integrations:

- `ANTHROPIC_API_KEY` (Claude-only AI agent layer — Haiku 4.5 / Sonnet 5 / Opus 4.8; see `.env.example`)
- `AGNES_AI_API_KEY` (semantic compliance classifier — fails closed if unset, see `README.md`)
- `CFE_VOCABULARY_MODE` (`observe` default, or `block`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`
- `GHL_PIT`
- `SMTP_HOST`
- `SMTP_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `COMPLIANCE_WEBHOOK_URL`

## Deployment Checklist

### Pre-Deploy

- [x] Root page exists at `src/app/page.tsx`
- [x] Root layout exists at `src/app/layout.tsx`
- [x] Demo auth/onboarding/dashboard pages exist
- [x] Demo-safe API fallbacks exist
- [x] `.env.example` exists with non-secret placeholders
- [x] Link/create Vercel project
- [x] Deploy production demo URL
- [ ] Add environment variables in Vercel dashboard if using database/live integrations

### Post-Deploy Verification

- [x] Root URL loads without 404
- [x] `/auth` loads
- [x] `/onboarding` loads
- [x] `/dashboard` displays Mission Control demo state
- [x] `/api/mission-control/briefing` responds with `x-user-id` header
- [x] `/api/contacts/pipeline` responds with demo pipeline data
- [x] Vercel deployment completed

## Build Flow / CI Gate

`npm run build` automatically chains into `npm run postbuild` (npm's `postbuild` convention),
which as of this refresh runs **11** guards in sequence — `verify:middleware`, `verify:api-auth`,
`verify:contrast`, and 8 `guard:*` checks (i18n, touch-target, status-live-region, migration-drift,
etc.); see `README.md`'s Scripts section for the full, current list. The original and still-first
guard, `verify:middleware` (see `scripts/verify-middleware.mjs`), closes the T-04 CRITICAL defect
class where `middleware.ts` compiled and typechecked cleanly but silently failed to register with
Next.js (wrong location relative to `src/`), so the `/dashboard` auth gate never ran and an
unauthenticated request got `200 OK` instead of a redirect. Typecheck/lint/unit tests cannot catch
this — it only shows up in the compiled `.next/server/middleware-manifest.json` — so the guard runs
post-build and exits non-zero (failing the build, and therefore CI/deploy) if the manifest's
`middleware` object is empty or missing a `/dashboard` matcher. As of T-06, `.github/workflows/ci.yml`
runs `npm run build` (and the rest of the quality gates) on every push/PR, so all 11 checks run
automatically in CI; any other pipeline invoking `npm run build` (or `vercel deploy`, which runs it)
also inherits them. See `docs/CI.md` for the full CI/CD picture, including the deferred Vercel
deploy workflow. Run any guard standalone (e.g. `npm run verify:middleware`) after a build to check
without rebuilding.

## PWA / Mobile Shell (T-58a)

Added: a web app manifest (`src/app/manifest.ts`), favicon/apple-touch-icon (`src/app/icon.svg`,
`src/app/apple-icon.png`), placeholder PWA icons (`public/icons/`), an offline app-shell service
worker scoped to static-shell-only caching (`public/sw.js` — never intercepts `/api/*`, `/auth`,
or `/_next/`), an offline fallback page (`public/offline.html`), a `vercel.json` (headers only; no
`crons` — Inngest owns all scheduling, see `src/app/api/inngest/route.ts`), and a Capacitor config
(`capacitor.config.ts` — config only, no native platforms added, no native toolchain in this build
environment). Full detail, the icon-placeholder flag, and the native-platform-add steps for an
operator: `docs/mobile-shell.md`.

## Safety Notes

- Demo APIs are explicit fallback/demo routes.
- They do not send outbound messages.
- They do not charge payments.
- Mission Control and contact data remain safe placeholders until database-backed state is wired.
- Compliance behavior preserves fail-closed language and safe-harbor disclaimers.

## Latest Verification

Local quality gates, re-verified during the T-R53 doc refresh (2026-07-26):

```text
npm run lint            PASS  (next lint — no warnings/errors)
npm run typecheck       PASS  (tsc --noEmit)
npm test -- --maxWorkers=2
  Test Suites: 288 passed, 288 total
  Tests:       4022 passed, 4022 total
npm run build           PASS
  App routes generated: 173 (incl. ~124 API routes)
  postbuild: all 11 guards green
```

Production URL checked live during this refresh:

```text
GET https://harvest-app-self.vercel.app   200
```

This unit did not perform a deploy (out of scope — see repo build-unit doctrine); the above is a
local build/test verification plus a liveness check of the already-deployed production URL, not a
fresh route-by-route smoke test or a new `vercel deploy`. For the full historical deploy/smoke-test
record predating this refresh, see git history for this file.

### Manual `vercel deploy` note

The local project directory (this repo plus `node_modules` after `npm install`) exceeds 15,000
files, past the threshold where the Vercel CLI needs `--archive=tgz` to bundle the upload into a
single tarball instead of enumerating every file individually, e.g.:

```bash
vercel deploy --prod --archive=tgz
```

(The CI deploy workflow, `.github/workflows/deploy.yml`, instead uses `vercel build` +
`vercel deploy --prebuilt`, which uploads only the built output.)
