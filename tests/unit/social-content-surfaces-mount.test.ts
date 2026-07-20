// T-41 (WP06 §11 "Social, Content & Launch Kit") — the reachability proofs. WP03/WP04/WP05 each
// failed their first gate on an orphaned surface (per the build brief); this suite is the analog of
// tests/unit/messaging-surfaces-mount.test.ts / conversation-mount.test.ts: it proves every WP06
// route exists on disk, is session-gated, and reads no forged identity header; that the Content
// Queue / Launch Kit / Template Library pages are real files reachable via a real nav Link from
// Today; that the three cron functions are registered on the Inngest serve endpoint; and that the
// pre-doctrine baseline scaffold (content.service.ts / rep-identity.service.ts / api/social/route.ts
// / types/social-content.ts) is gone and referenced by nothing.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { GATED_DOWNSTREAM_PAGE_PREFIXES, isGatedDownstreamPage } from '@/lib/auth/onboarding-gate-edge';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function src(...parts: string[]): string {
  return readFileSync(path.join(SRC_DIR, ...parts), 'utf8');
}

const FORGED_HEADER_READ_RE = /\.headers\s*\.\s*get\(\s*['"`]x-user-id['"`]/;

const ROUTES: { label: string; parts: string[] }[] = [
  { label: 'content queue list', parts: ['app', 'api', 'content', 'queue', 'route.ts'] },
  { label: 'content queue approve', parts: ['app', 'api', 'content', 'queue', '[id]', 'approve', 'route.ts'] },
  { label: 'content queue decline', parts: ['app', 'api', 'content', 'queue', '[id]', 'decline', 'route.ts'] },
  { label: 'content queue edit', parts: ['app', 'api', 'content', 'queue', '[id]', 'edit', 'route.ts'] },
  { label: 'content queue publish-attempt', parts: ['app', 'api', 'content', 'queue', '[id]', 'publish-attempt', 'route.ts'] },
  { label: 'content queue publish-manual', parts: ['app', 'api', 'content', 'queue', '[id]', 'publish-manual', 'route.ts'] },
  { label: 'content queue bulk-approve', parts: ['app', 'api', 'content', 'queue', 'bulk-approve', 'route.ts'] },
  { label: 'batch generate', parts: ['app', 'api', 'content', 'batch', 'generate', 'route.ts'] },
  { label: 'launch-kit trigger', parts: ['app', 'api', 'content', 'launch-kit', 'trigger', 'route.ts'] },
  { label: 'launch-kit get', parts: ['app', 'api', 'content', 'launch-kit', '[id]', 'route.ts'] },
  { label: 'launch-kit approve', parts: ['app', 'api', 'content', 'launch-kit', '[id]', 'approve', 'route.ts'] },
  { label: 'launch-kit withdraw', parts: ['app', 'api', 'content', 'launch-kit', '[id]', 'withdraw', 'route.ts'] },
  { label: 'templates', parts: ['app', 'api', 'content', 'templates', 'route.ts'] },
  { label: 'followups list', parts: ['app', 'api', 'content', 'followups', 'route.ts'] },
  { label: 'followups complete', parts: ['app', 'api', 'content', 'followups', '[id]', 'complete', 'route.ts'] },
];

describe('T-41 — every WP06 API route is MOUNTED, session-gated, and reads no forged x-user-id', () => {
  for (const r of ROUTES) {
    test(`${r.label} route exists at src/${r.parts.join('/')}`, () => {
      expect(existsSync(path.join(SRC_DIR, ...r.parts))).toBe(true);
    });
    test(`${r.label} route is session-gated (withOnboardingGate) and never trusts a forged x-user-id`, () => {
      const s = src(...r.parts);
      expect(s).toMatch(/withOnboardingGate/);
      expect(s).not.toMatch(FORGED_HEADER_READ_RE);
    });
  }
});

describe('T-41 — the Content Queue / Launch Kit / Template Library pages exist and are reachable', () => {
  test('the Content Queue page exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'content', 'page.tsx'))).toBe(true);
  });
  test('the Launch Kit review page exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'content', 'launch-kit', '[id]', 'page.tsx'))).toBe(true);
  });
  test('the Template Library page exists', () => {
    expect(existsSync(path.join(SRC_DIR, 'app', 'content', 'templates', 'page.tsx'))).toBe(true);
  });

  test('TEETH: Today (the default landing surface) links to /content — no orphaned surface', () => {
    const today = src('app', 'today', 'page.tsx');
    expect(today).toMatch(/href="\/content"/);
  });

  test('the Content Queue page mounts a real fetch to /api/content/queue (not a stub)', () => {
    const page = src('app', 'content', 'page.tsx');
    expect(page).toContain('/api/content/queue');
    expect(page).toContain('/api/content/batch/generate');
    expect(page).toContain('/api/content/launch-kit/trigger');
  });

  test('the Content Queue page renders the CFE-offline "PUBLISHING PAUSED" banner (§11.5 rule 1)', () => {
    const page = src('app', 'content', 'page.tsx');
    expect(page).toMatch(/PUBLISHING PAUSED/);
  });

  test('the Launch Kit page mounts the real photo (or honest fallback) and the withdraw affordance', () => {
    const page = src('app', 'content', 'launch-kit', '[id]', 'page.tsx');
    expect(page).toContain('/api/content/launch-kit/');
    expect(page).toMatch(/initials avatar/i);
    expect(page).toMatch(/withdrew/i);
  });
});

