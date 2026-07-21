// T-R13 — proves the wiring that embeds T-33's real ApprovalInboxItem directly into the Shift's
// Work-phase card (replacing the old deep-link-to-`/inbox` stopgap; see WorkPhase.tsx's header note
// and ShiftApprovalRequiresReviewError's doc comment in shift.service.ts). Three things this file
// exists to prove:
//
//   1. EDIT RE-ENTERS THE CFE: `makeEditHandler` posts to the REAL `/api/approval-inbox/edit` route
//      (the exact endpoint `ApprovalInboxService.editDraft` backs) — this file calls no CFE logic
//      of its own, it only proves the request/response wiring is correct and that the re-checked
//      band always replaces the stale one in the merged result.
//   2. FAIL-CLOSED, PRESERVED: a CFE-BLOCKED (HELD) draft's merged post-edit item, fed into the REAL
//      (unmocked) `ApprovalInboxItem` and rendered, never has an Approve button — proving the
//      invariant holds all the way from "the edit route said HELD" to "the rep literally cannot tap
//      Approve", not just at the service layer.
//   3. APPROVE/DECLINE REUSE THE SHIFT'S OWN ACTION PATH, UNCHANGED: `makeApproveHandler` /
//      `makeDeclineHandler` are thin adapters over the SAME `onAction` every other Work-phase button
//      already calls (`/api/shift/action` -> `ShiftService.actionCard`) — a refusal from that path
//      (e.g. `ShiftApprovalRequiresReviewError`, unmodified by T-R13) is surfaced as `{ok:false,
//      error}`, never silently swallowed into a success.
//
// This repo's Jest config runs `testEnvironment: 'node'` (no DOM/jsdom, no @testing-library — see
// jest.config.js and shift-view.test.ts's own header note on the same constraint), so — same
// convention as `applyOptimisticAction`/`OfflineActionQueue` — the ADAPTER functions are exported
// from DraftApprovalCard.tsx specifically so they can be exercised directly, without simulating a
// click.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ApprovalInboxItem, { type InboxItemData } from '@/app/inbox/components/ApprovalInboxItem';
import DraftApprovalCard, {
  cardToInboxItem,
  makeApproveHandler,
  makeDeclineHandler,
  makeEditHandler,
} from '@/app/shift/components/DraftApprovalCard';
import { t as catalog, type TVars } from '@/lib/i18n/catalog';
import type { ShiftQueueCard } from '@/types/learning-state';

// T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — `makeEditHandler` now resolves its DISPLAY
// string from the route's `code` via `errorDisplay`, never the raw English `error` prose. This fake
// `t` mirrors `regate-b-error-i18n.test.ts`'s own convention (the real catalog lookup, pinned to a
// locale) rather than a stub, so a test asserting Spanish output is proof against the REAL `es.json`
// copy, not a mock that could drift from it.
const tEn = (key: string, vars?: TVars) => catalog('en', key, vars);
const tEs = (key: string, vars?: TVars) => catalog('es', key, vars);

