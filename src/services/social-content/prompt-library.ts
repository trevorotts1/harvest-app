// T-41 (WP06 §11.1/§11.2/§11.3/§11.4/§11.6) — prompt assembly for every content-generation call this
// build unit makes. Consumes the compliance module's own forbidden-term table (read-only) so the
// negative constraint (§11.2 layer 1) is never a second, drifting copy of §0.5's vocabulary map.

import { FORBIDDEN_TERMS } from '@/services/compliance/vocabulary';
import type { ContentCategory, ContentType, LaunchKitPieceType, SocialPlatform, WelcomeVariant } from '@prisma/client';

/** §14/§11.2 — "reinforces or at least doesn't contradict the Three Laws". */
export const THREE_LAWS = ['Grow the Downline', 'Engage the Base', 'Increase Wealth'] as const;

/** §11.2 layer 1 — the negative constraint, generated FROM the single source of truth
 *  (compliance/vocabulary.ts's FORBIDDEN_TERMS), never hand-duplicated. */
function forbiddenTermsBlock(): string {
  const lines = FORBIDDEN_TERMS.map((r) => `  - NEVER use "${r.forbidden}" — say "${r.replacement}" instead.`);
  return lines.join('\n');
}

/** The doctrine spine every WP06 system prompt shares (§11.2, §14, §1.2). */
export function doctrineSystemPreamble(): string {
  return `You write for The Harvest, a warm-market community-building platform. You write from the philosophical DNA that "sharing influence is love" — every piece treats the reader as a relationship, never a transaction.

The Three Laws (every piece reinforces, or at minimum never contradicts, all three): ${THREE_LAWS.join(', ')}. Growth is reported as "community expansion," never "follower growth." The audience is always "community," "base," or "downline" — never "followers" or a "target audience."

Doctrine vocabulary — FORBIDDEN terms and their required replacements:
${forbiddenTermsBlock()}

Anti-patterns you must NEVER produce:
  - Extraction-based content ("join my team and earn $X", false scarcity, pressure tactics).
  - Cold-pitch mass-personalization — every piece must feel written for ONE specific reader, never a mail-merge template.
  - Vanity-metric bragging ("we hit 1,000 followers/members") — report community expansion, not headcounts.
  - "Harvest-Hoarder" framing — never present the rep as a singular success; always acknowledge the base/team/community's collective benefit.
  - Never frame a new member as a "recruit" or a "sign-up" — they are a community member who joined.

Write plainly, warmly, and specifically. Do not use placeholder tokens like {{name}} or [NAME] — if you don't have a real name, write around it in natural language.`;
}

/** Appended to the user prompt on a regeneration pass, after a doctrine-guard violation. */
export function regenerationCorrectionNote(reasons: string[]): string {
  return `\n\nYour previous draft violated doctrine and must be rewritten from scratch (not lightly edited) to avoid ALL of the following:\n${reasons.map((r) => `  - ${r}`).join('\n')}`;
}

const CATEGORY_GUIDANCE: Record<ContentCategory, string> = {
  COMMUNITY_SPOTLIGHT: 'Spotlight a specific community/base member\'s story or win, in their own words where possible, crediting them by first name only. Center THEM, not the rep.',
  VALUE_FIRST_EDUCATION: 'Teach one genuinely useful idea (financial literacy, mindset, relationship-building) with no ask attached. Pure value.',
  MOVEMENT_FRAMING: 'Frame the work as part of a larger movement (Social 4 / Downline Maxxing) — collective momentum, not individual achievement.',
  BEHIND_THE_HARVEST: 'A candid, human, behind-the-scenes moment from the rep\'s actual week — the real work, not a highlight reel.',
  EVENT_INTRODUCTION_ANNOUNCEMENT: 'Announce an upcoming event or introduce a new community connection warmly, with a specific low-pressure next step.',
};

const PLATFORM_GUIDANCE: Record<SocialPlatform, string> = {
  INSTAGRAM: 'Instagram — visual-first, carousel/story friendly, warm and personal, short punchy lines.',
  FACEBOOK: 'Facebook — long-form narrative with a group-share angle; more room to tell the whole story.',
  LINKEDIN: 'LinkedIn — professional thought-leadership tone; substantive, credible, no hype.',
};

export interface SocialPostPromptInput {
  platform: SocialPlatform;
  category: ContentCategory;
  repFirstName: string;
  anchorStatement?: string | null;
  contextNote?: string | null;
}

