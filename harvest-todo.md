# The Harvest — PRD Phase Task Tracker

**Project:** The Harvest: 2 Hour CEO Business Agent
**Phase:** PRD Assembly
**Version:** v1.0.0
**Last Updated:** 2026-04-27
**Status:** All tasks open — build not started

---

## Infrastructure Setup

- [ ] **T01** — Create GitHub repository `harvest-app` with `main` and `prd` branches  
  **Phase:** Setup | **Dependencies:** None | **Status:** [ ]

---

## 11 Work Package Tasks

### Phase 1 — Foundation (Critical Spine)

- [ ] **T02** — Write/expand Section 4: Data Model & ERD (WP11 prerequisite)  
  **Phase:** Expansion | **Dependencies:** T01 | **Status:** [ ]

- [ ] **T03** — Write/expand Section 5: API Contracts & Endpoints  
  **Phase:** Expansion | **Dependencies:** T02 | **Status:** [ ]

- [ ] **T04** — Write/expand Section 6: Global Sub-Agent Rules & Behavioral Constraints  
  **Phase:** Expansion | **Dependencies:** T02 | **Status:** [ ]

- [ ] **T05** — QC for Sections 4, 5, 6 (Foundation QC Gate)  
  **Phase:** QC | **Dependencies:** T02, T03, T04 | **Status:** [ ]

- [ ] **T06** — Write/expand Section 7: Delivery, Push Destinations & GitHub Protocol  
  **Phase:** Expansion | **Dependencies:** T05 | **Status:** [ ]

- [ ] **T07** — Write/expand Section 8: Compliance, Legal & Data Privacy Standards  
  **Phase:** Expansion | **Dependencies:** T05 | **Status:** [ ]

- [ ] **T08** — Write/expand Section 9: Deployment Architecture & Infrastructure  
  **Phase:** Expansion | **Dependencies:** T05 | **Status:** [ ]

- [ ] **T09** — QC for Sections 7, 8, 9  
  **Phase:** QC | **Dependencies:** T06, T07, T08 | **Status:** [ ]

- [ ] **T10** — Full PRD Grading (Pressure Test — Kimi 2.6)  
  **Phase:** QC | **Dependencies:** T09 | **Status:** [ ]

---

### Phase 2 — Work Package Specifications (via sub-agent workforce)

- [ ] **T11** — WP01: Onboarding & Profile Engine — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T01 | **Status:** [ ]

- [ ] **T12** — QC for WP01  
  **Phase:** QC | **Dependencies:** T11 | **Status:** [ ]

- [ ] **T13** — WP02: Warm Market & Contact Engine (Universal) — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T11, T12 | **Status:** [ ]

- [ ] **T14** — QC for WP02  
  **Phase:** QC | **Dependencies:** T13 | **Status:** [ ]

- [ ] **T15** — WP03: Harvest Warm Market Method (Primerica-Specific) — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T14 | **Status:** [ ]

- [ ] **T16** — QC for WP03  
  **Phase:** QC | **Dependencies:** T15 | **Status:** [ ]

- [ ] **T17** — WP04: AI Agent Layer & Mission Control — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T12, T14 | **Status:** [ ]

- [ ] **T18** — QC for WP04  
  **Phase:** QC | **Dependencies:** T17 | **Status:** [ ]

- [ ] **T19** — WP05: Messaging Engine & Outreach System — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T18 | **Status:** [ ]

- [ ] **T20** — QC for WP05  
  **Phase:** QC | **Dependencies:** T19 | **Status:** [ ]

- [ ] **T21** — WP06: Social, Content & Launch Kit — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T18 | **Status:** [ ]

- [ ] **T22** — QC for WP06  
  **Phase:** QC | **Dependencies:** T21 | **Status:** [ ]

- [ ] **T23** — WP07: Accountability, Gamification & Motivation — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T18 | **Status:** [ ]

- [ ] **T24** — QC for WP07  
  **Phase:** QC | **Dependencies:** T23 | **Status:** [ ]

- [ ] **T25** — WP08: Taprooting, Timeline & Primerica-Specific Features — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T16 | **Status:** [ ]

