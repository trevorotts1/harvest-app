// T-R16 (from T-R13 QC "approve-button CFE gate") — `src/app/inbox/components/ApprovalInboxItem.tsx`
// used to enable its plain, one-tap Approve button whenever `approval_state !== 'HELD'` — so a
// FLAG/PENDING (non-PASS) draft showed an enabled Approve affordance even though the server enforces
// stricter rules for it in some hosts (e.g. the Shift's `ShiftApprovalRequiresReviewError`). This
// suite proves the fix: the plain Approve button now ALSO requires `cfe_outcome === 'PASS'`, and a
// FLAG draft gets a SEPARATE "Approve with justification" control instead (uiux AC-5.6-5) — never
// both, never neither combined incorrectly. It also proves this new CFE gate COEXISTS with T-54's
// offline suppression (`item.queuedOffline`) rather than one bypassing the other: this repo's Jest
// config runs `testEnvironment: 'node'` (no DOM/jsdom — see shift-ui.test.ts's own header note), so
// — same convention as every other ApprovalInboxItem render proof in this suite — assertions are
// against the component's real, unmocked `react-dom/server` static markup for its initial (view-mode)
// render.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ApprovalInboxItem, { type InboxItemData } from '@/app/inbox/components/ApprovalInboxItem';

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ApprovalInboxItem as never, props));
const textOf = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const noopApprove = async () => ({ ok: true });
const noopDecline = async () => ({ ok: true });
const noopEdit = async () => ({ ok: true });

function baseItem(overrides: Partial<InboxItemData> = {}): InboxItemData {
  return {
    id: 'd-1',
    contact_id: 'c-1',
    contact: { firstName: 'Jordan', lastName: 'Vega' },
    channel: 'SMS_HANDOFF',
    body: 'a drafted message',
    cfe_outcome: 'PASS',
    cfe_risk_score: 3,
    approval_state: 'PENDING',
    created_at: new Date('2026-07-18T08:00:00Z').toISOString(),
    ...overrides,
  };
}

/** Matches a `<button>` whose visible text is EXACTLY "Approve" (nothing appended) — the plain,
 *  one-tap affordance. Distinct from "Approve with justification", which this regex does NOT match. */
const EXACT_PLAIN_APPROVE_BUTTON = /<button[^>]*>\s*Approve\s*<\/button>/;

describe('canPlainApprove — the plain one-tap Approve button requires cfe_outcome===PASS (in addition to !isHeld)', () => {
  test('cfe_outcome PASS, approval_state PENDING, online -> the plain Approve button renders, enabled', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'PASS', approval_state: 'PENDING' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(html).not.toMatch(/Approve with justification/);
    // Not disabled — the plain-approve button's `disabled={busy}` is false on initial render.
    const [tag] = html.match(/<button[^>]*>\s*Approve\s*<\/button>/) ?? [''];
    expect(tag).not.toMatch(/disabled/);
  });

  // ══ THE TEETH TEST ══ — TEETH: fails if the PASS-only gate is removed/weakened back to the old
  // `!isHeld`-only rule. A FLAG/PENDING draft must NEVER show the plain, unconditionally-enabled
  // "Approve" affordance — only the separate, justification-gated control.
  test('TEETH: cfe_outcome FLAG, approval_state PENDING, online -> NO plain enabled Approve button — only the justification-gated control', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'FLAG', approval_state: 'PENDING' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(textOf(html)).toMatch(/Approve with justification/);
    // The justification control is disabled until the rep types something (empty on initial render).
    const match = html.match(/<button([^>]*)>\s*Approve with justification\s*<\/button>/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/disabled/);
    // The justification textarea itself is present too.
    expect(html).toMatch(/Justification for approving this flagged draft/);
  });

  test('cfe_outcome BLOCK, approval_state PENDING (defensive — should not normally occur alongside PENDING) -> no plain Approve, no justification control either', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'BLOCK', approval_state: 'PENDING' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(html).not.toMatch(/Approve with justification/);
  });

  test('HELD (blocked verdict) -> neither the plain Approve nor the justification control render, regardless of cfe_outcome', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'FLAG', approval_state: 'HELD' }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(html).not.toMatch(/Approve with justification/);
    expect(textOf(html)).toMatch(/cannot be approved as-is/);
  });
});

describe('COEXISTENCE with T-54 offline suppression — queuedOffline wins over BOTH Approve affordances, for either outcome', () => {
  test('queuedOffline: true + cfe_outcome PASS -> no plain Approve (T-54 baseline, re-confirmed here)', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'PASS', approval_state: 'PENDING', queuedOffline: true }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(html).not.toMatch(/Approve with justification/);
    expect(textOf(html)).toMatch(/will finish when you.{1,3}re back online/i);
  });

  // ══ THE COEXISTENCE TEETH TEST ══ — proves the NEW CFE gate does not accidentally bypass the
  // EXISTING offline suppression: a FLAG item that is ALSO queued offline must show neither the
  // justification control nor any Approve affordance — only the honest "Queued" state, exactly as
  // T-54 established for every other outcome.
  test('TEETH: queuedOffline: true + cfe_outcome FLAG -> the justification control does NOT render either — offline suppression still wins', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'FLAG', approval_state: 'PENDING', queuedOffline: true }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(html).not.toMatch(EXACT_PLAIN_APPROVE_BUTTON);
    expect(html).not.toMatch(/Approve with justification/);
    expect(html).not.toMatch(/Justification for approving this flagged draft/);
    expect(textOf(html)).toMatch(/will finish when you.{1,3}re back online/i);
    expect(textOf(html)).toMatch(/Queued/);
  });

  test('negative control: queuedOffline false + cfe_outcome FLAG (online) -> the justification control DOES render (proves the suppression is offline-specific, not a blanket hide)', () => {
    const html = render({
      item: baseItem({ cfe_outcome: 'FLAG', approval_state: 'PENDING', queuedOffline: false }),
      onApprove: noopApprove,
      onDecline: noopDecline,
      onEdit: noopEdit,
    });
    expect(textOf(html)).toMatch(/Approve with justification/);
  });
});
