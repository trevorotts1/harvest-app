// uiux §5.4 route: /ritual/warm-market. Client-rendered (the ritual is a stateful, resumable,
// per-layer flow driven by the authenticated session's own T-26 engine state — there is nothing to
// statically prerender here, same rationale as the onboarding flow's own page.tsx).
'use client';

import WarmMarketRitual from './WarmMarketRitual';

export default function WarmMarketRitualPage() {
  return <WarmMarketRitual />;
}