- [ ] **T26** — QC for WP08  
  **Phase:** QC | **Dependencies:** T25 | **Status:** [ ]

- [ ] **T27** — WP09: Team Calendar & Upline Dashboard — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T17, T18 | **Status:** [ ]

- [ ] **T28** — QC for WP09  
  **Phase:** QC | **Dependencies:** T27 | **Status:** [ ]

- [ ] **T29** — WP10: Payment & Subscription Infrastructure — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T12 | **Status:** [ ]

- [ ] **T30** — QC for WP10  
  **Phase:** QC | **Dependencies:** T29 | **Status:** [ ]

- [ ] **T31** — WP11: Data Privacy, Security & Compliance Architecture — specification + implementation draft  
  **Phase:** Build | **Dependencies:** T12 | **Status:** [ ]

- [ ] **T32** — QC for WP11  
  **Phase:** QC | **Dependencies:** T31 | **Status:** [ ]

---

## Cross-Package Integration & Finalization

- [ ] **T33** — Full PRD Integration Review (all packages + sections cohered)  
  **Phase:** QC | **Dependencies:** T30, T32, T20, T22, T24, T26, T28 | **Status:** [ ]

- [ ] **T34** — Final PRD Grading (Kimi 2.6 pressure test — 8 questions, zero critical failures required)  
  **Phase:** QC | **Dependencies:** T33 | **Status:** [ ]

---

## Delivery & Push

- [ ] **T35** — Push PRD package to GitHub `prd` branch (all 5 files: prd, todo, qc-checklist, changelog, handoff)  
  **Phase:** Delivery | **Dependencies:** T34 | **Status:** [ ]

- [ ] **T36** — Vercel deployment (if applicable — PRD static site or prototype)  
  **Phase:** Delivery | **Dependencies:** T35 | **Status:** [ ]

---

## Documentation Artifacts

- [ ] **T37** — Create/update `harvest-changelog.md` — versioned log of all changes  
  **Phase:** Docs | **Dependencies:** T01 | **Status:** [ ]

- [ ] **T38** — Create/update `harvest-qc-checklist.md` — work-package-specific QC criteria + pressure test protocol  
  **Phase:** Docs | **Dependencies:** T01 | **Status:** [ ]

- [ ] **T39** — Create/update `harvest-handoff.md` — handoff summary for build workforce  
  **Phase:** Docs | **Dependencies:** T34 | **Status:** [ ]

---

## Teardown

- [ ] **T40** — Remove cron supervisor job  
  **Phase:** Teardown | **Dependencies:** T36 | **Status:** [ ]

- [ ] **T41** — Verify cron shows `Enabled: false` after removal  
  **Phase:** Teardown | **Dependencies:** T40 | **Status:** [ ]

- [ ] **T42** — Run `openclaw doctor` — confirm clean system state (build officially closed only on clean pass)  
  **Phase:** Teardown | **Dependencies:** T41 | **Status:** [ ]

---

## Summary

| Category | Count | Notes |
|---|---|---|
| Infrastructure tasks | 1 | T01 |
| Expansion section tasks | 6 | T02–T08 |
| Work package tasks (spec + impl) | 11 | T11–T31 |
| QC tasks | 13 | T05, T09, T12, T14, T16, T18, T20, T22, T24, T26, T28, T30, T32 |
| Final grading tasks | 2 | T10, T34 |
| Integration review | 1 | T33 |
| Delivery tasks | 2 | T35, T36 |
| Documentation artifacts | 3 | T37, T38, T39 |
| Teardown tasks | 3 | T40, T41, T42 |
| **Total** | **42** | |

---

**Dependency note:** Per PRD Section 1.8, the critical spine is:
`Onboarding/Profile (WP01) → Privacy/Compliance (WP11) → Warm Market Universal (WP02) → AI Agent/Mission Control (WP04) → Messaging/Outreach (WP05)`

Secondary packages (WP06, WP07, WP08, WP09, WP10) branch after WP04 is QC-approved. Do not advance dependents until blockers clear.

**QC rule:** All tasks scoring <8/10 or with any Critical Failure (per Section 6.2.2) re-enter the QC loop. Maximum 3 revision attempts before human escalation.
