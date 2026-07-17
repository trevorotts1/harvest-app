// WP01 §6.9 — Downstream data contracts (event bus).
//
// "On `gated_complete`, WP01 emits `user.onboarding_completed { user_id, role, access_tier,
// organization[], anchor_statement, intensity_setting }`. Per-WP: WP02 gets identity + sponsor
// seed; WP03 reads `intensity_setting` (calibrates lead volume) + `solution_number`; WP04 seeds
// agents with `anchor_statement` + intensity; WP05 uses `first_name`/`organization`/
// `mobile_phone`; WP06 uses `anchor_statement` + org (launch-kit library); WP07 uses
// `anchor_statement` + intensity (quotes, milestones, thresholds); WP08 reads the
// sponsor→downline graph + `access_tier` + `role`; WP09 reads `calendar_preferences`/
// `calendar_connected`; WP10 provisions per `access_tier`; WP11 is the consumer (validates) that
// WP01 gates on."
//
// This module is the ONE place the event is assembled and the ONE place each downstream WP's
// contract is derived FROM that same assembled event (plus the extra per-WP context the base event
// doesn't carry — sponsor_id, solution_number, first_name, mobile_phone, calendar state — each
// documented on its own type in `types/onboarding.ts`). Every projection function below is a pure
// derivation of the SAME `OnboardingCompletedEvent`, never a second, independently-assembled
// payload — "a clean typed contract, not ad-hoc" is exactly this: one source event, N typed views.
//
// WP11 is deliberately not modeled as a downstream projection here: per §6.9's own last clause,
// WP11 is "the consumer (validates) that WP01 gates on" — i.e. WP01 depends on WP11 being
// operational (§16.1 deployment order), not the other way around; WP11 does not consume this event.

import {
  AccessTier,
  IntensitySetting,
  OnboardingCompletedEvent,
  OnboardingStatus,
  Role,
  WP02WarmMarketContract,
  WP03HarvestMethodContract,
  WP04AgentLayerContract,
  WP05MessagingContract,
  WP06ContentContract,
  WP07GamificationContract,
  WP08TaprootingContract,
  WP09CalendarContract,
  WP10PaymentContract,
  CalendarPreferences,
} from '@/types/onboarding';

export type { OnboardingCompletedEvent };

/** Everything needed to assemble the §6.9 base event. Mirrors the event's own field list exactly. */
export interface OnboardingCompletedInput {
  user_id: string;
  role: Role;
  access_tier: AccessTier;
  /** Org membership is a SET (§6.8 multi-org membership) — always an array, even for a single org. */
  organization: string[];
  /**
   * §6.4: the Seven Whys anchor statement. Only the rep track (Flow A/C) runs Seven Whys — the
   * dense upline/RVP tracks (Flow B/D) never produce one. The base event's `anchor_statement` field
   * is a non-nullable `string` (matching the pre-existing `OnboardingCompletedEvent` contract this
   * module reuses rather than widening), so a track with no anchor statement passes `''` — the same
   * "non-nullable string column, redact/default to empty rather than null" convention this codebase
   * already uses for scrubbed-but-non-nullable fields (see `UplineInvite.recipient_email` in
   * data-rights.ts). Downstream projections that need a REAL anchor statement (WP04/06/07 — see
   * below) should treat `''` as "no anchor statement for this user" and degrade accordingly, not
   * crash on it.
   */
  anchor_statement: string;
  intensity_setting: IntensitySetting;
}

/** Assembles the exact §6.9 base event payload. Pure — no side effects, no publishing. */
export function buildOnboardingCompletedEvent(input: OnboardingCompletedInput): OnboardingCompletedEvent {
  return {
    event: 'user.onboarding_completed',
    user_id: input.user_id,
    role: input.role,
    access_tier: input.access_tier,
    organization: input.organization,
    anchor_statement: input.anchor_statement,
    intensity_setting: input.intensity_setting,
  };
}

// ─── The event bus (in-memory sink; matches the repo's constructor-injection test pattern) ─────

export interface OnboardingEventSink {
  publish(event: OnboardingCompletedEvent): void | Promise<void>;
}

/** A reference in-memory sink for tests/local composition — mirrors `InMemoryLegalHoldRepository`-style helpers elsewhere in this repo. */
export class InMemoryOnboardingEventSink implements OnboardingEventSink {
  readonly events: OnboardingCompletedEvent[] = [];

