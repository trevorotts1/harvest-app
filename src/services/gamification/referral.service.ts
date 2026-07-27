// T-43 (WP07 §12.7, §12.9-7) — the Referral script generator. Relationship-type templates; DIME-
// aligned where relevant (Dollar ranges, Income replacement, Monthly commitment, Education/
// background); warm open -> relationship context -> why the rep is doing this -> soft ask for an
// introduction; SMS-length + email-length versions; Sonnet 5 drafts; ALL scripts CFE-cleared BEFORE
// the rep ever sees them (never after — the draft is only returned to the caller once `gate.pass` is
// true; a held/blocked draft is persisted to `Referral` for audit but its `script_text` is never
// surfaced to the rep as usable). Referred names auto-create attributed pipeline entries
// (`Contact.referred_by_contact_id`).
//
// CLAUDE-ONLY / FAIL-CLOSED (§0.3): drafting goes through the SAME injected `AgentModelClient` every
// other Sonnet-5 workload in this app uses. A missing ANTHROPIC_API_KEY throws
// `MissingClaudeCredentialError`, caught here and turned into a `held` result — never a silent
// template stub presented as a freshly-drafted script.

import { ClaudeModelTier } from '../agent-runtime/runtime-model-map';
import type { AgentModelClient } from '../agent-runtime/claude/runtime-client';
import { AgnesRuntimeClient } from '../agent-runtime/agnes/agnes-runtime-client';
import { ComplianceFilterEngine } from '../compliance/engine';
import type { CFEInput } from '@/types/compliance';
import { gateRepFacingContent, type CFEContentEvaluator } from './cfe-gate';
import type { GamificationPrismaClient } from './prisma-types';

export type ReferralRelationshipType = 'family' | 'friend' | 'work' | 'church' | 'neighbor' | 'former_coworker' | 'coach';
export type ReferralChannel = 'SMS' | 'EMAIL';

export const ALL_RELATIONSHIP_TYPES: ReferralRelationshipType[] = ['family', 'friend', 'work', 'church', 'neighbor', 'former_coworker', 'coach'];

const RELATIONSHIP_CONTEXT: Record<ReferralRelationshipType, string> = {
  family: 'a family member — the warm open should feel like a kitchen-table conversation, not a business pitch',
  friend: 'a close friend — casual, familiar tone, references shared history',
  work: 'a current or former colleague — professional but warm, references shared work context',
  church: 'a member of the same faith community — grounded in shared values and community',
  neighbor: 'a neighbor — grounded in local, everyday familiarity',
  former_coworker: 'a former coworker — references the working relationship fondly, catches up first',
  coach: 'a coach, mentor, or teacher — respectful, references what they taught the rep',
};

export interface ReferralDeps {
  cfe?: CFEContentEvaluator;
  modelClient?: AgentModelClient;
  db?: Pick<GamificationPrismaClient, 'referral'>;
}

export interface DraftReferralOptions {
  userId: string;
  relationshipType: ReferralRelationshipType;
  channel: ReferralChannel;
  repFirstName: string;
  anchorStatement: string | null;
  includeDimeFraming: boolean; // DIME-aligned when relevant (§12.7) — the caller decides relevance (org/context)
  userContext: CFEInput['userContext'];
}

export type DraftReferralResult =
  | { status: 'ok'; referralId: string | null; text: string }
  | { status: 'held'; reason: string; referralId: string | null };

function buildSystemPrompt(opts: DraftReferralOptions): string {
  const lengthRule = opts.channel === 'SMS' ? 'Keep it under 320 characters — SMS length.' : 'Write 3-5 short paragraphs — email length.';
  const dime = opts.includeDimeFraming
    ? ' Where natural, weave in DIME-aligned framing (Dollar amount ranges, Income replacement, Monthly commitment, Education/background) without sounding like a form.'
    : '';
  return (
    'You draft a warm-market REFERRAL ASK for a Downline Maxxing rep, in the rep\'s own voice. ' +
    `The recipient is ${RELATIONSHIP_CONTEXT[opts.relationshipType]}. ` +
    'Structure EXACTLY: (1) a warm, genuine open, (2) relationship context (something true and specific), ' +
    '(3) why the rep personally is doing this work, (4) a SOFT ask for an introduction to someone the ' +
    'recipient trusts — never a hard close, never pressure. ' +
    'Doctrine vocabulary (hard rule): NEVER use the words "prospect", "lead", "pitch", "sales pitch", ' +
    '"closing", "funnel", "cold outreach", or any guaranteed-income language ("you will earn", ' +
    '"guaranteed income"). Use "community introduction" / "share" / "invite" instead. ' +
    `${lengthRule}${dime} Reply with ONLY the message text, no preamble, no quotation marks.`
  );
}

