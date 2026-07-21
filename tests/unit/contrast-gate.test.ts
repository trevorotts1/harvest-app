import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  // T-52 (WCAG 2.2 AA §17.4) — the 4 legacy [WARN-EXEMPT] pairs carried from T-05 (auth/page.tsx,
  // onboarding/page.tsx, globals.css .side-link, globals.css .visual-root span — rgba white text on
  // the flat `--bg-deep` fill) are now genuinely fixed (real AA-passing opaque token, not a
  // suppressed check) and their exemption removed. This is a REGRESSION LOCK: if a future edit
  // reintroduces a translucent-text violation and someone "fixes" the gate by re-adding it to
  // `KNOWN_PRE_EXISTING_EXEMPTIONS` instead of fixing the color, this test fails loudly.
  it('guard:no-opacity-on-text — runs with ZERO exemptions (T-52: all 4 legacy exemptions resolved, not suppressed)', () => {
    const scriptPath = path.join(repoRoot, 'scripts', 'guard-no-opacity-on-text.mjs');
    const output = execFileSync('node', [scriptPath], { stdio: 'pipe' }).toString();
    expect(output).not.toContain('WARN-EXEMPT');
    expect(output).not.toContain('grandfathered');
    expect(output).toMatch(/no NEW sub-1 opacity \/ translucent text color found\. OK\./);
  });

  // T-52 — proves the fix is a REAL contrast pass, not just "no longer translucent": the three
  // rules that used to be `rgba(255,255,255,.72)` on the flat `--bg-deep` fill (auth/page.tsx,
  // globals.css .side-link, globals.css .visual-root span) now all resolve to `var(--muted-inverse)`
  // — computed here with the same WCAG relative-luminance math verify-contrast.mjs uses, against
  // the real hex values in tokens.css, so this fails if either token's value ever drifts below AA.
  it('the T-52 fix (--muted-inverse on --grove-950) genuinely meets WCAG AA (>=4.5:1), not merely non-translucent', () => {
    const tokensCss = readFileSync(path.join(repoRoot, 'src', 'app', 'tokens.css'), 'utf8');
    const globalsCss = readFileSync(path.join(repoRoot, 'src', 'app', 'globals.css'), 'utf8');
    const authPage = readFileSync(path.join(repoRoot, 'src', 'app', 'auth', 'page.tsx'), 'utf8');

    const hexOf = (name: string): string => {
      const m = tokensCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
      if (!m) throw new Error(`token --${name} not found in tokens.css`);
      return m[1];
    };

    // Source-level proof the three carried exemptions now consume the token, not a literal rgba.
    // Comments are stripped first — this file's own explanatory "T-52 WCAG AA fix: was `color:
    // rgba(...)`" comments deliberately quote the OLD value for context and must not trip a
    // regression check meant for live declarations only.
    const globalsCssNoComments = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const authPageNoComments = authPage.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(globalsCssNoComments).toMatch(/\.side-link\s*\{[^}]*color:\s*var\(--muted-inverse\)/);
    expect(globalsCssNoComments).toMatch(/\.visual-root span\s*\{[^}]*color:\s*var\(--muted-inverse\)/);
    expect(authPageNoComments).toContain("color: 'var(--muted-inverse)'");
    expect(globalsCssNoComments).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0?\.?72\)/);
    expect(authPageNoComments).not.toContain("color: 'rgba(255,255,255,.72)'");

    const channelLuminance = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminanceOf = (hex: string) => {
      const int = parseInt(hex.slice(1), 16);
      const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
      return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
    };
    const fg = luminanceOf(hexOf('muted-inverse'));
    const bg = luminanceOf(hexOf('grove-950'));
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
