// T-41 (WP06 §11.6 "Template system") — the 20+ doctrine-verified template library, as an in-code
// catalog mirrored to the `ContentTemplate` table (same "in-code map is the source of truth, DB is a
// mirror" convention as AgentDefinition/NINE_AGENTS, src/services/agent-runtime/runtime-model-map.ts
// `agentDefinitionRows()`). Keeping the catalog in code means the ≥20-template AC and the
// doctrine_verified flag are provable by a plain unit test with NO database — see templates.test.ts.
//
// §11.6 names seven template categories: "Community Introduction, Base Spotlight, Educational Value,
// Movement Framing, Behind-the-Harvest, Event Announcement, and the Harvest book integration." These
// map onto the five ContentCategory enum values (COMMUNITY_SPOTLIGHT covers Community
// Introduction/Base Spotlight, VALUE_FIRST_EDUCATION covers Educational Value, etc.) plus two
// explicitly-named "Harvest book integration" templates (tagged MOVEMENT_FRAMING — the book is the
// movement's philosophical grounding) so that category is never just folded silently into another.
//
// Three personalization tiers (§11.6): `AUTOMATIC` (names from WP02 Contact rows — no template
// change needed, the generation layer fills these), `AI_INFERRED` (context/shared qualities via
// Sonnet 5 — the templates below whose copy_skeleton includes a bracketed inference cue are this
// tier), `REP_PROVIDED` (personal story/testimonial/event details — the templates whose skeleton
// asks for rep-supplied specifics are this tier). `personalizationTierForTemplate` below is the
// single source of truth mapping a template key to its tier.

import type { ContentCategory, ContentType, LaunchKitPieceType } from '@prisma/client';

export interface ContentTemplateSeed {
  key: string;
  name: string;
  contentType: ContentType;
  category: ContentCategory | null;
  launchKitPieceType: LaunchKitPieceType | null;
  copySkeleton: string;
  imageConceptPrompt: string | null;
  platformVariants: Record<string, string> | null;
  toneGuidance: string;
}

const PLATFORM_TONE: Record<string, string> = {
  INSTAGRAM: 'Visual-first, warm, short lines, carousel/story friendly.',
  FACEBOOK: 'Long-form narrative, group-share angle, room to tell the whole story.',
  LINKEDIN: 'Professional thought-leadership, substantive, no hype.',
};

function socialTemplate(
  keySuffix: string,
  name: string,
  category: ContentCategory,
  copySkeleton: string,
  imageConceptPrompt: string
): ContentTemplateSeed {
  return {
    key: `social.${category.toLowerCase()}.${keySuffix}`,
    name,
    contentType: 'SOCIAL_POST',
    category,
    launchKitPieceType: null,
    copySkeleton,
    imageConceptPrompt,
    platformVariants: PLATFORM_TONE,
    toneGuidance: 'Leads with relationship; treats the audience as community; reinforces the Three Laws.',
  };
}

