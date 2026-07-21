// T-54 (master-spec §17.6 "Offline-first & degraded operation"; uiux §6.4 "Queue-and-sync with
// re-validation") — a tiny, shared HTTP helper for `PersistentOfflineQueue` (offline-queue.ts)
// replay handlers that need the RESPONSE STATUS, not just a thrown/resolved outcome, to tell a
// TRANSIENT failure (network error, 5xx — stays queued, retried on the next reconnect) apart from a
// PERMANENT, business-final rejection (400/403/404/409 — the item's server-side state, not
// connectivity, is the blocker; retrying alone will never fix it). This is one level below
// `src/app/ritual/warm-market/offline.ts`'s own `postJson` (which only needs "did this throw", so it
// keeps its own simpler, throw-on-`!res.ok` helper) — used by every OTHER T-54 offline-queue wiring
// (`src/app/inbox/offline.ts`, `src/app/today/offline.ts`) so the transient/permanent classification
// rule lives in exactly one place, not copy-pasted per surface.

export interface RawJsonResponse<T> {
  status: number;
  data: T;
}

/** The one production HTTP call this helper makes — callers inject it (or a test double) into their
 *  own `create*QueueHandlers` factory so replay logic stays independently testable, same seam
 *  convention as the ritual's `postJson`. */
export async function postJson<T>(url: string, body: unknown): Promise<RawJsonResponse<T>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { status: res.status, data };
}

export type PostJsonFn = <T>(url: string, body: unknown) => Promise<RawJsonResponse<T>>;

/** Every mutating route this codebase's offline-queue replay handlers dispatch to (approve/decline/
 *  edit on the Approval Inbox; approve/decline/confirm/attendance on Today's Action Queue) resolves
 *  a business-final rejection to exactly one of these four statuses — 400 invalid input, 403
 *  forbidden/not-approvable, 404 not-found, 409 conflict/invalid-state/terminal-state. Anything else
 *  (no response at all — a network failure — or a 5xx) is transient and must stay queued for the
 *  next reconnect attempt. */
export function isPermanentRejectionStatus(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 409;
}
