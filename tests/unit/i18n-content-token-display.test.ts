// T-57 RG6 (i18n; master-spec §17.5, uiux §6.2) — the `/content/*` display-mappers
// (`src/lib/i18n/content-token-display.ts`) closing 7 `RENDERED_I18N_LEAK_BASELINE.json` entries:
// `content/page.tsx`'s `item.category`/`item.state`, `content/launch-kit/[id]/page.tsx`'s
// `item.launch_kit_piece_type`/`kit.version`/`kit.welcome_variant`,
// `TemplateListSection.tsx`'s category-filter-chip `c`/`tpl.defaultPersonalizationTier`. Proves
// every known enum value resolves to a genuinely distinct EN/ES string, and an unknown/future token
// falls back to a generic, always-localized label — never the raw or merely de-snake-cased token.

import { t } from '@/lib/i18n/catalog';
import {
  contentCategoryLabel,
  contentStateLabel,
  launchKitPieceTypeLabel,
  launchKitVersionLabel,
  welcomeVariantLabel,
  personalizationTierLabel,
  contentTypeLabel,
} from '@/lib/i18n/content-token-display';

const translateEn = (key: string, vars?: Record<string, string | number>) => t('en', key, vars);
const translateEs = (key: string, vars?: Record<string, string | number>) => t('es', key, vars);

describe('contentCategoryLabel — ContentCategory (content/page.tsx, TemplateListSection.tsx)', () => {
  test.each([
    'COMMUNITY_SPOTLIGHT', 'VALUE_FIRST_EDUCATION', 'MOVEMENT_FRAMING',
    'BEHIND_THE_HARVEST', 'EVENT_INTRODUCTION_ANNOUNCEMENT',
  ])('TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token', (category) => {
    const en = contentCategoryLabel(translateEn, category);
    const es = contentCategoryLabel(translateEs, category);
    expect(en).not.toBe(category.replace(/_/g, ' '));
    expect(en).not.toBe(es);
  });

  test('the synthesized "ALL" filter-chip value reuses content.queue.filters.all — no duplicate copy', () => {
    expect(contentCategoryLabel(translateEn, 'ALL')).toBe(t('en', 'content.queue.filters.all'));
    expect(contentCategoryLabel(translateEs, 'ALL')).toBe(t('es', 'content.queue.filters.all'));
    expect(contentCategoryLabel(translateEn, 'ALL')).toBe('All');
    expect(contentCategoryLabel(translateEs, 'ALL')).toBe('Todo');
  });

  test('an unrecognized/future category falls back to a generic localized label', () => {
    expect(contentCategoryLabel(translateEn, 'SOME_FUTURE_CATEGORY')).toBe('Category');
    expect(contentCategoryLabel(translateEs, null)).toBe('Categoría');
  });
});

