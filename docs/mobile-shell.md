# Mobile / PWA shell (T-58a)

This build unit added the **deploy + mobile/PWA shell infrastructure spine** only — an additive
config layer. It does not touch feature UI, i18n copy, CFE logic, or auth, and it does not attempt
any native compilation (no Xcode/Android Studio toolchain is available in this build environment).

## What's implemented

| Piece | File(s) | Status |
|---|---|---|
| Web App Manifest | `src/app/manifest.ts` | Implemented (App-Router file convention — no `layout.tsx` edit) |
| Favicon | `src/app/icon.svg` | Implemented (App-Router file convention) |
| Apple touch icon | `src/app/apple-icon.png` | Implemented (App-Router file convention) |
| PWA icons | `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | Implemented — **placeholders, see below** |
| Offline app-shell service worker | `public/sw.js` | Implemented — static shell + offline fallback only |
| Offline fallback page | `public/offline.html` | Implemented |
| SW registration | `src/app/template.tsx` | Implemented (App-Router file convention — no `layout.tsx` edit) |
| Vercel deploy config | `vercel.json` | Implemented (headers only — see below) |
| Capacitor config | `capacitor.config.ts` | Implemented — **config only, no native platforms added** |

## Icon assets — placeholder, operator action required

No brand icon assets existed anywhere in this repo before this unit. `scripts/generate-pwa-icons.mjs`
rasterizes the app's **already-existing** `.brand-mark` treatment (`src/app/globals.css` — a
rounded square, `linear-gradient(135deg, var(--leaf), var(--harvest))`, a bold "H"; the same mark
already rendered live on `/`, `/auth`, and every `/team/*` page) at the sizes the manifest / Apple
touch icon / favicon conventions need. **These are placeholders, not final brand art.** Before any
App Store / Play Store submission, an operator/designer must supply real icon assets — ideally
from a vector source, with deliberately composed (not rasterized-and-hoped) maskable safe-zone
art. Re-run `node scripts/generate-pwa-icons.mjs` after editing that script if you want to iterate
on the placeholder in the meantime; it is not wired into any npm script or postbuild guard.

## Offline app-shell service worker — cache scope

`public/sw.js` precaches **only** `public/offline.html` + the two icon files the manifest
references. Its `fetch` handler:

- Passes `/api/*`, `/auth*`, and `/_next/*` straight to the network with **zero interception** —
  no cache read, no cache write, no fallback substitution. This is the compliance-critical
  boundary: every CFE decision and every dynamic/per-user response in this app flows through
  `/api/**`, so bypassing that prefix entirely also transitively excludes every CFE-adjacent path
  — there is no separate non-`/api` surface serving live CFE state.
- For navigations, tries the network first and falls back to the static offline page **only** on
  total network failure — it never caches or replays a stale dynamic page.
- For everything else same-origin (icons, the manifest file, etc.), cache-first with a network
  fallback.

This intentionally does **not** duplicate the richer "briefing/queue/approvals read from cache,
queue-and-sync with CFE re-validation on reconnect" behavior the specs describe (master spec
§17.6/§18.6, uiux §6.4) — that already exists at the application layer
(`src/lib/offline/{offline-queue,storage,online-status,http}.ts` +
`src/app/{inbox,today,ritual/warm-market}/offline.ts`), built by earlier units. This worker is
strictly the layer beneath that: it keeps the static shell and a "you're offline" page available
even before the app's own JS can boot.

Verified by `tests/unit/sw-scope.test.ts`, which loads and executes the real `public/sw.js` file
in a sandboxed `vm` context (not a hand-copied mirror of its logic) and asserts
`event.respondWith` is never called for `/api/`, `/auth/`, or `/_next/` requests.

## Vercel config — deliberately no `crons` block

`vercel.json` does not declare any `crons` entry. This is not an oversight: `src/app/api/inngest/route.ts`
already documents the decision (T-R14) that all scheduled/cron work in this app is driven by
Inngest's own `{ cron: ... }` function triggers against that one signed endpoint, specifically
*because* a parallel `vercel.json` Cron entry firing the same work would double-schedule it
through two independent clocks. `vercel.json` here is limited to `framework` (matches the
already-auto-detected value; no behavior change) and `headers` for `/sw.js` and
`/manifest.webmanifest` (the one genuinely new, additive piece — correct cache-control semantics
for a service worker script and a manifest file, which Vercel has no other built-in mechanism for
without either a `vercel.json` `headers` block or a `next.config.js` edit; this unit chose the
former to avoid touching `next.config.js`, a shared file). `buildCommand` / `installCommand` /
`outputDirectory` / `regions` are deliberately left unset: this repo's existing
`.github/workflows/deploy.yml` (T-06) already drives `vercel pull` / `vercel build` / `vercel
deploy` against the already-linked, already-deployed Vercel project (per `README_DEPLOYMENT.md`),
and Vercel's own zero-config Next.js framework preset is the documented, recommended path — an
explicit `outputDirectory` override in particular can break the framework-specific Build Output
API. Overriding any of these now would only risk changing already-working, already-deployed
behavior for no functional gain.

## Capacitor — config only, native platforms NOT added

`capacitor.config.ts` + the `@capacitor/core` (runtime, `dependencies`) and `@capacitor/cli`
(dev-only — provides the `CapacitorConfig` type the config file imports, and the `cap` CLI itself)
dependencies, both pinned to `8.4.2` — config-only for now, so there is no reason to float either
until a later unit actually exercises `cap add` — are the only changes. **This build did not run**
`npx cap add ios` / `npx cap add android` — no native toolchain (Xcode, Android Studio / Android
SDK) exists in this build environment, and per this unit's brief, native compilation is explicitly
deferred to a later build unit.

`server.url` is set to `https://harvest-app-inky.vercel.app` — the real, already-deployed
production URL per this repo's `README_DEPLOYMENT.md` — rather than a static local `webDir`
build, because this is a full dynamic Next.js App Router app (Route Handlers, RSC, auth,
per-request data) that cannot be `next export`-ed to a static bundle. Capacitor's native WebView
loads that live URL directly and still injects its native JS bridge into it, so
`window.Capacitor.Plugins.*` will work against the same one deployed app with no second codebase —
once plugins are actually added (see below). `appId: "com.theharvest.app"` is a conventional
reverse-DNS placeholder; **no appId is specified anywhere in the master or uiux specs**, and
bundle identifiers are effectively permanent once published — confirm/replace before submission.

### Next steps for an operator, on a machine with the native toolchains

```bash
# iOS (requires macOS + Xcode)
npx cap add ios
npx cap sync ios
npx cap open ios      # then build/run from Xcode

# Android (requires Android Studio / Android SDK)
npx cap add android
npx cap sync android
npx cap open android   # then build/run from Android Studio
```

After `cap add`, the native contact-import plugins (iOS `CNContactStore` / Android Contacts
Provider — master spec §17.3, "native contact import ... is native-shell-only"), push
notifications (APNs/FCM), haptics, and share-sheet plugins still need to be added
(`@capacitor/*` official plugins or equivalents) and wired to the web app's existing contact-
import surface — that is out of scope for this unit (native contacts import is explicitly a
LATER unit per this build's brief) and is not attempted here.
