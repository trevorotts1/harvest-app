# Integration Coherence Report — The Harvest

**Date:** 2026-04-27  
**Scope:** All 11 WP specs (WP01–WP11), harvest-prd.md, harvest-qc-checklist.md  
**Reviewer:** Integration Coherence Subagent  
**Status:** ❌ FAIL — Score: 3.5/10  

---

## Executive Summary

The 11 work package specifications demonstrate strong individual quality but suffer from **4 hard conflicts** that would cause code-breaking issues if implemented as-written. The most critical is a foundational contradiction about WP03's gating (Primerica-only vs universal-with-overlay) that affects the entire organizational branching architecture. Two roles defined in the PRD (RVP, dual) are not properly reflected in WP01's schema. Two dependency declarations in individual WP specs disagree with the PRD's dependency map. Two features from the PRD behavior matrix have no WP owner. The package cannot pass without resolution of all hard conflicts.

**Score: 3.5/10 — FAIL**

---

## Coherence Check Results

### 1. DEPENDENCY CHAIN VERIFICATION

#### 1.1 Declared vs Expected Dependencies

| WP | PRD-Stated Prerequisites | WP Spec's Own Declared Deps | Match? |
|----|-------------------------|----------------------------|--------|
| WP01 | WP11 | WP11 (MUST be production-ready before WP01) | ✅ Match |
| WP02 | WP01, WP11 | WP01 (Hard Block), WP11 (Hard Block), WP04 (Consumer) | ⚠️ WP04 listed as consumer (correct — WP02 feeds WP04) |
| WP03 | WP01, WP02, WP11 | WP01 (Hard Block), WP02 (Hard Block), WP11 (Hard Block), WP04 (Consumer), WP07 (Consumer), WP08 (Consumer) | ✅ Match (exceeds — names consumers correctly) |
| WP04 | WP01, WP02, WP11 | WP01 (Hard Block), WP11 (Hard Block) | 🔴 **MISSING WP02 as hard dependency.** WP02 listed in spec body as essential but **not in dependency table** |
| WP05 | WP04, WP11 | WP04 (Hard Block), WP11 (Hard Block) | ⚠️ WP02 (contact/segment context) listed in spec body but not in dependency table |
| WP06 | WP01, WP05, WP11 | WP04 (Hard Block), WP11 (Hard Block), WP02 (Strong), WP09 (Moderate) | 🔴 **PRD says WP05, spec says WP04.** Two different parent packages |
| WP07 | WP01, WP04, WP05 (soft/parallel), WP11 | WP01 (Hard Block), WP04 (Hard Block), WP05 (Hard Block), WP11 (Hard Block) | 🔴 **PRD says WP05 is soft/parallel; WP07's spec says Hard Block** |
| WP08 | WP01, WP03, WP07, WP09, WP11 | WP01 (Hard Block), WP04 (Hard Block), WP03 (Hard Block) | 🔴 **Missing WP07 and WP09.** WP04 listed but PRD does not list WP04 for WP08 |
| WP09 | WP01, WP04, WP11 | WP01 (Hard Block), WP04 (Hard Block), WP11 (Hard Block) | ✅ Match |
| WP10 | WP01, WP11 | WP01 (Hard Block), WP11 (Hard Block) | ✅ Match |
| WP11 | None | None (WP11 is first) | ✅ Match |

#### 1.2 Blocking Issues Found

1. **🔴 WP04 dependency table omits WP02 as a hard block.** The spec body correctly states WP02 as an input: "WP02 for fully grounded contact-fed execution flows." But the formal dependency table only lists WP01 and WP11. A builder referencing the table would miss that WP02 must be complete before WP04 finalizes.

2. **🔴 WP06 dependencies point to WP04 instead of WP05.** PRD Section 3.4 says WP06 depends on WP01, WP05, and WP11. WP06's spec says WP04 (Hard Block), WP11 (Hard Block), WP02 (Strong), WP09 (Moderate). This is a different dependency chain. WP04 is indirectly correct (WP04 generates the content), but the formal dependency should follow the PRD.

