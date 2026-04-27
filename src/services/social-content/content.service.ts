import {
  ContentCategory,
  ContentPost,
  PostStatus,
  SocialPlatform,
} from '../../types/social-content';
import { getIdentity } from './rep-identity.service';

// ── In-memory store ──────────────────────────────────────────────
const store = new Map<string, ContentPost>();

// ── Anti-hustle detection ────────────────────────────────────────
const HUSTLE_PHRASES = ['grind', 'hustle culture', 'hustle', 'rise and grind', 'no days off', 'sleep is for the weak'];

function detectAntiHustle(text: string): void {
  const lower = text.toLowerCase();
  for (const phrase of HUSTLE_PHRASES) {
    if (lower.includes(phrase)) {
      throw new Error(
        `Content blocked by anti-hustle policy: contains "${phrase}". ` +
          'Harvest promotes sustainable growth, not hustle culture.',
      );
    }
  }
}

// ── CFE mock integration ─────────────────────────────────────────
function cfeReview(post: ContentPost): ContentPost {
  // Simulate Compliance & Field Education review
  // In production, this would call the CFE service
  const reviewed: ContentPost = {
    ...post,
    cfeReviewed: true,
    status: PostStatus.APPROVED,
    updatedAt: new Date(),
  };
  return reviewed;
}

// ── Helpers ──────────────────────────────────────────────────────
let postCounter = 0;
function nextPostId(): string {
  return `post-${++postCounter}`;
}

// ── Launch Content (7 posts) ────────────────────────────────────
const LAUNCH_TEMPLATES = [
  { headline: 'I\'m Here.', body: 'Welcome to my journey with Harvest. This is the beginning of something real.', cta: 'Follow along' },
  { headline: 'Why I Said Yes', body: 'I chose Harvest because the mission aligns with my values — not the hype.', cta: 'Learn more' },
  { headline: 'My Core Values', body: 'These are the principles that guide every decision I make in this business.', cta: 'Tell me yours' },
  { headline: 'Behind the Scenes', body: 'Here\'s what a typical day looks like — not the highlight reel, the real work.', cta: 'Watch more' },
  { headline: 'What Makes This Different', body: 'I\'ve seen the other side. Harvest focuses on substance over spectacle.', cta: 'See for yourself' },
  { headline: 'Community Over Competition', body: 'I\'m building with people who lift each other up. That matters.', cta: 'Join us' },
  { headline: 'Let\'s Connect', body: 'If this resonates with you, let\'s talk. No pressure, no pitch — just a real conversation.', cta: 'DM me' },
];

export function generateLaunchContent(
  repId: string,
  identityId: string,
  platform: SocialPlatform = SocialPlatform.INSTAGRAM,
): ContentPost[] {
  const identity = getIdentity(identityId);
  if (!identity) {
    throw new Error(`Identity not found: ${identityId}. Create an identity before generating launch content.`);
  }

  const posts: ContentPost[] = LAUNCH_TEMPLATES.map((tpl, index) => {
    const body = `[${identity.brandName}] ${tpl.body}`;
    // Validate each post
    detectAntiHustle(body);
    detectAntiHustle(tpl.headline);

    const post: ContentPost = {
      id: nextPostId(),
      repId,
      category: ContentCategory.LAUNCH,
      status: PostStatus.DRAFT,
      platform,
      headline: tpl.headline,
      body,
      cta: tpl.cta,
      cfeReviewed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.set(post.id, post);
    return post;
  });

  return posts;
}

export function generateDailyPost(
  repId: string,
  identityId: string,
  topic: string,
  platform: SocialPlatform = SocialPlatform.INSTAGRAM,
): ContentPost {
  const identity = getIdentity(identityId);
  if (!identity) {
    throw new Error(`Identity not found: ${identityId}. Create an identity before generating content.`);
  }

  const headline = `Daily Insight: ${topic}`;
  const body = `[${identity.brandName}] Sharing thoughts on ${topic}. This is what I\'ve learned on my journey.`;

  detectAntiHustle(headline);
  detectAntiHustle(body);

  const post: ContentPost = {
    id: nextPostId(),
    repId,
    category: ContentCategory.DAILY,
    status: PostStatus.DRAFT,
    platform,
    headline,
    body,
    cta: 'What do you think?',
    cfeReviewed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  store.set(post.id, post);
  return post;
}

export function getContentCalendar(repId: string): ContentPost[] {
  const all: ContentPost[] = [];
  for (const post of store.values()) {
    if (post.repId === repId) {
      all.push(post);
    }
  }
  return all.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function submitForCfeReview(postId: string): ContentPost {
  const post = store.get(postId);
  if (!post) {
    throw new Error(`Post not found: ${postId}`);
  }
  const reviewed = cfeReview(post);
  store.set(postId, reviewed);
  return reviewed;
}

// Exported for testing reset
export function _resetStore(): void {
  store.clear();
  postCounter = 0;
}