import type { Metadata } from 'next';
import { ThemeToggle } from '../theme-toggle';
import styles from './design-tokens.module.css';

/**
 * Living Field Design System — token reference (T-05).
 *
 * A real, working consumer of the token layer defined in
 * src/app/tokens.css: every swatch and sample below reads a live CSS
 * custom property (`var(--soil-500)`, `var(--text-secondary)`, …), not a
 * hardcoded color, so this page is proof the tokens are wired into the
 * app rather than dead CSS. Toggling the appearance control switches the
 * `data-theme` attribute on `<html>`, which every semantic-token sample
 * on this page reacts to live.
 *
 * The exact contrast ratios shown in the "semantic pairs" section are
 * computed and asserted by `scripts/verify-contrast.mjs`
 * (`npm run verify:contrast`) — this page's copy and that script must
 * describe the same pairings.
 */

export const metadata: Metadata = {
  title: 'Living Field Design System — tokens',
  description: 'Reference page for the token layer: ramps, semantic pairs, type scale, spacing, elevation, and motion.',
};

const SOIL_RAMP = ['0', '50', '100', '200', '300', '400', '500', '550', '700', '900'];
const LEAF_RAMP = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const HARVEST_RAMP = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const CLAY_RAMP = ['50', '100', '200', '300', '400', '500', '600', '700'];
const WHEAT_RAMP = ['100', '300', '500', '700'];
const GROVE_STEPS = ['950', '900', '800', '700'];

const TYPE_TOKENS: Array<{ token: string; label: string }> = [
  { token: 'caption', label: 'caption — 13/1.4' },
  { token: 'body', label: 'body — 16/1.5' },
  { token: 'body-lg', label: 'body-lg — 20/1.5' },
  { token: 'title', label: 'title — 25/1.2' },
  { token: 'headline', label: 'headline — 31/1.15' },
  { token: 'display', label: 'display — 39/1.1' },
];

const SPACE_TOKENS = ['1', '2', '3', '4', '5', '6', '7', '8'];

