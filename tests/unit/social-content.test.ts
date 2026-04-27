import {
  createIdentity,
  getIdentity,
  updateIdentity,
  _resetStore as _resetIdentityStore,
} from '../../src/services/social-content/rep-identity.service';
import {
  generateLaunchContent,
  generateDailyPost,
  submitForCfeReview,
  _resetStore as _resetContentStore,
} from '../../src/services/social-content/content.service';
import {
  ContentCategory,
  PostStatus,
  SocialCategory,
  SocialPlatform,
} from '../../src/types/social-content';

beforeEach(() => {
  _resetIdentityStore();
  _resetContentStore();
});

// ── Test 1: Identity CRUD ───────────────────────────────────────
describe('RepIdentity Service', () => {
  it('creates, reads, and updates an identity', () => {
    const identity = createIdentity({
      repId: 'rep-001',
      brandName: 'Wellness With Sam',
      tagline: 'Growth, not grind.',
      coreValues: ['integrity', 'sustainability', 'community'],
      brandDoctrine: 'I share my authentic journey and never promise specific results.',
      socialCategories: [SocialCategory.PERSONAL_BRAND],
      platforms: [SocialPlatform.INSTAGRAM, SocialPlatform.LINKEDIN],
    });

    expect(identity.id).toBeDefined();
    expect(identity.brandName).toBe('Wellness With Sam');
    expect(identity.coreValues).toHaveLength(3);

    // Read
    const fetched = getIdentity(identity.id);
    expect(fetched).toBeDefined();
    expect(fetched!.brandName).toBe('Wellness With Sam');

    // Update
    const updated = updateIdentity(identity.id, { tagline: 'Rooted in real.' });
    expect(updated.tagline).toBe('Rooted in real.');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(fetched!.createdAt.getTime());
  });

  it('blocks income claims in brand doctrine', () => {
    expect(() =>
      createIdentity({
        repId: 'rep-002',
        brandName: 'Bad Actor',
        tagline: 'Get rich quick',
        coreValues: ['money'],
        brandDoctrine: 'I will help you earn six figures in 90 days guaranteed.',
      }),
    ).toThrow(/income-claim phrase/i);

    // Also test update path
    const identity = createIdentity({
      repId: 'rep-003',
      brandName: 'Good Actor',
      tagline: 'Real growth',
      coreValues: ['honesty'],
      brandDoctrine: 'I share my authentic journey.',
    });

    expect(() =>
      updateIdentity(identity.id, {
        brandDoctrine: 'You can make passive income easily.',
      }),
    ).toThrow(/income-claim phrase/i);
  });
});

// ── Test 2: 7-post launch kit ───────────────────────────────────
describe('Content Service — Launch Kit', () => {
  it('generates exactly 7 launch posts', () => {
    const identity = createIdentity({
      repId: 'rep-010',
      brandName: 'Harvest Sam',
      tagline: 'Real growth',
      coreValues: ['authenticity'],
      brandDoctrine: 'I share my authentic journey.',
    });

    const posts = generateLaunchContent('rep-010', identity.id);
    expect(posts).toHaveLength(7);
    expect(posts.every((p) => p.category === ContentCategory.LAUNCH)).toBe(true);
    expect(posts.every((p) => p.status === PostStatus.DRAFT)).toBe(true);
    expect(posts.every((p) => p.cfeReviewed === false)).toBe(true);
    // Each post body should contain the brand name
    expect(posts.every((p) => p.body.includes('Harvest Sam'))).toBe(true);
  });
});

// ── Test 3: CFE review ─────────────────────────────────────────
describe('Content Service — CFE Review', () => {
  it('marks a post as CFE-reviewed and approved', () => {
    const identity = createIdentity({
      repId: 'rep-020',
      brandName: 'CFE Test',
      tagline: 'Review me',
      coreValues: ['compliance'],
      brandDoctrine: 'I stay compliant.',
    });

    const posts = generateLaunchContent('rep-020', identity.id);
    const firstPost = posts[0];
    expect(firstPost.cfeReviewed).toBe(false);
    expect(firstPost.status).toBe(PostStatus.DRAFT);

    const reviewed = submitForCfeReview(firstPost.id);
    expect(reviewed.cfeReviewed).toBe(true);
    expect(reviewed.status).toBe(PostStatus.APPROVED);
  });
});

// ── Test 4: Anti-hustle detection ──────────────────────────────
describe('Content Service — Anti-Hustle Policy', () => {
  it('blocks content containing "grind" or "hustle culture"', () => {
    const identity = createIdentity({
      repId: 'rep-030',
      brandName: 'Growth Test',
      tagline: 'No hustle',
      coreValues: ['sustainability'],
      brandDoctrine: 'I share my authentic journey.',
    });

    // Test via daily post — "grind" in topic
    expect(() =>
      generateDailyPost('rep-030', identity.id, 'the daily grind'),
    ).toThrow(/anti-hustle policy/i);

    // "hustle culture" in topic
    expect(() =>
      generateDailyPost('rep-030', identity.id, 'escaping hustle culture'),
    ).toThrow(/anti-hustle policy/i);

    // Clean topic should work
    const cleanPost = generateDailyPost('rep-030', identity.id, 'sustainable habits');
    expect(cleanPost).toBeDefined();
    expect(cleanPost.category).toBe(ContentCategory.DAILY);
  });
});

// ── Test 5: Empty identity error ───────────────────────────────
describe('Content Service — Missing Identity', () => {
  it('throws when generating content without an identity', () => {
    expect(() =>
      generateLaunchContent('rep-999', 'nonexistent-id'),
    ).toThrow(/Identity not found/);

    expect(() =>
      generateDailyPost('rep-999', 'nonexistent-id', 'test topic'),
    ).toThrow(/Identity not found/);
  });
});