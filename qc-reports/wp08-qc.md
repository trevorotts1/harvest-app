# WP08 QC Report — Taprooting, Timeline & Primerica-Specific Features

**Spec File:** `prd-packages/harvest-app/wp-specs/wp08-taprooting.md`
**QC Performed:** 2026-04-27
**QC Model:** ollama/deepseek-v4-flash:cloud

---

## Score Summary

| Category | Weight | Points Awarded | Max Points |
|----------|--------|----------------|------------|
| Functionality / Requirements | 40% | 3.5 | 4.0 |
| Security & Compliance | 30% | 2.5 | 3.0 |
| Code Quality / Documentation | 20% | 1.5 | 2.0 |
| Performance / Edge Cases | 10% | 0.7 | 1.0 |
| **Total** | **100%** | **8.2** | **10.0** |

**Pass Threshold:** 8.0
**Score:** 8.2 / 10.0
**Result:** ✅ **PASS** (Attempt 1 of 3)

---

## Critical Failures

| # | Condition | Status |
|---|-----------|--------|
| CF1 | Primerica-specific feature leakage to non-Primerica users | ✅ **Not Present** — Section 7 defines hard-gating with `Violation Protocol`; AC5 requires full invisibility; Section 11 covers Org-Type Switch to wipe state on org change |
| CF2 | Failure of hard organizational boundary control | ✅ **Not Present** — Gating governed by Organization Engine (WP03); edge case for org-type change defined; all Primerica features explicitly scoped behind org gate |

**Conclusion:** Zero critical failures detected.

---

## WP08-Specific Checkpoints

| # | Checkpoint | Status | Notes |
|---|------------|--------|-------|
| 1 | Org = Primerica hard gate verified for all features | ✅ PASS | Section 7 enforces strict conditional gating. Non-Primerica workspaces get zero Primerica UI/logic. Violation Protocol guards against leaks. |
| 2 | Taprooting visualization renders organizational tree correctly | ✅ PASS | Section 2 defines tree construction from WP01 hierarchy data. Section 6 specs 3 depth tiers (Personal/Team/Collective), 10+ level visibility, color-coded node health (Green/Yellow/Red). Data model defined in Section 8 (RepNode, RelationshipLink, HealthScore). |
| 3 | Milestone timeline logic unlocks based on activity metrics | ✅ PASS | Section 3 defines three core activities (Recruit, Promote, Train). Section 4 gives 90-day phase-lock with three 30-day stages (Foundation/Launch/Habit). Integration with WP04 agents for real-time milestone detection (Section 9). |
| 4 | Objection-handling structures functional | ⚠️ MINOR ISSUE | The QC checklist lists this as a checkpoint, but the spec does not explicitly address objection-handling. Objection handling may logically live in WP03 (Harvest Warm Market Method), but WP08 does not reference it or define its integration with taprooting/timeline features. **Recommendation:** Add a subsection or cross-reference to objection-handling in the taprooting/timeline context. |
| 5 | Integration with daily briefing functional | ✅ PASS | Section 5 provides explicit Mission Control integration with example nudges ("3 reps at day 75 of phase-lock," "2 reps stagnating at milestone 2," "new multiplication at Lvl 4"). Section 9 confirms WP04 agent feeds data to Mission Control briefing engine. |

---

## Detailed Scoring Breakdown

### Functionality / Requirements (3.5 / 4.0)

**Strengths:**
- All 7 acceptance criteria (AC1-AC7) are explicitly defined and testable.
- Org tree visualization targets Lvl 5 minimum (AC1), with spec going further (10+ levels, Section 2).
- Phase-lock sequence (AC2) is well-structured with clear 30-day stages.
- Mission Control integration (AC3) has concrete example nudges.
- Node health based on Three Laws (AC4) defined with Grow/Engage/Wealth indices.
- Primerica-UI invisibility (AC5) enforced with hard gating protocol.
- WP04 agent milestone detection (AC6) documented in Section 9.
- Data privacy (AC7) referenced to WP11 CFE standards.
- Edge cases covered: Stagnation, Broken Taproot, Org-Type Switch (Section 11).
- Dependencies table (Section 13) lists all hard blocks with clear WP references.

