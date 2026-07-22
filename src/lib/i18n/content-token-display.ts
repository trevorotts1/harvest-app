// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — small per-domain "raw backend token -> localized
// DISPLAY string" mappers for the `/content/*` Unified Content Queue surfaces (every-rep-facing —
// RG5-QC's correction that these are NOT niche admin). Same shape as `error-display.ts`/
// `reason-display.ts`/`channel-display.ts`/`team-token-display.ts`: a small `Record<token,
// catalogKey>` plus a generic, always-localized fallback for anything outside the known set — never
// the raw/humanized machine token.

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `content/page.tsx`'s `ContentItem.category` (prisma/schema.prisma's `ContentCategory` enum, "§11.1
 *  Five doctrine-aligned categories") + `content/templates/components/TemplateListSection.tsx`'s
 *  filter-chip `category` (the same enum, plus the page-synthesized `'ALL'` chip value — reuses the
 *  content-queue's own `filters.all` key rather than duplicating "All"/"Todo"). Generic fallback for
 *  any future/unrecognized category never renders the raw token. */
const CATEGORY_CATALOG_KEY: Readonly<Record<string, string>> = {
  ALL: 'content.queue.filters.all',
  COMMUNITY_SPOTLIGHT: 'content.queue.category.communitySpotlight',
  VALUE_FIRST_EDUCATION: 'content.queue.category.valueFirstEducation',
  MOVEMENT_FRAMING: 'content.queue.category.movementFraming',
  BEHIND_THE_HARVEST: 'content.queue.category.behindTheHarvest',
  EVENT_INTRODUCTION_ANNOUNCEMENT: 'content.queue.category.eventIntroductionAnnouncement',
};

export function contentCategoryLabel(t: Translate, category: string | null | undefined): string {
  if (!category) return t('content.queue.category.generic');
  const key = CATEGORY_CATALOG_KEY[category];
  return t(key ?? 'content.queue.category.generic');
}

/** `content/page.tsx`'s `ContentItem.state` (prisma/schema.prisma's `ContentQueueState` enum, "§11.5
 *  the Unified Content Queue's six states") + `content/launch-kit/[id]/page.tsx`'s per-piece
 *  `ContentItem.state` (the identical enum). REUSES the content queue's own `filters.*` catalog keys
 *  for the 5 states that already have one (single source of truth with the filter chips); only
 *  `COMPLIANCE_CHECK` (which the filter row has no chip for) gets a new key. Generic fallback for
 *  any future/unrecognized state never renders the raw token. */
const STATE_CATALOG_KEY: Readonly<Record<string, string>> = {
  DRAFTING: 'content.queue.filters.drafting',
  COMPLIANCE_CHECK: 'content.queue.state.complianceCheck',
  READY_FOR_REVIEW: 'content.queue.filters.readyForReview',
  SCHEDULED: 'content.queue.filters.scheduled',
  PUBLISHED: 'content.queue.filters.published',
  BLOCKED: 'content.queue.filters.blocked',
};

export function contentStateLabel(t: Translate, state: string | null | undefined): string {
  if (!state) return t('content.queue.state.generic');
  const key = STATE_CATALOG_KEY[state];
  return t(key ?? 'content.queue.state.generic');
}

/** `content/launch-kit/[id]/page.tsx`'s per-piece `ContentItem.launch_kit_piece_type` (prisma/
 *  schema.prisma's `LaunchKitPieceType` enum, "§11.4 the four launch-kit components"). Generic
 *  fallback for any future/unrecognized piece type never renders the raw token. */
const PIECE_TYPE_CATALOG_KEY: Readonly<Record<string, string>> = {
  WELCOME: 'content.launchKit.pieceType.welcome',
  ANNOUNCEMENT: 'content.launchKit.pieceType.announcement',
  DAY3_VALUE_EMAIL: 'content.launchKit.pieceType.day3ValueEmail',
  DAY7_EVENT_INVITE: 'content.launchKit.pieceType.day7EventInvite',
};

export function launchKitPieceTypeLabel(t: Translate, pieceType: string | null | undefined): string {
  if (!pieceType) return t('content.launchKit.pieceType.generic');
  const key = PIECE_TYPE_CATALOG_KEY[pieceType];
  return t(key ?? 'content.launchKit.pieceType.generic');
}

/** `content/launch-kit/[id]/page.tsx`'s `LaunchKit.version` (prisma/schema.prisma's
 *  `LaunchKitVersion` enum, "§11.4 Versions: V1 standard, V2 testimonial-anchored, V3
 *  event-centric"). Generic fallback for any future/unrecognized version never renders the raw
 *  token. */
const VERSION_CATALOG_KEY: Readonly<Record<string, string>> = {
  V1_STANDARD: 'content.launchKit.version.v1Standard',
  V2_TESTIMONIAL_ANCHORED: 'content.launchKit.version.v2TestimonialAnchored',
  V3_EVENT_CENTRIC: 'content.launchKit.version.v3EventCentric',
};

export function launchKitVersionLabel(t: Translate, version: string | null | undefined): string {
  if (!version) return t('content.launchKit.version.generic');
  const key = VERSION_CATALOG_KEY[version];
  return t(key ?? 'content.launchKit.version.generic');
}

/** `content/launch-kit/[id]/page.tsx`'s `LaunchKit.welcome_variant` (prisma/schema.prisma's
 *  `WelcomeVariant` enum). REUSES `content/page.tsx`'s own `LaunchKitTrigger` sub-component's
 *  `content.queue.launchKitTrigger.welcomeVariant.*` catalog keys — single source of truth for the
 *  3 known values, the same `<select>` this trigger form already ships. Generic fallback for any
 *  future/unrecognized variant never renders the raw token. */
const WELCOME_VARIANT_CATALOG_KEY: Readonly<Record<string, string>> = {
  PERSONAL_REFERRAL: 'content.queue.launchKitTrigger.welcomeVariant.personalReferral',
  EVENT_ATTENDEE: 'content.queue.launchKitTrigger.welcomeVariant.eventAttendee',
  BASE_MEMBER_INTRODUCED: 'content.queue.launchKitTrigger.welcomeVariant.baseMemberIntroduced',
};

export function welcomeVariantLabel(t: Translate, variant: string | null | undefined): string {
  if (!variant) return t('content.queue.launchKitTrigger.welcomeVariant.generic');
  const key = WELCOME_VARIANT_CATALOG_KEY[variant];
  return t(key ?? 'content.queue.launchKitTrigger.welcomeVariant.generic');
}

/** `content/templates/components/TemplateListSection.tsx`'s `TemplateData.defaultPersonalizationTier`
 *  (prisma/schema.prisma's `PersonalizationTier` enum, "§11.6 the three personalization tiers").
 *  Generic fallback for any future/unrecognized tier never renders the raw token. */
const PERSONALIZATION_TIER_CATALOG_KEY: Readonly<Record<string, string>> = {
  AUTOMATIC: 'content.templates.personalizationTier.automatic',
  AI_INFERRED: 'content.templates.personalizationTier.aiInferred',
  REP_PROVIDED: 'content.templates.personalizationTier.repProvided',
};

export function personalizationTierLabel(t: Translate, tier: string | null | undefined): string {
  if (!tier) return t('content.templates.personalizationTier.generic');
  const key = PERSONALIZATION_TIER_CATALOG_KEY[tier];
  return t(key ?? 'content.templates.personalizationTier.generic');
}

/** `content/page.tsx`'s `ContentItem.content_type` + `TemplateListSection.tsx`'s
 *  `TemplateData.contentType` (prisma/schema.prisma's `ContentType` enum, "the three content forms
 *  the Unified Content Queue carries"). Not part of the guard's baselined leak class (both sites
 *  render the bare token, never wrapped in a `.replace()` humanize call) — fixed alongside the
 *  baselined sites in the same files for consistency across this every-rep-facing surface. Generic
 *  fallback for any future/unrecognized content type never renders the raw token. */
const CONTENT_TYPE_CATALOG_KEY: Readonly<Record<string, string>> = {
  SOCIAL_POST: 'content.queue.contentType.socialPost',
  BLOG: 'content.queue.contentType.blog',
  EMAIL: 'content.queue.contentType.email',
};

export function contentTypeLabel(t: Translate, contentType: string | null | undefined): string {
  if (!contentType) return t('content.queue.contentType.generic');
  const key = CONTENT_TYPE_CATALOG_KEY[contentType];
  return t(key ?? 'content.queue.contentType.generic');
}
