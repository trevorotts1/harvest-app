// T-39 QC FIX 1 (uiux §5.7/§4.7) — the GATE-BLOCKING finding this fix closes: "`ConversationTimeline`,
// `AgentSentBadge`, `ThreeWayHandoffCard` exist but are mounted on NO route — a rep cannot reach the
// conversation surface." This suite proves the surface is actually MOUNTED and REACHABLE, not just
// that the presentational components render correctly in isolation (that half is already proven by
// tests/unit/conversation-timeline.test.ts). It fails if:
//   • the route/page files do not exist on disk (unmounted);
//   • the page does not actually import/render `ConversationTimeline`;
//   • the Community list has no way to navigate to it (unreachable);
//   • `/community/<any-id>` is not a gated downstream page (session-gating regression).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';
import ContactCard from '@/app/community/components/ContactCard';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

describe('T-39 QC FIX 1 — the conversation surface is mounted on a real route', () => {
  test('the contact-detail page exists at src/app/community/[contactId]/page.tsx', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'community', '[contactId]', 'page.tsx'))).toBe(true);
  });

  test('the page actually renders ConversationTimeline (composing the badge + handoff card), not a stub', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'community', '[contactId]', 'page.tsx'), 'utf8');
    expect(src).toMatch(/import\s+ConversationTimeline\b/);
    expect(src).toMatch(/<ConversationTimeline\b/);
  });

  test('the conversation read API route exists at src/app/api/contacts/[contactId]/conversation/route.ts', () => {
    expect(
      existsSync(path.join(SRC_DIR, 'app', 'api', 'contacts', '[contactId]', 'conversation', 'route.ts'))
    ).toBe(true);
  });

  test('the API route is session-gated (withOnboardingGate) and never reads a forged x-user-id header', () => {
    const src = readFileSync(
      path.join(SRC_DIR, 'app', 'api', 'contacts', '[contactId]', 'conversation', 'route.ts'),
      'utf8'
    );
    expect(src).toMatch(/withOnboardingGate/);
    // The header-READ call pattern (`.headers.get('x-user-id')`), not the substring "x-user-id" —
    // this file's own doc comment explains, in prose, why it does NOT read that header, so a naive
    // substring check on "x-user-id" would false-positive on the comment itself.
    expect(src).not.toMatch(/\.headers\s*\.\s*get\(\s*['"`]x-user-id['"`]/);
  });
});

describe('T-39 QC FIX 1 — /community/<contactId> is session-gated (no middleware regression)', () => {
  test('a not-yet-onboarded rep landing on ANY contact-detail page still lands in onboarding first', () => {
    expect(isGatedDownstreamPage('/community/contact-abc-123')).toBe(true);
    expect(isGatedDownstreamPage('/community')).toBe(true);
  });
});

describe('T-39 QC FIX 1 — the Community list is a real path INTO the conversation surface', () => {
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ContactCard as ElementType, props));

  const baseProps = {
    id: 'contact-77',
    name: 'Priya Nair',
    initials: 'PN',
    closeness: 3,
    recency: 'leaf' as const,
    isRecruitTarget: false,
    isClient: false,
    onToggleRecruitTarget: () => {},
    onToggleClient: () => {},
  };

  test('TEETH: every rendered Contact Card links to its OWN /community/{id} conversation route', () => {
    const html = render(baseProps);
    expect(html).toContain('href="/community/contact-77"');
  });

  test('a DIFFERENT contact id renders a link to ITS OWN route, never a shared/hardcoded one', () => {
    const html = render({ ...baseProps, id: 'contact-99', name: 'Jamie Rivera' });
    expect(html).toContain('href="/community/contact-99"');
    expect(html).not.toContain('href="/community/contact-77"');
  });

  test('the link is a real navigable anchor (not merely styled text) and never sits inside a flag-toggle button', () => {
    const html = render(baseProps);
    // The two flag-toggle buttons must not themselves carry the navigation href (that would make the
    // whole card double as both a toggle and a link, and would break the "separate callbacks" guarantee).
    const buttonMatches = html.match(/<button[^>]*>/g) ?? [];
    for (const b of buttonMatches) {
      expect(b).not.toContain('/community/contact-77');
    }
    expect(html).toMatch(/<a[^>]*href="\/community\/contact-77"[^>]*>/);
  });
});
