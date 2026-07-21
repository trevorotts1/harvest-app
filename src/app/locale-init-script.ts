/**
 * T-53 — inline, pre-hydration script that applies a saved locale override to `<html lang>` before
 * first paint, exactly the same rationale as `./theme-init-script.ts` (no flash of the wrong
 * language for a returning rep who already chose Español). Absent a saved override, `<html
 * lang="en">` (set in layout.tsx) stands as the sensible default until detection/hydration runs.
 *
 * Must stay in sync with the storage key and value contract used by ./locale-context.tsx
 * (`LOCALE_STORAGE_KEY`, 'en' | 'es').
 */
export const LOCALE_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem('harvest-locale');
    if (stored === 'en' || stored === 'es') {
      document.documentElement.setAttribute('lang', stored);
    }
  } catch (e) {
    /* localStorage unavailable (privacy mode, etc.) — the default 'en' <html lang> stands. */
  }
})();
`;
