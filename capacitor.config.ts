import type { CapacitorConfig } from '@capacitor/cli';

// T-58a — CAPACITOR CONFIG ONLY. Master spec §2.1/§17.3: "the same Next.js app shipped as an
// installable PWA, wrapped in a thin native shell (Capacitor-class) that exposes: iOS
// CNContactStore / Android Contacts Provider import, push notifications (APNs / FCM), haptics,
// share sheets, and the SMS composer handoff." This build unit adds ONLY this config + the
// `@capacitor/core` (runtime bridge) and `@capacitor/cli` (dev-only — provides the
// `CapacitorConfig` type imported above, and the `cap` CLI a later unit will run) dependencies —
// it deliberately does NOT run `npx cap add ios` / `npx cap add android` (no native toolchain —
// Xcode/Android Studio — is available in this build environment) and does NOT implement any
// native plugin (contact import, push, haptics, share). Those are later, separate build units;
// see docs/mobile-shell.md for the exact commands an operator runs next, on a machine with the
// native toolchains installed.
//
// WHY `server.url` INSTEAD OF A LOCAL STATIC `webDir` BUILD: this app is a full Next.js App
// Router project with dynamic Route Handlers, RSC, auth, and per-request data (see §2.1) — it
// cannot be `next export`ed to a static bundle the way a purely static site could be. The
// standard, supported Capacitor pattern for a server-rendered/dynamic web app ("thin shell") is
// to point the native WebView at the live, deployed HTTPS URL via `server.url` rather than
// bundling a static `webDir`; Capacitor still injects its native JS bridge into that remote
// content, so `window.Capacitor.Plugins.*` (contacts/push/haptics/share, once those plugins are
// added in a later unit) works from the same live app with no second codebase — exactly the "no
// divergent second codebase" requirement in §2.1. `webDir` is still a required config field even
// in this mode; it points at `public/` (this repo's real static-asset directory, which now also
// holds the offline app-shell fallback page — see public/offline.html) rather than an empty
// placeholder.
//
// FLAGGED FOR OPERATOR CONFIRMATION BEFORE ANY STORE SUBMISSION:
//   - `appId`: "com.theharvest.app" is a reasonable, conventional placeholder (reverse-DNS of the
//     brand name) — NOT confirmed against any spec value (none is stated in the master/uiux
//     specs) or any registered Apple/Google developer account. Bundle identifiers are
//     effectively permanent once an app is published — confirm/replace this before `cap add`.
//   - `server.url`: currently the real, already-deployed production URL from this repo's
//     README_DEPLOYMENT.md ("Production demo URL: https://harvest-app-inky.vercel.app"). Update
//     this to the final production domain once one is set (a custom domain, if any, per §2.2).
const config: CapacitorConfig = {
  appId: 'com.theharvest.app',
  appName: 'The Harvest',
  webDir: 'public',
  server: {
    url: 'https://harvest-app-inky.vercel.app',
    androidScheme: 'https',
  },
};

export default config;