function draftCard(overrides: Partial<ShiftQueueCard> = {}): ShiftQueueCard {
  return {
    id: 'd1',
    type: 'RESPOND_FLAGGED',
    title: 'Respond to a flagged draft',
    detail: 'the drafted body text',
    estimateMinutes: 1,
    cfeOutcome: 'FLAG',
    draft: {
      contactId: 'contact-1',
      contact: { firstName: 'Maya', lastName: 'Jordan' },
      channel: 'SMS_HANDOFF',
      cfeRiskScore: 55,
      approvalState: 'PENDING',
      createdAt: '2026-07-18T08:00:00.000Z',
    },
    ...overrides,
  };
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ─── cardToInboxItem: no second source of truth for any field ─────────────────────────────────────

describe('cardToInboxItem — maps ShiftQueueCard.draft into the exact InboxItemData ApprovalInboxItem needs', () => {
  test('a fully-hydrated draft card maps every field through', () => {
    const item = cardToInboxItem(draftCard());
    expect(item).toEqual<InboxItemData>({
      id: 'd1',
      contact_id: 'contact-1',
      contact: { firstName: 'Maya', lastName: 'Jordan' },
      channel: 'SMS_HANDOFF',
      body: 'the drafted body text',
      cfe_outcome: 'FLAG',
      cfe_risk_score: 55,
      approval_state: 'PENDING',
      created_at: '2026-07-18T08:00:00.000Z',
    });
  });

  test('a card with no `draft` payload degrades gracefully (never throws) with safe defaults', () => {
    const item = cardToInboxItem(draftCard({ draft: undefined, cfeOutcome: undefined }));
    expect(item.contact).toBeNull();
    expect(item.approval_state).toBe('PENDING');
    expect(item.cfe_outcome).toBeNull();
  });
});

// ─── makeApproveHandler: reuses `onAction` (the Shift's own /api/shift/action path) — TEETH ───────

// T-57 RE-GATE ROUND-3 (B [a7133fce] residual) — `onAction` rejecting no longer bubbles its raw
// `.message` (always English prose from `ShiftOwnershipError`/`ShiftApprovalRequiresReviewError`)
// straight to the rendered card. It now resolves a DISPLAY string from the `code` a rejection MAY
// carry (see `ShiftView.tsx`'s `postJson`/`CodedActionError`, the OTHER half of this fix) via
// `errorDisplay` — proven below against the REAL `es.json` catalog (`tEs`), not a mock, so a
// passing test is proof a Spanish rep gets Spanish, never the raw English these two service errors
// default to. `codedError` simulates exactly what `postJson` now attaches to a rejected `onAction`.
function codedError(message: string, code?: string, currentState?: string): Error {
  const err = new Error(message) as Error & { code?: string; currentState?: string };
  if (code !== undefined) err.code = code;
  if (currentState !== undefined) err.currentState = currentState;
  return err;
}

describe('makeApproveHandler — Approve is wired through the SAME onAction every other Work-phase button uses', () => {
  test('onAction resolving -> {ok: true}, and onAction is called with exactly (draftId, "APPROVE")', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const approve = makeApproveHandler(onAction, tEs);

    const result = await approve('d1');

    expect(result).toEqual({ ok: true });
    expect(onAction).toHaveBeenCalledWith('d1', 'APPROVE');
  });

  test('TEETH — fail-closed preserved AND localized: a REQUIRES_REVIEW refusal (mirrors ShiftApprovalRequiresReviewError / the 409 the route surfaces for a non-PASS draft) is NEVER swallowed into a success, and resolves the REAL Spanish errors.REQUIRES_REVIEW catalog string — never the raw English `.message` the rejection carries', async () => {
    const onAction = jest.fn().mockRejectedValue(
      codedError(
        'This draft was flagged by compliance review and cannot be approved from the Shift ritual — review it in the Approval Inbox.',
        'REQUIRES_REVIEW'
      )
    );
    const approve = makeApproveHandler(onAction, tEs);

    const result = await approve('flagged-draft');

    expect(result.ok).toBe(false);
    expect(result.error).toBe(catalog('es', 'errors.REQUIRES_REVIEW'));
    expect(result.error).not.toMatch(/flagged by compliance review/i);
  });

  test('a NOT_OWNED refusal (mirrors ShiftOwnershipError) resolves the REAL Spanish errors.NOT_OWNED catalog string, never the raw English message', async () => {
    const onAction = jest.fn().mockRejectedValue(codedError('That item does not belong to you.', 'NOT_OWNED'));
    const approve = makeApproveHandler(onAction, tEs);

    const result = await approve('not-mine');

    expect(result).toEqual({ ok: false, error: catalog('es', 'errors.NOT_OWNED') });
  });

  test('a rejection with no usable code (incl. a non-Error value) still resolves to the REAL localized errors.generic — never English, never a crash', async () => {
    const onAction = jest.fn().mockRejectedValue('not an Error instance');
    const approve = makeApproveHandler(onAction, tEs);
    const result = await approve('d1');
    expect(result).toEqual({ ok: false, error: catalog('es', 'errors.generic') });
  });
});

// ─── makeDeclineHandler: same onAction path, never gated ──────────────────────────────────────────