export const CONTENT_TEMPLATES: ContentTemplateSeed[] = [
  // ── Community Spotlight / Community Introduction / Base Spotlight (§11.6) ───────────────────────
  socialTemplate(
    'intro',
    'Community Introduction',
    'COMMUNITY_SPOTLIGHT',
    '[Base member first name] joined our community [context]. Here\'s what stood out about them: [AI-inferred shared quality]. Welcome them if you see them around.',
    'A warm, candid photo of two people talking outdoors in natural light — no stock handshake, no money symbols.'
  ),
  socialTemplate(
    'base-spotlight',
    'Base Spotlight',
    'COMMUNITY_SPOTLIGHT',
    'Spotlight on [base member first name]: [rep-provided story/testimonial]. This is what community expansion looks like — one relationship at a time.',
    'A natural, unposed photo of a small gathering — a porch, a kitchen table, a shared meal.'
  ),
  socialTemplate(
    'circle',
    'Community Circle Check-In',
    'COMMUNITY_SPOTLIGHT',
    'This week our community expanded — not measured by headcount, but by depth. [AI-inferred connection theme]. Grateful for this base.',
    'A wide shot of a harvest field at golden hour — community/natural imagery, never a stock office photo.'
  ),
  // ── Educational Value (§11.6) ───────────────────────────────────────────────────────────────────
  socialTemplate(
    'lesson',
    'Value-First Lesson',
    'VALUE_FIRST_EDUCATION',
    'One idea that changed how I think about [topic]: [educational point]. No ask — just something useful I wanted to share with you.',
    'A simple, warm photo of a notebook and coffee on a wooden table — natural, unstaged.'
  ),
  socialTemplate(
    'myth-bust',
    'Myth vs. Reality',
    'VALUE_FIRST_EDUCATION',
    'A common myth about [topic]: [myth]. The reality: [educational correction]. Sharing because someone shared it with me first.',
    'A close-up of hands sorting seeds or produce — natural imagery, no money symbols.'
  ),
  socialTemplate(
    'howto',
    'Practical How-To',
    'VALUE_FIRST_EDUCATION',
    'A simple practice that\'s helped our base with [topic]: [rep-provided how-to steps].',
    'A community workshop or gathering photo — real people, natural light.'
  ),
  // ── Movement Framing (§11.6) ────────────────────────────────────────────────────────────────────
  socialTemplate(
    'movement',
    'Movement Framing',
    'MOVEMENT_FRAMING',
    'This isn\'t about one person\'s success — it\'s a movement. [AI-inferred collective-momentum note]. Grow the Downline, Engage the Base, Increase Wealth — together.',
    'A group photo mid-conversation, candid, community/natural imagery — never a solo hero shot.'
  ),
  socialTemplate(
    'downline-maxxing',
    'Downline Maxxing Explainer',
    'MOVEMENT_FRAMING',
    'What "Downline Maxxing" actually means to us: [educational explainer]. It\'s collective, not individual.',
    'A field with multiple rows of new growth — natural harvest imagery symbolizing collective growth.'
  ),
  socialTemplate(
    'harvest-book-social',
    'The Harvest Book Integration (social)',
    'MOVEMENT_FRAMING',
    'A line from The Harvest that\'s been on my mind: "[rep-provided quote from the book]." Here\'s why it matters to our base: [reflection].',
    'A photo of the book on a table with warm natural light — no staged office backdrop.'
  ),
  // ── Behind-the-Harvest (§11.6) ──────────────────────────────────────────────────────────────────
  socialTemplate(
    'behind-week',
    'Behind-the-Harvest: This Week',
    'BEHIND_THE_HARVEST',
    'The real, unfiltered version of my week: [rep-provided candid update]. Not the highlight reel — the actual work.',
    'A candid, slightly imperfect photo — a messy desk, a real moment, not a polished flat-lay.'
  ),
  socialTemplate(
    'behind-lesson',
    'Behind-the-Harvest: What I Learned',
    'BEHIND_THE_HARVEST',
    'Something I got wrong this week, and what it taught me: [rep-provided reflection].',
    'A quiet, natural moment — a walk outdoors, early morning light.'
  ),
  socialTemplate(
    'behind-gratitude',
    'Behind-the-Harvest: Gratitude',
    'BEHIND_THE_HARVEST',
    'Grateful this week for [base member or community moment, rep-provided] — this is why the work matters.',
    'A natural, warm photo of hands holding fresh produce or seeds.'
  ),
  // ── Event & Introduction Announcements (§11.6) ─────────────────────────────────────────────────
  socialTemplate(
    'event-announce',
    'Event Announcement',
    'EVENT_INTRODUCTION_ANNOUNCEMENT',
    'Join us: [rep-provided event name/date/location]. A low-pressure way to meet the community in person.',
    'A photo of a past gathering — warm, candid, community-focused.'
  ),
  socialTemplate(
    'intro-announce',
    'Introduction Announcement',
    'EVENT_INTRODUCTION_ANNOUNCEMENT',
    'Excited to introduce [base member first name] to the community — [AI-inferred shared quality that connects them to the group].',
    'A candid two-person introduction photo, natural setting.'
  ),
  socialTemplate(
    'recap',
    'Event Recap',
    'EVENT_INTRODUCTION_ANNOUNCEMENT',
    'What happened at [rep-provided event name]: [recap]. Grateful for everyone who came out.',
    'A wide, candid group photo from the event — natural light, no staged posing.'
  ),

  // ── Blog (§11.3, §11.6) ─────────────────────────────────────────────────────────────────────────
  {
    key: 'blog.community-story',
    name: 'Community Introduction Story (blog)',
    contentType: 'BLOG',
    category: 'COMMUNITY_SPOTLIGHT',
    launchKitPieceType: null,
    copySkeleton: 'Open with a specific community-introduction story (rep-provided), connect it to one of the Three Laws, close with a soft invitation.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: '600-1500 words, educational + narrative, ends with a soft invitation (never a hard ask).',
  },
  {
    key: 'blog.educational-value',
    name: 'Educational Value Long-Form (blog)',
    contentType: 'BLOG',
    category: 'VALUE_FIRST_EDUCATION',
    launchKitPieceType: null,
    copySkeleton: 'Teach one substantive idea in depth (AI-inferred or rep-provided topic), grounded in a real story, closing with a Three-Laws reference.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: '600-1500 words, educational + narrative, ends with a soft invitation.',
  },
  {
    key: 'blog.harvest-book-integration',
    name: 'The Harvest Book Integration (blog)',
    contentType: 'BLOG',
    category: 'MOVEMENT_FRAMING',
    launchKitPieceType: null,
    copySkeleton: 'Reflect on a theme from The Harvest book (rep-provided passage/quote), connect it to the rep\'s own community-introduction story and the Three Laws.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: '600-1500 words, grounded in the book\'s philosophy, ends with a soft invitation.',
  },

  // ── Email (§11.3, §11.6) ────────────────────────────────────────────────────────────────────────
  {
    key: 'email.welcome',
    name: 'Welcome Touch (email)',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: null,
    copySkeleton: 'A warm welcome — no ask. Automatic personalization: recipient first name.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'CAN-SPAM-compliant; plain-text opt-out mention required.',
  },
  {
    key: 'email.value',
    name: 'Value Touch (email)',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: null,
    copySkeleton: 'One useful idea (AI-inferred from recipient context), no ask.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'CAN-SPAM-compliant; plain-text opt-out mention required.',
  },
  {
    key: 'email.invite',
    name: 'Invite Touch (email)',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: null,
    copySkeleton: 'A soft, specific, low-pressure next step (rep-provided event/detail).',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'CAN-SPAM-compliant; plain-text opt-out mention required.',
  },
  {
    key: 'email.harvest-update',
    name: 'Harvest Update for the Base (email)',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: null,
    copySkeleton: 'A warm, honest community-expansion update (AI-inferred from recent activity) — never a vanity-metric headcount.',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'CAN-SPAM-compliant; plain-text opt-out mention required.',
  },

  // ── Launch Kit pieces (§11.4, §11.6) ───────────────────────────────────────────────────────────
  {
    key: 'launch-kit.welcome',
    name: 'Launch Kit — Welcome Message',
    contentType: 'SOCIAL_POST',
    category: null,
    launchKitPieceType: 'WELCOME',
    copySkeleton: 'A short, warm SMS/DM welcome (automatic: new member first name; rep-provided: how they joined).',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'Short, personal, no ask. Three welcome variants: personal referral, event-attendee, base-member-introduced.',
  },
  {
    key: 'launch-kit.announcement',
    name: 'Launch Kit — Announcement Post',
    contentType: 'SOCIAL_POST',
    category: null,
    launchKitPieceType: 'ANNOUNCEMENT',
    copySkeleton: 'A platform-optimized announcement celebrating the new member joining (automatic: name; rep-provided: real onboarding photo). They joined a community — never framed as anything transactional.',
    imageConceptPrompt: 'The new member\'s real onboarding photo — never a stock image.',
    platformVariants: PLATFORM_TONE,
    toneGuidance: 'Never frames the new member as a "recruit" or "sign-up".',
  },
  {
    key: 'launch-kit.day3-value',
    name: 'Launch Kit — Day-3 Value Email',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: 'DAY3_VALUE_EMAIL',
    copySkeleton: 'A pure-value email for the new member, no ask (AI-inferred topic from their onboarding context).',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'No ask.',
  },
  {
    key: 'launch-kit.day7-event',
    name: 'Launch Kit — Day-7 Event Invitation',
    contentType: 'EMAIL',
    category: null,
    launchKitPieceType: 'DAY7_EVENT_INVITE',
    copySkeleton: 'A warm, specific event invitation for the new member (rep-provided event details).',
    imageConceptPrompt: null,
    platformVariants: null,
    toneGuidance: 'Warm, specific, low-pressure.',
  },
];

