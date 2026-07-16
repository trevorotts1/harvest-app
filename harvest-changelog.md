## [2.0.0-build.T08] — BUILD PHASE — 2026-07-16
### T-08 — Compliance Filter Engine core, fail-closed (WP11 critical path, QC earned 9.1/10, 1 QC loop)
- 5 Haiku-4.5 classifiers (Income/Testimonial/Opportunity/Insurance/Referral) + vocabulary classifier (§0.5 forbidden terms force BLOCKED), DI-mockable (tests run with no API key).
- §5.4 risk banding (weights + regulation multipliers + thresholds verbatim from spec); removed a non-spec score-inflation hack.
- FAIL-CLOSED short-circuit: the ONLY release path is band=clear & not held; any classifier error/timeout/missing-credential/unavailable → held ("held for review"), zero send, HTTP 503 — no approve-on-error path (mutation-proven: flipping to fail-open breaks 6 tests).
- §5.5 licensing-phase hard-block: unlicensed / licensing-phase rep + ANY insurance-recommendation signal → blocked regardless of score (keyed on signal, not mere unlicensed status, so clean content is not over-blocked).
- Claude-only: missing ANTHROPIC_API_KEY throws with no network call and no fallback; out-of-[0,1] classifier confidence throws → held. evaluateContent() gate + backward-compat review() shim for WP04/05. Audit events emitted for T-10. 178 tests.

## [2.0.0-build.T13] — BUILD PHASE — 2026-07-16
### T-13 — State insurance licensing state machine (WP11, QC earned 9.2/10)
- FSM: UNLICENSED → PRE_LICENSING → LICENSED → LICENSE_EXPIRED (+ RENEW_LICENSE loop), guarded transitions reject illegal jumps with no state mutation or audit emission.
- Fail-closed capability gate: canPerformLicensedActivity/isLicensed true only for LICENSED; missing record or empty jurisdiction set = UNLICENSED (never inferred licensed). Content-gate levels per §16.5.
- Per-US-state jurisdiction; strictest state governs a multi-state rep; feeds CFE UserContext.licensed_states (WP01/WP03/WP08 consume the gate).
- Additive schema: LicensingRecord + LicensingStateEvent (+ migration). Audit sink for T-10. 34 new tests (151 total).

## [2.0.0-build.T05] — BUILD PHASE — 2026-07-15
### T-05 — Living Field design-system token layer (QC earned 9.8/10, 4 QC loops)
_Note: merged after T-06 due to four QC iterations (each caught a real, progressively subtler WCAG failure: opacity-on-text, viewport-dependent gradient text, dark-theme token composition). The branch was brought current with main (T-04+T-06) before merge._
- src/app/tokens.css: 6 LFDS hue ramps (soil/leaf/harvest/clay/wheat/grove); Golden Hour (light) + Pre-Dawn (dark) semantic tokens per uiux §1.2.4; corrected values (--soil-550 #5d6a62; --harvest-500 never text-on-light; --color-harvest-on-cream pinned harvest-700 in both themes); type scale, 8pt spacing, elevation, motion tokens.
- Pre-hydration theme switch (System / Golden Hour / Pre-Dawn) with no flash; legacy scaffold pages intentionally pinned light (dark-mode migration deferred to per-screen work).
- Accessibility gates (a11y failure = gate failure, uiux §6.1): verify:contrast (27 pairs + negative teeth), guard:no-opacity-on-text (static, per-instance exemption keys), and verify:rendered-contrast (Playwright, 2 themes x 2 viewports x 2 surfaces = 904 nodes) — wired into postbuild, npm test, and CI.
- /design-tokens showcase route. 117 tests. 4 pre-existing legacy AA issues (auth/onboarding pages, .side-link, .visual-root span) documented [WARN-EXEMPT] and carried to T-52.

## [2.0.0-build.T06] — BUILD PHASE — 2026-07-15
### T-06 — CI quality-gate workflow + deferred Vercel deploy stub (QC earned 8.9/10, 2 QC loops)
- .github/workflows/ci.yml: on push main/build/** + PR — npm ci, prisma generate, typecheck, lint, test, build (+postbuild verify:middleware/verify:api-auth), and actionlint over all workflows. A failure in any step fails the job.
- .github/workflows/deploy.yml: gate job reads VERCEL_TOKEN/ORG_ID/PROJECT_ID via env and emits `deployable`; deploy job runs `needs:[gate]` + `if: needs.gate.outputs.deployable=='true'` — skipped (not errored) until T-02 supplies the three GitHub secrets. (Fixed from an invalid job-level `secrets`-in-if guard.)
- Added .eslintrc.json (repo's first ESLint config; ~74 pre-existing violations warn-level, tracked as T-R2) + .nvmrc (20). docs/CI.md documents the workflows and the §19.4 ledgers convention.

## [2.0.0-build.T04] — BUILD PHASE — 2026-07-15
### T-04 — Auth.js (NextAuth) + five-role RBAC scaffold, MFA-capable (QC earned 8.7/10, 3 QC loops)
- NextAuth v4 + Prisma adapter + bcryptjs; typed session carries role (REP/UPLINE/RVP/ADMIN/DUAL) + org context.
- RBAC guard (requireRole/hasRole/roleSatisfies): DUAL = union of REP+UPLINE, ADMIN bypass (opt-out per call), fail-closed on null/invalid session.
- Route auth: middleware at src/middleware.ts gates /dashboard (unauth -> 307 /auth); postbuild verify-middleware + verify-api-auth guards fail the build if the gate is silently unregistered or a route serves real data off a forged header.
- MFA-capable session seams for T-12; loud production failure if NEXTAUTH_SECRET/AUTH_SECRET is unset; login timing-equalized against email enumeration.
- Live /api/session/whoami withRole call-site; adapter tables Account/Session/VerificationToken + migration. 114/114 tests. OPENAI_API_KEY removed from .env.example.

## [2.0.0-build.T03] — BUILD PHASE — 2026-07-15
### T-03 — Prisma schema evolved to master-spec §3 (QC earned 8.9/10)
- Schema evolved 18 -> 51 entities (13 enums, 38 models) incl SecurityEvent; resolved 5-role enum (REP/UPLINE/RVP/ADMIN/DUAL).
- Keyed, fail-closed HMAC-SHA256 (env CONTACT_HASH_PEPPER) for contact phone/email match hashes; unkeyed SHA-256 retired for PII.
- Postgres partial unique indexes: at most one ACTIVE Subscription and one ACTIVE Sponsorship per user.
- First committed migration (20260715120420_evolve_to_spec_v3) + migration_lock.toml.
- 12 new tests added (82/82 passing). Independently verified on a live Postgres 16 (zero drift; constraint enforcement + mutation-tested).

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
