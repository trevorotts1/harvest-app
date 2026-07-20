// T-43 (WP07) — the shared CFE gate every content-bearing WP07 surface calls through (§0.4 rule 2 /
// master-spec §12 preamble: "All content-bearing outputs (quotes, referral scripts, celebration
// copy) pass the CFE"). Mirrors the narrow `CFEContentEvaluator` seam already established by WP01's
// `outreach-gate.ts` — ONE interface, satisfied by the real `ComplianceFilterEngine.evaluateContent`
// (constructed lazily by each call site, never at module scope) or a test fake.
//
// FAIL-CLOSED: `gateRepFacingContent` returns `{ pass: true }` ONLY when the CFE itself returned
// `released: true` (band === 'clear' && !held). Every other outcome — FLAG, BLOCK, held-for-review,
// a thrown exception the engine already turns into a held verdict — is `{ pass: false }`. There is
// no code path here that shows content to the rep without a fresh, live CFE decision; this
// deliberately never trusts a cached `cfe_cleared` column as authoritative — see quote.service.ts's
// header comment for why a stored flag is a debugging cache only, not a bypass.

import type { CFEInput, CFEVerdict } from '@/types/compliance';

export interface CFEContentEvaluator {
  evaluateContent(input: CFEInput): Promise<CFEVerdict>;
}

export type ContentGateResult =
  | { pass: true; verdict: CFEVerdict }
  | { pass: false; reason: 'flagged' | 'blocked' | 'held'; verdict: CFEVerdict };

export async function gateRepFacingContent(
  content: string,
  cfe: CFEContentEvaluator,
  userContext: CFEInput['userContext'],
  // 'EMAIL' matches the existing convention `agent-runtime.ts`'s `cfeChannelFor` already uses for
  // `rep_facing` output — kept in lockstep so the CFE classifiers see the same channel context for
  // every rep-facing surface in the app, not a WP07-only divergent value.
  channel: CFEInput['channel'] = 'EMAIL'
): Promise<ContentGateResult> {
  const verdict = await cfe.evaluateContent({ content, channel, userContext });
  if (verdict.released) {
    return { pass: true, verdict };
  }
  const reason = verdict.held ? 'held' : verdict.band === 'blocked' ? 'blocked' : 'flagged';
  return { pass: false, reason, verdict };
}