describe('contentStateLabel — ContentQueueState (content/page.tsx, launch-kit/[id]/page.tsx)', () => {
  test.each(['DRAFTING', 'COMPLIANCE_CHECK', 'READY_FOR_REVIEW', 'SCHEDULED', 'PUBLISHED', 'BLOCKED'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token',
    (state) => {
      const en = contentStateLabel(translateEn, state);
      const es = contentStateLabel(translateEs, state);
      expect(en).not.toBe(state.replace(/_/g, ' '));
      expect(en).not.toBe(es);
    }
  );

  test('the 5 filter-chip states reuse content.queue.filters.* — single source of truth', () => {
    expect(contentStateLabel(translateEn, 'DRAFTING')).toBe(t('en', 'content.queue.filters.drafting'));
    expect(contentStateLabel(translateEn, 'SCHEDULED')).toBe(t('en', 'content.queue.filters.scheduled'));
    expect(contentStateLabel(translateEn, 'BLOCKED')).toBe(t('en', 'content.queue.filters.blocked'));
  });

  test('COMPLIANCE_CHECK (no pre-existing filter chip) gets its own new real EN/ES copy', () => {
    expect(contentStateLabel(translateEn, 'COMPLIANCE_CHECK')).toBe('Compliance check');
    expect(contentStateLabel(translateEs, 'COMPLIANCE_CHECK')).toBe('Revisión de cumplimiento');
  });
});

describe('launchKitPieceTypeLabel — LaunchKitPieceType (launch-kit/[id]/page.tsx)', () => {
  test.each(['WELCOME', 'ANNOUNCEMENT', 'DAY3_VALUE_EMAIL', 'DAY7_EVENT_INVITE'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token',
    (pieceType) => {
      const en = launchKitPieceTypeLabel(translateEn, pieceType);
      const es = launchKitPieceTypeLabel(translateEs, pieceType);
      expect(en).not.toBe(pieceType.replace(/_/g, ' '));
      expect(en).not.toBe(es);
    }
  );

  test('null/undefined and an unrecognized value fall back to a generic localized label', () => {
    expect(launchKitPieceTypeLabel(translateEn, null)).toBe('Kit piece');
    expect(launchKitPieceTypeLabel(translateEs, 'SOME_FUTURE_PIECE')).toBe('Pieza del kit');
  });
});

describe('launchKitVersionLabel — LaunchKitVersion (launch-kit/[id]/page.tsx)', () => {
  test.each(['V1_STANDARD', 'V2_TESTIMONIAL_ANCHORED', 'V3_EVENT_CENTRIC'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased raw token',
    (version) => {
      const en = launchKitVersionLabel(translateEn, version);
      const es = launchKitVersionLabel(translateEs, version);
      expect(en).not.toBe(version.replace(/_/g, ' '));
      expect(en).not.toBe(es);
    }
  );

  test('an unrecognized/future version falls back to a generic localized label', () => {
    expect(launchKitVersionLabel(translateEn, 'V4_FUTURE')).toBe('Version');
    expect(launchKitVersionLabel(translateEs, 'V4_FUTURE')).toBe('Versión');
  });
});

describe('welcomeVariantLabel — WelcomeVariant (launch-kit/[id]/page.tsx)', () => {
  test.each(['PERSONAL_REFERRAL', 'EVENT_ATTENDEE', 'BASE_MEMBER_INTRODUCED'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased-and-lowercased raw token',
    (variant) => {
      const en = welcomeVariantLabel(translateEn, variant);
      const es = welcomeVariantLabel(translateEs, variant);
      expect(en).not.toBe(variant.replace(/_/g, ' ').toLowerCase());
      expect(en).not.toBe(es);
    }
  );

  test('reuses the SAME content.queue.launchKitTrigger.welcomeVariant.* keys the trigger <select> ships', () => {
    expect(welcomeVariantLabel(translateEn, 'PERSONAL_REFERRAL')).toBe(
      t('en', 'content.queue.launchKitTrigger.welcomeVariant.personalReferral')
    );
    expect(welcomeVariantLabel(translateEs, 'PERSONAL_REFERRAL')).toBe('Referencia personal');
  });

  test('an unrecognized/future variant falls back to a generic localized label', () => {
    expect(welcomeVariantLabel(translateEn, 'SOME_FUTURE_VARIANT')).toBe('Welcome');
    expect(welcomeVariantLabel(translateEs, null)).toBe('Bienvenida');
  });
});

describe('personalizationTierLabel — PersonalizationTier (TemplateListSection.tsx)', () => {
  test.each(['AUTOMATIC', 'AI_INFERRED', 'REP_PROVIDED'])(
    'TEETH — %s resolves to a real, distinct EN/ES label, never the de-snake-cased-and-lowercased raw token',
    (tier) => {
      const en = personalizationTierLabel(translateEn, tier);
      const es = personalizationTierLabel(translateEs, tier);
      expect(en).not.toBe(tier.replace(/_/g, ' ').toLowerCase());
      expect(en).not.toBe(es);
    }
  );

  test('matches the tone already established in content.templates.subtitleTemplate', () => {
    expect(personalizationTierLabel(translateEs, 'AUTOMATIC')).toBe('Automática');
    expect(personalizationTierLabel(translateEs, 'AI_INFERRED')).toBe('Inferida por IA');
    expect(personalizationTierLabel(translateEs, 'REP_PROVIDED')).toBe('Proporcionada por el rep');
  });
});

describe('contentTypeLabel — ContentType (content/page.tsx, TemplateListSection.tsx)', () => {
  // "BLOG" is intentionally excluded from the distinct-EN/ES assertion below — "Blog" is a genuine
  // loanword, identical in both languages (confirmed real copy, not a missed translation); its
  // resolved values are still spot-checked in the exact-copy test right below this one.
  test.each(['SOCIAL_POST', 'EMAIL'])(
    'TEETH — %s resolves to a real, distinct EN/ES label',
    (type) => {
      const en = contentTypeLabel(translateEn, type);
      const es = contentTypeLabel(translateEs, type);
      expect(en).not.toBe(es);
    }
  );

  test('exact copy for all 3 known content types, including the "Blog" loanword (same in both languages)', () => {
    expect(contentTypeLabel(translateEn, 'SOCIAL_POST')).toBe('Social post');
    expect(contentTypeLabel(translateEs, 'SOCIAL_POST')).toBe('Publicación social');
    expect(contentTypeLabel(translateEn, 'BLOG')).toBe('Blog');
    expect(contentTypeLabel(translateEs, 'BLOG')).toBe('Blog');
    expect(contentTypeLabel(translateEn, 'EMAIL')).toBe('Email');
    expect(contentTypeLabel(translateEs, 'EMAIL')).toBe('Correo electrónico');
  });

  test('an unrecognized/future type falls back to a generic localized label', () => {
    expect(contentTypeLabel(translateEn, 'PODCAST')).toBe('Content');
    expect(contentTypeLabel(translateEs, 'PODCAST')).toBe('Contenido');
  });
});
