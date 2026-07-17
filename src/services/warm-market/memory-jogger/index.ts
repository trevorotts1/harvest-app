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

export { LocalDeterministicMemoryJoggerCategoryClient } from './local-category-client';