describe('T-41 — /content is a gated downstream page, kept in sync with middleware.ts', () => {
  test('isGatedDownstreamPage recognizes /content and its subpaths', () => {
    expect(isGatedDownstreamPage('/content')).toBe(true);
    expect(isGatedDownstreamPage('/content/launch-kit/abc-123')).toBe(true);
    expect(isGatedDownstreamPage('/content/templates')).toBe(true);
  });

  test('GATED_DOWNSTREAM_PAGE_PREFIXES includes /content', () => {
    expect(GATED_DOWNSTREAM_PAGE_PREFIXES).toContain('/content');
  });

  test('src/middleware.ts\'s own matcher also covers /content/:path* (kept in lockstep)', () => {
    const middleware = src('middleware.ts');
    expect(middleware).toContain("'/content/:path*'");
  });
});

describe('T-41 — the three WP06 cron functions are registered on the Inngest serve endpoint', () => {
  test('inngest-functions.ts defines the weekly batch, publish tick, and launch-kit sweep functions', () => {
    const fns = src('services', 'social-content', 'inngest-functions.ts');
    expect(fns).toMatch(/weeklyContentBatchFunction/);
    expect(fns).toMatch(/contentPublishTickFunction/);
    expect(fns).toMatch(/launchKitAutoTriggerFunction/);
    expect(fns).toMatch(/socialContentInngestFunctions/);
  });

  test('the serve endpoint registers socialContentInngestFunctions', () => {
    const serve = src('app', 'api', 'inngest', 'route.ts');
    expect(serve).toMatch(/socialContentInngestFunctions/);
  });
});

describe('T-41 — the pre-doctrine baseline scaffold is deleted and referenced by nothing', () => {
  const DEAD_FILES = [
    ['services', 'social-content', 'content.service.ts'],
    ['services', 'social-content', 'rep-identity.service.ts'],
    ['app', 'api', 'social', 'route.ts'],
    ['types', 'social-content.ts'],
  ];
  const DEAD_SPECIFIERS = [
    'social-content/content.service',
    'social-content/rep-identity.service',
    'types/social-content',
  ];

  test('each dead scaffold file no longer exists on disk', () => {
    for (const parts of DEAD_FILES) {
      expect(existsSync(path.join(SRC_DIR, ...parts))).toBe(false);
    }
  });

  test('the orphaned baseline test (tests/unit/social-content.test.ts) is removed', () => {
    expect(existsSync(path.join(REPO_ROOT, 'tests', 'unit', 'social-content.test.ts'))).toBe(false);
  });

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  test('TEETH: no file under src imports any deleted scaffold module (grep-clean)', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      for (const spec of DEAD_SPECIFIERS) {
        if (content.includes(spec)) offenders.push(`${path.relative(REPO_ROOT, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
