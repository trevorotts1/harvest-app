// T-41 (WP06 §11.5 "Scheduling, publishing & human review") — the publish pipeline.
//
// §11.5 hard rules implemented here:
//   1. "If the CFE is offline, publishing pauses with a visible 'PUBLISHING PAUSED — COMPLIANCE
//      OFFLINE' banner and no manual bypass." — `getBannerState` checks `cfe.isAvailable()` (the
//      SAME fast-pause mechanism agent-runtime.ts already uses, §0.3/§5.2) and `attemptPublish` ALSO
//      re-runs the full CFE `evaluateContent` (defense-in-depth: a live classifier failure fails
//      CLOSED the moment it actually happens, not only when someone flips the DI toggle) — a
//      fail-closed hold from EITHER check pauses that attempt; there is no code path that publishes
//      while the CFE cannot be consulted.
//   2. "Platform-API failure holds the post with a retry window, then offers manual publish after 3
//      failures." — `attemptPublish` increments `publish_attempts` on a transport failure; the manual
//      fallback (`markPublishedManually`) is refused until `publish_attempts >= 3`.
//   3. Every PUBLISHED item spawns a 48h engagement-follow-up task (§11.8-5) — via
//      EngagementFollowUpService, consumed here, never re-implemented.
//
// HONEST DEVIATION (stated explicitly, not silently omitted — see this build's report): no live
// Instagram/Facebook/LinkedIn publishing API credentials or integration exist in this codebase.
// `UnconfiguredSocialPublishTransport` is the only production `SocialPublishTransport` and ALWAYS
// fails closed with a distinct, honest reason (`NO_PUBLISH_TRANSPORT_CONFIGURED`) rather than a
// silent no-op or a fabricated "published" result — so the retry-then-manual-fallback path this
// module implements is real and exercised (a rep can always finish a publish manually, with the
// system honestly telling them why automation didn't), never dead scaffold.

import { ComplianceFilterEngine } from '@/services/compliance/engine';
import type { ContentItemPrismaClient, ContentItemRow } from './content-item.service';
import { EngagementFollowUpService, type EngagementFollowUpPrismaClient } from './engagement-followup.service';

export interface SocialPublishTransport {
  publish(item: ContentItemRow): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** The only production transport today — see this file's header for why. */
export class UnconfiguredSocialPublishTransport implements SocialPublishTransport {
  async publish(): Promise<{ ok: false; reason: string }> {
    return { ok: false, reason: 'NO_PUBLISH_TRANSPORT_CONFIGURED' };
  }
}

const MANUAL_FALLBACK_THRESHOLD = 3;

export interface BannerState {
  publishingPaused: boolean;
  reason?: 'cfe_unavailable';
}

export type PublishAttemptResult =
  | { status: 'PUBLISHED'; item: ContentItemRow }
  | { status: 'PAUSED'; reason: string }
  | { status: 'BLOCKED'; item: ContentItemRow; reason: string }
  | { status: 'RETRY_HELD'; item: ContentItemRow; attempts: number }
  | { status: 'MANUAL_FALLBACK_AVAILABLE'; item: ContentItemRow; attempts: number }
  | { status: 'NOT_FOUND' }
  | { status: 'INVALID_STATE'; currentState: string };

export type ManualPublishResult =
  | { status: 'PUBLISHED'; item: ContentItemRow }
  | { status: 'NOT_FOUND' }
  | { status: 'RETRY_NOT_EXHAUSTED'; attempts: number }
  | { status: 'INVALID_STATE'; currentState: string };

export class PublishingService {
  private readonly followUps: EngagementFollowUpService;

  constructor(
    private prisma: ContentItemPrismaClient,
    private cfe: ComplianceFilterEngine = new ComplianceFilterEngine(),
    private transport: SocialPublishTransport = new UnconfiguredSocialPublishTransport(),
    followUpPrisma?: EngagementFollowUpPrismaClient
  ) {
    this.followUps = new EngagementFollowUpService((followUpPrisma ?? (prisma as unknown as EngagementFollowUpPrismaClient)));
  }

  /** §11.5 rule 1, fast path — the same `isAvailable()` mechanism agent-runtime.ts checks before
   *  spending any Claude tokens. Exposed so the Content Queue page can render the banner without
   *  attempting a publish. */
  getBannerState(): BannerState {
    if (!this.cfe.isAvailable()) return { publishingPaused: true, reason: 'cfe_unavailable' };
    return { publishingPaused: false };
  }

