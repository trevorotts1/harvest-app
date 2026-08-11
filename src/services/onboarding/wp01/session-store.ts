// WP01 T-R36 — the REAL, Prisma-backed onboarding-session persistence this app's lifecycle needs.
//
// Before this fix, `POST /api/onboarding/complete` (and its sibling `/step`/`/status` routes) each
// read from their OWN private, always-empty, in-memory `sessions: any[] = []` array (see the
// retired `./complete/store.ts`'s own header comment — "no session-creation endpoint of its own
// yet ... full onboarding-session lifecycle wiring is T-20"). A real production user's session was
// NEVER in that array — every real completion 404'd ("Onboarding session not found") before the
// T-R35 event-publish wiring ever ran, and the T-R35 fix (wiring `user.onboarding_completed` ->
// WP10 provisioning) was consequently dead for every real user even though it was correctly wired.
//
// This module is the ONE place a real `OnboardingSession` row is read, created, or looked up —
// mirroring this repo's established narrow-Prisma-delegate-shape convention (ProvisioningPrismaClient
// in payment/provisioning.ts, GdprConsentPrismaClient in lib/onboarding/gdpr-consent.ts,
// SponsorInvitePrismaClient in sponsor-invite.service.ts): a small interface naming only the methods
// this file calls, satisfied by the real `@/lib/prisma` singleton in production and by a plain
// stateful fake object in tests, never a live database in either case.
//
// FIELD OWNERSHIP (why this session row stays this small): the in-memory demo session object used
// to conflate BOTH "settled identity/profile" fields (role, org_type, solution_number, access_tier,
// intensity_setting, gdpr_consent, commitment_score) AND "still-in-progress step data" (seven_whys,
// goal_card, intensity_data, current_step) into one flat object, because the fake had no real
// `User` row to read those settled fields from. The REAL `User` Prisma model (prisma/schema.prisma)
// already carries every one of those settled fields as real columns — so the real
// `OnboardingSession` row only needs to own the step-resumption state machine (`current_step`) plus
// the three step-specific JSON blobs the schema already declares (`seven_whys`/`goal_card`/
// `intensity_data`) and the terminal `completed` flag. No new scalar columns were needed on
// `OnboardingSession` for this fix — see prisma/schema.prisma's `OnboardingStep` enum comment for
// the one schema change this fix DID require (additively widening that enum so `current_step` can
// durably hold the app's real 11-step vocabulary, not just the legacy 6-value subset).

import { Prisma, type OnboardingStep as PrismaOnboardingStep } from '@prisma/client';

import type { OnboardingStep as TsOnboardingStep } from '@/types/onboarding';

/** Shape of a real `OnboardingSession` row this module reads/writes. */
export interface OnboardingSessionRow {
  id: string;
  user_id: string;
  current_step: PrismaOnboardingStep;
  seven_whys: Prisma.JsonValue | null;
  goal_card: Prisma.JsonValue | null;
  intensity_data: Prisma.JsonValue | null;
  completed: boolean;
  created_at: Date;
}

/**
 * These three columns are nullable `Json?`. The real Prisma-generated update-input type for a
 * nullable Json field deliberately does NOT accept a plain `null` (Prisma disambiguates "SQL NULL"
 * (`Prisma.DbNull`) from "the literal JSON value `null`" (`Prisma.JsonNull`) — see
 * `NullableJsonNullValueInput` in the generated client). This app only ever means "no data for this
 * step yet" (SQL NULL) — never a stored JSON `null` literal — so `toJsonUpdateValue` below is the
 * one place that distinction is bridged: pass it a plain JS value (or `null`) and it returns
 * whatever the real Prisma client's `data` argument actually requires.
 */
export type OnboardingJsonUpdateValue = Prisma.InputJsonValue | typeof Prisma.DbNull;

