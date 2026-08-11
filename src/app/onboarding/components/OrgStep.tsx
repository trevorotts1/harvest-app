// uiux §5.1 O-3 — Organization & role context (the org gate: "the single gate that shapes
// everything").
//
// R-02 (refinements catalog 2026-08-10): the org type is captured EXACTLY ONCE, at registration
// (`src/app/api/auth/register/route.ts` — resolvedOrgType, fail-closed to EXTERNAL) and persisted
// as `User.org_type`. This step NO LONGER asks the redundant "Where do you build?" Primerica-vs-
// other question — the flow is driven entirely from the single persisted registration-time org
// determination, read from the SERVER session (via `getCurrentSession()`, exactly like R-01's role
// wiring) and handed down as the `orgType` prop. The Primerica-vs-other framing is NEVER surfaced
// again in onboarding; a non-Primerica (universal) user sees a clean, generic experience with zero
// Primerica strings (the org-gate at `src/services/onboarding/wp01/org-gate.ts` enforces this at
// the data layer — kept fully intact).
//
// THE ORG-GATE LAW (§17.1, uiux AC-5.1-2): a non-Primerica (universal) user must see NO Primerica
// string or surface. This component enforces that structurally by rendering the branch panel purely
// from `buildOrgContext(orgType)` (org-gate.ts), whose universal-branch return is Primerica-free BY
// CONSTRUCTION (no solution-number field, no Primerica surfaces) — so the universal panel cannot
// contain a Primerica term to leak. The solution-number field (Primerica only) shows the authoritative
// "not verified" caption and, once entered, only ever the mask — the raw digits are never re-displayed
// (§6.10-4).
//
// NOTE (R-02): this file keeps its historical name (`OrgStep.tsx`) so existing tests/importers of
// the `OrgBranchPanel` rendering contract keep compiling unchanged — the removed artifact is the
// redundant org SELECTOR (`OrgStep`'s choice-card grid), not the org-context surface.

import { OrgType } from '@prisma/client';

import {
  buildOrgContext,
  type OrgContext,
} from '@/services/onboarding/wp01/org-gate';
import {
  SOLUTION_NUMBER_FORMAT,
  SOLUTION_NUMBER_MASK,
  maskSolutionNumber,
} from '@/services/onboarding/wp01/solution-number';

import styles from '../onboarding.module.css';
import { useT, useLocale } from '@/app/locale-context';

export interface OrgBranchPanelProps {
  orgContext: OrgContext;
  /** The in-progress solution-number entry (Primerica only); undefined for universal. */
  solutionNumber?: string;
  onSolutionNumberChange?: (value: string) => void;
  /** True once the number has been captured — after which only the MASK is shown, never the digits. */
  confirmed?: boolean;
}

/**
 * The branch-specific panel, rendered straight from the `OrgContext`. For a universal user the
 * context carries no Primerica fields, so this renders a Primerica-free panel; for a Primerica user
 * it renders the solution-number field + its "not verified" caption.
 */
export function OrgBranchPanel({
  orgContext,
  solutionNumber = '',
  onSolutionNumberChange,
  confirmed = false,
}: OrgBranchPanelProps) {
  const t = useT();
  const field = orgContext.solutionNumberField;
  if (!field) {
    // Universal branch — nothing Primerica-shaped exists to render.
    return (
      <div className={styles.card}>
        <p className={styles.lede}>
          {t('onboarding.orgContext.universalBody')}
        </p>
      </div>
    );
  }

  const formatOk = SOLUTION_NUMBER_FORMAT.test(solutionNumber);
  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="solution-number">
          {field.label}
        </label>
        {confirmed ? (
          // §6.10-4: after entry the number is NEVER displayed again — only the mask.
          <output className={styles.input} aria-label={t('onboarding.orgContext.solutionNumberSavedAria')}>
            {maskSolutionNumber(solutionNumber) /* always the mask, never the digits */}
          </output>
        ) : (
          <input
            id="solution-number"
            className={styles.input}
            inputMode="text"
            maxLength={64}
            value={solutionNumber}
            // T-R57 (operator directive 2026-07-28): this used to strip every non-digit character
            // as the user typed (`.replace(/\D/g, '')`), which made it IMPOSSIBLE to enter a letter
            // or hyphen at all — a client-side enforcement of the same fabricated fixed-7-digit rule
            // that dead-ended real registrants during a live demo. Now strips only characters
            // outside the real alphanumeric+hyphen format (`SOLUTION_NUMBER_FORMAT`'s charset).
            onChange={(e) => onSolutionNumberChange?.(e.target.value.replace(/[^A-Za-z0-9-]/g, ''))}
            aria-describedby="solution-number-caption"
            placeholder={field.formatHint}
          />
        )}
        {/* The "not verified" honesty caption, rendered as a designed element (never a footnote). */}
        <p id="solution-number-caption" className={styles.notVerified}>
          {field.caption}
        </p>
        {!confirmed && solutionNumber && !formatOk ? (
          <p className={styles.caption}>{t('onboarding.orgContext.enterAllDigits')}</p>
        ) : null}
      </div>
    </div>
  );
}

export const MASK = SOLUTION_NUMBER_MASK;

/**
 * R-02 — the O-3 org-context screen, driven ENTIRELY from the persisted registration-time org
 * determination (the `orgType` prop, resolved server-side from the session — see the module header
 * note). There is NO org selector here and never will be: a user who declared Primerica at
 * registration sees the Primerica branch panel (solution-number capture, still gated); every other
 * user sees the generic, Primerica-free branch panel. This is the ONE place any org-specific
 * onboarding capture lives — never duplicated with the business-name/level capture at registration.
 */
export interface OrgStepProps {
  /** The persisted registration-time org type (server session), never client input. */
  orgType: OrgType;
  solutionNumber?: string;
  onSolutionNumberChange?: (value: string) => void;
  confirmed?: boolean;
}

export default function OrgStep({
  orgType,
  solutionNumber,
  onSolutionNumberChange,
  confirmed,
}: OrgStepProps) {
  const { locale } = useLocale();
  return (
    <div className={styles.stepInner}>
      {/* No org question is ever asked again — the branch panel renders the org-shaped context
          for the branch the user already declared at registration (Primerica: solution-number
          capture; universal: the generic build context). */}
      <OrgBranchPanel
        orgContext={buildOrgContext(orgType, locale)}
        solutionNumber={solutionNumber}
        onSolutionNumberChange={onSolutionNumberChange}
        confirmed={confirmed}
      />
    </div>
  );
}