3. **🔴 WP07 vs PRD: WP05 dependency mode.** WP07's spec declares WP05 as a Hard Block. PRD Section 3.4 says: "may proceed once WP05 boundaries are stable; motivation logic benefits from messaging cadence definitions but does not require full WP05 completion" — soft/parallel. If a builder follows the WP07 spec, they will wait for full WP05 completion before starting WP07, causing unnecessary serialization.

4. **🔴 WP08 dependency table incomplete.** WP08's spec lists WP01, WP04, WP03 as dependencies. The PRD lists WP01, WP03, WP07, WP09, and WP11. Missing: WP07 (motivation/milestone events), WP09 (calendar context), WP11 (compliance). The spec body references both WP07 and WP11 correctly, but the dependency table is wrong.

#### 1.3 Cross-WP Reference Check (Undocumented Dependencies)

| Reference | Source WP | Target WP | Declared? |
|-----------|-----------|-----------|-----------|
| "Feeds direct to WP04" | WP03 (Action Queue) | WP04 | ✅ (consumer) |
| "Pipeline feed to WP04" | WP02 (Section 6) | WP04 | ✅ (consumer) |
| "Compliance Interception" (multiple) | WP05, WP06, WP07 | WP11 | ✅ |
| "Integration with WP04" | WP06 (Section 10) | WP04 | ✅ |
| "Integration with WP04" | WP08 (Section 9) | WP04 | ✅ |
| "Booked events auto-trigger WP05" | WP09 (Section 9) | WP05 | ✅ |
| "Mission Control integration" | WP08 (Section 5) | WP04 | ✅ |
| "Upline dashboard surfaces" (from WP07 scores) | WP09 (Section 6) | WP07 | ⚠️ Implicit in PRD but not explicit in either spec |

---

### 2. TERMINOLOGY CONSISTENCY

#### 2.1 Subscription Tiers

| Source | Terms Used |
|--------|-----------|
| PRD (Section 2.2.2) | Free / Org-Sponsored / Paid Individual |
| WP10 | Free / Pro ($49/mo) / Enterprise ($199/mo) + Org-Sponsored (Multi-Seat) |
| WP01 | "access tier seeds (free org-linked vs paid external)" |
| QC Checklist | Free / Org / Paid (3-tier) |

**Assessment:** ⚠️ Minor inconsistency. WP10 uses "Pro" and "Enterprise" while the PRD uses "Paid Individual" and "Org-Sponsored." The concepts map correctly (Pro = Paid Individual, Enterprise = Org-Sponsored), but the naming is not synchronized. The QC checklist uses "Free/Org/Paid" which maps but isn't identical to either. This could cause confusion in documentation cross-references but won't break code if properly mapped.

**Recommendation:** Standardize naming across the PRD, WP10, and QC checklist. Recommend: Free / Pro ($49/mo) / Enterprise — since WP10 has the most detailed tier specification.

#### 2.2 Roles

| Source | Roles Listed |
|--------|-------------|
| PRD (Section 1.5) | Rep, Upline/Field Trainer, RVP/Organization Leader, External Non-Primerica User (+ dual-role support) |
| PRD (Section 1.7) | Rep, Upline, Admin, Dual (in WP01 description) |
| WP01 Schema | `rep`, `upline`, `admin`, `dual` (enum of 4) |
| QC Checklist | Rep, Upline, RVP, External User |
| WP08 | References rep, upline, admin permissions |
| WP09 | Upline, Rep (The Base/Downline) |
| WP11 RBAC | Rep, Upline, Admin |

**Assessment:** 🔴 **Hard conflict.** The PRD defines **RVP/Organization Leader** as a distinct primary role type with specific permissions (team-wide visibility, configuration surfaces, master calendar layers). The QC checklist confirms RVP as a role. However, **WP01's role enum does not include `rvp`**. The WP01 schema has only 4 roles: `rep, upline, admin, dual`. If RVP is meant to be a special variant of `upline`, this must be explicitly mapped in WP01. Without it, the RBAC matrix defined in WP11, the team visibility features in WP09, and the organization-level configuration surfaces referenced in the PRD have no underlying permission entity.

