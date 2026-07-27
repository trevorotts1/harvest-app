// T-43 (WP07 §12.8 P1, §12.9-9) — Ask Harvest: an in-app coach (Sonnet 5) grounded EXCLUSIVELY in
// the course, the objection tree, and brand doctrine. Answers "what do I say when..." in the rep's
// own voice; clearly labeled coaching; NEVER sends outbound without the CFE (this service has no
// send path at all — it only ever returns coaching text to the rep; an actual outbound send, if the
// rep copies guidance into a real message, goes through the pre-existing, unmodified compose/CFE/
// send pipeline, so there is no separate CFE bypass to build or audit here).
//
// GROUNDING (§12.9-9 "answering from outside course/objection/doctrine sources" is a critical failure
// this build must refuse): a deterministic, keyword-based SCOPE GATE runs BEFORE any Claude call. An
// out-of-scope question (matching none of the Harvest-vocabulary allow-list drawn from the real
// course catalog + the real WP05 objection tree + core doctrine terms) is refused immediately — no
// model call happens at all, so the refusal is provable without a live Claude key and cannot be
// talked around by prompt-injecting the model. An in-scope question is answered by Sonnet 5, given
// ONLY the matched course modules/objection entries as context (not open-ended knowledge), with an
// explicit system instruction to say so if it still cannot answer from that material.

import { ClaudeModelTier } from '../agent-runtime/runtime-model-map';
import type { AgentModelClient } from '../agent-runtime/claude/runtime-client';
import { AgnesRuntimeClient } from '../agent-runtime/agnes/agnes-runtime-client';
import { COURSE_MODULES } from './course-catalog';
import { OBJECTION_TREE } from '../messaging/objection/objection-tree';

const DOCTRINE_TERMS = [
  'anchor statement', 'seven whys', 'belief', 'community introduction', 'warm market', 'downline',
  'collective benefit', 'hoarder', 'momentum', 'streak', 'consistency', 'three laws', 'grow', 'engage',
  'wealth', 'harvest', 'referral', 'course', 'module', 'objection', 'pyramid scheme', 'mlm', 'no time',
  'no money', 'not a salesperson', 'think about it', 'tried before', 'primerica', 'commission',
  'downline maxxing', 'ask harvest', 'shift', 'ritual', 'intensity', 'goal commitment',
];

function scopeKeywords(): string[] {
  const fromCourse = COURSE_MODULES.flatMap((m) => [m.title.toLowerCase(), m.key.replace(/_/g, ' ')]);
  const fromObjections = OBJECTION_TREE.flatMap((o) => [o.label.toLowerCase(), o.key.replace(/_/g, ' ')]);
  return [...DOCTRINE_TERMS, ...fromCourse, ...fromObjections];
}

export function isInScope(question: string): boolean {
  const q = question.toLowerCase();
  return scopeKeywords().some((kw) => q.includes(kw));
}

const OUT_OF_SCOPE_REFUSAL =
  "Ask Harvest only coaches from the Downline Maxxing course, the objection scripts, and brand doctrine — " +
  "I don't have grounded guidance for that question. Try asking about an objection you heard, the Three " +
  "Laws, your anchor statement, streaks, or the course modules.";

export interface AskHarvestResult {
  status: 'ok' | 'refused' | 'held';
  label: 'coaching';
  answer: string | null;
  reason?: string;
}

export interface AskHarvestDeps {
  modelClient?: AgentModelClient;
}

function groundingContext(question: string): string {
  const q = question.toLowerCase();
  const matchedModules = COURSE_MODULES.filter((m) => q.includes(m.title.toLowerCase()) || q.includes(m.key.replace(/_/g, ' ')));
  const matchedObjections = OBJECTION_TREE.filter((o) => q.includes(o.label.toLowerCase()) || q.includes(o.key.replace(/_/g, ' ')));

  const parts: string[] = [];
  for (const m of matchedModules.length ? matchedModules : COURSE_MODULES) {
    parts.push(`COURSE MODULE — ${m.title}: ${m.body}`);
  }
  for (const o of matchedObjections) {
    parts.push(`OBJECTION — "${o.label}" — clarifying question: "${o.clarifyingQuestion}" — branches: ${o.branches.map((b) => `${b.label}: ${b.response}`).join(' | ')}`);
  }
  return parts.join('\n\n');
}

/** Answers a rep's coaching question. Returns `refused` (deterministic, no model call) for anything
 *  outside the course/objection/doctrine vocabulary; `held` if Claude is unavailable for an in-scope
 *  question (fail-closed, §0.3 — never a fabricated coaching answer); `ok` with the labeled coaching
 *  text otherwise. */
export async function askHarvest(question: string, deps: AskHarvestDeps = {}): Promise<AskHarvestResult> {
  if (!isInScope(question)) {
    // SC9 (no blank surfaces): the refusal itself IS the answer shown to the rep, never a null/blank
    // state — a graceful, honest "I can't help with that" is always rendered.
    return { status: 'refused', label: 'coaching', answer: OUT_OF_SCOPE_REFUSAL, reason: 'out_of_scope' };
  }

  const modelClient = deps.modelClient ?? new AgnesRuntimeClient();
  try {
    const result = await modelClient.generate({
      tier: ClaudeModelTier.SONNET_5,
      systemPrompt:
        'You are Ask Harvest, an in-app coach for a warm-market rep. Answer ONLY using the grounding ' +
        'material provided below — the Downline Maxxing course modules and objection-tree entries. If ' +
        'the grounding material does not cover the question, say plainly: "I do not have course or ' +
        'objection guidance on that specific point." NEVER invent legal, tax, investment, or earnings ' +
        'advice. NEVER use the words prospect/lead/pitch/funnel/closing. Speak in the rep\'s own voice, ' +
        'warm and practical, 2-4 sentences.\n\nGROUNDING MATERIAL:\n' +
        groundingContext(question),
      userPrompt: question,
      maxTokens: 400,
    });
    return { status: 'ok', label: 'coaching', answer: result.text.trim() };
  } catch {
    return { status: 'held', label: 'coaching', answer: null, reason: 'model_unavailable' };
  }
}

export { OUT_OF_SCOPE_REFUSAL };
