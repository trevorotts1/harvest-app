# Harvest App — Deployment Readiness

**Generated:** 2026-04-28  
**Project:** The Harvest — 2 Hour CEO Business Agent  
**Path:** `prd-packages/harvest-app/`

## Current Status

| Check | Result |
|---|---|
| Framework | Next.js 14.2.35 + TypeScript + Prisma |
| Frontend demo | **PRESENT** — `/`, `/auth`, `/onboarding`, `/dashboard` |
| Demo APIs | **PRESENT** — mission briefing, contact import, contact pipeline, demo seed |
| Typecheck | **PASS** — `npm run typecheck` |
| Tests | **PASS** — 69 tests across 11 suites |
| Build | **PASS** — 25 app routes generated |
| Vercel CLI | Installed/authenticated on this machine when last checked |
| Vercel project | **LINKED + DEPLOYED** |
| Production demo URL | `https://harvest-app-inky.vercel.app` |

## Human Demo Path

Public demo URL:

- `https://harvest-app-inky.vercel.app`

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

Required for full database-backed behavior:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `JWT_SECRET`

Required only when enabling live integrations:

- `ANTHROPIC_API_KEY` (Claude-only AI agent layer — Haiku 4.5 / Sonnet 5 / Opus 4.8; see `.env.example`)
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

`npm run build` automatically runs `npm run verify:middleware` afterward (npm's `postbuild`
convention — see `scripts/verify-middleware.mjs`). This closes the T-04 CRITICAL defect class where
`middleware.ts` compiled and typechecked cleanly but silently failed to register with Next.js
(wrong location relative to `src/`), so the `/dashboard` auth gate never ran and an unauthenticated
request got `200 OK` instead of a redirect. Typecheck/lint/unit tests cannot catch this — it only
shows up in the compiled `.next/server/middleware-manifest.json` — so the guard runs post-build and
exits non-zero (failing the build, and therefore CI/deploy) if the manifest's `middleware` object is
empty or missing a `/dashboard` matcher. As of T-06, `.github/workflows/ci.yml` runs `npm run build`
(and the rest of the quality gates) on every push/PR, so this check runs automatically in CI; any
other pipeline invoking `npm run build` (or `vercel deploy`, which runs it) also inherits it. See
`docs/CI.md` for the full CI/CD picture, including the deferred Vercel deploy workflow. Run the
guard standalone with `npm run verify:middleware` (after a build) to check without rebuilding.

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

```text
npm run typecheck      PASS
npm test -- --runInBand --silent
  Test Suites: 11 passed, 11 total
  Tests:       69 passed, 69 total
npm run build          PASS
  Static/dynamic routes generated: 25
vercel deploy --yes    PASS
  Public URL: https://harvest-app-inky.vercel.app
Live route smoke test  PASS
  /, /auth, /onboarding, /dashboard, /api/contacts/pipeline, /api/mission-control/briefing returned 200
```