describe('makeDeclineHandler — Decline reuses the same onAction path; a server refusal still surfaces, never silently', () => {
  test('onAction resolving -> {ok: true} regardless of the reason/note the embedded selector collected', async () => {
    const onAction = jest.fn().mockResolvedValue(undefined);
    const decline = makeDeclineHandler(onAction, tEs);

    const result = await decline('d1', 'wrong_person', 'not the right contact');

    expect(result).toEqual({ ok: true });
    expect(onAction).toHaveBeenCalledWith('d1', 'DECLINE');
  });

  test('onAction rejecting with a NOT_OWNED code surfaces {ok: false, error}, resolved to the REAL Spanish errors.NOT_OWNED string — never the raw English `.message`, not a silent success', async () => {
    const onAction = jest.fn().mockRejectedValue(codedError('That item does not belong to you.', 'NOT_OWNED'));
    const decline = makeDeclineHandler(onAction, tEs);
    const result = await decline('not-mine', 'other');
    expect(result).toEqual({ ok: false, error: catalog('es', 'errors.NOT_OWNED') });
    expect(result.error).not.toBe('That item does not belong to you.');
  });

  test('a rejection with no usable code still resolves to the REAL localized errors.generic, never English', async () => {
    const onAction = jest.fn().mockRejectedValue('not an Error instance');
    const decline = makeDeclineHandler(onAction, tEs);
    const result = await decline('d1', 'other');
    expect(result).toEqual({ ok: false, error: catalog('es', 'errors.generic') });
  });
});

// ─── makeEditHandler: THE RE-ENTRY CALL, from inside the Shift ────────────────────────────────────

