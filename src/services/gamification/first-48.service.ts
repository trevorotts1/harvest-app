// T-43 (WP07 §12.2) — the 48-Hour Countdown & First-48 guided mode.
//
// TRIGGER (a stated, documented deviation — read before assuming a real onboarding-completion hook
// exists elsewhere): §12.2 says the countdown "activates immediately on `gated_complete`."
//
// UPDATE (T-R36): the route that flips onboarding to GATED_COMPLETE
// (src/app/api/onboarding/complete/route.ts) now DOES write real Prisma — it durably sets
// `User.onboarding_status = GATED_COMPLETE` inside a real `$transaction` on every successful
// completion (see that file's own header comments; this was previously a pre-existing WP01 gap,
// now closed). That said, this module's own `ensureFirstFortyEightStarted` bridge is deliberately
// left as-is by T-R36 (out of that fix's scope — a cross-work-package wiring change, not an
// onboarding-persistence one): the completion route does NOT itself call
// `ensureFirstFortyEightStarted` synchronously. `ensureFirstFortyEightStarted` remains the live
// mechanism: it lazily stamps `User.gated_complete_at` the FIRST time a GATED_COMPLETE rep's Today
// surface is actually read — and since "Today is the default landing surface, always" (uiux §2.1)
// and is itself gated behind `withOnboardingGate` (nothing downstream of onboarding is reachable
// before GATED_COMPLETE, §6.10-1), this is still a correct, real, production-wired moment, just not
// the earliest possible one. Wiring a synchronous call from the completion route into this function
// (now genuinely possible post-T-R36, and still "zero code change here" — idempotent, a second call
// after the timestamp is already set is a no-op) remains a small, deferred follow-up for whichever
// unit owns that cross-cutting change.

export type FirstFortyEightPhase = 'ON_TIME' | 'WARNING' | 'EXPIRED';

const WARNING_AT_HOURS = 48;
const EXPIRED_AT_HOURS = 72;

export interface FirstFortyEightState {
  active: boolean; // true iff the rep has EVER had a First-48 window (gated_complete_at is set)
  phase: FirstFortyEightPhase | null;
  startedAt: string | null; // ISO
  hoursElapsed: number | null;
  goals: FirstFortyEightGoal[];
}

export interface FirstFortyEightGoal {
  contactId: string;
  displayName: string; // first-name + last-initial, §9.5 privacy convention
  contacted: boolean;
}

interface UserGateRow {
  onboarding_status: string;
  gated_complete_at: Date | null;
}

interface FirstFortyEightDb {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserGateRow | null>;
    update(args: { where: { id: string }; data: { gated_complete_at: Date } }): Promise<unknown>;
  };
}

/** Idempotent: a no-op if already stamped, or if the rep is not (yet) GATED_COMPLETE. */
export async function ensureFirstFortyEightStarted(db: FirstFortyEightDb, userId: string, now: Date = new Date()): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.onboarding_status !== 'GATED_COMPLETE') return;
  if (user.gated_complete_at) return;
  await db.user.update({ where: { id: userId }, data: { gated_complete_at: now } });
}

export function firstFortyEightPhase(startedAt: Date, now: Date): FirstFortyEightPhase {
  const hours = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
  if (hours >= EXPIRED_AT_HOURS) return 'EXPIRED';
  if (hours >= WARNING_AT_HOURS) return 'WARNING';
  return 'ON_TIME';
}

interface ContactGoalRow {
  id: string;
  first_name: string;
  last_name: string;
  last_contact_date: Date | null;
}

interface GoalsDb {
  // Prefer WP03's already-computed closest-sphere signal (ContactMethodProfile.readiness_tier = 'A')
  // when it exists — CONSUMED, never recomputed here. Falls back to Contact.is_a_list (WP02's own
  // A-list flag) when no WP03 profile rows exist yet (e.g. a universal, non-Primerica rep who hasn't
  // run the three-layer method), so First-48 never renders blank goals (SC9) waiting on a WP03 state
  // that may not exist for every org/rep combination.
  contactMethodProfile?: {
    findMany(args: {
      where: { user_id: string; readiness_tier: 'A' };
      take: number;
    }): Promise<{ contact_id: string }[]>;
  };
  contact: {
    findMany(args: { where: Record<string, unknown>; take?: number }): Promise<ContactGoalRow[]>;
  };
}

/** §12.2 "Target: three community introductions to the closest-sphere A-list names." Exactly three
 *  (or fewer if the rep's Vault genuinely has fewer A-list contacts — never fabricated, §18.6). */
export async function firstFortyEightGoals(db: GoalsDb, userId: string): Promise<FirstFortyEightGoal[]> {
  let contacts: ContactGoalRow[] = [];

  if (db.contactMethodProfile) {
    try {
      const tierA = await db.contactMethodProfile.findMany({ where: { user_id: userId, readiness_tier: 'A' }, take: 3 });
      if (tierA.length > 0) {
        contacts = await db.contact.findMany({ where: { user_id: userId, id: { in: tierA.map((t) => t.contact_id) } } });
      }
    } catch {
      contacts = [];
    }
  }

  if (contacts.length === 0) {
    contacts = await db.contact.findMany({ where: { user_id: userId, is_a_list: true }, take: 3 });
  }

  return contacts.slice(0, 3).map((c) => ({
    contactId: c.id,
    displayName: `${c.first_name} ${c.last_name ? `${c.last_name[0]}.` : ''}`.trim(),
    contacted: Boolean(c.last_contact_date),
  }));
}

export async function buildFirstFortyEightState(
  db: FirstFortyEightDb & GoalsDb,
  userId: string,
  now: Date = new Date()
): Promise<FirstFortyEightState> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.gated_complete_at) {
    return { active: false, phase: null, startedAt: null, hoursElapsed: null, goals: [] };
  }
  const startedAt = user.gated_complete_at;
  const phase = firstFortyEightPhase(startedAt, now);
  const goals = await firstFortyEightGoals(db, userId);
  const hoursElapsed = (now.getTime() - startedAt.getTime()) / (1000 * 60 * 60);
  return { active: true, phase, startedAt: startedAt.toISOString(), hoursElapsed, goals };
}
