import type { Metadata } from 'next';
import Script from 'next/script';
import './tokens.css';
import './globals.css';
import { THEME_INIT_SCRIPT } from './theme-init-script';
import { LOCALE_INIT_SCRIPT } from './locale-init-script';
import { Providers } from './providers';
import SkipLinkText from './skip-link-text';

export const metadata: Metadata = {
  title: 'The Harvest | 2 Hour CEO',
  description: 'A calm command center for building a warm-market business with focus, compliance, and momentum.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Living Field Design System (T-05): applies a saved manual
          light/dark override (Me -> Appearance, spec §1.2.2) as the
          `data-theme` attribute before hydration, so there is no
          flash-of-wrong-theme. Absent a saved override, the OS
          `prefers-color-scheme` media query in tokens.css governs the
          semantic tokens directly — no JS is required for that default
          path. `beforeInteractive` runs ahead of first paint.
        */}
        <Script id="lfds-theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {/*
          T-53 (i18n, master-spec §17.5 / uiux §6.2): applies a saved locale override to
          `<html lang>` before hydration, so a returning rep who chose Español never sees a flash
          of the wrong `lang` attribute — same rationale/pattern as the theme-init script above.
        */}
        <Script id="lfds-locale-init" strategy="beforeInteractive">
          {LOCALE_INIT_SCRIPT}
        </Script>
      </head>
      <body>
        {/*
          T-52 (WCAG 2.2 AA §17.4 / uiux §6.1 item 2: "skip-to-content first on every page").
          A plain `<div>` target (not `<main>`) — many pages under src/app already render their
          own `<main>` landmark, and a second nested `<main>` here would be an invalid/duplicate
          landmark. `tabIndex={-1}` makes the target programmatically focusable (so activating the
          link actually MOVES focus past the nav, not just scrolls the viewport) without adding it
          to the normal tab order. Visually hidden until focused (globals.css `.skip-link`).
        */}
        <a href="#main-content" className="skip-link">
          <SkipLinkText />
        </a>
        <div id="main-content" tabIndex={-1}>
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