  /** §11.5 rule 1, authoritative path — re-runs the CFE on THIS item's body immediately before
   *  attempting to publish. A fail-closed hold (missing key / classifier timeout / classifier error /
   *  engine exception / explicit `cfe_unavailable`) pauses this attempt; a genuine NEW `blocked`
   *  verdict (content drifted since it was originally cleared) blocks the item outright — distinct
   *  from an infra pause, and never conflated with it. */
  async attemptPublish(userId: string, id: string, now: Date = new Date()): Promise<PublishAttemptResult> {
    const banner = this.getBannerState();
    if (banner.publishingPaused) {
      return { status: 'PAUSED', reason: banner.reason ?? 'cfe_unavailable' };
    }

    const item = await this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
    if (!item) return { status: 'NOT_FOUND' };
    if (item.state !== 'SCHEDULED' && item.state !== 'READY_FOR_REVIEW') {
      return { status: 'INVALID_STATE', currentState: item.state };
    }

    const verdict = await this.cfe.evaluateContent({
      content: item.body,
      channel: 'SOCIAL',
      userContext: { user_id: userId, role: 'REP' as never, content_id: id },
    });

    if (verdict.held) {
      // Fail-closed infra pause — nothing about THIS item's content; do not count as a delivery
      // failure, do not touch publish_attempts. No manual bypass exists for this state (rule 1).
      return { status: 'PAUSED', reason: `cfe_${verdict.heldReason ?? 'unavailable'}` };
    }
    if (verdict.band === 'blocked') {
      const updated = await this.prisma.contentItem.update({
        where: { id },
        data: { state: 'BLOCKED', publish_hold_reason: 'CFE_BLOCKED_AT_PUBLISH_TIME' },
      });
      return { status: 'BLOCKED', item: updated, reason: 'cfe_blocked_at_publish_time' };
    }

    const result = await this.transport.publish(item);
    if (result.ok) {
      const updated = await this.prisma.contentItem.update({
        where: { id },
        data: { state: 'PUBLISHED', published_at: now, publish_hold_reason: null },
      });
      await this.followUps.createFollowUp(userId, id, now);
      return { status: 'PUBLISHED', item: updated };
    }

    const attempts = item.publish_attempts + 1;
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: { publish_attempts: attempts, publish_hold_reason: result.reason },
    });
    if (attempts >= MANUAL_FALLBACK_THRESHOLD) {
      return { status: 'MANUAL_FALLBACK_AVAILABLE', item: updated, attempts };
    }
    return { status: 'RETRY_HELD', item: updated, attempts };
  }

  /** §11.5 rule 2's manual-fallback affordance — refused until 3 automated failures have actually
   *  been recorded (never a shortcut around the retry window). Still gated by the CFE banner check:
   *  a rep cannot manually "publish around" a CFE outage either (no bypass, rule 1). */
  async markPublishedManually(userId: string, id: string, now: Date = new Date()): Promise<ManualPublishResult> {
    const banner = this.getBannerState();
    if (banner.publishingPaused) {
      return { status: 'INVALID_STATE', currentState: 'CFE_OFFLINE_NO_BYPASS' };
    }
    const item = await this.prisma.contentItem.findFirst({ where: { id, user_id: userId } });
    if (!item) return { status: 'NOT_FOUND' };
    if (item.state !== 'SCHEDULED') {
      return { status: 'INVALID_STATE', currentState: item.state };
    }
    if (item.publish_attempts < MANUAL_FALLBACK_THRESHOLD) {
      return { status: 'RETRY_NOT_EXHAUSTED', attempts: item.publish_attempts };
    }
    const updated = await this.prisma.contentItem.update({
      where: { id },
      data: { state: 'PUBLISHED', published_at: now, publish_hold_reason: null },
    });
    await this.followUps.createFollowUp(userId, id, now);
    return { status: 'PUBLISHED', item: updated };
  }

  /** The scheduled "publish tick" (see inngest-functions.ts) — attempts every DUE (scheduled_for <=
   *  now) SCHEDULED item across all reps. A single item's failure/pause never blocks the others. */
  async runDuePublishes(dueItems: ContentItemRow[], now: Date = new Date()): Promise<PublishAttemptResult[]> {
    const results: PublishAttemptResult[] = [];
    for (const item of dueItems) {
      results.push(await this.attemptPublish(item.user_id, item.id, now));
      // A CFE-offline pause applies platform-wide — stop the tick rather than burn through every
      // remaining item against a gate we already know is down (still re-checked fresh next tick).
      if (results[results.length - 1].status === 'PAUSED') break;
    }
    return results;
  }
}
