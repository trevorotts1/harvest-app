// T-41 (WP06) — the single lazy, build-safe production factory for the WP06 service stack. Every
// export is a FUNCTION; nothing is constructed at module scope and no key is read here (§0.4) — the
// Claude client (AnthropicRuntimeClient) and the CFE (ComplianceFilterEngine) are both build-safe to
// construct (they read their key lazily, inside their own `generate`/`evaluateContent` calls), so
// even these factory functions never need to defer construction further than "call this function
// inside a request handler" — the same convention src/services/messaging/send/production-wiring.ts
// already established.

import { prisma } from '@/lib/prisma';
import { AnthropicRuntimeClient } from '@/services/agent-runtime/claude';
import { ComplianceFilterEngine } from '@/services/compliance/engine';

import { ContentItemService, type ContentItemPrismaClient } from './content-item.service';
import { ContentBriefService, type ContentBriefPrismaClient } from './content-brief.service';
import { ContentBatchService } from './content-batch.service';
import { LaunchKitService, type LaunchKitPrismaClient } from './launch-kit.service';
import { PublishingService, UnconfiguredSocialPublishTransport } from './publishing.service';
import { EngagementFollowUpService, type EngagementFollowUpPrismaClient } from './engagement-followup.service';

type AnyPrisma = typeof prisma;

export function buildContentItemService(db: AnyPrisma = prisma): ContentItemService {
  return new ContentItemService(db as unknown as ContentItemPrismaClient, new ComplianceFilterEngine());
}

export function buildContentBriefService(db: AnyPrisma = prisma): ContentBriefService {
  return new ContentBriefService(db as unknown as ContentBriefPrismaClient);
}

export function buildContentBatchService(db: AnyPrisma = prisma): ContentBatchService {
  return new ContentBatchService(buildContentBriefService(db), buildContentItemService(db), {
    modelClient: new AnthropicRuntimeClient(),
  });
}

export function buildLaunchKitService(db: AnyPrisma = prisma): LaunchKitService {
  return new LaunchKitService(
    db as unknown as LaunchKitPrismaClient,
    buildContentBriefService(db),
    buildContentItemService(db),
    { modelClient: new AnthropicRuntimeClient() }
  );
}

export function buildPublishingService(db: AnyPrisma = prisma): PublishingService {
  return new PublishingService(
    db as unknown as ContentItemPrismaClient,
    new ComplianceFilterEngine(),
    new UnconfiguredSocialPublishTransport(),
    db as unknown as EngagementFollowUpPrismaClient
  );
}

export function buildEngagementFollowUpService(db: AnyPrisma = prisma): EngagementFollowUpService {
  return new EngagementFollowUpService(db as unknown as EngagementFollowUpPrismaClient);
}