**Recommendation:** Either (a) add `rvp` to WP01's role enum, or (b) explicitly document that RVP is a `upline` subtype with specific flag/settings, and update WP01's schema to include an `rvp` boolean or `leadership_role` field.

#### 2.3 Entity Names

| Entity | WP01 | WP03 | WP07 | Consistent? |
|--------|------|------|------|-------------|
| Solution Number | `solution_number` (snake_case) | `solution_number` (snake_case) | Referenced | ✅ |
| Seven Whys | "Seven Whys" | Referenced | Referenced (anchor statement) | ✅ |
| Goal Commitment Card | "Goal Commitment Card" | Referenced | "Goal Commitment Card" | ✅ |
| Compliance Filter Engine | Referenced | Referenced | Referenced | ✅ (CFE throughout) |
| Anchor Statement | `anchor_statement` | — | "anchor statement" | ✅ |
| Momentum Score | — | — | `Momentum Score` (0–100) | ✅ (unique to WP07) |
| Readiness Score | — | `readiness_score` (0–100) | — | ✅ (unique to WP03) |

**Assessment:** ✅ No hard conflicts. All named entities use consistent naming and casing across WPs that reference them.

---

### 3. DATA CONTRACT ALIGNMENT

#### 3.1 Field Name Casing

| Concept | WP01 | WP02 | WP03 | WP10 | Consistent? |
|---------|------|------|------|------|-------------|
| User ID | `user_id` | `user_id` FK | — | `user_id` FK | ✅ (snake_case) |
| Onboarding Status | `onboardingStatus` (camelCase) | — | — | — | ⚠️ Only appears in WP01 |
| Solution Number | `solution_number` | — | `solution_number` | — | ✅ |
| First Name | — | `first_name` (encrypted) | `first_name` (encrypted string) | — | ✅ |
| Tier | — | — | — | `plan_tier` (snake_case) | ✅ |
| Status | `onboardingStatus` (camelCase) | — | — | `status` (snake_case) | ⚠️ Inconsistent casing between WP01 and WP10 |

**Assessment:** ⚠️ Minor. WP01 uses `onboardingStatus` (camelCase for a multi-word field) while WP10 and WP03 use consistent snake_case everywhere. This is a style inconsistency but not blocking — each field occurs in its own context. However, a project-wide convention (recommended: snake_case for DB fields per WP10 DDL standard) should be documented.

#### 3.2 Key Data Handoffs

| Handoff | Source | Target | Field Compatibility |
|---------|--------|--------|-------------------|
| User Profile | WP01 | All downstream | WP01 schema uses `onboardingStatus` — downstream WPs reference "GatedComplete" state — compatible |
| Solution Number | WP01 | WP03 | Both use `solution_number` — ✅ |
| Contacts | WP02 | WP04 | WP02: `GET /api/v1/contacts/agent-queue` returns fields matching WP02 schema — ✅ |
| Action Queue | WP03 | WP04 | WP03: `GET /api/v1/warm-market/action-queue` fully documented — ✅ |
| Subscriptions | WP10 | Entitlement | WP10: full DDL + API contracts — ✅ |
| Compliance | WP11 | WP04–WP07 | WP11: `POST /api/v1/compliance/review` — all WPs reference this — ✅ |

**Assessment:** ✅ No data contract mismatches found. All cross-WP handoffs have compatible field definitions.

---

### 4. GATE ARCHITECTURE CONSISTENCY

#### 4.1 Org-Gate (Primerica vs Non-Primerica)

