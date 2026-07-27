// T-23 (§7.4) — Memory Jogger category-selection public surface.

export {
  MemoryJoggerCategory,
  MEMORY_JOGGER_CATEGORY_PROMPTS,
  MEMORY_JOGGER_CATEGORY_JSON_SCHEMA,
  MEMORY_JOGGER_LOW_CONTACT_THRESHOLD,
  shouldTriggerMemoryJogger,
} from './types';
export type { MemoryJoggerCategoryPrompt } from './types';

export type { MemoryJoggerCategoryClient, MemoryJoggerCategoryRequest } from './category-client';
export {
  HaikuMemoryJoggerCategoryClient,
  MemoryJoggerCategoryError,
  MemoryJoggerCategoryTimeoutError,
  MissingClaudeCredentialError,
} from './category-client';
export type { HaikuMemoryJoggerCategoryClientOptions } from './category-client';

// T-R55b — Agnes (`agnes-2.0-flash`) sibling, the operator-directed DEFAULT for this workload.
export { AgnesMemoryJoggerCategoryClient } from './agnes-category-client';
export type { AgnesMemoryJoggerCategoryClientOptions } from './agnes-category-client';

export { LocalDeterministicMemoryJoggerCategoryClient } from './local-category-client';