/** §11.6 "three personalization tiers... Templates are version-tracked". Single source of truth for
 *  which tier a given template operates at by default (a content item can still be created at any
 *  tier — this is the template's DEFAULT/typical tier, used by the Template Library page). */
export function personalizationTierForTemplate(key: string): 'AUTOMATIC' | 'AI_INFERRED' | 'REP_PROVIDED' {
  const t = CONTENT_TEMPLATES.find((tpl) => tpl.key === key);
  if (!t) return 'AUTOMATIC';
  if (/rep-provided/i.test(t.copySkeleton)) return 'REP_PROVIDED';
  if (/AI-inferred/i.test(t.copySkeleton)) return 'AI_INFERRED';
  return 'AUTOMATIC';
}

/** DB-mirror upsert, following the AgentDefinition/`agentDefinitionRows()` convention — the in-code
 *  catalog above is the source of truth; this keeps the DB copy (read by the Template Library page,
 *  §11.6) in lockstep. Idempotent (upsert by unique `key`); safe to call repeatedly (e.g. from a
 *  lazy ensure-seeded call in the templates route, never at module scope). */
export interface ContentTemplatePrismaClient {
  contentTemplate: {
    upsert(args: {
      where: { key: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

export async function ensureTemplatesSeeded(db: ContentTemplatePrismaClient): Promise<void> {
  for (const t of CONTENT_TEMPLATES) {
    await db.contentTemplate.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        name: t.name,
        content_type: t.contentType,
        category: t.category,
        launch_kit_piece_type: t.launchKitPieceType,
        copy_skeleton: t.copySkeleton,
        image_concept_prompt: t.imageConceptPrompt,
        platform_variants: t.platformVariants,
        tone_guidance: t.toneGuidance,
        doctrine_verified: true,
      },
      update: {
        name: t.name,
        content_type: t.contentType,
        category: t.category,
        launch_kit_piece_type: t.launchKitPieceType,
        copy_skeleton: t.copySkeleton,
        image_concept_prompt: t.imageConceptPrompt,
        platform_variants: t.platformVariants,
        tone_guidance: t.toneGuidance,
      },
    });
  }
}
