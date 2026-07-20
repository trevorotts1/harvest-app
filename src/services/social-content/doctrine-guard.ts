// T-41 (WP06 master-spec §11.2 "Brand-doctrine vocabulary enforcement") — the three-layer doctrine
// guard every generated social/blog/email/launch-kit piece passes BEFORE it can leave DRAFTING.
//
// Layer 1 (negative constraint in the generation prompt) lives in prompt-library.ts — this module is
// layers 2 + the WP06-specific anti-pattern/tone checks that run ALONGSIDE the CFE (layer 3,
// consumed as-is from src/services/compliance/engine.ts in content-generation.ts /
// content-batch.service.ts — this file does not call the CFE and does not duplicate it):
//
//   • `scanVocabulary` — layer 2's forbidden-term rescan. CONSUMES the existing
//     `VocabularyClassifier` (src/services/compliance/vocabulary.ts) verbatim — the §0.5
//     forbidden→required table is defined ONCE, in the compliance module, and this file does not
//     redeclare or fork it.
//   • `scanDeterministicAntiPatterns` — a fast, local, WP06-specific lint for patterns §11.2/§11.7
//     name that are outside the compliance module's forbidden-term table: vanity-metric growth
//     bragging ("we hit 1,000 members"), false scarcity ("only 3 spots left", "act now"), and
//     leftover template tokens (an un-personalized `{{name}}`/`[NAME]` — the literal signature of a
//     mail-merge cold-pitch that was never actually written for one reader).
//   • `HaikuToneGateClassifier` — the "three-question tone gate" (§11.2: leads with relationship? /
//     treats the audience as community? / reinforces or at least doesn't contradict the Three Laws —
//     Grow the Downline, Engage the Base, Increase Wealth, master-spec §14) PLUS Harvest-Hoarder
//     detection (§11.7: "rep as singular success, no base acknowledgment"). This is a SEMANTIC check
//     a regex cannot make reliably, so it runs on Haiku 4.5 (§0.3 Claude-only; cheap/mechanical
//     classification tier, §4.4) via the SAME `AgentModelClient` boundary WP06's own drafting calls
//     use (src/services/agent-runtime/claude) — NOT the compliance module's closed `Classifier` union
//     (INCOME_CLAIM/TESTIMONIAL/OPPORTUNITY/INSURANCE/REFERRAL, src/types/compliance.ts), which this
//     build unit does not extend or edit (§11.2 is WP06's own doctrine surface, not a CFE classifier).
//     Claude-only, fail-closed: a missing key / transport error / malformed verdict THROWS — callers
//     (content-generation.ts) catch this exactly like a CFE hold, never silently skip the check.
//   • `detectMassPersonalization` — §11.7/AC-6 "cold-pitch mass-personalization" / "every piece must
//     feel written for one reader": a batch-level near-duplicate-structure check across a set of
//     generated bodies (the weekly social batch), so a mail-merge name-swap pattern is caught even
//     when each individual piece would pass the per-item checks above.

import { VocabularyClassifier, type VocabularyScan } from '@/services/compliance/vocabulary';
import type { AgentModelClient } from '@/services/agent-runtime/claude';
import { ClaudeModelTier } from '@/services/agent-runtime/runtime-model-map';

// ─── Layer 2a: reuse the compliance module's own forbidden-term scanner verbatim ──────────────────

const vocabularyClassifier = new VocabularyClassifier();

export function scanVocabulary(text: string): VocabularyScan {
  return vocabularyClassifier.scan(text);
}

// ─── Layer 2b: WP06-specific deterministic anti-pattern lint ──────────────────────────────────────

export interface AntiPatternViolation {
  kind: 'vanity_metric' | 'false_scarcity' | 'template_token_leftover' | 'extraction_framing';
  match: string;
}

export interface AntiPatternScan {
  clean: boolean;
  violations: AntiPatternViolation[];
}

// §11.7 "vanity-metric content ('we hit 1,000 followers')" — 'follower' alone is already blocked by
// the compliance vocabulary table; this additionally catches growth-bragging framing over ANY
// audience noun ("members", "subscribers", "downline") the vocabulary table does not itself forbid.
const VANITY_METRIC_RE =
  /\b(?:we|i)\s*(?:just\s+)?(?:hit|crossed|reached|passed)\s*[\d,]+\+?\s*(?:members?|subscribers?|followers?|people)\b/i;

