// T-23 (§7.4 Memory Jogger): "Category prompt cards ('Who cut your hair? Who was at your last
// cookout?') as a swipeable 2-minute 'gardening' mini-flow ... triggered when contact count is low
// (< 50) or on demand."

export enum MemoryJoggerCategory {
  HAIR_AND_BEAUTY = 'HAIR_AND_BEAUTY',
  GATHERINGS = 'GATHERINGS',
  KIDS_AND_SCHOOL = 'KIDS_AND_SCHOOL',
  FITNESS = 'FITNESS',
  FAITH_COMMUNITY = 'FAITH_COMMUNITY',
  WORK_AND_CAREER = 'WORK_AND_CAREER',
  NEIGHBORS = 'NEIGHBORS',
  OLD_FRIENDS = 'OLD_FRIENDS',
}

export interface MemoryJoggerCategoryPrompt {
  category: MemoryJoggerCategory;
  promptText: string;
}

// Doctrine-vocab-clean (§0.5) by construction — these are the literal card copy the rep sees.
// `MemoryJoggerVocabViolationError` (../memory-jogger.service.ts) is still a defensive re-check on
// top of this, mirroring `finalizeAnchorStatement` (WP01 §6.4) — see that module's comment for why.
export const MEMORY_JOGGER_CATEGORY_PROMPTS: Record<MemoryJoggerCategory, string> = {
  [MemoryJoggerCategory.HAIR_AND_BEAUTY]: 'Who cut your hair or did your nails last?',
  [MemoryJoggerCategory.GATHERINGS]: 'Who was at your last cookout, party, or get-together?',
  [MemoryJoggerCategory.KIDS_AND_SCHOOL]: "Who do you see at your kids' school or activities?",
  [MemoryJoggerCategory.FITNESS]: 'Who do you see at the gym, on a run, or on your sports team?',
  [MemoryJoggerCategory.FAITH_COMMUNITY]: 'Who do you sit near or talk with at church or your community group?',
  [MemoryJoggerCategory.WORK_AND_CAREER]: "Who's a coworker — or former coworker — you haven't caught up with?",
  [MemoryJoggerCategory.NEIGHBORS]: 'Which neighbor do you wave to but rarely really talk to?',
  [MemoryJoggerCategory.OLD_FRIENDS]: "Who's an old friend you keep meaning to reach out to?",
};

/** Structured-output schema for the Haiku category-selection call (§4.4 "Memory-Jogger prompt
 * selection"). */
export const MEMORY_JOGGER_CATEGORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: Object.values(MemoryJoggerCategory) },
    rationale: { type: 'string' },
  },
  required: ['category', 'rationale'],
} as const;

/** §7.4: "triggered when contact count is low (< 50) or on demand." */
export const MEMORY_JOGGER_LOW_CONTACT_THRESHOLD = 50;

export function shouldTriggerMemoryJogger(contactCount: number, onDemand: boolean): boolean {
  return onDemand || contactCount < MEMORY_JOGGER_LOW_CONTACT_THRESHOLD;
}
