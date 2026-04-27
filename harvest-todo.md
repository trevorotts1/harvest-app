# The Harvest — PRD Phase Task Tracker

**Project:** The Harvest: 2 Hour CEO Business Agent
**Phase:** PRD Assembly
**Version:** v1.2.0
**Last Updated:** 2026-04-27
**Status:** All WP specs complete, integration cohered, final grading in progress

---

## Infrastructure Setup

- [x] **T01** — Create GitHub repository `harvest-app` with `main` and `prd` branches
  **Phase:** Setup | **Dependencies:** None | **Status:** [ ]

---

## Supervision Infrastructure Setup

- [x] **T02** — Set agents.defaults.timeoutSeconds to 1800 and restart Gateway
  **Phase:** Setup | **Dependencies:** T01 | **Status:** [ ]

- [x] **T03** — Set agents.defaults.llm.idleTimeoutSeconds to 120 and restart Gateway
  **Phase:** Setup | **Dependencies:** T01 | **Status:** [ ]

- [x] **T04** — Register harvest-build-supervisor cron job (15-minute interval, isolated session, America/Chicago)
  **Phase:** Setup | **Dependencies:** T01 | **Status:** [ ]

- [x] **T05** — Populate HEARTBEAT.md with full monitoring checklist
  **Phase:** Setup | **Dependencies:** T01 | **Status:** [ ]

- [x] **T06** — Verify: cron status shows enabled, HEARTBEAT.md populated, timeout is 1800
  **Phase:** Setup | **Dependencies:** T02, T03, T04, T05 | **Status:** [ ]

---

## Phase 1 — Foundation (PRD Section Completion)

- [x] **T07** — Write/expand Section 4: Data Model & ERD (WP11 prerequisite)
  **Phase:** Expansion | **Dependencies:** T01 | **Status:** [ ]

- [x] **T08** — Write/expand Section 5: API Contracts & Endpoints
  **Phase:** Expansion | **Dependencies:** T07 | **Status:** [ ]

- [x] **T09** — Write/expand Section 6: Global Sub-Agent Rules & Behavioral Constraints
  **Phase:** Expansion | **Dependencies:** T07 | **Status:** [ ]

- [x] **T10** — QC for Sections 4, 5, 6 (Foundation QC Gate)
  **Phase:** QC | **Dependencies:** T07, T08, T09 | **Status:** [ ]

- [x] **T11** — Write/expand Section 7: Delivery, Push Destinations & GitHub Protocol
  **Phase:** Expansion | **Dependencies:** T10 | **Status:** ✅ Done

- [x] **T12** — Write/expand Section 8: Compliance, Legal & Data Privacy Standards
  **Phase:** Expansion | **Dependencies:** T10 | **Status:** ✅ Done

- [x] **T13** — Write/expand Section 9: Deployment Architecture & Infrastructure
  **Phase:** Expansion | **Dependencies:** T10 | **Status:** ✅ Done

- [x] **T14** — QC for Sections 7, 8, 9
  **Phase:** QC | **Dependencies:** T11, T12, T13 | **Status:** ✅ Done

- [x] **T15** — Full PRD Grading (Pressure Test — Kimi 2.6)
  **Phase:** QC | **Dependencies:** T14 | **Status:** ✅ PASS (8.5/10)

---

## Phase 2 — Work Package Specifications (via sub-agent workforce)

### Critical Spine

- [x] **T16** — WP11: Data Privacy, Security & Compliance Architecture — specification + implementation draft
  **Phase:** Build | **Dependencies:** T01 | **Status:** ✅ Done

- [x] **T17** — QC for WP11
  **Phase:** QC | **Dependencies:** T16 | **Status:** ✅ PASS (9.0/10)

- [x] **T18** — WP01: Onboarding & Profile Engine — specification + implementation draft
  **Phase:** Build | **Dependencies:** T17 | **Status:** ✅ Done

- [x] **T19** — QC for WP01
  **Phase:** QC | **Dependencies:** T18 | **Status:** ✅ PASS (8.0/10)

- [x] **T20** — WP02: Warm Market & Contact Engine (Universal) — specification + implementation draft
  **Phase:** Build | **Dependencies:** T19 | **Status:** ✅ Done

- [x] **T21** — QC for WP02
  **Phase:** QC | **Dependencies:** T20 | **Status:** ✅ PASS (9.6/10)

- [x] **T22** — WP04: AI Agent Layer & Mission Control — specification + implementation draft
  **Phase:** Build | **Dependencies:** T21 | **Status:** ✅ Done

- [x] **T23** — QC for WP04
  **Phase:** QC | **Dependencies:** T22 | **Status:** ✅ PASS (9.5/10)

- [x] **T24** — WP05: Messaging Engine & Outreach System — specification + implementation draft
  **Phase:** Build | **Dependencies:** T23 | **Status:** ✅ Done

- [x] **T25** — QC for WP05
  **Phase:** QC | **Dependencies:** T24 | **Status:** ✅ PASS (9.5/10)

### Parallel Work Packages (after critical spine prerequisites met)

- [x] **T26** — WP03: Harvest Warm Market Method (Universal with Primerica Overlay) — specification + implementation draft
  **Phase:** Build | **Dependencies:** T21 | **Status:** ✅ Done | **Runs parallel with T28, T30**

- [x] **T27** — QC for WP03
  **Phase:** QC | **Dependencies:** T26 | **Status:** ✅ PASS (9.6/10)

- [x] **T28** — WP06: Social, Content & Launch Kit — specification + implementation draft
  **Phase:** Build | **Dependencies:** T23 | **Status:** ✅ Done | **Runs parallel with T26, T30**

