// uiux §5.1 O-3 — Organization & role (the org gate: "the single gate that shapes everything").
//
// THE ORG-GATE LAW (§17.1, uiux AC-5.1-2): a non-Primerica (universal) user must see NO Primerica
// string or surface. This component enforces that structurally by rendering the branch panel purely
// from `buildOrgContext(orgType)` (org-gate.ts), whose universal-branch return is Primerica-free BY
// CONSTRUCTION (no solution-number field, no Primerica surfaces) — so the universal panel cannot
// contain a Primerica term to leak. The solution-number field (Primerica only) shows the authoritative
// "not verified" caption and, once entered, only ever the mask — the raw digits are never re-displayed
// (§6.10-4).

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
          {t('onboarding.orgStep.universalBody')}
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
          <output className={styles.input} aria-label={t('onboarding.orgStep.solutionNumberSavedAria')}>
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
          <p className={styles.caption}>{t('onboarding.orgStep.enterAllDigits')}</p>
        ) : null}
      </div>
    </div>
  );
}

export const MASK = SOLUTION_NUMBER_MASK;

export interface OrgStepProps {
  selectedOrgType: OrgType | null;
  onSelectOrgType?: (orgType: OrgType) => void;
  solutionNumber?: string;
  onSolutionNumberChange?: (value: string) => void;
  confirmed?: boolean;
}

export default function OrgStep({
  selectedOrgType,
  onSelectOrgType,
  solutionNumber,
  onSolutionNumberChange,
  confirmed,
}: OrgStepProps) {
  const t = useT();
  const { locale } = useLocale();
  // T-R32b — moved from a module-level constant into the component body: the labels/blurbs now
  // route through the catalog (`t()`, a hook-backed lookup), which can only run inside a component.
  const orgChoices: { orgType: OrgType; label: string; blurb: string }[] = [
    { orgType: OrgType.PRIMERICA, label: t('onboarding.orgStep.choices.primerica.label'), blurb: t('onboarding.orgStep.choices.primerica.blurb') },
    { orgType: OrgType.EXTERNAL, label: t('onboarding.orgStep.choices.external.label'), blurb: t('onboarding.orgStep.choices.external.blurb') },
  ];

  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>{t('onboarding.orgStep.headline')}</h1>
      <p className={styles.lede}>{t('onboarding.orgStep.lede')}</p>

      <div className={styles.orgGrid} role="radiogroup" aria-label={t('onboarding.orgStep.organizationAria')}>
        {orgChoices.map((choice) => {
          const selected = selectedOrgType === choice.orgType;
          return (
            <button
              key={choice.orgType}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${styles.orgCard} ${selected ? styles.orgCardSelected : ''}`}
              onClick={() => onSelectOrgType?.(choice.orgType)}
            >
              <span className={styles.label}>{choice.label}</span>
              <span className={styles.caption}>{choice.blurb}</span>
            </button>
          );
        })}
      </div>

      {selectedOrgType ? (
        <OrgBranchPanel
          orgContext={buildOrgContext(selectedOrgType, locale)}
          solutionNumber={solutionNumber}
          onSolutionNumberChange={onSolutionNumberChange}
          confirmed={confirmed}
        />
      ) : null}
    </div>
  );
}
