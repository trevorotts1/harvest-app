/**
 * Inline, pre-hydration script (T-05) that applies a saved manual
 * light/dark override to `<html data-theme>` before first paint, so a
 * returning user who overrode the OS default never sees a flash of the
 * wrong theme. Kept as a plain string (rather than JSX) so it can be
 * handed to `next/script` with `strategy="beforeInteractive"` verbatim —
 * see src/app/layout.tsx.
 *
 * Absent a saved override, this script does nothing: the semantic tokens
 * in tokens.css already follow `prefers-color-scheme` with zero JS.
 *
 * Must stay in sync with the storage key and value contract used by
 * ./theme-toggle.tsx (`THEME_STORAGE_KEY`, 'light' | 'dark').
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('harvest-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {
    /* localStorage unavailable (privacy mode, etc.) — fall back to OS default */
  }
})();
`;
