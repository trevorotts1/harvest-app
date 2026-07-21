// T-54 (master-spec §17.6 "Offline-first & degraded operation"; uiux §6.4 "Queue-and-sync with
// re-validation" / §4.2 Action Queue Item "queued-offline" state) — offline local-queue wiring for
// Today's Action Queue (`src/app/today/page.tsx`'s `onQueueAction`) and its Team-calendar attendance
// marking (`onMarkAttendance`) — both of which, before this build unit, were a bare `fetch` with no
// offline handling at all (T-51 finding). Framework-free (no React import), built on the same
// codebase-wide primitives every other T-54 offline surface uses (`src/lib/offline/*`, T-R11), and
// following the exact shape `src/app/inbox/offline.ts` (this build unit's sibling module) and
// `src/app/ritual/warm-market/offline.ts` (T-R11) already established: this module owns the storage
// key, the mutation-kind vocabulary, and the `replay()` handler map; the page owns only the React
// glue (state, effects).
//
// SCOPE NOTE — no CFE re-entry lives here: unlike the Approval Inbox's `editDraft`, neither
// `actOnQueueDraft`'s approve/decline nor `confirmAppointment`/`markAttendance` ever change a
// draft's CONTENT — they only transition `approval_state`/`Appointment.status`/`Attendance.state`.
// `actOnQueueDraft`'s own approve path already re-checks `cfe_outcome === 'PASS'` against the
// CURRENT persisted row before allowing the transition (today.service.ts, T-32 QC fix) — this
// module's job is only to make sure that check is still what runs on replay (never bypassed, never
// re-implemented client-side), and to stop retrying a mutation forever once the server's answer is
// business-final rather than transient (see `isPermanentRejectionStatus`, `src/lib/offline/http.ts`).

import { MutationHandler } from '@/lib/offline/offline-queue';
import { isPermanentRejectionStatus, postJson, type PostJsonFn, type RawJsonResponse } from '@/lib/offline/http';
import { errorDisplay, type Translate } from '@/lib/i18n/error-display';

export { isPermanentRejectionStatus, postJson, type PostJsonFn, type RawJsonResponse };

export const TODAY_QUEUE_STORAGE_KEY = 'harvest:today:offline-queue:v1';

export const TODAY_MUTATION_KIND = {
  QUEUE_ACTION: 'today/queue-action',
  ATTENDANCE: 'today/attendance',
} as const;

export type TodayMutationKind = (typeof TODAY_MUTATION_KIND)[keyof typeof TODAY_MUTATION_KIND];

export interface QueueActionMutationPayload {
  kind: 'draft' | 'appointment';
  id: string;
  action?: 'approve' | 'decline';
}
export interface AttendanceMutationPayload {
  eventId: string;
  state: 'attended' | 'missed';
}

/** Stable per-item mutation ids — a repeat click before the offline queue-up has re-rendered the
 *  item out of its interactive row enqueues only once (dedupe-by-id, same rationale as
 *  `RITUAL_MUTATION_ID` / `approveMutationId` in this codebase's other two offline modules). */
export function queueActionMutationId(kind: 'draft' | 'appointment', id: string, action?: 'approve' | 'decline'): string {
  return `today:queue-action:${kind}:${id}:${action ?? 'confirm'}`;
}
export function attendanceMutationId(eventId: string): string {
  return `today:attendance:${eventId}`;
}

interface ApiOkShape {
  ok?: boolean;
  error?: string;
  // T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — the machine code the
  // mission-control queue-action/attendance routes now set alongside `error` (kept for logs only);
  // `onPermanentRejection`'s message is resolved through it, never through the raw `error` prose.
  code?: string;
}

export interface TodayPermanentRejectionInfo {
  kind: TodayMutationKind;
  message: string;
}

/**
 * Builds the `replay()` handler map Today's offline queue dispatches to on reconnect. Hits the
 * EXACT same two routes (`/api/mission-control/queue-action`, `/api/mission-control/attendance`) a
 * live online action would — no parallel write path, so `actOnQueueDraft`'s own fail-closed
 * CFE-outcome re-check (§9.2/T-32 QC fix) and every ownership check on both routes apply on replay
 * exactly as they do online. `onPermanentRejection` (optional) fires, synchronously, for every
 * business-final rejection (400/403/404/409 — e.g. the draft/appointment/event is no longer in the
 * state this action assumed) so the caller can surface a non-silent explanation and reload Today
 * from the server, mirroring master-spec §17.6's "an approval that expired while offline returns to
 * the queue with an explanation" — never retried forever, never silently dropped.
 */
export function createTodayQueueHandlers(
  postJsonFn: PostJsonFn,
  onPermanentRejection?: (info: TodayPermanentRejectionInfo) => void,
  // T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — injected by the page (which already holds
  // the live locale's `t` via `useLocale()`); this module stays framework-free (see header) by
  // taking a plain function rather than importing React/the locale context itself.
  // `onPermanentRejection`'s `message` is ALWAYS resolved through `errorDisplay(t, data.code)`,
  // never through the raw `data.error` prose — see `src/lib/i18n/error-display.ts`'s own header for
  // why, and `src/app/inbox/offline.ts` (the sibling module this mirrors exactly).
  t?: Translate
): Record<string, MutationHandler<unknown>> {
  const display = (code: string | undefined): string =>
    t ? errorDisplay(t, code) : (code ?? 'errors.generic');
  return {
    [TODAY_MUTATION_KIND.QUEUE_ACTION]: async (payload) => {
      const { kind, id, action } = payload as QueueActionMutationPayload;
      const { status, data } = await postJsonFn<ApiOkShape>('/api/mission-control/queue-action', { kind, id, action });
      if (status >= 200 && status < 300 && data.ok) return;
      if (isPermanentRejectionStatus(status)) {
        onPermanentRejection?.({
          kind: TODAY_MUTATION_KIND.QUEUE_ACTION,
          message: display(data.code),
        });
        return; // finished processing (never retryable) — resolved, not thrown.
      }
      // Thrown/logged only (never rendered to the rep) — the raw `error` prose is fine here.
      throw new Error(`Queue-action replay failed (${status}): ${data.error ?? 'unknown error'}`);
    },
    [TODAY_MUTATION_KIND.ATTENDANCE]: async (payload) => {
      const { eventId, state } = payload as AttendanceMutationPayload;
      const { status, data } = await postJsonFn<ApiOkShape>('/api/mission-control/attendance', { eventId, state });
      if (status >= 200 && status < 300 && data.ok) return;
      if (isPermanentRejectionStatus(status)) {
        onPermanentRejection?.({
          kind: TODAY_MUTATION_KIND.ATTENDANCE,
          message: display(data.code),
        });
        return;
      }
      // Thrown/logged only (never rendered to the rep) — the raw `error` prose is fine here.
      throw new Error(`Attendance replay failed (${status}): ${data.error ?? 'unknown error'}`);
    },
  };
}
