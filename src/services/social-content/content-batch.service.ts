// T-41 (WP06 §11.1/§11.3, AC §11.8-2 "A weekly batch produces 7+ social posts, 1 blog draft, 2 email
// drafts per rep on Sonnet 5") — the weekly batch orchestrator. Every piece goes through the SAME
// three-layer doctrine pipeline (content-generation.ts's regenerate-on-violation loop, then
// ContentItemService.createFromDraft's CFE gate) — there is no second, looser path into the queue.

import type { ContentCategory, SocialPlatform } from '@prisma/client';
import {
  buildBlogPrompt,
  buildEmailPrompt,
  buildSocialPostPrompt,
  type EmailTouch,
} from './prompt-library';
import {
  detectMassPersonalization,
  generateDoctrineCleanDraft,
  parseBlogResponse,
  parseEmailResponse,
  parseSocialPostResponse,
  type GeneratedDraft,
  type GenerationDeps,
} from './content-generation';
import { ContentBriefService, type ContentBriefPrismaClient } from './content-brief.service';
import { ContentItemService, type ContentItemRow } from './content-item.service';

/** §11.1 cadence: Instagram 3-5/wk, Facebook 3-5/wk, LinkedIn 2-3/wk, across the five doctrine
 *  categories. This plan (3+3+2 = 8) comfortably clears the AC's "7+ social posts" floor while
 *  staying inside every platform's own weekly range. */
const SOCIAL_PLAN: { platform: SocialPlatform; category: ContentCategory }[] = [
  { platform: 'INSTAGRAM', category: 'COMMUNITY_SPOTLIGHT' },
  { platform: 'INSTAGRAM', category: 'BEHIND_THE_HARVEST' },
  { platform: 'INSTAGRAM', category: 'VALUE_FIRST_EDUCATION' },
  { platform: 'FACEBOOK', category: 'MOVEMENT_FRAMING' },
  { platform: 'FACEBOOK', category: 'COMMUNITY_SPOTLIGHT' },
  { platform: 'FACEBOOK', category: 'EVENT_INTRODUCTION_ANNOUNCEMENT' },
  { platform: 'LINKEDIN', category: 'VALUE_FIRST_EDUCATION' },
  { platform: 'LINKEDIN', category: 'MOVEMENT_FRAMING' },
];

/** §11.3 "2 email drafts per rep" for the weekly batch (distinct from the launch kit's own
 *  welcome/day-3/day-7 pieces, and from WP05's per-contact outreach messaging). */
const WEEKLY_EMAIL_TOUCHES: EmailTouch[] = ['value', 'harvest_update'];

function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export interface WeeklyBatchResult {
  briefId: string;
  items: ContentItemRow[];
  crosswalk: string;
}

export class ContentBatchService {
  constructor(
    private briefService: ContentBriefService,
    private contentItemService: ContentItemService,
    private generation: GenerationDeps
  ) {}

