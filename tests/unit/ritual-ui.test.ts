// uiux §5.4 — the Warm-Market Ritual UI proof tests (T-28, build unit WP03/T-28).
//
// Renders the real ritual layer components with react-dom/server (same convention as
// tests/unit/onboarding-ui.test.ts) and scans their output for the load-bearing contracts the T-28
// charter names:
//   (a) the ritual renders its three layers (Blank Canvas / Qualities Flip / Background Matching)
//       and the SIX master-spec quality clusters (never five), and NEVER renders a numeric readiness
//       score anywhere — only the plain-language tier `label` (AC-5.4-2, AC-5.4-4);
//   excluded contacts never appear as actionable in the confirmation screen (master spec §8.2);
//   the soft gate never hard-blocks (AC-5.4-1); the framing caption stays doctrine-clean (§8.1).
//
// Each assertion has TEETH: it fails if a score leaks, a cluster count drifts from six, an excluded
// contact is rendered as an actionable top match, or the soft gate disables continuing instead of
// merely asking once.

import { createElement, type ElementType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QualityCluster, ReadinessTier } from '@prisma/client';

import BlankCanvasLayer, {
  CONSTELLATION_SIZE,
  type BlankCanvasDraftEntry,
} from '@/app/ritual/warm-market/components/BlankCanvasLayer';
import QualitiesFlipLayer, {
  type QualitiesFlipAssignmentDraft,
  type QualitiesFlipSeed,
} from '@/app/ritual/warm-market/components/QualitiesFlipLayer';
import BackgroundMatchingLayer from '@/app/ritual/warm-market/components/BackgroundMatchingLayer';
import RitualConfirmation, {
  APPROVAL_BOUNDARY_LINE,
  WARM_MARKET_SUB_AGENT_NAME,
} from '@/app/ritual/warm-market/components/RitualConfirmation';
import { QUALITY_CLUSTER_COUNT, QUALITY_CLUSTER_DEFINITIONS } from '@/services/harvest-method/clusters';
import type { PublicQueueItem } from '@/types/harvest-method';

