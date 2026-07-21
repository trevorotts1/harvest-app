// T-57 RE-GATE B [af7789d3] Finding 1 fix — the shared "resolve a backend error to a DISPLAY
// string" primitive. This is the piece that closes the systemic leak the re-gate caught: every
// mutation route in this codebase returns `{ error: <raw English prose>, code?: <machine token> }`
// on failure, and client call sites were doing `data.error ?? t('some.generic.key')` — since the
// server ALWAYS populates `error`, that `??` fallback is dead code and a Spanish rep sees the raw
// English `error` string 100% of the time. `errors.*` is deliberately NOT keyed by `error` — it is
// keyed ONLY by the stable machine `code` a route sets alongside it (mirroring the ALREADY-correct
// pattern `ComposerHandoffSheet`/`composer-handoff-core.ts` established: `viewFromHandoffResponse`
// resolves a `reason` token to a catalog key, never renders the wire body's prose). The English
// `error` string is kept on the wire for logs/back-compat/devtools only — no client in this fix
// reads it for display anymore.
//
// UNKNOWN-CODE SAFETY NET (by design, not merely convenience): `KNOWN_ERROR_CODES` is built by
// flattening the REAL shipped `en.json` at module load, so a code a given route hasn't been taught
// to set (or a generic auth-gate 401/403 from `withRole`/`withCapability`, which sets no `code` at
// all) still resolves to `errors.generic` — a real, translated, honest "something went wrong, try
// again" — never the untranslated code string and never a fall-through to English. This is what
// makes the fix systemic rather than a per-route patch list: a route this pass didn't get to still
// can never leak English through any call site that adopts `errorDisplay`.

import { flattenCatalog, type CatalogTree, type TVars } from './catalog';
import en from './messages/en.json';

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(flattenCatalog(en as CatalogTree))
    .filter((key) => key.startsWith('errors.'))
    .map((key) => key.slice('errors.'.length))
);

export type Translate = (key: string, vars?: TVars) => string;

/** Known `currentState`/`status`-style enum tokens this fix humanizes via `errors.states.*` (draft
 *  `approval_state`: PENDING/APPROVED/DECLINED/HELD; `UserDataDeletion.status`: PENDING/COMPLETED/
 *  FAILED). Anything else (a future/unknown token) is passed through verbatim rather than crashing
 *  or guessing — a raw enum token is a code smell to fix at the source, not a rendering hazard. */
const STATE_TOKENS: ReadonlySet<string> = new Set(['PENDING', 'APPROVED', 'DECLINED', 'HELD', 'COMPLETED', 'FAILED']);

/**
 * Resolves a backend machine `code` to a localized display string via the `errors.*` catalog
 * namespace. Never reads the wire's raw `error` prose. An absent/unrecognized `code` — including
 * the common case of a generic, code-less `{ error: "<English>" }` from a shared auth/validation
 * wrapper — resolves to `errors.generic`, so a display string is ALWAYS localized, never English.
 */
export function errorDisplay(t: Translate, code: string | null | undefined, vars?: TVars): string {
  const key = code && KNOWN_ERROR_CODES.has(code) ? `errors.${code}` : 'errors.generic';
  return t(key, vars);
}

/** Humanizes a raw state/status enum token for interpolation into an `errors.*` message (e.g.
 *  `errorDisplay(t, 'NOT_APPROVABLE', { currentState: errorStateLabel(t, draft.currentState) })`).
 *  Falls back to the raw token for anything outside `STATE_TOKENS` (see that const's own note). */
export function errorStateLabel(t: Translate, state: string | null | undefined): string {
  if (!state) return '';
  return STATE_TOKENS.has(state) ? t(`errors.states.${state}`) : state;
}
