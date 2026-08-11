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
// R-05 (refinements catalog 2026-07-28): the SOLUTION NUMBER is likewise captured EXACTLY ONCE —
// at registration (the first Primerica surface, `src/app/auth/page.tsx` → `POST /api/auth/register`,
// which persists it encrypted at rest as `User.solution_number`). This screen NO LONGER re-asks for
// it. A later step that used to show a solution-number entry field now shows the already-persisted
// value's MASKED saved-state + the module's not-verified caption — the mask is the only display
// form the solution-number module permits after entry (§6.10-4 "never displayed after entry",
// `SOLUTION_NUMBER_MASK`), and the saved/unsaved semantics are driven by a server-provided
// PRESENCE signal (`hasSolutionNumber`, `GET /api/onboarding/status`), never by any local
// re-entry. The server `/step` route reuses the same persisted value for `ROLE_ORG_CONTEXT`'s
// format gate (T-R38's `decryptSolutionNumberFromStorage` fallback) — so the value captured at
// registration is used, never re-prompted, and never re-entered.
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
  SOLUTION_NUMBER_MASK,
  maskSolutionNumber,
} from '@/services/onboarding/wp01/solution-number';

import styles from '../onboarding.module.css';
import { useT, useLocale } from '@/app/locale-context';

export interface OrgBranchPanelProps {
  orgContext: OrgContext;
  /**
   * R-05 — whether the solution number has ALREADY been captured at registration (a
   * server-provided PRESENCE signal, read from the persisted encrypted value; see
   * `GET /api/onboarding/status`'s `hasSolutionNumber`). Drives the honest saved/unsaved aria
   * labeling; the MASK renders either way (never displayed after entry, §6.10-4). The value
   * itself is never carried by this prop.
   */
  hasSolutionNumber?: boolean;
}

/**
 * The branch-specific panel, rendered straight from the `OrgContext`. For a universal user the
 * context carries no Primerica fields, so this renders a Primerica-free panel; for a Primerica user
 * it renders the solution-number saved-state (mask + "not verified" caption) — the number is never
 * re-asked here (R-05: captured once at registration, reused on every later step).
 */
export function OrgBranchPanel({
  orgContext,
  hasSolutionNumber = false,
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

  return (
    <div className={styles.card}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="solution-number">
          {field.label}
        </label>
        {/* R-05 — the number is NEVER re-asked: after its one capture at registration, every later
            step shows only the mask + the not-verified caption (the module's only permitted
            display form after entry, §6.10-4). `maskSolutionNumber` is called unconditionally so
            this display path can never accidentally render digits — it always returns the mask;
            the aria names the honest saved/unsaved state per the server presence probe. */}
        <output
          id="solution-number"
          className={styles.input}
          aria-label={
            hasSolutionNumber
              ? t('onboarding.orgContext.solutionNumberSavedAria')
              : t('onboarding.orgContext.solutionNumberMaskedAria')
          }
        >
          {maskSolutionNumber(SOLUTION_NUMBER_MASK)}
        </output>
        {/* The "not verified" honesty caption, rendered as a designed element (never a footnote). */}
        <p id="solution-number-caption" className={styles.notVerified}>
          {field.caption}
        </p>
      </div>
    </div>
  );
}

export const MASK = SOLUTION_NUMBER_MASK;

/**
 * R-02 — the O-3 org-context screen, driven ENTIRELY from the persisted registration-time org
 * determination (the `orgType` prop, resolved server-side from the session — see the module header
 * note). There is NO org selector here and never will be: a user who declared Primerica at
 * registration sees the Primerica branch panel (solution-number saved-state — R-05: captured once,
 * never re-asked); every other user sees the generic, Primerica-free branch panel. This is the ONE
 * place any org-specific onboarding capture lives — never duplicated with the business-name/level
 * capture at registration.
 */
export interface OrgStepProps {
  /** The persisted registration-time org type (server session), never client input. */
  orgType: OrgType;
  /**
   * R-05 — server-provided presence signal for the already-captured (registration-time) solution
   * number; drives the Primerica panel's honest saved/unsaved aria. A universal user's panel
   * ignores it (no Primerica surface exists for them).
   */
  hasSolutionNumber?: boolean;
}

export default function OrgStep({ orgType, hasSolutionNumber }: OrgStepProps) {
  const { locale } = useLocale();
  return (
    <div className={styles.stepInner}>
      {/* No org question is ever asked again — the branch panel renders the org-shaped context
          for the branch the user already declared at registration (Primerica: the saved-state
          mask for the already-captured solution number; universal: the generic build context). */}
      <OrgBranchPanel
        orgContext={buildOrgContext(orgType, locale)}
        hasSolutionNumber={hasSolutionNumber}
      />
    </div>
  );
}