| WP | Org Gate Stated | Consistent with PRD? |
|----|----------------|---------------------|
| WP01 | Organization selection + `solution_number` gate (Primerica-only) | ✅ PRD Section 1.6 |
| WP02 | Universal — no org gating | ✅ |
| WP03 | 🔴 `organization = primerica` — **entire package locked to Primerica** | ❌ **See below** |
| WP04 | Universal — no org gating mentioned | ✅ |
| WP05 | Universal — no Primerica-specific logic | ✅ |
| WP06 | Universal brand doctrine — no Primerica-specific logic | ✅ |
| WP07 | Conditional motivational quote weighting (Primerica vs general) | ✅ |
| WP08 | 🔴 `org_type = Primerica` — entire package locked | ✅ (WP08 is Primerica-only per PRD) |
| WP09 | Primerica-specific gating for availability triggers, universal availability otherwise | ✅ |
| WP10 | Universal — no Primerica-specific logic | ✅ |
| WP11 | Universal — no Primerica-specific logic | ✅ |

**🔴 HARD CONFLICT: WP03 Gating Contradiction**

**WP03 spec (Section 1):** "This package is **LOCKED** to `organization = primerica`. Any non-Primerica org route must be blocked at the conditional logic engine kernel. Attempting to access this package with `organization != primerica` returns a 403."

**PRD Section 9.2:** "WP03 is **unblocked for all organizations**, but its Primerica-specific content and logic only activate when org=Primerica. For non-Primerica orgs, WP03 delivers standard Wave 2 functionality without Primerica-specific behaviors."

**PRD Section 1.6:** Lists the Harvest Warm Market Method as a Primerica-only system.

**These are directly contradictory.** 
- If the WP03 spec is followed, non-Primerica users get a 403 on WP03 entirely.
- If PRD Section 9.2 is followed, non-Primerica users get "standard Wave 2 functionality" from WP03.
- If PRD Section 1.6 is followed, WP03 is Primerica-only.

The WP03 spec's "locked" language, its Primerica-specific Solution Number integration, Primerica-specific Hidden Earnings recalibration, and Primerica-compliance guardrails all suggest it was designed as entirely Primerica-specific. There is no "standard Wave 2 functionality" designed in the spec.

**Resolution required:** Either (a) redesign WP03 to have a universal mode (non-Primerica) and a Primerica overlay mode, or (b) accept WP03 as Primerica-only and update PRD Section 9.2 to match.

#### 4.2 CFE Gate (Compliance Filter Engine)

All WPs that generate outbound content (WP04, WP05, WP06, WP07) consistently reference WP11's CFE as a synchronous gate. The CFE's risk scoring model (0-10 auto-deploy, 11-70 flag, 71-100 block) is used consistently. 

**Assessment:** ✅ Consistent across all WPs.

#### 4.3 Seven Whys Gate

WP01 defines the Seven Whys coaching session with a >70/100 emotional resonance score gate. WP07 references the anchor statement from Seven Whys for motivation. PRD confirms the gate.

**Assessment:** ✅ Consistent.

---

### 5. ROLE-BASED ACCESS CONSISTENCY

#### 5.1 Role Set Used by Each WP

| WP | Roles Referenced | Consistent with WP01? |
|----|-----------------|---------------------|
| WP01 | rep, upline, admin, dual | Baseline |
| WP02 | user_id FK → User (implicitly all roles) | ✅ |
| WP03 | Rep (primary), Upline (visibility) | ✅ |
| WP04 | Rep, Upline | ✅ |
| WP05 | Rep, Upline (handoff) | ✅ |
| WP06 | Rep | ✅ |
| WP07 | Rep (primary), Upline (inactivity alerts) | ✅ |
| WP08 | Rep, Upline, Admin | ✅ |
| WP09 | Upline Access, Rep Access (The Base/Downline) | ✅ |
| WP10 | Users, RVP/Sponsor (billing visibility) | ⚠️ References RVP role not in WP01 schema |
| WP11 | Rep, Upline, Admin, Compliance Officer | ⚠️ Compliance Officer role not in WP01 schema |

**Assessment:** 🔴 **Hard conflict re: RVP role** (see Section 2.2 and Section 2.3 analysis). WP10 references RVP for billing visibility. WP11 references Compliance Officer. Neither exists in WP01's role enum. The Compliance Officer is a platform-level administrative role, likely a subtype of `admin`, but this is not documented. RVP requires resolution.