/** Drafts, CFE-clears, and persists ONE referral script. Every attempt is recorded to `Referral`
 *  (audit trail) regardless of outcome; only a `status: 'ok'` result's `text` is meant to ever reach
 *  the rep as a usable script. */
export async function draftReferralScript(opts: DraftReferralOptions, deps: ReferralDeps = {}): Promise<DraftReferralResult> {
  const cfe = deps.cfe ?? new ComplianceFilterEngine();
  const modelClient = deps.modelClient ?? new AgnesRuntimeClient();

  let draftText: string;
  try {
    const result = await modelClient.generate({
      tier: ClaudeModelTier.SONNET_5,
      systemPrompt: buildSystemPrompt(opts),
      userPrompt: `Rep's first name: ${opts.repFirstName}.${opts.anchorStatement ? ` The rep's own anchor statement (why they do this): "${opts.anchorStatement}".` : ''}`,
      maxTokens: opts.channel === 'SMS' ? 200 : 600,
    });
    draftText = result.text.trim();
  } catch {
    // Claude unavailable / transport error — FAIL CLOSED (§0.3). Persist the attempt as held, with
    // no fabricated script text.
    const referral = deps.db
      ? await deps.db.referral.create({
          data: {
            referrer_user_id: opts.userId,
            relationship_type: opts.relationshipType,
            channel: opts.channel,
            script_text: '',
            cfe_outcome: null,
            cfe_cleared: false,
            referred_contact_id: null,
          },
        })
      : null;
    return { status: 'held', reason: 'model_unavailable', referralId: referral?.id ?? null };
  }

  const gate = await gateRepFacingContent(draftText, cfe, opts.userContext, opts.channel);

  const referral = deps.db
    ? await deps.db.referral.create({
        data: {
          referrer_user_id: opts.userId,
          relationship_type: opts.relationshipType,
          channel: opts.channel,
          script_text: draftText,
          cfe_outcome: gate.pass ? 'PASS' : gate.verdict.band === 'blocked' || gate.verdict.held ? 'BLOCK' : 'FLAG',
          cfe_cleared: gate.pass,
          referred_contact_id: null,
        },
      })
    : null;

  if (!gate.pass) {
    return { status: 'held', reason: gate.reason, referralId: referral?.id ?? null };
  }
  return { status: 'ok', referralId: referral?.id ?? null, text: draftText };
}

interface AttributionDb {
  contact: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    findFirst(args: { where: { id: string; user_id: string } }): Promise<{ id: string } | null>;
  };
  referral: { findFirst(args: { where: { id: string; referrer_user_id: string } }): Promise<{ id: string } | null>; update(args: { where: { id: string }; data: { referred_contact_id: string } }): Promise<unknown> };
}

/** §12.7 "Referred names auto-create pipeline entries linked to their referrer, with attribution."
 *  `referrerContactId` is the EXISTING contact who gave the referral (the person the rep asked) —
 *  ownership-checked: both the referral and (if provided) the referrer contact must belong to this
 *  rep, otherwise 404-equivalent (`null`), never a 403/existence leak (§16.6). */
export async function recordReferredContact(
  db: AttributionDb,
  userId: string,
  referralId: string,
  referrerContactId: string | null,
  newContact: { firstName: string; lastName: string; relationshipType: ReferralRelationshipType }
): Promise<{ contactId: string } | null> {
  const referral = await db.referral.findFirst({ where: { id: referralId, referrer_user_id: userId } });
  if (!referral) return null; // ownership check — 404-equivalent, never leaks existence
  if (referrerContactId) {
    const owned = await db.contact.findFirst({ where: { id: referrerContactId, user_id: userId } });
    if (!owned) return null;
  }

  const contact = await db.contact.create({
    data: {
      user_id: userId,
      first_name: newContact.firstName,
      last_name: newContact.lastName,
      relationship_type: newContact.relationshipType,
      source: 'REFERRAL',
      referred_by_contact_id: referrerContactId,
    },
  });
  await db.referral.update({ where: { id: referralId }, data: { referred_contact_id: contact.id } });
  return { contactId: contact.id };
}