**Issues:**
- **Docked -0.5:** Objection-handling structures (QC checkpoint #4) are absent from the spec. The spec does not address how objection-handling connects to the taprooting timeline or org visualization. This is a gap between the QC checklist and the spec content.

### Security & Compliance (2.5 / 3.0)

**Strengths:**
- Strong organizational gating language throughout (Section 7, AC5).
- Org-Type Switch edge case explicitly wipes Primerica state on org change (Section 11).
- Data privacy compliance referenced to WP11 CFE standards (Section 10).
- Real-time health score tracking enables compliance awareness.

**Issues:**
- **Docked -0.3:** No explicit RBAC or permission model for org tree visibility beyond "upline sees what permitted under org rules" (AC7). The precise authorization boundaries for "deep-org visibility to 10+ levels" are not defined — e.g., at what level does crossline visibility stop?
- **Docked -0.2:** The Violation Protocol (Section 7) states no Primerica-logic is accessible without gating, but doesn't define the enforcement mechanism (is it database-level, API-middleware, or UI-only hiding?). This is acceptable for a spec, but borderline thin.

### Code Quality / Documentation (1.5 / 2.0)

**Strengths:**
- Well-structured spec with clear numbered sections.
- Acceptance criteria are testable and specific.
- Data model defined with typed properties (Section 8).
- Clear dependency mapping to other WPs (Section 13).
- Edge cases and failure modes documented (Section 11).

**Issues:**
- **Docked -0.3:** No sequence or flow diagrams for the milestone unlocking or phase-lock progression logic. The 90-day state machine is described in prose but has no explicit state transition diagram.
- **Docked -0.2:** No API contract or component interface specification for how WP04 agents query milestone data or feed into Mission Control.

### Performance / Edge Cases (0.7 / 1.0)

**Strengths:**
- Three edge cases explicitly documented (Stagnation, Broken Taproot, Org-Type Switch).
- Each edge case has a defined response flow.

**Issues:**
- **Docked -0.3:** No performance considerations for deep-org tree rendering (10+ levels). Canvas-based rendering is mentioned but no spec for virtual scrolling, lazy loading, or sub-tree pagination. With a large org of 50+ nodes across 10 levels, rendering performance could degrade without architectural guidance.

---

## PRD Pressure Test (8 Questions) — WP08 Relevance

| # | Question | Result | Notes |
|---|----------|--------|-------|
| 1 | All 11 WPs scoped? | ✅ | WP08 clearly scoped with dependencies on WP01, WP03, WP04, WP11 |
| 2 | Compliance a hard gate? | ✅ | Organizational gating is enforced as hard architecture |
| 3 | Critical spine makes sense? | ✅ | WP01 → WP03/WP08 → WP04 integration is coherent |
| 4 | Universal vs. Primerica gates hard? | ✅ | Hard-gating with Violation Protocol and state-wipe edge case |
| 7 | Brand doctrine embedded? | ✅ | Three Laws, Harvest Warm Market Method referenced throughout |
| 8 | Phase C can begin? | ✅ | Dependencies documented; no unresolved TODOs |

Questions 5 (outbound CFE), 6 (payment model) are N/A to WP08's scope.

---

## Issues Summary

| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|
| ISS-01 | Minor | Objection-handling structures (QC checkpoint #4) not addressed in spec | Add section or cross-reference documenting how objection-handling integrates with taprooting timeline / org visualization |
| ISS-02 | Minor | RBAC visibility boundaries for deep-org tree (10+ levels) not defined | Document which roles see what depth; specify crossline visibility limits |
| ISS-03 | Minor | No enforcement mechanism detail for Violation Protocol | Clarify whether gating is DB-layer, API-middleware, or UI-only |
| ISS-04 | Minor | No state machine/flow diagram for 90-day phase-lock | Add state transition diagram for Foundation → Launch → Habit |
| ISS-05 | Minor | No performance considerations for 10+ level org tree rendering | Add spec for lazy loading, virtual scrolling, or pagination of deep org nodes |

---

## Final Verdict

**Score: 8.2 / 10**
**Result: ✅ PASS**

No critical failures detected. The spec is well-structured, covers all core requirements, enforces strong Primerica gating, and documents integration points with dependent WPs. Five minor issues (listed above) should be addressed before production implementation but do not block progression.

**Recommendations before Phase C:**
1. Add objection-handling integration to fill the QC checklist gap
2. Add a state transition diagram for the 90-day phase-lock
3. Define RBAC visibility boundaries for deep-org tree access