#### 5.2 WP08 vs WP09 Role Alignment

Both WP08 (Taprooting) and WP09 (Calendar) reference upline visibility and role-based access. Both consistently reference the role hierarchy from WP01 (rep -> upline -> admin). No cross-WP role conflict found.

**Assessment:** ✅ Aligned.

---

### 6. API ENDPOINT CONFLICTS

#### 6.1 All Unique Routes

| Route | WP | Purpose |
|-------|----|---------|
| `GET /api/v1/contacts/agent-queue` | WP02 | Contact pipeline to agents |
| `GET /api/v1/warm-market/action-queue` | WP03 | Warm market action queue |
| `POST /api/v1/subscriptions` | WP10 | Create subscription |
| `PATCH /api/v1/subscriptions/:id` | WP10 | Change plan |
| `GET /api/v1/subscriptions/:id/billing-history` | WP10 | Invoice history |
| `DELETE /api/v1/subscriptions/:id` | WP10 | Cancel subscription |
| `POST /api/v1/compliance/review` | WP11 | CFE content review |
| `GET /onboarding/state` | WP01 | Session persistence state |
| `GET /onboarding/resume` | WP01 | Resume onboarding |
| `/api/v1/warm-market/action-queue` | WP03 | (see above — verified unique) |

**Assessment:** ✅ No overlapping routes. `api/v1/subscriptions` is unique to WP10. `api/v1/compliance/review` is unique to WP11. All routes are distinct.

#### 6.2 Versioning Convention

**Observation:** No WP explicitly states an API versioning strategy (e.g., `/v1/`, `/v2/`). The PRD Section 1.10.1 contract references `POST /api/v1/compliance/review`. WP10's endpoint summary table uses `/api/v1/`. WP02 and WP03 use `/api/v1/`. The `/v1/` convention is consistent but undocumented as policy.

**Assessment:** ⚠️ Minor gap. Recommend documenting `/v1/` as the project-wide API versioning convention in a shared API standards document.

---

### 7. ORPHANED FUNCTIONALITY CHECK

#### 7.1 PRD Behavior Matrix Coverage

| Behavior # | Behavior Name | WP Coverage | Covered? |
|-----------|--------------|-------------|----------|
| 1–18 | (Part 1 — detailed in separate matrix document) | Various | Need to verify Part 1 separately |
| 19 | Downline Maxxing Visualization | WP08 | ✅ |
| 20 | 30-Day Phased Timeline | WP08 | ✅ |
| 21 | Objection Handling Decision Tree | WP05 | ✅ |
| 22 | Motivational Quote Engine | WP07 | ✅ |
| 23 | Notification Architecture | WP07 | ✅ |
| 24 | Celebration & Milestone Engine | WP07 | ✅ |
| 25 | Momentum Score | WP07 | ✅ |
| 26 | 48-Hour Countdown | WP07 | ✅ |
| 27 | SMS Broadcast Center | WP05 | ✅ |
| 28 | Email Campaign Builder | WP05 | ✅ |
| 29 | Social Media Launch Kit | WP06 | ✅ |
| 30 | Goal Commitment Card | WP01 | ✅ |
| 31 | Referral Script Generator | WP05, WP07 | ✅ |
| **32** | **Downline Maxxing Course** | **None** | **❌ ORPHANED** |
| **33** | **Book: Harvest Integration** | **None** | **❌ ORPHANED** |
| 34 | Payment & Subscription Infrastructure | WP10 | ✅ |
| 35 | Compliance Filter | WP11 | ✅ |
| 36 | Data Privacy & Security | WP11 | ✅ |

**🔴 Two orphaned features:**

1. **Downline Maxxing Course (Behavior 32):** Described in the PRD behavior matrix as a progressive curriculum that unlocks stages (Stage 1: Philosophy), tracks module completions, rewards +5 momentum score on completion, and feeds milestones to the Celebration Engine. Has its own data model (`CourseProgress { rep_id, current_stage, completed_modules[], stage_unlocks_status }`). **No WP spec covers this.** It should be owned by WP07 (motivation/gamification) or possibly WP08 (timeline/phase-lock). The behavior matrix defines it as Primerica-gated = No (universal).