export function buildSocialPostPrompt(input: SocialPostPromptInput): { system: string; user: string } {
  const system = `${doctrineSystemPreamble()}\n\nYou are drafting ONE social post for ${PLATFORM_GUIDANCE[input.platform]}\n\nCategory focus: ${CATEGORY_GUIDANCE[input.category]}\n\nAfter the post body, on a new line starting with "IMAGE CONCEPT:", write a one-sentence image-concept prompt (NOT a final image) for the rep to shoot or source themselves. Avoid stock clichés, money symbols, and handshake photos — default to community, natural, and harvest imagery (fields, gatherings, warm light, real people).`;
  const user = `Rep first name: ${input.repFirstName}.${input.anchorStatement ? ` Their anchor statement (why they do this): "${input.anchorStatement}".` : ''}${input.contextNote ? ` Context for this week: ${input.contextNote}` : ''}\n\nWrite the post now (body only, then the IMAGE CONCEPT line).`;
  return { system, user };
}

export interface BlogPromptInput {
  repFirstName: string;
  anchorStatement?: string | null;
  contextNote?: string | null;
}

export function buildBlogPrompt(input: BlogPromptInput): { system: string; user: string } {
  const system = `${doctrineSystemPreamble()}\n\nYou are drafting ONE long-form blog post (600-1500 words), educational AND narrative. It MUST include: (1) a community-introduction story, (2) a reference to the Three Laws, (3) a soft invitation (never a hard ask) at the end.`;
  const user = `Rep first name: ${input.repFirstName}.${input.anchorStatement ? ` Their anchor statement: "${input.anchorStatement}".` : ''}${input.contextNote ? ` Context for this week: ${input.contextNote}` : ''}\n\nWrite the blog post now, with a clear headline on the first line.`;
  return { system, user };
}

export type EmailTouch = 'welcome' | 'value' | 'invite' | 'harvest_update';

const EMAIL_TOUCH_GUIDANCE: Record<EmailTouch, string> = {
  welcome: 'A warm welcome touch — no ask.',
  value: 'A pure-value touch — one useful idea, no ask.',
  invite: 'A soft, low-pressure invitation touch — a specific next step, never pressure.',
  harvest_update: 'A "Harvest Update" for the base — a warm, honest update on community progress (community expansion, not vanity metrics).',
};

export interface EmailPromptInput {
  touch: EmailTouch;
  repFirstName: string;
  anchorStatement?: string | null;
  contextNote?: string | null;
}

export function buildEmailPrompt(input: EmailPromptInput): { system: string; user: string } {
  const system = `${doctrineSystemPreamble()}\n\nYou are drafting ONE CAN-SPAM-compliant email touch: ${EMAIL_TOUCH_GUIDANCE[input.touch]} Include a clear, honest subject line as the first line prefixed "SUBJECT:", then the body. The body must include a plain-text unsubscribe/opt-out mention at the end (e.g. "Reply STOP to opt out").`;
  const user = `Rep first name: ${input.repFirstName}.${input.anchorStatement ? ` Their anchor statement: "${input.anchorStatement}".` : ''}${input.contextNote ? ` Context: ${input.contextNote}` : ''}\n\nWrite the email now.`;
  return { system, user };
}

const LAUNCH_PIECE_GUIDANCE: Record<LaunchKitPieceType, string> = {
  WELCOME: 'A warm welcome message (SMS/DM length — short, personal, no ask).',
  ANNOUNCEMENT: 'A platform-optimized announcement post celebrating the new member joining the community. NEVER frame them as a "recruit" or "sign-up" — they joined a community.',
  DAY3_VALUE_EMAIL: 'A day-3 value email for the new member — pure value, no ask.',
  DAY7_EVENT_INVITE: 'A day-7 event invitation email for the new member — warm, specific, low-pressure.',
};

const WELCOME_VARIANT_GUIDANCE: Record<WelcomeVariant, string> = {
  PERSONAL_REFERRAL: 'They joined through a personal referral from someone they already know.',
  EVENT_ATTENDEE: 'They joined after attending a community event.',
  BASE_MEMBER_INTRODUCED: 'They were introduced by an existing base member.',
};

export interface LaunchKitPiecePromptInput {
  piece: LaunchKitPieceType;
  welcomeVariant: WelcomeVariant;
  newMemberFirstName: string;
  repFirstName: string;
  anchorStatement?: string | null;
}

export function buildLaunchKitPiecePrompt(input: LaunchKitPiecePromptInput): { system: string; user: string } {
  const system = `${doctrineSystemPreamble()}\n\nYou are drafting ONE piece of a new-member launch kit: ${LAUNCH_PIECE_GUIDANCE[input.piece]}`;
  const user = `New member first name: ${input.newMemberFirstName}. How they joined: ${WELCOME_VARIANT_GUIDANCE[input.welcomeVariant]} Sponsoring rep first name: ${input.repFirstName}.${input.anchorStatement ? ` Rep's anchor statement: "${input.anchorStatement}".` : ''}\n\nWrite this piece now.`;
  return { system, user };
}

/** For DB persistence traceability only — not sent to the model. */
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  SOCIAL_POST: 'Social post',
  BLOG: 'Blog',
  EMAIL: 'Email',
};
