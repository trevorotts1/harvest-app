// T-23 (§7.4) — deterministic, offline category-selection client (no API key required).
//
// Mirrors ../segmentation/local-client.ts (T-23) and LocalDeterministicClassifierClient (T-08): NOT
// the production path — production wires `AgnesMemoryJoggerCategoryClient` (§4.4, T-R55b). Round-robins
// through every category that hasn't been shown recently before repeating, so the swipeable flow
// still varies without a live key.

import {
  MEMORY_JOGGER_CATEGORY_PROMPTS,
  MemoryJoggerCategory,
  MemoryJoggerCategoryPrompt,
} from './types';
import { MemoryJoggerCategoryClient, MemoryJoggerCategoryRequest } from './category-client';

const ALL_CATEGORIES = Object.values(MemoryJoggerCategory);

export class LocalDeterministicMemoryJoggerCategoryClient implements MemoryJoggerCategoryClient {
  async selectNextCategory(req: MemoryJoggerCategoryRequest): Promise<MemoryJoggerCategoryPrompt> {
    const recentSet = new Set(req.recentCategories);
    const unseen = ALL_CATEGORIES.find((c) => !recentSet.has(c));
    const category = unseen ?? ALL_CATEGORIES[req.recentCategories.length % ALL_CATEGORIES.length];
    return { category, promptText: MEMORY_JOGGER_CATEGORY_PROMPTS[category] };
  }
}
