# The Harvest

**The 2 Hour CEO Business Agent** — the Downline Maxxing platform. The Harvest turns warm-market
relationship activity into a calm, compliance-gated daily command center: who to reach out to
today, what to say, and what needs a human's sign-off before it goes out.

- **Version:** `2.0.0-build.T-R54` (see `package.json`)
- **Production:** https://harvest-app-self.vercel.app

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Database / ORM | PostgreSQL via Prisma 5 |
| Auth | NextAuth v4 (`@next-auth/prisma-adapter`); code also reads `AUTH_SECRET` for forward-compat with Auth.js v5 |
| Background jobs / scheduling | Inngest |
| Payments | Stripe |
| SMS | Twilio |
| Mobile shell | Capacitor (config only — no native platforms added in this repo) |
| AI / LLM | Claude only (Anthropic API) — Haiku/Sonnet/Opus, no other model provider is referenced anywhere in the app |
| Testing | Jest + ts-jest, Playwright (installed for later browser-level checks) |

## Prerequisites

- Node.js 20 (see `.nvmrc`)
- npm
- A provisioned PostgreSQL database (Supabase, Railway, Neon, or self-hosted all work — `prisma/schema.prisma`'s `datasource` just needs a standard Postgres connection string)

## Setup

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in real values from your secrets manager — **never
commit real secrets**, only the placeholder names already in `.env.example`. At minimum for a
database-backed local run you need:

- `DATABASE_URL` — PostgreSQL connection string
- `NEXTAUTH_SECRET` / `AUTH_SECRET` — session/JWT signing secret (`openssl rand -base64 32`)
- `NEXTAUTH_URL` — e.g. `http://localhost:3000`
- `CONTACT_HASH_PEPPER`, `CONTACT_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`, `SOLUTION_NUMBER_ENCRYPTION_KEY`, `WHY_SESSION_ENCRYPTION_KEY` — all AES-256/HMAC keys that fail closed (throw) if unset; generate each with `openssl rand -base64 32`

Only needed when enabling the corresponding live integration:

- `ANTHROPIC_API_KEY` — Claude API key for the AI agent layer
- `AGNES_AI_API_KEY` — semantic compliance classifier (see Compliance below); fails closed (no network attempt, no bypass) when unset
- `CFE_VOCABULARY_MODE` — Compliance Filter Engine doctrine-vocabulary mode (`observe` default, or `block`)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` — billing
- `GHL_PIT`, `SMTP_HOST`, `SMTP_API_KEY` — email/CRM outreach delivery
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — SMS delivery
- `COMPLIANCE_WEBHOOK_URL` — optional external compliance audit sink

Then provision the schema against your database before first run:

```bash
npx prisma migrate deploy
```

```bash
npm run dev
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | `prisma generate && next build`, then the `postbuild` gate below |
| `npm start` | Start the built app (`next start`) |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Jest suite |
| `npm run test:watch` | Jest in watch mode |
| `npm run db:generate` | `prisma generate` |
| `npm run db:push` | `prisma db push` |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:studio` | `prisma studio` |

### `postbuild` — 11 quality gates run automatically after every build

`npm run build` always chains into `postbuild`, which runs 11 checks in sequence; any one
non-zero exit fails the build (and therefore CI/deploy):

1. `verify:middleware` — confirms `middleware.ts` actually registered with Next.js (catches the
   T-04 class of defect where middleware compiled/typechecked but silently never ran, so an
   unauthenticated request to `/dashboard` got `200` instead of a redirect)
2. `verify:api-auth`
3. `verify:contrast`
4. `guard:no-opacity-on-text`
5. `guard:migration-drift`
6. `guard:i18n`
7. `guard:no-literals-in-components`
8. `guard:touch-target` — enforces the 44px touch-target floor
9. `guard:status-live-region` — WCAG 4.1.3 "Status Messages"
10. `guard:rendered-i18n-leak`
11. `guard:server-i18n-leak`

Guards distinguish pre-existing, tracked exceptions (grandfathered via baseline JSON files, logged
as `WARN-EXEMPT`, non-failing) from *new* violations, which fail the build. See `docs/CI.md` for
the full CI/CD picture.

## Testing

```bash
npm test
```

Current suite (verified in this build unit):

```
Test Suites: 288 passed, 288 total
Tests:       4022 passed, 4022 total
```

## Compliance architecture

All outbound communication (messages, content, drafts) is gated by the **Compliance Filter Engine
(CFE)**, which is **fail-closed by design**: if a classifier is unavailable, errors, or returns an
out-of-contract result, the item is held — it never auto-clears and never falls back to sending
unreviewed. Two independent classifier layers back the engine:

- **Haiku** (Claude) — the baseline compliance classifier
- **Agnes** — a semantic classifier layer providing doctrine-vocabulary observability; missing/
  invalid `AGNES_AI_API_KEY` fails closed exactly like a Haiku failure, with no bypass path

`CFE_VOCABULARY_MODE` (`observe` default, or `block`) controls whether flagged doctrine vocabulary
is only recorded for audit or actively blocks — the underlying classification and audit trail are
identical either way. The Claude API is the only LLM provider referenced anywhere in this
codebase; no other model provider key is ever read or accepted.

## Deployment

- **Host:** Vercel, project `spaulding-4178s-projects/harvest-app`
- **Production URL:** https://harvest-app-self.vercel.app
- Production deploys are promoted from `main` only (see `.github/workflows/deploy.yml`, currently
  a deferred stub until the operator wires the three Vercel GitHub Actions secrets — see
  `docs/CI.md`).
- This repository (including `node_modules` after `npm install`) exceeds Vercel CLI's 15,000-file
  threshold for a plain directory upload. A manual `vercel deploy` from a local checkout needs
  `--archive=tgz` so the CLI bundles the project into a single tarball instead of enumerating
  every file individually.

## Project structure

```
src/
  app/            Next.js App Router — pages + API routes
    api/          ~124 route handlers (auth, billing, compliance-review, contacts, content,
                   data-rights, gamification, harvest-method, inngest, messaging,
                   mission-control, onboarding, session, settings, shift, stripe, taprooting,
                   team, ...)
    auth/, onboarding/, dashboard/, today/, shift/, inbox/, community/, content/, grow/,
    learn/, me/, team/, ritual/, design-tokens/     user-facing route groups
  services/       Domain logic — agent-runtime, compliance, gamification, harvest-method,
                   messaging, mission-control, onboarding, payment, security, social-content,
                   taprooting, team-calendar, warm-market, deliverability, learning-state
  lib/            Cross-cutting: auth, i18n, inngest client, native/offline helpers, prisma client
  types/          Shared TypeScript types/contracts
  middleware.ts   Auth/session gate
prisma/           schema.prisma + migrations
scripts/          postbuild guard/verify scripts (see Scripts above)
tests/            Jest test suites (alongside co-located *.test.ts files under src/)
docs/             CI.md, mobile-shell.md
```

For deployment history/readiness detail, see `README_DEPLOYMENT.md`.
