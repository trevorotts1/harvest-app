# The Harvest - Changelog

> Version-controlled log of all changes from project inception through PRD completion.
>
> **Note:** Initial drafts (v0.1.0-draft.N) used ollama/deepseek-v4-flash:cloud before model standardization.

---

## v0.1.0 — PRD Draft Complete (Current)

### 2026-04-26
| Field | Value |
|-------|-------|
| **Date** | 2026-04-26 |
| **Version** | v0.1.0-draft.1 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | Repository setup: initialized `prd-packages/harvest-app/` directory structure, created foundational PRD skeleton, defined core user stories and functional requirements, drafted data models and API contract outlines. |

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.1.0-draft.2 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | First QC pass: reviewed foundation sections against project goals, corrected inconsistencies in data model definitions, refined API specifications, expanded edge-case coverage in user stories. |

| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.1.0-draft.3 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | Expansion writing: completed all PRD sections including non-functional requirements, security model, error handling strategy, and deployment considerations. Added acceptance criteria for all user stories. |

| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.1.0-draft.4 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | Second QC pass: cross-referenced all sections for internal consistency, validated API contracts against data models, verified acceptance criteria traceability, fixed formatting and markdown lint issues. |

| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.1.0-rc.1 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | Assembly: merged all sections into final PRD document, generated table of contents, added version metadata and authorship headers, prepared package for stakeholder review. |

| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.1.0 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | Finalization: completed final review pass, signed off on PRD completeness, tagged release as v0.1.0. PRD package ready for handoff to development team. Future build phases will increment to v0.2.0+. |
| **Files updated** | harvest-prd.md, harvest-todo.md, harvest-qc-checklist.md, harvest-changelog.md, harvest-handoff.md |

---

## Legend

| Version Suffix | Meaning |
|---------------|---------|
| `-draft.N` | Work-in-progress iteration |
| `-rc.N` | Release candidate — ready for review |
| (no suffix) | Final release |

## Next Expected Version

**v0.2.0** — Development kickoff (build phase)

---

## v0.3.2 — QC Checklist Deduplication Pass

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.3.2 |
| **Author** | Claudia (Orchestrator) |
| **Description** | Deduplication pass on harvest-qc-checklist.md. Removed 22 shorter duplicate checkpoints from WP02 (6), WP05 (6), and WP11 (10) — kept the more detailed version of each. Removed condensed Final QC section that duplicated the detailed Final QC Deployment Configuration section. File reduced from 587 to approximately 555 lines. No content lost — only shorter versions of duplicated checkpoints removed. |
| **Files updated** | harvest-qc-checklist.md |

## v0.3.1 — Round 4 Final QC Checklist Patch

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.3.1 |
| **Author** | Claudia (Orchestrator) |
| **Description** | Round 4 corrections — added missing deliverable-mapped checkpoints to WP02, WP05, and WP11 in harvest-qc-checklist.md, and expanded Final QC pressure test with deployment configuration, edge cases, and automatic-fail conditions. |
| **Files updated** | harvest-qc-checklist.md |

## v0.2.0 — 9-Correction Package Complete

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.2.0 |
| **Author** | Claudia (Orchestrator) |
| **Description** | Applied all 9 corrections to PRD package (C1–C9). Fixed: WP01 dependency gating (C4), duplicate section headers (C9), WP11 critical spine position (C2), supervision infrastructure insertion (C3), parallel-run indicators (C7), WP01 data schema section (C1), foundation section numbering fix (C5), CFE Agent Integration Contract expansion (C6), QC checklist expansion with Pressure Test Protocol and scoring examples (C8). Additional fix: Section 1.8 critical spine ordering corrected. Interim re-grade: all 8 pressure test questions passed (5/8 PASS, 2/8 PASS with minor notes, 1/8 PASS with clarifying note). Package zipped and delivered to Telegram. 6 of 11 WP specs complete (WP01, WP02, WP04, WP05, WP07, WP11). |
| **Files updated** | harvest-prd.md, harvest-todo.md, harvest-qc-checklist.md, harvest-changelog.md, harvest-handoff.md |

---

## v0.3.0 — Round 3 Corrections Complete

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.3.0 |
| **Author** | Claudia (Orchestrator) |
| **Description** | Round 3 corrections applied. Correction 1: Expanded all 11 QC blocks in `harvest-qc-checklist.md` — each WP block now has 12 checkpoints (up from 4-6), 150+ word "What Correct Completion Looks Like" descriptions, "Written Feedback to Sub-Agent (Required If Failing)" section, and "Edge Case Tests" placeholder (file grew from 375 to 505 lines). Correction 2: Reconciled timeout discrepancy between `harvest-todo.md` (1200→1800) and `harvest-handoff.md` (noted 1800 with rationale). T06 verify text corrected to match. Interim grade: 9/10. Package zipped and delivered to Telegram. |

---

## v0.4.0 — All 11 WP Specs Complete, Integration Coherence PASS

### 2026-04-27
| Field | Value |
|-------|-------|
| **Date** | 2026-04-27 |
| **Version** | v0.4.0 |
| **Author** | Claudia (Orchestrator) |
| **Model** | ollama/deepseek-v4-flash:cloud |
| **Description** | All 11 WP specs complete and integration-coherent. WP01 v5: RVP role architecture, downstream data contracts (Section 7), upline invite state machine (Section 6), calendar contract fields, access tier/intensity schema. WP10 v5: WP01 integration contract (Section 2.4), billing RBAC (Section 11), real-time entitlement gating (Section 3.2), grace period documentation, refunds/chargebacks (Section 15.2) with section renumbering 11->15. Integration coherence v2: 9.0/10 PASS -- all 4 hard conflicts and 6 minor issues resolved. WP01 role enum now includes rvp. WP03 gating standardized as Universal with Primerica Overlay. All dependency tables corrected. Orphaned behaviors assigned. |
| **Files updated** | wp01-onboarding.md, wp10-payment-subscription.md, harvest-todo.md, harvest-changelog.md, harvest-handoff.md, qc-reports/integration-coherence-v2.md |
