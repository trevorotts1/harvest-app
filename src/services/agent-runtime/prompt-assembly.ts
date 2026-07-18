// WP04 (T-30) — prompt assembly (§4.3) + the §4.3 data-sensitivity rule.
//
// Each agent call assembles a CACHED, stable system prompt (doctrine + compliance + org context) and
// a per-call user prompt (the specific contact/task). This module builds both. It does NOT call any
// model — it only shapes text — so it is pure and trivially testable.
//
// §4.3 hard rule (enforced HERE, before any draft-producing Claude call): the rep's anchor statement
// and why-photo are the most intimate data in the product. They may seed motivational surfaces but
// are NEVER inserted into outbound content unless `WhySession.use_in_outreach_consent === true`. This
// module refuses to place the anchor into an outbound (contact-bound) prompt without that consent.

import { AgentSpec } from './runtime-model-map';

/**
 * The stable doctrine/compliance system prompt (§4.3). In production this is prompt-cached (the same
 * bytes across reps and calls). It carries the Claude-only + doctrine-vocabulary (§0.5) + compliance
 * (§5) framing every agent shares.
 */
export const DOCTRINE_SYSTEM_PROMPT = [
  'You are a specialist agent inside The Harvest, a platform for warm-market community building.',
  'Doctrine (binding): every message is a warm community introduction from someone who already has a',
  'relationship with the person — never a cold sales pitch. The rep is a recommendation specialist,',
  'not a salesperson.',
  '',
  'FORBIDDEN vocabulary (§0.5) — never use: prospect, lead, pitch, sales pitch, sales call, selling,',
  'closing (as extraction), funnel, conversion, follower, target/target audience, recruit (as an',
  'extraction verb), cold outreach, guaranteed income, "you will earn". Use the doctrine replacements',
  '(community member, contact, community introduction, invite, potential, introduction pipeline).',
  '',
  'Compliance: never make income guarantees, testimonials without substantiation, unlicensed',
  'insurance recommendations, or non-consented referral requests. Your output will pass a Compliance',
  'Filter before any human sees it; write compliant, warm, honest copy.',
].join('\n');

export interface RepContext {
  firstName?: string;
  organization?: string;
  /** The rep's anchor statement — the most intimate data (§4.3). */
  anchorStatement?: string;
  /** §4.3 gate: true only if WhySession.use_in_outreach_consent === true. */
  anchorConsentForOutreach?: boolean;
}

export interface ContactContext {
  firstName?: string;
  relationshipType?: string;
  reflectedQualities?: string[];
}

export interface AssemblePromptInput {
  spec: AgentSpec;
  /** The step being generated (its OutputSurface drives the §4.3 anchor gate). */
  surface: 'contact_outbound' | 'rep_facing' | 'internal';
  rep: RepContext;
  contact?: ContactContext;
  /** Free-form task detail the caller adds (e.g. "day-3 nurture touch"). */
  task?: string;
}

export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** True when the anchor statement was permitted into the prompt (consent + not contact-bound, or consented). */
  anchorUsed: boolean;
}

/**
 * Build the {system, user} pair for one agent step, enforcing the §4.3 anchor-consent rule.
 *
 * The anchor is placed into the prompt ONLY when it is safe:
 *   - `rep_facing`/`internal` surfaces (motivational/analytic, seen by the rep) may use it; but
 *   - a `contact_outbound` surface may use it ONLY if `anchorConsentForOutreach === true`.
 * This is the single enforcement point the spec (§4.3) requires "before any Claude call that produces
 * outbound."
 */
export function assemblePrompt(input: AssemblePromptInput): AssembledPrompt {
  const { spec, surface, rep, contact, task } = input;

  const orgLine = rep.organization ? `Rep organization: ${rep.organization}.` : 'Rep organization: (universal).';

  // §4.3 anchor gate.
  const anchorAllowed =
    Boolean(rep.anchorStatement) &&
    (surface !== 'contact_outbound' || rep.anchorConsentForOutreach === true);
  const anchorLine = anchorAllowed ? `Rep anchor (motivational framing only): ${rep.anchorStatement}` : '';

  const contactLines: string[] = [];
  if (contact?.firstName) contactLines.push(`Community member first name: ${contact.firstName}.`);
  if (contact?.relationshipType) contactLines.push(`Relationship: ${contact.relationshipType}.`);
  if (contact?.reflectedQualities?.length) {
    contactLines.push(`Qualities the rep values (reflect as "seems like", never "you are"): ${contact.reflectedQualities.join(', ')}.`);
  }

  const userPrompt = [
    `Agent: ${spec.displayName} — ${spec.fn}`,
    orgLine,
    rep.firstName ? `Rep first name: ${rep.firstName}.` : '',
    anchorLine,
    ...contactLines,
    task ? `Task: ${task}` : '',
    surface === 'contact_outbound'
      ? 'Produce a warm, doctrine-clean community introduction/touch, ready for compliance review.'
      : surface === 'rep_facing'
        ? 'Produce a short, honest, encouraging summary for the rep. No income guarantees.'
        : 'Produce a concise internal analysis.',
  ]
    .filter(Boolean)
    .join('\n');

  return { systemPrompt: DOCTRINE_SYSTEM_PROMPT, userPrompt, anchorUsed: anchorAllowed };
}
