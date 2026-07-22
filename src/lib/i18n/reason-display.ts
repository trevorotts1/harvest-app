// T-57 RE-GATE ROUND-4 hardening, DIMENSION B — the "resolve a backend COMPLIANCE-HOLD reason token
// to a localized DISPLAY string" primitive, the exact sibling of `error-display.ts`'s `errorDisplay`
// but for the `reason`/`held_reason` machine tokens a few compliance surfaces splice straight into
// visible text (the round-4 leaks the re-gate found: `grow/components/TimeLapseShare.tsx`'s
// `cfe_held`/`cfe_blocked` share-block reason, and `content/launch-kit/[id]/page.tsx`'s
// `one_or_more_pieces_blocked_by_compliance_or_doctrine` whole-kit hold reason). Before this, those
// raw tokens rendered verbatim — a Spanish rep saw `cfe_held`, not "retenido para revisión de
// cumplimiento".
//
// SECURITY / MEANING-PRESERVING (uiux §0.4, the compliance-hold integrity rule): every reason this
// maps is a COMPLIANCE OR DOCTRINE HOLD, and the mapped copy — in both languages — MUST keep saying
// so. A Spanish rep must understand the export/kit was withheld for compliance, never a softened or
// generic "couldn't do that". That is why the UNKNOWN-token fallback is `errors.reasons.generic` =
// "a compliance hold" (ES "una retención de cumplimiento"), NOT a neutral "something went wrong":
// the only call sites are compliance-block branches, so an unrecognized token there is still, by
// construction, a compliance hold — the honest, safe default is to say exactly that.
//
// Like `errorDisplay`, the KNOWN set is built by flattening the REAL shipped `en.json` at module
// load, so a reason token the catalog hasn't been taught yet resolves to the generic compliance-hold
// copy — never the raw token, never English — which is what makes this a systemic fix (a new
// compliance surface adopting `reasonDisplay` can never leak a raw token through it) rather than a
// per-site patch.

import { flattenCatalog, type CatalogTree, type TVars } from './catalog';
import { type Translate } from './error-display';
import en from './messages/en.json';

const KNOWN_REASON_TOKENS: ReadonlySet<string> = new Set(
  Object.keys(flattenCatalog(en as CatalogTree))
    .filter((key) => key.startsWith('errors.reasons.'))
    .map((key) => key.slice('errors.reasons.'.length))
);

/**
 * Resolves a backend compliance-hold `reason`/`held_reason` machine token to a localized display
 * phrase via the `errors.reasons.*` catalog namespace. An absent/unrecognized token resolves to
 * `errors.reasons.generic` ("a compliance hold") — a display string is ALWAYS localized and ALWAYS
 * still communicates a compliance hold, never the raw token and never English (see this module's
 * header for the security rationale).
 */
export function reasonDisplay(t: Translate, reason: string | null | undefined, vars?: TVars): string {
  const key = reason && KNOWN_REASON_TOKENS.has(reason) ? `errors.reasons.${reason}` : 'errors.reasons.generic';
  return t(key, vars);
}