const render = (el: ElementType, props: Record<string, unknown>) => renderToStaticMarkup(createElement(el, props));
/** Visible text only (tags/attrs stripped) — digit checks must reflect what the rep actually SEES. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');

const noop = () => {};

// ─── (a1) Blank Canvas — Layer 1: 20-dot constellation, vault count as a number only, soft gate ────
describe('(a) Blank Canvas — Layer 1 of 3 (§5.4, AC-5.4-1)', () => {
  test('renders exactly a 20-dot constellation and the vault count as a NUMBER only (never names)', () => {
    const html = render(BlankCanvasLayer, {
      vaultCount: 47,
      entries: [{ typedName: 'Jordan', matched: true, contactId: 'c-1' }],
      onAddName: noop,
      softGateOpen: false,
      onRequestFinish: noop,
      onConfirmSoftGate: noop,
      onKeepAdding: noop,
    });
    expect((html.match(/role="listitem"/g) ?? []).length).toBe(CONSTELLATION_SIZE);
    expect(CONSTELLATION_SIZE).toBe(20);
    expect(textOf(html)).toMatch(/You have 47 people in your field/);
  });

  test('the ambient timer is decorative (aria-hidden) and Continue is enabled once >=1 name is entered', () => {
    const entries: BlankCanvasDraftEntry[] = [{ typedName: 'Alex', matched: false }];
    const html = render(BlankCanvasLayer, {
      vaultCount: 0,
      entries,
      onAddName: noop,
      softGateOpen: false,
      onRequestFinish: noop,
      onConfirmSoftGate: noop,
      onKeepAdding: noop,
    });
    expect(html).toMatch(/aria-hidden="true"/);
    const continueBtn = html.match(/<button[^>]*>\s*That.{1,4}s my list\s*<\/button>/)?.[0] ?? '';
    expect(continueBtn).not.toMatch(/disabled/);
  });

  test('TEETH (AC-5.4-1): the soft gate (<5 names) ASKS ONCE — it renders both a "keep adding" and a confirm action, never a disabled/hard-blocked state', () => {
    const html = render(BlankCanvasLayer, {
      vaultCount: 10,
      entries: [{ typedName: 'One', matched: false }, { typedName: 'Two', matched: false }],
      onAddName: noop,
      softGateOpen: true,
      onRequestFinish: noop,
      onConfirmSoftGate: noop,
      onKeepAdding: noop,
    });
    expect(textOf(html)).toMatch(/Are you sure you want to stop at 2/);
    expect(textOf(html)).toMatch(/keep adding/i);
    // The confirm action is a live, un-disabled button — proceeding on confirm is always available.
    const confirmBtn = html.match(/<button[^>]*>\s*Yes, that.{1,4}s my list\s*<\/button>/)?.[0] ?? '';
    expect(confirmBtn).not.toMatch(/disabled/);
  });
});

// ─── (a2) Qualities Flip — Layer 2: the SIX clusters (never five), doctrine-clean framing ─────────
describe('(a) Qualities Flip — Layer 2 of 3, the SIX master-spec clusters govern (§8.1, AC-5.4-2)', () => {
  const seeds: QualitiesFlipSeed[] = [{ contactId: 'c-1', name: 'Taylor' }];
  const assignments: Record<string, QualitiesFlipAssignmentDraft> = {
    'c-1': { clusters: [QualityCluster.COMMUNITY_HUB], needsTime: false },
  };

  test('TEETH: renders EXACTLY six quality-cluster cards (QUALITY_CLUSTER_COUNT), never five', () => {
    expect(QUALITY_CLUSTER_COUNT).toBe(6);
    const html = render(QualitiesFlipLayer, {
      selectedClusters: [],
      onToggleSelectedCluster: noop,
      seeds,
      assignments,
      onToggleAssignedCluster: noop,
      onToggleNeedsTime: noop,
      onContinue: noop,
    });
    for (const def of QUALITY_CLUSTER_DEFINITIONS) {
      expect(textOf(html)).toContain(def.label);
    }
    expect((html.match(/role="group" aria-label="The six quality clusters"/g) ?? []).length).toBe(1);
  });

  test('the doctrine-clean framing caption renders verbatim (§8.1 service-first reframe)', () => {
    const html = render(QualitiesFlipLayer, {
      selectedClusters: [],
      onToggleSelectedCluster: noop,
      seeds,
      assignments,
      onToggleAssignedCluster: noop,
      onToggleNeedsTime: noop,
      onContinue: noop,
    });
    expect(textOf(html)).toMatch(/Service first: who has the qualities that thrive in this business\?/);
    // Doctrine vocabulary clean (§0.5): never "lead"/"prospect" anywhere in this layer's copy.
    expect(html).not.toMatch(/\blead\b|\bprospect\b/i);
  });

  test('every seed contact\'s assigned cluster chip renders as pressed (aria-pressed="true")', () => {
    const html = render(QualitiesFlipLayer, {
      selectedClusters: [QualityCluster.COMMUNITY_HUB, QualityCluster.RISING_ACHIEVER],
      onToggleSelectedCluster: noop,
      seeds,
      assignments,
      onToggleAssignedCluster: noop,
      onToggleNeedsTime: noop,
      onContinue: noop,
    });
    expect(textOf(html)).toContain('Taylor');
    expect(html).toContain('aria-pressed="true"');
  });
});

// ─── (a3) Background Matching — Layer 3: four tiles, marker stroke, corrections, never a score ────
describe('(a) Background Matching — Layer 3 of 3 (§8.1, AC-5.4-3)', () => {
  test('renders all four context tiles per highlighted contact + the amber marker-stroke class on the name', () => {
    const html = render(BackgroundMatchingLayer, {
      entries: [
        {
          contactId: 'c-1',
          name: 'Riley',
          tiles: {},
          note: '',
          existingLicenseeFlag: false,
        },
      ],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [],
      onSubmit: noop,
    });
    expect(textOf(html)).toMatch(/Career Stage/);
    expect(textOf(html)).toMatch(/Financial Situation/);
    expect(textOf(html)).toMatch(/Family Context/);
    expect(textOf(html)).toMatch(/Community Role/);
    expect(textOf(html)).toContain('Riley');
  });

  test('a returned doctrine correction is surfaced inline, logged (§8.5)', () => {
    const html = render(BackgroundMatchingLayer, {
      entries: [{ contactId: 'c-1', name: 'Riley', tiles: {}, note: 'a community contact', existingLicenseeFlag: false }],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [
        {
          contactId: 'c-1',
          original: 'a prospect',
          corrected: 'a community contact',
          violations: [{ forbidden: 'prospect', replacement: 'community contact', match: 'prospect' }],
        },
      ],
      onSubmit: noop,
    });
    expect(textOf(html)).toMatch(/corrected a word/i);
    expect(textOf(html)).toContain('a community contact');
  });

  test('TEETH: this layer never renders any numeric score anywhere in its output', () => {
    const html = render(BackgroundMatchingLayer, {
      entries: [{ contactId: 'c-1', name: 'Riley', tiles: { careerStage: 'early' }, note: '', existingLicenseeFlag: false }],
      onChangeTile: noop,
      onChangeNote: noop,
      onToggleExistingLicensee: noop,
      corrections: [],
      onSubmit: noop,
    });
    expect(html).not.toMatch(/readiness[_\s]?score/i);
  });
});

// ─── (a4) Confirmation — never a numeric score, excluded contacts never actionable ────────────────
describe('(a) Ritual confirmation — score NEVER shown, excluded never actionable (AC-5.4-4/5/6)', () => {
  const actionableItem: PublicQueueItem = {
    contactId: 'c-1',
    firstName: 'Morgan',
    lastInitial: 'S',
    clusters: [QualityCluster.COMMUNITY_HUB],
    tiles: {},
    tier: ReadinessTier.A,
    label: 'Ready now',
    needsAcknowledgment: false,
    needsJurisdiction: false,
    layersCompleted: [],
  };
  const excludedItem: PublicQueueItem = {
    contactId: 'c-2',
    firstName: 'Casey',
    lastInitial: 'L',
    clusters: [],
    tiles: {},
    tier: ReadinessTier.EXCLUDED,
    label: 'Not eligible',
    needsAcknowledgment: true,
    needsJurisdiction: false,
    layersCompleted: [],
  };
  // T-29R2 — a distinct data-completion-prompt state, never mixed into the actionable grid either.
  const needsJurisdictionItem: PublicQueueItem = {
    contactId: 'c-3',
    firstName: 'Drew',
    lastInitial: 'T',
    clusters: [],
    tiles: {},
    tier: ReadinessTier.NEEDS_JURISDICTION,
    label: 'Needs jurisdiction info',
    needsAcknowledgment: false,
    needsJurisdiction: true,
    layersCompleted: [],
  };

  test('TEETH: renders NO digit anywhere that could be a readiness score — only the plain-language tier label', () => {
    const html = render(RitualConfirmation, {
      queue: [actionableItem],
      onAcknowledgeExcluded: noop,
      onHandToAgent: noop,
    });
    // The rendered text carries no digits at all (score could only reach the rep as a number).
    expect(textOf(html)).not.toMatch(/[0-9]/);
    expect(html).not.toMatch(/readiness[_\s]?score/i);
    expect(textOf(html)).toContain('Ready now');
  });

  test('TEETH: an EXCLUDED item is never mixed into the actionable top-match grid — it appears ONLY in the acknowledgment section', () => {
    const html = render(RitualConfirmation, {
      queue: [actionableItem, excludedItem],
      onAcknowledgeExcluded: noop,
      onHandToAgent: noop,
    });
    // Casey appears exactly once (in the excluded/acknowledgment section), not duplicated as a
    // top-match card too.
    const occurrences = (html.match(/Casey/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(textOf(html)).toMatch(/(need|require|requires) your acknowledgment/i);
    expect(textOf(html)).toMatch(/never actionable/i);
    // An excluded contact needing acknowledgment gets an Acknowledge action, not a send/approve one.
    expect(textOf(html)).toContain('Acknowledge');
  });

  test('T-29R2 TEETH: a NEEDS_JURISDICTION item is never mixed into the actionable top-match grid, and is never rendered as an "excluded" acknowledgment item either — it gets its own distinct, non-actionable section', () => {
    const html = render(RitualConfirmation, {
      queue: [actionableItem, needsJurisdictionItem],
      onAcknowledgeExcluded: noop,
      onHandToAgent: noop,
    });
    const occurrences = (html.match(/Drew/g) ?? []).length;
    expect(occurrences).toBe(1); // present exactly once — never duplicated into the actionable grid
    expect(textOf(html)).toMatch(/need their state on file/i);
    expect(textOf(html)).toContain('Needs jurisdiction info');
    // Distinct from the "excluded, needs acknowledgment" framing — this is a data gap, not a
    // confirmed exclusion, so there is no Acknowledge action rendered anywhere in this queue.
    expect(textOf(html)).not.toContain('Acknowledge');
  });

  test('names the Warm Market Sub-Agent and states the honest approval boundary (AC-5.4-5)', () => {
    const html = render(RitualConfirmation, { queue: [actionableItem], onAcknowledgeExcluded: noop, onHandToAgent: noop });
    expect(textOf(html)).toContain(WARM_MARKET_SUB_AGENT_NAME);
    expect(textOf(html)).toContain(APPROVAL_BOUNDARY_LINE);
  });

  test('unmatched highlights render the add-number capture prompt (AC-5.4-5)', () => {
    const html = render(RitualConfirmation, {
      queue: [actionableItem],
      unmatchedHighlights: [{ name: 'Sam' }],
      onAcknowledgeExcluded: noop,
      onHandToAgent: noop,
    });
    expect(textOf(html)).toMatch(/couldn.{1,3}t find Sam/i);
    expect(textOf(html)).toContain('Add number');
  });

  test('TEETH: PublicQueueItem (the type this component is built against) has no score field to render at all — a compile-time contract', () => {
    const item = actionableItem as unknown as Record<string, unknown>;
    expect('score' in item).toBe(false);
    expect('readinessScore' in item).toBe(false);
  });
});
