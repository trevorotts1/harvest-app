import {
  RepIdentityAsset,
  SocialCategory,
  SocialPlatform,
} from '../../types/social-content';

// ── In-memory store ──────────────────────────────────────────────
const store = new Map<string, RepIdentityAsset>();

// ── Brand-doctrine validation rules ──────────────────────────────
const BLOCKED_PHRASES = [
  'income claim',
  'earn',
  'make money',
  'guaranteed income',
  'six figures',
  '6 figures',
  'passive income',
  'replace your salary',
];

function validateBrandDoctrine(doctrine: string): void {
  const lower = doctrine.toLowerCase();
  for (const phrase of BLOCKED_PHRASES) {
    if (lower.includes(phrase)) {
      throw new Error(
        `Brand doctrine contains blocked income-claim phrase: "${phrase}". ` +
          'Reps may not make income claims per Harvest compliance policy.',
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────
let idCounter = 0;
function nextId(): string {
  return `identity-${++idCounter}`;
}

// ── Public API ───────────────────────────────────────────────────
export function createIdentity(input: {
  repId: string;
  brandName: string;
  tagline: string;
  coreValues: string[];
  brandDoctrine: string;
  socialCategories?: SocialCategory[];
  platforms?: SocialPlatform[];
}): RepIdentityAsset {
  validateBrandDoctrine(input.brandDoctrine);

  const asset: RepIdentityAsset = {
    id: nextId(),
    repId: input.repId,
    brandName: input.brandName,
    tagline: input.tagline,
    coreValues: input.coreValues,
    brandDoctrine: input.brandDoctrine,
    socialCategories: input.socialCategories ?? [SocialCategory.PERSONAL_BRAND],
    platforms: input.platforms ?? [SocialPlatform.INSTAGRAM],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  store.set(asset.id, asset);
  return asset;
}

export function getIdentity(id: string): RepIdentityAsset | undefined {
  return store.get(id);
}

export function updateIdentity(
  id: string,
  patch: Partial<
    Pick<
      RepIdentityAsset,
      'brandName' | 'tagline' | 'coreValues' | 'brandDoctrine' | 'socialCategories' | 'platforms'
    >
  >,
): RepIdentityAsset {
  const existing = store.get(id);
  if (!existing) {
    throw new Error(`Identity not found: ${id}`);
  }

  // Validate doctrine if it's being updated
  if (patch.brandDoctrine !== undefined) {
    validateBrandDoctrine(patch.brandDoctrine);
  }

  const updated: RepIdentityAsset = {
    ...existing,
    ...patch,
    updatedAt: new Date(),
  };

  store.set(id, updated);
  return updated;
}

// Exported for testing reset
export function _resetStore(): void {
  store.clear();
  idCounter = 0;
}