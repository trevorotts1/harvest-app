/**
 * T-57 R2 (A1 — WCAG 2.2 AA §6.1; tokens.css `--text-scale`) — inline, pre-hydration script that
 * applies a saved "Big Text" preference to `<html style="--text-scale">` before first paint, the
 * SAME rationale/pattern as `./theme-init-script.ts` and `./locale-init-script.ts` (no flash of the
 * wrong text size for a returning rep who turned Big Text on in Me → Accessibility). Absent a saved
 * override, tokens.css's own `--text-scale: 1` stands and this script does nothing.
 *
 * Must stay in sync with the storage key + value contract used by
 * src/app/me/accessibility/page.tsx (`BIG_TEXT_STORAGE_KEY`, 'on' | 'off'). `--text-scale: 1.25`
 * is the exact value tokens.css:173 documents ("Big Text mode (Me → Accessibility) sets this to
 * 1.25"); every `--type-*-size` token is `calc(<px> * var(--text-scale))`, so setting it once here
 * scales the whole type ramp app-wide.
 */
export const BIG_TEXT_STORAGE_KEY = 'harvest-big-text';
export const BIG_TEXT_SCALE = '1.25';

export const TEXT_SCALE_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('harvest-big-text');
    if (stored === 'on') {
      document.documentElement.style.setProperty('--text-scale', '1.25');
    }
  } catch (e) {
    /* localStorage unavailable (privacy mode, etc.) — the default --text-scale:1 in tokens.css stands. */
  }
})();
`;