2. **Book: Harvest Integration (Behavior 33):** Described in the PRD behavior matrix: welcome email with PDF download link, link to purchase physical book store, speaking engagement contact form. Data model: `HarvestBook { book_version, download_link, physical_store_url }`. **No WP spec covers this.** It could fit into WP06 (social/content/launch kit) or WP01 (onboarding welcome sequence).

#### 7.2 PRD-Defined Role vs WP01 Schema Gap

As documented in Sections 2.2 and 5.1 above, the **RVP/Organization Leader** role is defined in the PRD but not reflected in WP01's role schema. This is architecture-critical because WP09 (Team Calendar) and WP10 (Payment/Subscription) reference RVP-specific visibility and billing surfaces.

#### 7.3 PRD Doctrine Injection Points

The PRD Section 3.9 defines doctrine injection points for each WP. All 11 WPs were verified against this list:

| WP | PRD Doctrine Injection Point | Covered in WP Spec? |
|----|---------------------------|-------------------|
| WP01 | Seven Whys, anchor logic, 2 Hour CEO framing, role dignity | ✅ |
| WP02 | Hidden Earnings Estimate, relationship activation, warm-market-first worldview | ✅ |
| WP03 | Community Introduction, relational matching behavior | ✅ |
| WP04 | Mission Control as business companion, not admin console | ✅ |
| WP05 | Service framing, non-spam outreach, recommendation-specialist positioning | ✅ |
| WP06 | Launch content that feels movement-led, not hype-led | ✅ |
| WP07 | Belief reinforcement, collective uplift, celebration as retention infrastructure | ✅ |
| WP08 | Multiplication and team-building logic rendered visibly | ✅ |
| WP09 | Upline visibility in service of support, not surveillance | ✅ |
| WP10 | Access rules aligned with org membership logic | ✅ |
| WP11 | Data stewardship consistent with trust-centered brand promise | ✅ |

**Assessment:** ✅ All doctrine injection points are covered.

---

## Summary of Issues by Severity

### 🔴 HARD CONFLICTS (Blocking — Score Impact: -2.5 to -2.0 each)

| # | Issue | WPs Affected | Impact |
|---|-------|-------------|--------|
| HC-1 | **WP03 gating contradiction:** WP03 spec says entire package is Primerica-locked; PRD Section 9.2 says it's unblocked for all organizations with Primerica-specific overlay only. Contradicts PRD Section 1.6 (Primerica-only). | WP03, PRD | System-level — determines whether non-Primerica users get WP03 at all |
| HC-2 | **Missing RVP role in WP01 schema:** PRD defines RVP as a primary role; WP01 schema lacks it; WP09 and WP10 reference RVP-specific features | WP01, WP09, WP10, WP11 RBAC | RBAC matrix incomplete; visibility/permissions for org leaders undefined |
| HC-3 | **WP08 dependency table incomplete:** Missing WP07, WP09, WP11 from declared dependencies | WP08 | Build sequencing risk — downstream packages started without prerequisites |
| HC-4 | **WP07/WP05 dependency mode conflict:** WP07 says WP05 is Hard Block; PRD says soft/parallel | WP07, PRD | Could cause unnecessary serialization or premature parallel starts |

### ⚠️ MINOR INCONSISTENCIES (Non-blocking — Score Impact: -0.5 each)

| # | Issue | WPs Affected |
|---|-------|-------------|
| MI-1 | WP06 dependency table lists WP04 instead of WP05 | WP06 |
| MI-2 | WP04 dependency table omits WP02 as hard dependency | WP04 |
| MI-3 | Tier naming inconsistency: PRD says "Paid Individual" / "Org-Sponsored"; WP10 says "Pro" / "Enterprise" | WP10, PRD |
| MI-4 | WP01 uses `onboardingStatus` (camelCase) while all other WPs use snake_case | WP01 |
| MI-5 | No centralized API versioning convention documented | All |
| MI-6 | Two orphaned features: Downline Maxxing Course (Behavior 32), Book: Harvest Integration (Behavior 33) | Behavior Matrix |