describe('makeEditHandler — editing a draft from inside the Shift RE-ENTERS THE CFE via the real /api/approval-inbox/edit route', () => {
  test('posts to the real edit route with exactly {draftId, body} — the same contract inbox/page.tsx uses, not a second implementation', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, {
        ok: true,
        draft: { body: 'rewritten text', cfe_outcome: 'PASS', cfe_risk_score: 2, approval_state: 'PENDING' },
      })
    );
    const initialItem = cardToInboxItem(draftCard());
    const edit = makeEditHandler(initialItem, tEn, fetchImpl as unknown as typeof fetch);

    await edit('d1', 'rewritten text');

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/approval-inbox/edit',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ draftId: 'd1', body: 'rewritten text' }),
      })
    );
  });

  test('a re-check that comes back PASS merges the new band/body over the old, preserving contact/channel/created_at from the pre-edit item', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, {
        ok: true,
        draft: { body: 'a compliant rewrite', cfe_outcome: 'PASS', cfe_risk_score: 1, approval_state: 'PENDING' },
      })
    );
    const initialItem = cardToInboxItem(draftCard()); // FLAG/PENDING, contact "Maya Jordan"
    const edit = makeEditHandler(initialItem, tEn, fetchImpl as unknown as typeof fetch);

    const result = await edit('d1', 'a compliant rewrite');

    expect(result.ok).toBe(true);
    expect(result.item).toEqual({
      ...initialItem,
      body: 'a compliant rewrite',
      cfe_outcome: 'PASS',
      cfe_risk_score: 1,
      approval_state: 'PENDING',
    });
    // The pre-edit fields the edit route's response never repeats are carried over unchanged.
    expect(result.item?.contact).toEqual({ firstName: 'Maya', lastName: 'Jordan' });
    expect(result.item?.channel).toBe('SMS_HANDOFF');
  });

  test('TEETH — a re-check that comes back HELD (still non-compliant) merges to approval_state HELD, and THAT merged item — fed into the REAL ApprovalInboxItem — renders with NO Approve button', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(200, {
        ok: true,
        draft: { body: 'still not compliant', cfe_outcome: 'BLOCK', cfe_risk_score: 91, approval_state: 'HELD' },
      })
    );
    const initialItem = cardToInboxItem(draftCard());
    const edit = makeEditHandler(initialItem, tEn, fetchImpl as unknown as typeof fetch);

    const result = await edit('d1', 'still not compliant');
    expect(result.ok).toBe(true);
    expect(result.item?.approval_state).toBe('HELD');

    // The end-to-end proof: this exact merged item, rendered through the REAL (unmocked)
    // ApprovalInboxItem, never offers an Approve button — the CFE-BLOCKED draft cannot be approved
    // from within the Shift, full stop.
    const html = renderToStaticMarkup(
      createElement(ApprovalInboxItem, {
        item: result.item!,
        onApprove: async () => ({ ok: true }),
        onDecline: async () => ({ ok: true }),
        onEdit: async () => ({ ok: true }),
      })
    );
    expect(html).not.toMatch(/<button[^>]*>\s*Approve\s*<\/button>/);
    expect(html).toMatch(/cannot be approved as-is/);
  });

  // T-57 RE-GATE B [af7789d3] Finding 1 residual (RGb2) — RE-CONFIRM RED then GREEN. RED: the route
  // ALWAYS carries raw-English `error` prose alongside `code` (kept for logs/back-compat only).
  // GREEN: `makeEditHandler` never surfaces that raw `error` — it resolves the SAME `code` through
  // `errorDisplay`, so an ES-locale rep gets a genuine, distinct-from-English Spanish sentence.
  test('RE-CONFIRMED RED then GREEN — a server-side edit refusal (terminal state) resolves the DISPLAY string from `code`, never the raw English `error`', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      fakeResponse(409, {
        error: 'A declined draft cannot be edited (current state: DECLINED) — start a new draft instead.',
        code: 'TERMINAL_STATE',
        currentState: 'DECLINED',
        ok: false,
      })
    );

    // RED (re-confirmed): the wire body genuinely still carries raw English prose in `error`.
    const rawBody = await (await fetchImpl()).json();
    expect(rawBody.error).toMatch(/^A declined draft cannot be edited/);

    const editEn = makeEditHandler(cardToInboxItem(draftCard()), tEn, fetchImpl as unknown as typeof fetch);
    const resultEn = await editEn('d1', 'x');
    expect(resultEn.ok).toBe(false);
    expect(resultEn.item).toBeUndefined();
    expect(resultEn.error).toBe('A declined draft can\'t be edited (current state: declined) — start a new draft instead.');

    const editEs = makeEditHandler(cardToInboxItem(draftCard()), tEs, fetchImpl as unknown as typeof fetch);
    const resultEs = await editEs('d1', 'x');
    expect(resultEs.ok).toBe(false);
    // GREEN: a genuine, distinct Spanish sentence — never the raw English wire `error`.
    expect(resultEs.error).toBe(
      'Un borrador rechazado no se puede editar (estado actual: rechazado) — inicia un borrador nuevo en su lugar.'
    );
    expect(resultEs.error).not.toBe(rawBody.error);
    expect(resultEs.error).not.toBe(resultEn.error);
  });

  test('an unknown/absent `code` still resolves to errors.generic (localized), never the raw English `error` and never blank', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse(500, { error: 'Internal server error', ok: false }));
    const edit = makeEditHandler(cardToInboxItem(draftCard()), tEs, fetchImpl as unknown as typeof fetch);
    const result = await edit('d1', 'x');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Ocurrió un error. Inténtalo de nuevo.');
    expect(result.error).not.toBe('Internal server error');
  });

  test('a network failure (fetch throws) resolves to a safe fallback error, never throws out of the handler', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const edit = makeEditHandler(cardToInboxItem(draftCard()), tEn, fetchImpl as unknown as typeof fetch);
    const result = await edit('d1', 'x');
    expect(result).toEqual({ ok: false, error: 'This edit could not be saved.' });
  });
});

// ─── DraftApprovalCard: the actual embed renders without crashing, wired end-to-end ────────────────

describe('DraftApprovalCard — renders the real ApprovalInboxItem, wired to the card\'s own data', () => {
  test('renders the CFE chip + contact name straight from the ShiftQueueCard.draft payload', () => {
    const html = renderToStaticMarkup(
      createElement(DraftApprovalCard, { card: draftCard(), onAction: async () => undefined })
    );
    expect(html).toMatch(/Maya Jordan/);
    expect(html).toMatch(/Flagged/);
    expect(html).toMatch(/the drafted body text/);
  });
});
