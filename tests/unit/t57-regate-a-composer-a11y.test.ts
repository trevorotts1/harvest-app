// T-57 RE-GATE-A [ade0da76] fix unit (fix/T57-RGa-composer-a11y). The re-gate's fresh WCAG sweep on
// the remediated trunk (28443ae) found a NEW major blocker plus two non-blocking follow-ups it asked
// to be folded into the same fix:
//
//   1. BLOCKER — ComposerHandoffSheet.tsx declares role="dialog" aria-modal="true" (a real modal, on
//      the P0 first-touch surface, 4 mount sites: inbox/page.tsx, inbox/[itemId]/page.tsx,
//      today/components/WP07Panel.tsx, community/[contactId]/page.tsx) but shipped with NO Escape
//      handler, NO focus trap, and NO focus management at all.
//   2. follow-up — GroveThreeLawsSheet.tsx's focus handling was INCOMPLETE: it moved focus IN on
//      open (closeButtonRef) and closed on Escape, but never trapped Tab/Shift+Tab inside the sheet
//      and never returned focus to the Grove tap-target on close (dropped to <body> instead).
//   3. follow-up — me/security/page.tsx's MFA-error message had no aria-live region (a screen reader
//      user would never learn the enroll/verify call failed).
//
// This repo's Jest runs `testEnvironment: 'node'` (no jsdom — see composer-handoff-sheet.test.ts's
// and wcag-keyboard-focus.test.ts's own header notes). Focus/keyboard *behavior* has no DOM to
// exercise it against, so — matching this repo's documented, already-used convention (see
// wcag-keyboard-focus.test.ts section (c) and t57-r3c1-grove-sheet.test.ts's Escape/focus-ref tests)
// — these are source-scan assertions over the fixed files' own text, proving the exact mechanisms
// (Escape branch, focus-on-open ref call, Tab-trap bounds-check + preventDefault, trigger-capture +
// return-focus call) are present and wired to the right handler, not just present anywhere in the file.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const src = (...parts: string[]) => readFileSync(path.join(REPO_ROOT, 'src', ...parts), 'utf8');

describe('RE-GATE-A BLOCKER — ComposerHandoffSheet.tsx is now a real, fully keyboard-operable modal', () => {
  const component = src('app', 'community', 'components', 'ComposerHandoffSheet.tsx');

  test('role="dialog" + aria-modal="true" are still declared (unchanged content contract)', () => {
    expect(component).toMatch(/role="dialog"/);
    expect(component).toMatch(/aria-modal="true"/);
  });

  test('Escape closes the sheet via a real key-check wired to the dialog\'s onKeyDown', () => {
    expect(component).toMatch(/e\.key === 'Escape'/);
    expect(component).toMatch(/onKeyDown=\{handleDialogKeyDown\}/);
  });

  test('focus moves INTO the dialog (onto the close button) the instant it opens', () => {
    // The effect fires on `open` and calls the close-button ref's focus — never click-only reachable.
    expect(component).toMatch(/if \(open\) \{[\s\S]{0,120}closeBtnRef\.current\?\.focus\(\)/);
    expect(component).toMatch(/ref=\{closeBtnRef\}/);
  });

  test('the previously-focused element (the entry point\'s own trigger) is captured on open', () => {
    expect(component).toMatch(/triggerRef\.current = document\.activeElement/);
  });

  test('focus RETURNS to the trigger once the sheet closes — never dropped to <body>', () => {
    expect(component).toMatch(/\} else if \(triggerRef\.current\) \{[\s\S]{0,80}triggerRef\.current\.focus\(\)/);
  });

  test('Tab/Shift+Tab is trapped within the dialog\'s own focusable controls, both directions', () => {
    expect(component).toMatch(/getFocusableElements/);
    // Shift+Tab wrapping from the first control to the last…
    expect(component).toMatch(/e\.shiftKey && document\.activeElement === first/);
    // …and plain Tab wrapping from the last control back to the first.
    expect(component).toMatch(/!e\.shiftKey && document\.activeElement === last/);
    // Both branches actually intercept the native tab order.
    expect(component.match(/e\.preventDefault\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('the Tab-trap re-queries focusable elements from the dialog panel ref (adapts across phases: loading/held/ready/awaitingConfirm/confirmed/declined all render different controls)', () => {
    expect(component).toMatch(/ref=\{dialogRef\}/);
    expect(component).toMatch(/const container = dialogRef\.current/);
  });
});

describe('RE-GATE-A BLOCKER — fail-closed content logic is UNCHANGED (a11y-only fix)', () => {
  const component = src('app', 'community', 'components', 'ComposerHandoffSheet.tsx');

  test('the ready-only-yields-text gate is still intact: `cleared` is still only read inside the ready/awaitingConfirm phase branch', () => {
    expect(component).toMatch(/state\.phase === 'ready' \|\| state\.phase === 'awaitingConfirm'\) && state\.cleared/);
  });

  test('the fail-closed clearance fetch + viewFromHandoffResponse mapping is untouched', () => {
    expect(component).toMatch(/viewFromHandoffResponse\(res\.status, body\)/);
    expect(component).toMatch(/CLEARANCE_UNAVAILABLE/);
  });
});

describe('RE-GATE-A follow-up — GroveThreeLawsSheet.tsx focus trap/return completed', () => {
  const component = src('app', 'today', 'components', 'GroveThreeLawsSheet.tsx');

  test('Escape-to-close and focus-on-open are STILL present (regression)', () => {
    expect(component).toMatch(/e\.key === 'Escape'/);
    expect(component).toMatch(/closeButtonRef\.current\?\.focus\(\)/);
  });

  test('Tab/Shift+Tab is now trapped within the sheet panel, both directions', () => {
    expect(component).toMatch(/getFocusableElements/);
    expect(component).toMatch(/ref=\{panelRef\}/);
    expect(component).toMatch(/e\.shiftKey && document\.activeElement === first/);
    expect(component).toMatch(/!e\.shiftKey && document\.activeElement === last/);
    expect(component.match(/e\.preventDefault\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test('the triggering element (the Grove tap-target) is captured on open and refocused on close', () => {
    expect(component).toMatch(/triggerRef\.current = document\.activeElement/);
    expect(component).toMatch(/\} else if \(triggerRef\.current\) \{[\s\S]{0,80}triggerRef\.current\.focus\(\)/);
  });
});

describe('RE-GATE-A follow-up — me/security/page.tsx MFA-error is now an aria-live region', () => {
  const component = src('app', 'me', 'security', 'page.tsx');

  test('both MFA-error render sites (initial-enroll-failed, verify-failed) carry role="alert"', () => {
    const mfaErrorBlocks = component.match(/\{mfaError && \([\s\S]{0,160}?\)\}/g) ?? [];
    expect(mfaErrorBlocks.length).toBe(2);
    for (const block of mfaErrorBlocks) {
      expect(block).toMatch(/role="alert"/);
    }
  });

  test('the sign-out-everywhere error region (already role="status" pre-fix) is untouched by this fix', () => {
    expect(component).toMatch(/\{revokeError && <p className=\{`\$\{styles\.notice\} \$\{styles\.noticeFailed\}`\} role="status">/);
  });
});
