// T-57 RG6 (i18n; master-spec §17.5) — `team/rep/[userId]/page.tsx` carried a
// `RENDERED_I18N_LEAK_BASELINE.json` entry: `{m.key.replace(/_/g, ' ')}` (the raw `MilestoneKey`
// machine token, merely de-snake-cased, in the rep drill-in's Milestones section). Fixed by reusing
// `celebration.service.ts`'s own `today.zones.milestones.displayName.*` catalog namespace directly
// (a local `KNOWN_MILESTONE_KEYS` literal set — see that page's own header note on why it does NOT
// import the service module itself: doing so would pull the `ComplianceFilterEngine`/classifier
// graph into this 'use client' page's bundle).
//
// This page is fetch-driven with no props seam (unlike `RepDataPanels.tsx`, which WAS extracted for
// exactly this testability reason — see that file's own header comment) AND uses
// `next/navigation`'s `useParams()`, which never resolves outside a real App-Router request; its
// `useEffect`-driven fetch never runs under this repo's `renderToStaticMarkup`-only, no-jsdom Jest
// env either way (see tests/unit/content-queue-i18n.test.ts's identical header note) — so the
// milestone list's "ready" render is structurally unreachable in THIS test environment regardless
// of mocking. This suite instead proves the two things that ARE independently verifiable: (1) the
// exact catalog keys the page's inline mapping logic reads through resolve to real, distinct EN/ES
// copy (the milestoneDisplayName.* keys are already unit-proven for the service's own callers in
// tests/unit/gamification-celebration.test.ts; the NEW `milestoneGenericLabel` fallback key is
// proven here), and (2) a static source scan confirming the raw-token-humanize regression is gone
// and the real fix shape is present — the same "banned pattern" convention this repo's suite
// already uses (e.g. tests/unit/pipeline-route.test.ts's demo-stub scan).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { t } from '@/lib/i18n/catalog';

const REPO_ROOT = path.join(__dirname, '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'src', 'app', 'team', 'rep', '[userId]', 'page.tsx');

describe('team/rep/[userId]/page.tsx — milestone-key i18n (T-57 RG6)', () => {
  test('the raw-token humanize regression is gone from the authored source', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).not.toMatch(/m\.key\.replace\(/);
  });

  test('the real fix shape is present: a known-key catalog lookup + a generic fallback, not a bare render', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/KNOWN_MILESTONE_KEYS/);
    expect(src).toMatch(/today\.zones\.milestones\.displayName\./);
    expect(src).toMatch(/team\.rep\.milestoneGenericLabel/);
  });

  test('TEETH — every known MilestoneKey display-name catalog entry resolves to real, distinct EN/ES copy', () => {
    for (const key of ['FIRST_RESPONSE', 'FIRST_APPOINTMENT', 'FIRST_RECRUIT', 'FIRST_LICENSED_TEAM_MEMBER', 'THIRTY_DAY_STREAK']) {
      const en = t('en', `today.zones.milestones.displayName.${key}`);
      const es = t('es', `today.zones.milestones.displayName.${key}`);
      expect(en).not.toBe(key.toLowerCase().replace(/_/g, ' '));
      expect(en).not.toBe(es);
    }
  });

  test('FIRST_RECRUIT\'s display name says "teammate", never the doctrine-forbidden word "recruit"/"reclut"', () => {
    expect(t('en', 'today.zones.milestones.displayName.FIRST_RECRUIT').toLowerCase()).not.toContain('recruit');
    expect(t('es', 'today.zones.milestones.displayName.FIRST_RECRUIT').toLowerCase()).not.toContain('reclut');
  });

  test('the new generic fallback (an unrecognized/future milestone key) resolves to real, distinct EN/ES copy', () => {
    expect(t('en', 'team.rep.milestoneGenericLabel')).toBe('Milestone');
    expect(t('es', 'team.rep.milestoneGenericLabel')).toBe('Hito');
  });
});
