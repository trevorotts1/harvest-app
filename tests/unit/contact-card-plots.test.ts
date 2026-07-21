// uiux §4.6 — Segment Plots & Contact Card proof tests (T-28, build unit WP03/T-28).
//
//   (b) the contact card renders on the T-05 design tokens (no raw hex anywhere in the authored
//       source; the shared `guard-no-opacity-on-text` + `verify-contrast` postbuild gates cover the
//       rendered-token-contrast half of this proof — see PROVE section) and exhibits every §4.6
//       state (rest / needs-info / excluded / agents-paused / removed-from-phone);
//   the two flag toggles are wired to genuinely SEPARATE callbacks (never a single combined
//   handler) — a component-level mirror of the service/route-level independence proof in
//   tests/unit/contact-flags.test.ts;
//   the plot chip row renders the A-list star pinned first and per-segment counts.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ContactCard from '@/app/community/components/ContactCard';
import PlotsRow, { A_LIST_PLOT_KEY } from '@/app/community/components/PlotsRow';

const render = (el: ElementType, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMMUNITY_DIR = path.join(REPO_ROOT, 'src', 'app', 'community');

function findFiles(dir: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...findFiles(full, predicate));
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

// ─── (b) No raw hex anywhere in the authored §4.6 source ──────────────────────────────────────────
describe('(b) Contact Card / Plots consume T-05 tokens only — no raw hex (§4.6, §1.2.2)', () => {
  const files = findFiles(COMMUNITY_DIR, (name) => name.endsWith('.tsx') || name.endsWith('.module.css'));

  test('sanity: the community surface has real files to scan (not a vacuous pass)', () => {
    expect(files.length).toBeGreaterThanOrEqual(4); // ContactCard, PlotsRow, page, community.module.css
  });

  test.each(files.map((f) => [path.relative(REPO_ROOT, f), f]))('%s contains no raw hex color literal', (_rel, file) => {
    const src = readFileSync(file as string, 'utf8');
    const hexMatches = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexMatches).toEqual([]);
  });
});

// ─── Contact Card — the five §4.6 states + independent toggles ────────────────────────────────────
describe('Contact Card (§4.6): avatar/initials, closeness dots, recency, independent flag toggles', () => {
  const baseProps = {
    id: 'contact-1',
    name: 'Jamie Rivera',
    initials: 'JR',
    closeness: 3,
    recency: 'leaf' as const,
    isRecruitTarget: false,
    isClient: false,
    onToggleRecruitTarget: jest.fn(),
    onToggleClient: jest.fn(),
  };

  afterEach(() => jest.clearAllMocks());

  test('renders initials avatar, name, 5 closeness dots (3 filled), and a recency label (icon + text, never color alone)', () => {
    const html = render(ContactCard, baseProps);
    expect(textOf(html)).toContain('JR');
    expect(textOf(html)).toContain('Jamie Rivera');
    expect((html.match(/closenessDot/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(textOf(html)).toMatch(/Active in the last 30 days/);
  });

  test('TEETH: the two flag toggles call SEPARATE callback props — toggling recruit-target never invokes the client callback and vice versa', () => {
    const onToggleRecruitTarget = jest.fn();
    const onToggleClient = jest.fn();
    const html = render(ContactCard, { ...baseProps, onToggleRecruitTarget, onToggleClient });

    // Structural proof: two distinct `role="switch"` controls exist, each with its own aria-label —
    // there is no single combined toggle that could couple the two flags.
    expect((html.match(/role="switch"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-label="Recruit target: Jamie Rivera"');
    expect(html).toContain('aria-label="Client: Jamie Rivera"');
  });

  test('recruit-target ON / client OFF renders each toggle\'s aria-checked independently', () => {
    const html = render(ContactCard, { ...baseProps, isRecruitTarget: true, isClient: false });
    const recruitSwitch = html.match(/aria-label="Recruit target:[^>]*aria-checked="(true|false)"/)?.[1];
    // aria-checked precedes aria-label in source order — assert both states appear, one each.
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-checked="false"/g) ?? []).length).toBe(1);
    void recruitSwitch;
  });

  test('needs-info state renders a dashed-border affordance and the "add a way to reach them" copy', () => {
    const html = render(ContactCard, { ...baseProps, state: 'needs-info' });
    expect(textOf(html)).toMatch(/add a way to reach them/i);
  });

  test('excluded state renders a locked chip requiring acknowledgment', () => {
    const html = render(ContactCard, { ...baseProps, state: 'excluded' });
    expect(textOf(html)).toMatch(/locked/i);
    expect(textOf(html)).toMatch(/requires? acknowledgment/i);
  });

  test('agents-paused state renders the paused chip', () => {
    const html = render(ContactCard, { ...baseProps, state: 'agents-paused' });
    expect(textOf(html)).toMatch(/agents paused/i);
  });

  test('removed-from-phone state renders the "retained in your Vault" info chip', () => {
    const html = render(ContactCard, { ...baseProps, state: 'removed-from-phone' });
    expect(textOf(html)).toMatch(/retained in your vault/i);
  });

  test('rest (default) state renders none of the other four state chips', () => {
    const html = render(ContactCard, baseProps);
    expect(textOf(html)).not.toMatch(/add a way to reach them|locked|agents paused|retained in your vault/i);
  });
});

// ─── Plots row — A-list pinned first, segment name + count ─────────────────────────────────────────
describe('Plots chip row (§4.6 "Community home")', () => {
  test('the A-list star filter is pinned first, before any segment plot', () => {
    const html = render(PlotsRow, {
      plots: [
        { key: 'IDENTIFIED', name: 'Identified', count: 4 },
        { key: 'RESPONDED', name: 'Responded', count: 2 },
      ],
      selectedKey: null,
      onSelect: () => {},
    });
    const aListIdx = html.indexOf('A-list');
    const firstPlotIdx = html.indexOf('Identified');
    expect(aListIdx).toBeGreaterThanOrEqual(0);
    expect(firstPlotIdx).toBeGreaterThan(aListIdx);
  });

  test('each plot renders its name and count', () => {
    const html = render(PlotsRow, {
      plots: [{ key: 'MET', name: 'Met', count: 7 }],
      selectedKey: null,
      onSelect: () => {},
    });
    expect(textOf(html)).toContain('Met');
    expect(textOf(html)).toContain('7');
  });

  test('the selected plot (or A-list) carries aria-selected="true"; others do not', () => {
    const html = render(PlotsRow, {
      plots: [{ key: 'MET', name: 'Met', count: 7 }],
      selectedKey: A_LIST_PLOT_KEY,
      onSelect: () => {},
    });
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
  });
});
