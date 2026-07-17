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
  const field = orgContext.solutionNumberField;
  if (!field) {
    // Universal branch — nothing Primerica-shaped exists to render.
    return (
      <div className={styles.card}>
        <p className={styles.lede}>
          You&rsquo;re building independently. The Harvest tailors your whole field to how you build.
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
          <output className={styles.input} aria-label="Solution number (saved, masked)">
            {maskSolutionNumber(solutionNumber) /* always the mask, never the digits */}
          </output>
        ) : (
          <input
            id="solution-number"
            className={styles.input}
            inputMode="numeric"
            maxLength={7}
            value={solutionNumber}
            onChange={(e) => onSolutionNumberChange?.(e.target.value.replace(/\D/g, ''))}
            aria-describedby="solution-number-caption"
            placeholder={field.formatHint}
          />
        )}
        {/* The "not verified" honesty caption, rendered as a designed element (never a footnote). */}
        <p id="solution-number-caption" className={styles.notVerified}>
          {field.caption}
        </p>
        {!confirmed && solutionNumber && !formatOk ? (
          <p className={styles.caption}>Enter all 7 digits.</p>
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

const ORG_CHOICES: { orgType: OrgType; label: string; blurb: string }[] = [
  { orgType: OrgType.PRIMERICA, label: 'Primerica', blurb: 'I build with Primerica.' },
  { orgType: OrgType.EXTERNAL, label: 'Independent / other', blurb: 'I build on my own or with another team.' },
];

export default function OrgStep({
  selectedOrgType,
  onSelectOrgType,
  solutionNumber,
  onSolutionNumberChange,
  confirmed,
}: OrgStepProps) {
  return (
    <div className={styles.stepInner}>
      <h1 className={styles.headline}>Where do you build?</h1>
      <p className={styles.lede}>This shapes your whole field — pick where you build.</p>

      <div className={styles.orgGrid} role="radiogroup" aria-label="Organization">
        {ORG_CHOICES.map((choice) => {
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
          orgContext={buildOrgContext(selectedOrgType)}
          solutionNumber={solutionNumber}
          onSolutionNumberChange={onSolutionNumberChange}
          confirmed={confirmed}
        />
      ) : null}
    </div>
  );
}