export function toJsonUpdateValue(value: unknown): OnboardingJsonUpdateValue {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export interface OnboardingSessionUpdateData {
  current_step?: PrismaOnboardingStep;
  seven_whys?: OnboardingJsonUpdateValue;
  goal_card?: OnboardingJsonUpdateValue;
  intensity_data?: OnboardingJsonUpdateValue;
  // R-08 — the sponsor-step decision record (compact JSON: { decision, recordedAt }); see the
  // schema column's own comment for why this is an audit record, never a sponsorship source.
  sponsor_decision?: OnboardingJsonUpdateValue;
  completed?: boolean;
}

/** The narrow Prisma slice this module needs — DI-mockable in tests (see this file's own header). */
export interface OnboardingSessionPrismaClient {
  onboardingSession: {
    findFirst(args: {
      where: { user_id: string };
      orderBy?: { created_at: 'asc' | 'desc' };
    }): Promise<OnboardingSessionRow | null>;
    create(args: { data: { user_id: string } }): Promise<OnboardingSessionRow>;
    update(args: { where: { id: string }; data: OnboardingSessionUpdateData }): Promise<OnboardingSessionRow>;
  };
}

/**
 * Bridges the app's full 11-step TS vocabulary (`@/types/onboarding`'s own `OnboardingStep` enum,
 * which drives `ROLE_STEP_MAP`/`OnboardingService`) onto the Prisma-generated `OnboardingStep`
 * enum column. The two are DIFFERENT TS types with IDENTICAL string values by construction — unlike
 * Role/OrgType/AccessTier/IntensitySetting/OnboardingStatus (already unified 1:1 with the Prisma
 * enum by earlier T-17/T-19/T-20 QC fixes; see `@/types/onboarding`'s own import comments),
 * `OnboardingStep` was never unified (prisma/schema.prisma's own `OnboardingStep` doc comment notes
 * why: "superseded in part by WhySession"). Unifying the TWO TS declarations into one is out of
 * scope for this fix (a much larger, separate refactor touching every file that imports
 * `OnboardingStep` from `@/types/onboarding|@prisma/client`) — this pair of pure, one-line functions
 * is the deliberately narrow, documented bridge instead.
 */
export function toPersistedStep(step: TsOnboardingStep): PrismaOnboardingStep {
  return step as unknown as PrismaOnboardingStep;
}
export function fromPersistedStep(step: PrismaOnboardingStep): TsOnboardingStep {
  return step as unknown as TsOnboardingStep;
}

/**
 * Read-only lookup of this user's own current onboarding session — "current" meaning the most
 * recently created row for this `user_id` (mirrors the old in-memory `sessions.find(s => s.user_id
 * === userId)` one-session-per-user semantics). Returns `null` if none exists yet. Callers that
 * must NOT silently create a session on a miss (`/api/onboarding/complete`, `/api/onboarding/status`
 * — a missing session there is an honest 404, never an auto-start) call this directly, never
 * `getOrCreateOnboardingSession` below.
 */
export async function getOnboardingSession(
  prisma: OnboardingSessionPrismaClient,
  userId: string
): Promise<OnboardingSessionRow | null> {
  return prisma.onboardingSession.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * `/api/onboarding/step` is the one call-site allowed to CREATE a session: "when onboarding
 * starts" (T-R36 brief) is defined here as the first authenticated step-submission this user ever
 * makes — there is no separate `/api/onboarding/start` endpoint in this app's API surface (the real
 * client, `OnboardingFlow.tsx`, does not call `/step`/`/complete`/`/status` at all yet — a
 * pre-existing, separately-tracked UI-wiring gap, not something this fix papers over), so lazily
 * creating the row on first touch is the honest "start" moment available. `current_step` defaults
 * to `REGISTER` at the schema level, matching the pre-existing in-memory default.
 */
export async function getOrCreateOnboardingSession(
  prisma: OnboardingSessionPrismaClient,
  userId: string
): Promise<OnboardingSessionRow> {
  const existing = await getOnboardingSession(prisma, userId);
  if (existing) return existing;
  return prisma.onboardingSession.create({ data: { user_id: userId } });
}
