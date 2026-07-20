// WP08 §13.1/§13.6-7, uiux AC-5.5-5 — the org-tree time-lapse SHARE export gate.
//
// "a shareable, CFE-filtered moment for team meetings" / "Share export requires a CFE pass ... and
// never includes income math." This module never constructs its own income/override-math figure
// into the exported content (there is no code path here that reads `override-math.ts` at all) and
// routes every export attempt through the CFE fail-closed, mirroring the exact DI/decision shape
// `src/services/onboarding/wp01/seven-whys/outreach-gate.ts` already established for a different
// content-to-CFE path (narrow `CFEContentEvaluator` interface, `released`/`held` decision) — the
// SAME "no bypass" contract: a CFE that is unavailable/held/blocked never releases the export.

import type { CFEInput, CFEVerdict } from '@/types/compliance';
import type { TimeLapseShareOutcome, TimeLapseShareRequest } from '@/types/taprooting';

/** The narrow CFE surface this module depends on — satisfied by `ComplianceFilterEngine.
 *  evaluateContent`, or any mock/fake in tests (mirrors `outreach-gate.ts`'s identical interface). */
export interface CFEContentEvaluator {
  evaluateContent(input: CFEInput): Promise<CFEVerdict>;
}

/** Structure + growth only — deliberately NEVER touches override-math.ts / any dollar figure
 *  (uiux AC-5.5-5 "The exported asset never includes income math"). A join-order roster is the
 *  entire exported "content" the CFE screens; there is nothing else in the payload that could
 *  smuggle a number past this description. */
export function buildTimeLapseExportSummary(request: TimeLapseShareRequest): string {
  const lines = request.events
    .slice()
    .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())
    .map((e) => `Level ${e.level}: ${e.displayName} joined ${e.joinedAt}`);
  return ['Org growth time-lapse — structure and growth only.', ...lines].join('\n');
}

/**
 * Attempts to clear an org-tree time-lapse export for sharing. Returns `allowed: true` ONLY when
 * the CFE released the content — a held (unavailable/timeout/missing-key) or blocked verdict both
 * resolve to `allowed: false`, and the export must not leave the app either way (§0.4 rule 3 "any
 * generated outbound content ... MUST pass CFE on the synchronous path — fail-closed").
 */
export async function evaluateTimeLapseShare(
  request: TimeLapseShareRequest,
  cfe: CFEContentEvaluator,
  userContext: CFEInput['userContext']
): Promise<TimeLapseShareOutcome> {
  const exportSummary = buildTimeLapseExportSummary(request);
  const verdict = await cfe.evaluateContent({
    content: exportSummary,
    channel: 'SOCIAL',
    userContext,
  });

  if (verdict.released) {
    return { allowed: true, exportSummary };
  }
  return {
    allowed: false,
    reason: verdict.held ? 'cfe_held' : 'cfe_blocked',
    detail: verdict.reason,
  };
}
