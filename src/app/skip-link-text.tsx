'use client';

// T-R32c (i18n, master-spec §17.5 / uiux §6.2) — the ONLY reason this is its own tiny client
// component rather than a plain string in `layout.tsx`: the root layout exports `metadata`, which
// Next.js only allows from a Server Component, so `layout.tsx` itself cannot carry a `'use client'`
// directive. This wraps just the skip-link's translatable text; `layout.tsx` keeps rendering the
// real `<a href="#main-content" className="skip-link">` anchor itself, unchanged (T-52's own
// skip-to-content structure/position stays exactly as tests/unit/wcag-keyboard-focus.test.ts's
// source-scan already proves), so this is a pure additive swap of the text node.

import { useT } from './locale-context';

export default function SkipLinkText() {
  const t = useT();
  return <>{t('common.skipToContent')}</>;
}