  publish(event: OnboardingCompletedEvent): void {
    this.events.push(event);
  }
}

/** Builds the event AND publishes it to `sink` in one call — the call-site WP01 makes at `gated_complete`. */
export async function emitOnboardingCompleted(
  sink: OnboardingEventSink,
  input: OnboardingCompletedInput
): Promise<OnboardingCompletedEvent> {
  const event = buildOnboardingCompletedEvent(input);
  await sink.publish(event);
  return event;
}

// ─── Per-WP projections (§6.9 "Per-WP:" sentence) ──────────────────────────────────────────────
// Each function takes the SAME assembled event plus only the extra context that WP genuinely needs
// and the base event does not carry (documented per-type in types/onboarding.ts). No projection
// re-derives a field the base event already carries — it is passed through, not recomputed.

/** WP02: "gets identity + sponsor seed." */
export function projectToWP02(
  event: OnboardingCompletedEvent,
  extra: { sponsor_id: string | null; onboarding_status: OnboardingStatus }
): WP02WarmMarketContract {
  return {
    user_id: event.user_id,
    role: event.role,
    organization: event.organization,
    onboarding_status: extra.onboarding_status,
    sponsor_id: extra.sponsor_id,
  };
}

/** WP03: "reads `intensity_setting` (calibrates lead volume) + `solution_number`." */
export function projectToWP03(
  event: OnboardingCompletedEvent,
  extra: { onboarding_status: OnboardingStatus; solution_number: string | null }
): WP03HarvestMethodContract {
  return {
    user_id: event.user_id,
    intensity_setting: event.intensity_setting,
    onboarding_status: extra.onboarding_status,
    solution_number: extra.solution_number,
  };
}

/** WP04: "seeds agents with `anchor_statement` + intensity." */
export function projectToWP04(event: OnboardingCompletedEvent): WP04AgentLayerContract {
  return {
    user_id: event.user_id,
    anchor_statement: event.anchor_statement,
    intensity_setting: event.intensity_setting,
    role: event.role,
  };
}

/** WP05: "uses `first_name`/`organization`/`mobile_phone`." */
export function projectToWP05(
  event: OnboardingCompletedEvent,
  extra: { first_name: string; mobile_phone: string | null }
): WP05MessagingContract {
  return {
    user_id: event.user_id,
    first_name: extra.first_name,
    organization: event.organization,
    mobile_phone: extra.mobile_phone,
    role: event.role,
  };
}

/** WP06: "uses `anchor_statement` + org (launch-kit library)." */
export function projectToWP06(event: OnboardingCompletedEvent): WP06ContentContract {
  return {
    user_id: event.user_id,
    anchor_statement: event.anchor_statement,
    organization: event.organization,
  };
}

/** WP07: "uses `anchor_statement` + intensity (quotes, milestones, thresholds)." */
export function projectToWP07(event: OnboardingCompletedEvent): WP07GamificationContract {
  return {
    user_id: event.user_id,
    anchor_statement: event.anchor_statement,
    intensity_setting: event.intensity_setting,
  };
}

/** WP08: "reads the sponsor→downline graph + `access_tier` + `role`." */
export function projectToWP08(
  event: OnboardingCompletedEvent,
  extra: { sponsor_id: string | null }
): WP08TaprootingContract {
  return {
    user_id: event.user_id,
    sponsor_id: extra.sponsor_id,
    access_tier: event.access_tier,
    role: event.role,
  };
}

/** WP09: "reads `calendar_preferences`/`calendar_connected`." */
export function projectToWP09(
  event: OnboardingCompletedEvent,
  extra: { calendar_preferences: CalendarPreferences; calendar_connected: boolean }
): WP09CalendarContract {
  return {
    user_id: event.user_id,
    calendar_preferences: extra.calendar_preferences,
    calendar_connected: extra.calendar_connected,
    role: event.role,
    intensity_setting: event.intensity_setting,
  };
}

/** WP10: "provisions per `access_tier`." The provisioning contract §15.2 governs (WP10 must not provision before this event fires). */
export function projectToWP10(event: OnboardingCompletedEvent): WP10PaymentContract {
  return {
    user_id: event.user_id,
    access_tier: event.access_tier,
  };
}
