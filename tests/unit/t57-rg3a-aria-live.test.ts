// T-57 RE-GATE ROUND-2 (dimension-A [a6bdadd3]) Finding: error/status text renders with NO
// role/aria-live (WCAG SC 4.1.3 Status Messages). This test asserts the fixes:
// 1. src/app/content/page.tsx error banner (line 252) → role="alert"
// 2. src/app/content/page.tsx LaunchKitTrigger result (line 422) → role="status"
// 3. src/app/team/calendar/page.tsx coachingMessage (line 224) → role="status" + aria-live="polite"
// 4. src/app/team/calendar/page.tsx appointmentMessage (line 235) → role="status" + aria-live="polite"

import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

describe('T-57 RG3a — error/status text carries ARIA live regions (SC 4.1.3)', () => {
  test('src/app/content/page.tsx error banner renders with role="alert"', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'content', 'page.tsx'), 'utf8');
    // Confirm the error state block renders the error text with role="alert"
    expect(src).toContain('<p role="alert">{error}</p>');
  });

  test('src/app/content/page.tsx LaunchKitTrigger result renders with role="status"', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'content', 'page.tsx'), 'utf8');
    // Confirm the LaunchKitTrigger component renders the result with role="status"
    expect(src).toContain('{result && <p role="status">{result}</p>}');
  });

  test('src/app/team/calendar/page.tsx coachingMessage renders with role="status" and aria-live="polite"', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'team', 'calendar', 'page.tsx'), 'utf8');
    // Confirm the coaching message renders with both role and aria-live
    expect(src).toContain('{coachingMessage && <p role="status" aria-live="polite"');
  });

  test('src/app/team/calendar/page.tsx appointmentMessage renders with role="status" and aria-live="polite"', () => {
    const src = readFileSync(path.join(SRC_DIR, 'app', 'team', 'calendar', 'page.tsx'), 'utf8');
    // Confirm the appointment message renders with both role and aria-live
    expect(src).toContain('{appointmentMessage && <p role="status" aria-live="polite"');
  });
});
