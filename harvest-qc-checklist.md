# Harvest QC Checklist

## 1. Task-Level QC Criteria (Work Packages)

Each Work Package (WP) must satisfy the following specific criteria to pass QC.

- **WP01 (Onboarding & Profile):** Verification of org-gate logic (Primerica vs. Non-Primerica); Seven Whys progression gate enforcement; role-architecture verification.
- **WP02 (Warm Market):** Verification of deduplication logic; schema compliance; safe-harbor language injection for Hidden Earnings.
- **WP03 (Harvest Method):** Verification of relational matching; community introduction behavior; Primerica-branch coherence.
- **WP04 (AI Agent Layer):** Verification of agent inventory; role execution; mission control interaction.
- **WP05 (Messaging):** Verification of CFE filter interception; outcome-first positioning; non-spam framework.
- **WP06 (Social/Content):** Verification of movement-led tone; scheduling; platform-gated rendering.
- **WP07 (Motivation):** Verification of collective uplift framing; celebration/retention logic.
- **WP08 (Taprooting):** Verification of multiplication/team-building visibility; timeline coherence.
- **WP09 (Calendar/Dashboard):** Verification of upline-visibility rules; role-gated schedule access.
- **WP10 (Payment/Subscription):** Verification of tier-gating logic; checkout state machine; stripe entitlement sync.
- **WP11 (Compliance):** Verification of CFE filter interception; audit trail immutability; data-rights workflows; RBAC policy enforcement.

## 2. Final System-Level QC Criteria (Pressure Test)

All criteria must be satisfied during integrated system testing:
1. Integrated user stories (Section 1) satisfied without workaround.
2. Compliance hard rules from `compliance-extraction-v4.md` enforced in code.
3. Critical path (WP11 → WP01 → WP02 → WP04 → WP05) functional and coherent.
4. Universal vs. Primerica gating implemented as hard architecture.
5. All 11 work packages covered with no orphaned functionality.
6. Compliance filter intercepts 100% of outbound content.
7. Payment/subscription logic matches the 3-tier model (Free/Org/Paid).
8. System maintains coherence through session/checkpoint restart.
9. System performance metrics (latency/throughput) remain within defined thresholds.
10. System documentation aligns perfectly with implemented codebase truth.

## 3. QC Scoring Rubric

Max Score: 10. Pass Threshold: 8.

| Category | Weight | Points | Focus |
| --- | --- | --- | --- |
| Functionality / Requirements | 40% | 4 | All requirements met; no workarounds. |
| Security & Compliance | 30% | 3 | Zero violations; auth enforced; no leakage. |
| Code Quality / Documentation | 20% | 2 | Maintainable; self-documenting; docs accurate. |
| Performance / Edge Cases | 10% | 1 | Graceful error handling; boundary tested. |

## 4. Critical Failure Taxonomy

Any occurrence of the following results in an automatic QC failure (Fatal Fail):
1. **Hard-rule violation:** Prohibited regulatory/benefit language detected.
2. **Security vulnerability:** SQL injection, XSS, API key leakage, insecure endpoints.
3. **Breaking public API contract:** Non-versioned breaking API changes.
4. **Data loss/migration risk:** Non-reversible schema modifications.
5. **Permission violation:** Sub-agent/process modifying repository or core PRD `.md` files.
6. **Circular dependency:** Self-referencing PRD sections.

## 5. QC Loop Rules

1. **Failure Notification:** Fail score (<8) or Critical Failure logged; PRD returned for revision.
2. **Revision:** Model tasked with fix + feedback.
3. **Re-evaluation Scope:**
   - **Critical Failures:** Full re-evaluation.
   - **Non-Critical Failures:** DELTA/Partial re-evaluation.
4. **Max Loops:** Maximum 3 revision cycles per work package.
5. **Escalation:** Failure after 3rd loop triggers human escalation.
