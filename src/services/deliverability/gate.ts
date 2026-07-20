// T-36 (§10.3, §10.9-2, SC5 launch gate) — the deliverability readiness gate: the single seam
// T-37 (send paths) and any other caller consult to decide "is this channel actually sendable,
// right now." Wraps A2PProvisioningService.computeSmsPlatformReadiness (SMS_PLATFORM) and
// EmailDeliverabilityService.computeEmailReadiness (EMAIL) behind one fail-closed entry point,
// `isChannelDeliverable`.
//
// Fail-closed throughout: an unknown/unrecognized channel, a missing sending domain for an EMAIL
// check, or any unexpected error from either underlying service resolves to `deliverable: false`,
// never to a default "assume fine." Neither underlying service call ever throws by its own
// contract (both are pure DB reads), but this gate still wraps them in a try/catch — a caller of
// THE send-path gate must never be able to mistake a crashed check for a passed one.
//
// §10.1 documents one explicit, intentional exception this gate does NOT provision-gate:
// first-touch SMS via composer handoff sends from the rep's own number (a native `sms:` deep
// link), never through Twilio/A2P — there is no platform provisioning to check for that path at
// all, so `FIRST_TOUCH_COMPOSER` always reports deliverable, not because provisioning was
// verified, but because provisioning is simply not this path's concern. Callers must not conflate
// `FIRST_TOUCH_COMPOSER` with `SMS_PLATFORM` — they are different sends with different gates.

import { A2PProvisioningStatus, ProvisionedChannel } from '../../types/deliverability';
import { A2PProvisioningService } from './a2p-service';
import { EmailDeliverabilityService } from './email-deliverability-service';

/** The full channel vocabulary a send path might reason about — a superset of
 *  `ProvisionedChannel` (the two channels this gate actually evaluates against provisioning
 *  state) plus the one channel that is deliberately never gated here (see header). */
export type MessageChannel = ProvisionedChannel | 'FIRST_TOUCH_COMPOSER';

/** Same shape as `DeliverabilityStatus` (src/types/deliverability.ts), widened to accept
 *  `MessageChannel` rather than only `ProvisionedChannel`, so `FIRST_TOUCH_COMPOSER` and an
 *  unrecognized/unknown channel value can both be represented without lying about which channel
 *  was actually evaluated. */
export interface ChannelDeliverabilityResult {
  channel: MessageChannel;
  /** Fail-closed: true only on a positive, verified proof of readiness (or the documented
   *  FIRST_TOUCH_COMPOSER exception, which is never platform-gated at all). */
  deliverable: boolean;
  reason: string;
  detail: Record<string, unknown>;
}

export interface DeliverabilityGateDeps {
  a2pService: A2PProvisioningService;
  emailService: EmailDeliverabilityService;
}

function isKnownMessageChannel(value: unknown): value is MessageChannel {
  return value === 'SMS_PLATFORM' || value === 'EMAIL' || value === 'FIRST_TOUCH_COMPOSER';
}

/**
 * THE fail-closed capability query T-37's send paths (and any other caller) must consult before
 * any platform-sent message:
 *   - `SMS_PLATFORM`         -> `A2PProvisioningService.computeSmsPlatformReadiness(organizationId)`
 *   - `EMAIL`                -> `EmailDeliverabilityService.computeEmailReadiness(organizationId, domain)`
 *     (requires `domain`; missing domain resolves to NOT deliverable, not a thrown error)
 *   - `FIRST_TOUCH_COMPOSER` -> always `deliverable: true` (never platform-provisioned; §10.1 —
 *     see header)
 *   - anything else (a typo, a future channel not yet wired here, a value that bypassed the type
 *     checker from an untyped/external caller) -> `deliverable: false` — fail CLOSED on the
 *     unrecognized case, never open.
 *
 * Never throws: any unexpected error surfaced by either underlying service is caught here and
 * resolved to NOT deliverable rather than propagated.
 */
export async function isChannelDeliverable(
  deps: DeliverabilityGateDeps,
  channel: MessageChannel,
  organizationId: string,
  domain?: string | null
): Promise<ChannelDeliverabilityResult> {
  try {
    if (!isKnownMessageChannel(channel)) {
      return {
        channel: 'SMS_PLATFORM',
        deliverable: false,
        reason: `Unknown message channel "${String(channel)}" — fail-closed: not deliverable.`,
        detail: { requestedChannel: String(channel) },
      };
    }

    if (channel === 'FIRST_TOUCH_COMPOSER') {
      return {
        channel: 'FIRST_TOUCH_COMPOSER',
        deliverable: true,
        reason:
          "First-touch composer handoff sends from the rep's own number and is never platform-provisioned " +
          '(§10.1) — not gated by A2P/email provisioning.',
        detail: {},
      };
    }

    if (channel === 'SMS_PLATFORM') {
      const status = await deps.a2pService.computeSmsPlatformReadiness(organizationId);
      return { ...status };
    }

    // channel === 'EMAIL'
    if (!domain) {
      return {
        channel: 'EMAIL',
        deliverable: false,
        reason: 'No sending domain was supplied for an EMAIL deliverability check — fail-closed: not deliverable.',
        detail: {},
      };
    }
    const status = await deps.emailService.computeEmailReadiness(organizationId, domain);
    return { ...status };
  } catch (err) {
    return {
      channel,
      deliverable: false,
      reason: `Deliverability check failed unexpectedly: ${(err as Error).message} — fail-closed: not deliverable.`,
      detail: {},
    };
  }
}

// ─── Webhook/poll write-path convenience wrappers ──────────────────────────────────────────────
//
// A2PProvisioningService.applyBrandStatusResult / applyCampaignStatusResult (a2p-service.ts) are
// the guarded write path BOTH a Twilio status poll AND a (future, out of this unit's scope —
// see below) verified Twilio webhook payload would call with an already-known status, so neither
// path can bypass the state machine's legal-transition table. These two thin wrappers are that
// named seam for a webhook route to call; T-36 does not add a live Twilio webhook receiver route
// itself (no inbound-webhook signature-verification pattern exists anywhere yet in this codebase
// to safely extend — see twilio-client.ts's polling-based `refreshBrandStatus`/
// `refreshCampaignStatus`, which are fully functional today without one), but the write path a
// future webhook route would call is here, named, and tested, so adding that route later is
// exactly "add a route that verifies X-Twilio-Signature and calls these" — not a new design.

export async function applyBrandStatusUpdate(
  a2pService: A2PProvisioningService,
  organizationId: string,
  actor: { actor_id: string; actor_role?: string },
  status: Exclude<A2PProvisioningStatus, 'UNREGISTERED'>,
  failureReason: string | null
) {
  return a2pService.applyBrandStatusResult(organizationId, actor, status, failureReason);
}

export async function applyCampaignStatusUpdate(
  a2pService: A2PProvisioningService,
  organizationId: string,
  actor: { actor_id: string; actor_role?: string },
  status: Exclude<A2PProvisioningStatus, 'UNREGISTERED'>,
  failureReason: string | null,
  throughputTier: string | null
) {
  return a2pService.applyCampaignStatusResult(organizationId, actor, status, failureReason, throughputTier);
}
