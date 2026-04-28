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
| Vercel project | Needs project linkage before a hosted preview URL exists |

## Human Demo Path

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

- `OPENAI_API_KEY`
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
- [ ] Link/create Vercel project
- [ ] Add environment variables in Vercel dashboard if using database/live integrations
- [ ] Deploy preview from `main`

### Post-Deploy Verification

- [ ] Root URL loads without 404
- [ ] `/auth` loads and continues to onboarding
- [ ] `/onboarding` wizard advances to dashboard
- [ ] `/dashboard` displays Mission Control demo state
- [ ] `/api/mission-control/briefing` responds with `x-user-id` header
- [ ] `/api/contacts/pipeline` responds with demo pipeline data
- [ ] Vercel build logs show no errors

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
```