  async generateWeeklyBatch(userId: string, now: Date = new Date()): Promise<WeeklyBatchResult> {
    const identity = await this.briefService.loadRepIdentity(userId);
    const context = await this.briefService.buildContext(userId, identity.organizationId, now);
    const brief = await this.briefService.createBrief(userId, startOfWeek(now), context);
    const contextNote = this.briefService.contextNote(context) || null;

    // ── Social posts (§11.1) ──────────────────────────────────────────────────────────────────────
    const socialDrafts: { plan: (typeof SOCIAL_PLAN)[number]; draft: GeneratedDraft }[] = [];
    for (const plan of SOCIAL_PLAN) {
      const prompt = buildSocialPostPrompt({
        platform: plan.platform,
        category: plan.category,
        repFirstName: identity.firstName,
        anchorStatement: identity.anchorStatement,
        contextNote,
      });
      const draft = await generateDoctrineCleanDraft(
        { systemPrompt: prompt.system, userPrompt: prompt.user, parse: parseSocialPostResponse },
        this.generation
      );
      socialDrafts.push({ plan, draft });
    }

    // ── Batch-level mass-personalization / cold-pitch guard (§11.7, AC-6) ────────────────────────
    const bodies = socialDrafts.map((d) => d.draft.body);
    const dup = detectMassPersonalization(bodies);
    for (const [i, j] of dup.duplicatePairs) {
      const plan = socialDrafts[j].plan;
      const prompt = buildSocialPostPrompt({
        platform: plan.platform,
        category: plan.category,
        repFirstName: identity.firstName,
        anchorStatement: identity.anchorStatement,
        contextNote,
      });
      const correctedUser = `${prompt.user}\n\nIMPORTANT: an earlier post in this batch is structurally too similar to what you're about to write. Make this one clearly distinct in structure and specifics — every piece must feel written for ONE specific reader, never a mail-merge template. The earlier post: "${bodies[i]}"`;
      const redraft = await generateDoctrineCleanDraft(
        { systemPrompt: prompt.system, userPrompt: correctedUser, parse: parseSocialPostResponse },
        this.generation
      );
      socialDrafts[j] = { plan, draft: redraft };
      bodies[j] = redraft.body;
    }

    // ── Blog (§11.3: 1-2/wk) ──────────────────────────────────────────────────────────────────────
    const blogPrompt = buildBlogPrompt({
      repFirstName: identity.firstName,
      anchorStatement: identity.anchorStatement,
      contextNote,
    });
    const blogDraft = await generateDoctrineCleanDraft(
      { systemPrompt: blogPrompt.system, userPrompt: blogPrompt.user, parse: parseBlogResponse, maxTokens: 3000 },
      this.generation
    );

    // ── Email (§11.3: 2 drafts for the weekly batch) ─────────────────────────────────────────────
    const emailDrafts: { touch: EmailTouch; draft: GeneratedDraft }[] = [];
    for (const touch of WEEKLY_EMAIL_TOUCHES) {
      const prompt = buildEmailPrompt({ touch, repFirstName: identity.firstName, anchorStatement: identity.anchorStatement, contextNote });
      const draft = await generateDoctrineCleanDraft(
        { systemPrompt: prompt.system, userPrompt: prompt.user, parse: parseEmailResponse },
        this.generation
      );
      emailDrafts.push({ touch, draft });
    }

    // ── Persist everything through the ONE gate (ContentItemService.createFromDraft) ────────────
    const items: ContentItemRow[] = [];
    for (const { plan, draft } of socialDrafts) {
      const { item } = await this.contentItemService.createFromDraft({
        userId,
        contentType: 'SOCIAL_POST',
        category: plan.category,
        platform: plan.platform,
        briefId: brief.id,
        headline: draft.headline ?? null,
        body: draft.body,
        imageConceptPrompt: draft.imageConceptPrompt ?? null,
        vocabClean: draft.vocabClean,
        vocabViolations: draft.vocabClean ? null : draft.doctrineNotes,
        doctrineNotes: draft.doctrineNotes,
        modelUsed: draft.modelId,
      });
      items.push(item);
    }

    const { item: blogItem } = await this.contentItemService.createFromDraft({
      userId,
      contentType: 'BLOG',
      category: 'VALUE_FIRST_EDUCATION',
      briefId: brief.id,
      headline: blogDraft.headline ?? null,
      body: blogDraft.body,
      vocabClean: blogDraft.vocabClean,
      vocabViolations: blogDraft.vocabClean ? null : blogDraft.doctrineNotes,
      doctrineNotes: blogDraft.doctrineNotes,
      modelUsed: blogDraft.modelId,
    });
    items.push(blogItem);

    for (const { draft } of emailDrafts) {
      const { item } = await this.contentItemService.createFromDraft({
        userId,
        contentType: 'EMAIL',
        briefId: brief.id,
        headline: draft.headline ?? null,
        body: draft.body,
        vocabClean: draft.vocabClean,
        vocabViolations: draft.vocabClean ? null : draft.doctrineNotes,
        doctrineNotes: draft.doctrineNotes,
        modelUsed: draft.modelId,
      });
      items.push(item);
    }

    // ── §11.3 "the agent produces a weekly content crosswalk" ────────────────────────────────────
    const crosswalk = this.buildCrosswalkNarrative(socialDrafts.length, blogDraft, emailDrafts.length);
    await this.briefService.setCrosswalk(brief.id, crosswalk);

    return { briefId: brief.id, items, crosswalk };
  }

  private buildCrosswalkNarrative(
    socialCount: number,
    blogDraft: GeneratedDraft,
    emailCount: number
  ): string {
    const platformCounts = SOCIAL_PLAN.reduce<Record<string, number>>((acc, p) => {
      acc[p.platform] = (acc[p.platform] ?? 0) + 1;
      return acc;
    }, {});
    const platformSummary = Object.entries(platformCounts)
      .map(([platform, count]) => `${count} ${platform.charAt(0)}${platform.slice(1).toLowerCase()}`)
      .join(', ');
    return `This week's blog ("${blogDraft.headline ?? 'this week\'s post'}") auto-summarizes into ${socialCount} social posts (${platformSummary}) and ${emailCount} email touches — one coherent story, adapted per surface.`;
  }
}

export type { ContentBriefPrismaClient };
