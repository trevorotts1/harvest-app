// T-58a — the Web App Manifest, via the Next.js App-Router file convention (this file, alone,
// produces a `/manifest.webmanifest` route AND the `<link rel="manifest">` head tag; NO edit to
// layout.tsx is needed or made — deliberately, since another build unit is concurrently editing
// that shared file). Master spec §2.1/§17.3 ("the same Next.js app shipped as an installable PWA")
// and uiux spec §1 naming/branding + §6.3 (PWA + thin native shell) inform the values below.
//
// - `name` / `short_name`: matches the in-app brand name used everywhere else (layout.tsx's
//   `<title>`, the `.brand-mark` "The Harvest" lockup on `/`, `/auth`, `/team/*`).
// - `start_url`: uiux spec §1 ("Today is the default landing surface, always — every app open,
//   every PWA launch, every login lands on Today unless following a deep link").
// - `display: 'standalone'`: the installable-app chrome the PWA + native-shell parity table
//   (master spec §17.3, uiux §6.3) assumes.
// - `theme_color` / `background_color`: pulled from the real design tokens (src/app/tokens.css),
//   not invented — `--leaf-600` (`--color-action`, the primary brand green) and `--soil-100`
//   (`--surface-canvas`, the light-theme canvas — the manifest's `background_color` is the splash
//   background while the app boots, so it should match the default/light canvas rather than the
//   dark-mode one). Kept in sync by eye with tokens.css; if those two token values ever change,
//   update the two hex literals below to match.
// - `icons`: placeholder rasters (see scripts/generate-pwa-icons.mjs's header comment) — an
//   operator/designer must supply final brand icon art before any store submission (see
//   docs/mobile-shell.md). The "maskable" purpose entry is required by installability checks on
//   Android/Chromium; "any" entries cover everywhere else.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Harvest — 2 Hour CEO',
    short_name: 'Harvest',
    description:
      'A calm command center for building a warm-market business with focus, compliance, and momentum.',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f3ea',
    theme_color: '#2f6b4f',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