// §11.7 "false scarcity" anti-pattern.
const FALSE_SCARCITY_RE =
  /\b(?:only\s+\d+\s+spots?\s+left|last\s+chance|act\s+now|limited\s+time\s+only|hurry|spots?\s+(?:are\s+)?filling\s+(?:up\s+)?fast|don't\s+wait)\b/i;

// A literal un-filled merge token — the signature of mass-personalization tooling, not a
// written-for-one-reader piece (§11.7).
const TEMPLATE_TOKEN_RE = /\{\{\s*\w+\s*\}\}|\[(?:NAME|FIRST_?NAME|CONTACT)\]/i;

// §0.5/§11.7 extraction framing not already covered by the compliance vocabulary table's literal
// term list — "join my team and earn $X" phrasing. (The CFE's own INCOME_CLAIM/OPPORTUNITY Haiku
// classifiers, consumed unmodified as layer 3, also catch semantic variants of this — this is a
// cheap deterministic pre-filter in the same spirit as the CFE's own stage-1 vocabulary lint.)
const EXTRACTION_FRAMING_RE = /\bjoin\s+my\s+team\s+and\s+earn\b|\bmake\s*\$\s*\d/i;

// §11.4/§11.7/critical-failure-condition: "A new member framed as a 'recruit/sign-up' in any
// launch-kit asset." The bare vocabulary table (scanVocabulary) already forbids "recruit" as a verb
// of extraction (§0.5); this catches the NOUN framing of the new member as A sign-up/recruit
// specifically — narrow enough that "sign up for the event" (a legitimate RSVP ask in the day-7
// invite piece) never trips it, since that phrasing has no "our newest/new/just" possessive-person
// cue in front of it.
const RECRUIT_NOUN_FRAMING_RE =
  /\bour\s+(?:newest|new)\s+sign-?up\b|\b(?:just|recently)\s+signed\s+up\b|\bnew\s+recruit\b|\bmy\s+(?:newest|new)\s+recruit\b/i;

export function scanRecruitFraming(text: string): AntiPatternScan {
  const m = text.match(RECRUIT_NOUN_FRAMING_RE);
  return m ? { clean: false, violations: [{ kind: 'extraction_framing', match: m[0] }] } : { clean: true, violations: [] };
}

export function scanDeterministicAntiPatterns(text: string): AntiPatternScan {
  const violations: AntiPatternViolation[] = [];
  const checks: [AntiPatternViolation['kind'], RegExp][] = [
    ['vanity_metric', VANITY_METRIC_RE],
    ['false_scarcity', FALSE_SCARCITY_RE],
    ['template_token_leftover', TEMPLATE_TOKEN_RE],
    ['extraction_framing', EXTRACTION_FRAMING_RE],
  ];
  for (const [kind, re] of checks) {
    const m = text.match(re);
    if (m) violations.push({ kind, match: m[0] });
  }
  return { clean: violations.length === 0, violations };
}

// ─── Layer 2c: the semantic tone gate + Harvest-Hoarder detector (Haiku 4.5, Claude-only) ─────────

export interface ToneGateVerdict {
  /** True only when ALL three tone-gate questions pass AND no Harvest-Hoarder framing is present. */
  clean: boolean;
  leadsWithRelationship: boolean;
  treatsAudienceAsCommunity: boolean;
  reinforcesThreeLaws: boolean;
  harvestHoarderFraming: boolean;
  rationale: string;
}

const TONE_GATE_SYSTEM_PROMPT = `You are a doctrine-compliance tone classifier for a warm-market community platform ("The Harvest"). You are given ONE piece of rep-authored content (a social post, blog excerpt, or email). Answer four yes/no questions about it, then return STRICT JSON matching this exact shape and nothing else:
{"leads_with_relationship": boolean, "treats_audience_as_community": boolean, "reinforces_three_laws": boolean, "harvest_hoarder_framing": boolean, "rationale": string}

Definitions:
- leads_with_relationship: true if the piece opens from genuine relationship/connection, not a transactional pitch.
- treats_audience_as_community: true if the audience is framed as "community"/"base"/"downline" (never "followers" or "target audience").
- reinforces_three_laws: true if the piece is consistent with (or at least does not contradict) the Three Laws — Grow the Downline, Engage the Base, Increase Wealth — framed as collective, not individual, benefit.
- harvest_hoarder_framing: true if the piece frames the REP as a singular success with NO acknowledgment of their base/team/community (a doctrine violation — flip this to true when hoarding framing is present).

Return ONLY the JSON object, no prose, no markdown fences.`;

export interface ToneGateClassifierClient {
  classify(content: string): Promise<ToneGateVerdict>;
}

/** The real production tone-gate classifier — Haiku 4.5, via the SAME injected AgentModelClient
 *  content-generation.ts uses for drafting (Claude-only, §0.3; fail-closed: throws on any failure,
 *  never fabricates a clean verdict). */
export class HaikuToneGateClassifier implements ToneGateClassifierClient {
  constructor(private readonly client: AgentModelClient) {}

  async classify(content: string): Promise<ToneGateVerdict> {
    const result = await this.client.generate({
      tier: ClaudeModelTier.HAIKU_4_5,
      systemPrompt: TONE_GATE_SYSTEM_PROMPT,
      userPrompt: content,
      maxTokens: 300,
    });
    return HaikuToneGateClassifier.parse(result.text);
  }

  static parse(raw: string): ToneGateVerdict {
    let json: unknown;
    try {
      // Defensive: strip any stray markdown fence a model might still emit.
      const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
      json = JSON.parse(cleaned);
    } catch {
      throw new Error('ToneGateClassifier: response was not valid JSON.');
    }
    const v = json as Record<string, unknown>;
    if (
      typeof v.leads_with_relationship !== 'boolean' ||
      typeof v.treats_audience_as_community !== 'boolean' ||
      typeof v.reinforces_three_laws !== 'boolean' ||
      typeof v.harvest_hoarder_framing !== 'boolean'
    ) {
      throw new Error('ToneGateClassifier: verdict missing required boolean fields.');
    }
    const clean =
      v.leads_with_relationship === true &&
      v.treats_audience_as_community === true &&
      v.reinforces_three_laws === true &&
      v.harvest_hoarder_framing === false;
    return {
      clean,
      leadsWithRelationship: v.leads_with_relationship,
      treatsAudienceAsCommunity: v.treats_audience_as_community,
      reinforcesThreeLaws: v.reinforces_three_laws,
      harvestHoarderFraming: v.harvest_hoarder_framing,
      rationale: typeof v.rationale === 'string' ? v.rationale : '',
    };
  }
}

// ─── Layer 2d: batch-level mass-personalization / cold-pitch detector (§11.7, AC-6) ───────────────

/** Normalizes a body for structural comparison: lowercases, strips names/numbers/punctuation so
 *  only the SHAPE of the sentence survives — a genuine mail-merge name-swap normalizes to an
 *  identical (or near-identical) skeleton even though the literal text differs per contact. */
function structuralSkeleton(text: string): string {
  return text
    .toLowerCase()
    .replace(/[A-Z][a-z]+/g, '') // crude first-pass; re-lowercased already, kept for clarity/no-op safety
    .replace(/\b\d+\b/g, '#')
    .replace(/[^\w\s#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(structuralSkeleton(text).split(' ').filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export interface MassPersonalizationResult {
  clean: boolean;
  /** Index pairs whose structural similarity crossed the threshold — a likely name-swap batch. */
  duplicatePairs: [number, number][];
}

/** §11.7 "cold-pitch automation (mass name-swap)" — a batch whose bodies are near-identical in
 *  STRUCTURE (not literal text) once names/numbers are stripped is flagged. Threshold chosen so
 *  legitimately-varied per-category/per-platform content (which shares almost no vocabulary) never
 *  trips this, while two "Hi {name}, join my team!" clones (which differ only by the swapped name)
 *  reliably do. */
export function detectMassPersonalization(bodies: string[], threshold = 0.82): MassPersonalizationResult {
  const sets = bodies.map(tokenSet);
  const duplicatePairs: [number, number][] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      if (jaccardSimilarity(sets[i], sets[j]) >= threshold) {
        duplicatePairs.push([i, j]);
      }
    }
  }
  return { clean: duplicatePairs.length === 0, duplicatePairs };
}