- [x] **T29** — QC for WP06
  **Phase:** QC | **Dependencies:** T28 | **Status:** ✅ PASS

- [x] **T30** — WP07: Accountability, Gamification & Motivation — specification + implementation draft
  **Phase:** Build | **Dependencies:** T23 | **Status:** ✅ Done | **Runs parallel with T26, T28**

- [x] **T31** — QC for WP07
  **Phase:** QC | **Dependencies:** T30 | **Status:** ✅ PASS (9.5/10)

- [x] **T32** — WP08: Taprooting, Timeline & Primerica-Specific Features — specification + implementation draft
  **Phase:** Build | **Dependencies:** T27 | **Status:** ✅ Done

- [x] **T33** — QC for WP08
  **Phase:** QC | **Dependencies:** T32 | **Status:** ✅ PASS (8.2/10)

- [x] **T34** — WP09: Team Calendar & Upline Dashboard — specification + implementation draft
  **Phase:** Build | **Dependencies:** T23 | **Status:** ✅ Done | **Runs parallel with T36**

- [x] **T35** — QC for WP09
  **Phase:** QC | **Dependencies:** T34 | **Status:** ✅ PASS (8.0/10)

- [x] **T36** — WP10: Payment & Subscription Infrastructure — specification + implementation draft
  **Phase:** Build | **Dependencies:** T19 | **Status:** ✅ Done (v5, 671 lines) | **Runs parallel with T34**

- [x] **T37** — QC for WP10
  **Phase:** QC | **Dependencies:** T36 | **Status:** ✅ PASS (8.0/10, v5 — with RBAC, entitlements, refunds, WP01 contract)

---

## Cross-Package Integration & Finalization

- [x] **T38** — Full PRD Integration Review (all packages + sections cohered)
  **Phase:** QC | **Dependencies:** T25, T27, T29, T31, T33, T35, T37 | **Status:** ✅ PASS (9.0/10)

- [x] **T39** — Final PRD Grading (Kimi 2.6 pressure test — 8 questions, zero critical failures required)
  **Phase:** QC | **Dependencies:** T38 | **Status:** ✅ PASS (8.5/10)

---

## Delivery & Push

- [x] **T40** — Push PRD package to GitHub `prd` branch (all 5 files: prd, todo, qc-checklist, changelog, handoff)
  **Phase:** Delivery | **Dependencies:** T39 | **Status:** ✅ Done (pushed to main + prd branch)

- [x] **T41** — Vercel deployment (if applicable — PRD static site or prototype)
  **Phase:** Delivery | **Dependencies:** T40 | **Status:** ✅ N/A (PRD package — no Vercel deployment needed)

---

## Documentation Artifacts

- [x] **T42** — Create/update `harvest-changelog.md` — versioned log of all changes
  **Phase:** Docs | **Dependencies:** T01 | **Status:** ✅ Done (v0.4.0 entry added)

- [x] **T43** — Create/update `harvest-qc-checklist.md` — work-package-specific QC criteria + pressure test protocol
  **Phase:** Docs | **Dependencies:** T01 | **Status:** ✅ Done (expanded to 505+ lines)

- [x] **T44** — Create/update `harvest-handoff.md` — handoff summary for build workforce
  **Phase:** Docs | **Dependencies:** T39 | **Status:** ✅ Done (complete handoff documented)

---

## Teardown

- [x] **T45** — Remove cron supervisor job
  **Phase:** Teardown | **Dependencies:** T41 | **Status:** ✅ Done (cron removed)

- [x] **T46** — Verify cron shows `Enabled: false` after removal
  **Phase:** Teardown | **Dependencies:** T45 | **Status:** ✅ Done (cron fully removed — no harvest entries in list)

- [x] **T47** — Run `openclaw doctor` — confirm clean system state (build officially closed only on clean pass)
  **Phase:** Teardown | **Dependencies:** T46 | **Status:** ✅ Clean pass (no errors, only pre-existing deprecation warnings)

---

## Summary

| Category | Count | Notes |
|---|---|---|
| Infrastructure tasks | 1 | T01 |
| Supervision tasks | 5 | T02–T06 |
| Expansion section tasks | 6 | T07–T13 |
| Work package tasks (spec + impl) | 11 | T16–T36 |
| QC tasks | 13 | T10, T14, T17, T19, T21, T23, T25, T27, T29, T31, T33, T35, T37 |
| Final grading tasks | 2 | T15, T39 |
| Integration review | 1 | T38 |
| Delivery tasks | 2 | T40, T41 |
| Documentation artifacts | 3 | T42, T43, T44 |
| Teardown tasks | 3 | T45, T46, T47 |
| **Total** | **47** | **All 47 tasks ✅ COMPLETE** |

---

**Dependency note:** Per PRD Section 1.8, the corrected critical spine is:
`Privacy/Compliance (WP11) → Onboarding/Profile (WP01) → Warm Market Universal (WP02) → AI Agent/Mission Control (WP04) → Messaging/Outreach (WP05)`

Secondary packages branch after their respective critical-spine prerequisites are QC-approved:
- WP03, WP06, WP07 can run in parallel after WP04 is QC-approved (and WP03 additionally requires WP02 QC-approved)
- WP09 and WP10 can run in parallel after WP01 is QC-approved
- WP08 depends on WP03 being QC-approved

Do not advance dependents until blockers clear.

**QC rule:** All tasks scoring <8/10 or with any Critical Failure (per Section 6.2.2) re-enter the QC loop. Maximum 3 revision attempts before human escalation.
