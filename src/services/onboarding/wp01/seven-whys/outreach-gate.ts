// WP01 §6.4 / §4.3 / §5 — routing the anchor statement to an outreach/send path.
//
// The Seven Whys conversation itself is private and self-reflective — it is never CFE-screened
// turn-by-turn (there is nothing to send anywhere while it's happening). But per §4.3, the anchor
// statement "may seed motivational surfaces but [is] never inserted into outbound content without
// WhySession.use_in_outreach_consent = true", and per §5 "any AI-generated conversational content on
// a send/store path must route through the CFE." This module is the ONE function that may ever
// forward anchor text toward an outreach/send path, and it enforces BOTH gates, in this order:
//
//   1. Consent (`use_in_outreach_consent`) — defaults false (§6.4); an explicit rep opt-in only.
//      This is independent of, and prior to, the CFE — the CFE has no way to grant consent on the
//      rep's behalf, so it is checked first and short-circuits without even calling the CFE.
//   2. The CFE (fail-closed, §5.2) — called on EVERY attempt once consent is true. There is no
//      bypass: this function has no code path that returns `allowed: true` without a CFE verdict
//      that itself set `released: true`.

import type { CFEInput, CFEVerdict } from '../../../../types/compliance';

/** The narrow CFE surface this module depends on — satisfied by `ComplianceFilterEngine.evaluateContent`, or any mock in tests. */
export interface CFEContentEvaluator {
  evaluateContent(input: CFEInput): Promise<CFEVerdict>;
}

export type AnchorOutreachDecision =
  | { allowed: true; verdict: CFEVerdict }
  | { allowed: false; reason: 'consent_required'; verdict: null }
  | { allowed: false; reason: 'cfe_held' | 'cfe_blocked'; verdict: CFEVerdict };

/**
 * Attempts to route the rep's anchor statement to an outreach/send path. Returns `allowed: true`
 * ONLY when (a) the rep has explicitly opted in and (b) the CFE released the content. Every other
 * outcome is `allowed: false` — including a CFE that is unavailable/held (§5.2 fail-closed) or that
 * blocked the content outright.
 */
export async function routeAnchorToOutreach(
  session: { anchorStatementPlain: string; useInOutreachConsent: boolean },
  cfe: CFEContentEvaluator,
  userContext: CFEInput['userContext'],
  channel: CFEInput['channel'] = 'SMS'
): Promise<AnchorOutreachDecision> {
  if (!session.useInOutreachConsent) {
    // §6.4/§4.3: consent defaults false; no anchor content reaches outreach without an explicit
    // rep opt-in. No CFE bypass risk here — we simply never got as far as needing one.
    return { allowed: false, reason: 'consent_required', verdict: null };
  }

  // §5: no bypass — every attempt with consent=true is CFE-screened before it may proceed.
  const verdict = await cfe.evaluateContent({
    content: session.anchorStatementPlain,
    channel,
    userContext,
  });

  if (verdict.released) {
    return { allowed: true, verdict };
  }
  return { allowed: false, reason: verdict.held ? 'cfe_held' : 'cfe_blocked', verdict };
}