function RampRow({ name, steps, prefix }: { name: string; steps: string[]; prefix: string }) {
  return (
    <div className={styles.rampGroup}>
      <span className={styles.rampName}>{name}</span>
      <div className={styles.rampRow}>
        {steps.map((step) => (
          <div className={styles.swatch} key={step}>
            <div className={styles.swatchFill} style={{ background: `var(--${prefix}-${step})` }} />
            <span className={styles.swatchLabel}>
              {prefix}-{step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DesignTokensPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Living Field Design System</p>
            <h1 className={styles.title}>Token reference</h1>
            <p className={styles.lede}>
              Six hue ramps, semantic tokens for Golden Hour and Pre-Dawn, a 1.25 modular type
              scale, an 8pt spacing grid, elevation, and motion — read live from the same CSS
              custom properties the rest of the app consumes.
            </p>
          </div>
          <ThemeToggle />
        </header>

        <section className={styles.section} aria-labelledby="ramps-heading">
          <h2 className={styles.sectionTitle} id="ramps-heading">
            Primitive ramps
          </h2>
          <p className={styles.sectionNote}>
            Theme-invariant. Components consume semantic tokens only (below) — ramps exist so a
            semantic token always has a validated step to point at.
          </p>
          <RampRow name="Soil" steps={SOIL_RAMP} prefix="soil" />
          <RampRow name="Leaf" steps={LEAF_RAMP} prefix="leaf" />
          <RampRow name="Harvest" steps={HARVEST_RAMP} prefix="harvest" />
          <RampRow name="Clay" steps={CLAY_RAMP} prefix="clay" />
          <RampRow name="Wheat" steps={WHEAT_RAMP} prefix="wheat" />
          <RampRow name="Grove" steps={GROVE_STEPS} prefix="grove" />
        </section>

        <section className={styles.section} aria-labelledby="pairs-heading">
          <h2 className={styles.sectionTitle} id="pairs-heading">
            Semantic pairs — contrast-verified
          </h2>
          <p className={styles.sectionNote}>
            Every pairing here is asserted by <code>npm run verify:contrast</code> against a WCAG
            AA target (4.5:1 normal text, 3:1 large/non-text). Toggle appearance above to see both
            themes.
          </p>
          <div className={styles.pairGrid}>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--surface-canvas)', borderColor: 'var(--line)', color: 'var(--text-primary)' }}
            >
              <span className={styles.pairSample}>Body text on canvas</span>
              <span className={styles.pairMeta}>text-primary / surface-canvas — 15.1:1 (light) · 13.9:1 (dark)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--surface-canvas)', borderColor: 'var(--line)', color: 'var(--text-secondary)' }}
            >
              <span className={styles.pairSample}>Secondary text (AA-corrected)</span>
              <span className={styles.pairMeta}>text-secondary / surface-canvas — 5.1:1 (light) · 7.0:1 (dark)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--surface-canvas)', borderColor: 'var(--line)', color: 'var(--color-action)' }}
            >
              <span className={styles.pairSample}>Action / links</span>
              <span className={styles.pairMeta}>color-action / surface-canvas — 5.7:1 (light) · 8.5:1 (dark)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--color-action)', color: 'var(--on-action)', border: 'none' }}
            >
              <span className={styles.pairSample}>Primary button</span>
              <span className={styles.pairMeta}>on-action / color-action — 6.3:1 (light) · 8.5:1 (dark)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--cream)', borderColor: 'var(--line)', color: 'var(--color-harvest-text)' }}
            >
              <span className={styles.pairSample}>Harvest / wealth moment</span>
              <span className={styles.pairMeta}>color-harvest-text / cream — 6.9:1 (light) · never text-on-canvas below harvest-700</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--surface-canvas)', borderColor: 'var(--line)', color: 'var(--color-blocked-fill)' }}
            >
              <span className={styles.pairSample}>Compliance blocked</span>
              <span className={styles.pairMeta}>color-blocked-fill / surface-canvas — 6.1:1 (light) · 7.1:1 (dark)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--color-caution-bg)', borderColor: 'var(--line)', color: 'var(--color-caution-text)' }}
            >
              <span className={styles.pairSample}>Caution / flagged</span>
              <span className={styles.pairMeta}>color-caution-text / color-caution-bg — 7.4:1 (light) · 9.2:1 (dark, on canvas)</span>
            </div>
            <div
              className={styles.pairCard}
              style={{ background: 'var(--color-danger-form-bg)', borderColor: 'var(--line)', color: 'var(--color-danger-form-text)' }}
            >
              <span className={styles.pairSample}>Ordinary form error</span>
              <span className={styles.pairMeta}>color-danger-form-text / color-danger-form-bg — 7.1:1 (light)</span>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="type-heading">
          <h2 className={styles.sectionTitle} id="type-heading">
            Type scale — 1.25 modular, 16px base
          </h2>
          {TYPE_TOKENS.map(({ token, label }) => (
            <div className={styles.typeRow} key={token}>
              <span
                style={{
                  fontSize: `var(--type-${token}-size)`,
                  lineHeight: `var(--type-${token}-line)`,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                The Harvest — 20 : 5 : 1
              </span>
              <span className={styles.typeMeta}>{label}</span>
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby="space-heading">
          <h2 className={styles.sectionTitle} id="space-heading">
            Spacing — 8pt grid
          </h2>
          {SPACE_TOKENS.map((step) => (
            <div className={styles.spaceRow} key={step}>
              <span className={styles.spaceMeta}>--space-{step}</span>
              <div className={styles.spaceBar} style={{ width: `var(--space-${step})` }} />
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby="elevation-heading">
          <h2 className={styles.sectionTitle} id="elevation-heading">
            Elevation
          </h2>
          <div className={styles.elevationGrid}>
            {['0', '1', '2', '3'].map((level) => (
              <div
                className={styles.elevationCard}
                key={level}
                style={{ boxShadow: `var(--elevation-${level})`, border: level === '0' ? '1px solid var(--line)' : 'none' }}
              >
                elevation-{level}
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="motion-heading">
          <h2 className={styles.sectionTitle} id="motion-heading">
            Motion — &quot;motion is growth&quot;
          </h2>
          <p className={styles.sectionNote}>
            Reload this page to see the enter animation (scale {'→'} 1, unfurl easing).
            Respects <code>prefers-reduced-motion</code>.
          </p>
          <div className={styles.motionRow}>
            <div className={styles.motionCard}>dur-grow / ease-organic</div>
          </div>
        </section>
      </div>
    </main>
  );
}