---

## Recommendations (Priority Order)

1. **Resolve WP03 gating (HC-1):** Decide: is WP03 Primerica-only (per its spec and PRD Section 1.6) or universal-with-overlay (per PRD Section 9.2)? Update the contradictory source to match the decision. Recommend: follow PRD Section 1.6 (Primerica-only) since WP03's Solution Number integration, Primerica-specific multipliers, and Primerica compliance rules are deeply embedded — adding a universal mode would require significant redesign.

2. **Add RVP role to WP01 schema (HC-2):** Add `rvp` to WP01's role enum. Define RVP permissions: team-wide visibility, configuration surfaces, master calendar layers, billing oversight. Update WP11 RBAC matrix accordingly.

3. **Fix WP08 dependency table (HC-3):** Add WP07 (motivation/milestones), WP09 (calendar context), and WP11 (compliance) as declared hard dependencies.

4. **Align WP07/WP05 dependency mode (HC-4):** Standardize on either hard block or soft/parallel. PRD's soft/parallel characterization seems more practical — update WP07's spec to match.

5. **Fix WP06 dependency table (MI-1):** Replace WP04 with WP05 as the declared hard dependency (per PRD). Keep WP04 in the spec body as the generation engine.

6. **Add WP02 to WP04's dependency table (MI-2):** Explicitly list WP02 as a hard dependency alongside WP01 and WP11.

7. **Standardize tier naming (MI-3):** Align PRD, WP10, and QC checklist on a single naming convention. Recommend WP10's: Free / Pro ($49/mo) / Enterprise.

8. **Assign orphaned behaviors:** Add Downline Maxxing Course (Behavior 32) to WP07 scope. Add Book: Harvest Integration (Behavior 33) to WP06 or WP01 scope.

9. **Document API versioning convention:** Establish `/api/v1/` as the project standard.

---

## Final Score Calculation

| Category | Max | Score | Notes |
|----------|-----|-------|-------|
| Functionality / Requirement Coverage | 4 | 1.0 | PRD coverage is complete but WP03 gating contradiction and missing RVP role create foundational gaps |
| Security & Compliance | 3 | 2.0 | CFE gate architecture is consistent across all relevant WPs. No compliance gaps. Docked for missing Compliance Officer in WP01 role schema |
| Code Quality / Documentation | 2 | 0.5 | Multiple dependency table mismatches between WP specs and PRD. Two orphaned features. Terminology inconsistency on tiers |
| Performance / Edge Cases | 1 | 0.0 | Not evaluated in this coherence pass (scope is integration consistency, not performance) |

**Raw Score: 3.5/10**

**Threshold: 8/10 required for PASS**

**Result: ❌ FAIL** — 4 hard conflicts (HC-1 through HC-4) exist. Per rubric, any hard conflict results in FAIL regardless of score.

---

## Conclusion

This integration coherence pass found 4 hard conflicts, 6 minor inconsistencies, and 2 orphaned features. The most critical issue is the contradictory definition of WP03's org-gating between the WP03 spec (entirely Primerica-locked) and the PRD (universal with Primerica overlay). The second-hardest issue is the missing RVP role in WP01's schema despite being a primary role type in the PRD and QC checklist.

**The package cannot pass QC in its current state.** All hard conflicts must be resolved before the WP specs can be considered coherent for implementation. Recommend:
1. Resolving HC-1 (WP03 gating) first — this is foundational
2. Adding RVP to WP01 schema — this affects RBAC, calendar, and payment
3. Fixing dependency tables in WP06, WP07, WP08 — build sequencing depends on this
4. Assigning the two orphaned features to their owning WPs

Once those are resolved, a re-check should bring the score above 8/10.
