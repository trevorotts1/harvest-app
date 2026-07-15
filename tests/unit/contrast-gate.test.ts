import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Gates `npm test` on the two static checks that back the WCAG AA
 * guarantee for the Living Field Design System token layer (T-05, spec
 * §1.2.4 / §6.1) — in addition to `postbuild` running them after
 * `npm run build`. Two independent hooks so this class of failure can't
 * silently stop running if either lifecycle script is ever skipped
 * (QC defect 3: the gate must not be able to go quiet).
 *
 * Both scripts are self-contained Node processes (same pattern as
 * verify-middleware.mjs / verify-api-auth.mjs) that print a report and
 * exit non-zero on failure — spawning them and asserting a clean exit is
 * more honest than re-implementing their logic here, since it exercises
 * the exact command CI runs.
 */
describe('WCAG AA contrast gate (T-05)', () => {
  const repoRoot = path.join(__dirname, '..', '..');

  it('verify:contrast — every semantic token pairing meets its AA target', () => {
    const scriptPath = path.join(repoRoot, 'scripts', 'verify-contrast.mjs');
    expect(() => execFileSync('node', [scriptPath], { stdio: 'pipe' })).not.toThrow();
  });

  it('guard:no-opacity-on-text — no CSS Module dims text with `opacity` (the T-05 QC defect class)', () => {
    const scriptPath = path.join(repoRoot, 'scripts', 'guard-no-opacity-on-text.mjs');
    expect(() => execFileSync('node', [scriptPath], { stdio: 'pipe' })).not.toThrow();
  });
});
