## [2.0.0-build.T23] — BUILD PHASE — 2026-07-17
### T-23 — Segmentation + Memory Jogger + agent pipeline; Contact-PII decrypt reads (WP02, QC 8.75)
- Haiku-4.5 contact segmentation (DI-mockable, fail-closed on missing key, no non-Claude fallback; deterministic 0–100 score, A-list ≥70). Memory Jogger surfaces DECRYPTED contact PII (via T-22's decryptContactPII) with dedup + skip-count. Agent pipeline (contact→agent typed contract) + new session-gated /api/contacts/agent-queue route (ownership-checked, forged-header-inert).
- Fixes the T-22 ciphertext-read consequence: memory-jogger + pipeline now decrypt Contact PII; replaced 2 falsely-green plaintext-mock tests with a real encrypt→store→decrypt round-trip. Additive schema Contact.memory_jogger_skip_count + migration. 748 tests.
- Advisory to WP04 (T-30): inject HaikuSegmentationClient/HaikuMemoryJoggerCategoryClient — services default to the local heuristic; forgetting = silent regex instead of Haiku.

## [2.0.0-build.T24] — BUILD PHASE — 2026-07-17
### T-24 — Hidden Earnings engine: FTC-safe formula, org-gated Primerica calibration, safe-harbor on every render, 0-3 growth path (WP02, QC 9.8)
- FTC-safe potential-earnings formula (framed potential/illustrative, never a guarantee). Primerica calibration triple-gated behind the org gate — a non-Primerica user never receives Primerica-specific numbers (branch check + assertPrimericaGate + payload leak-scan at the wire).
- The safe-harbor line is emitted on EVERY figure-bearing path (render, screen-reader, outreach) via assertSafeHarborPresent (throws if missing/altered). 0–3 contacts — and any non-positive computed value — render a growth path, never $0/NaN/Infinity (hostile inputs sanitized). Outreach text is CFE-gated (released-only). /api/contacts/hidden-earnings is session-gated, org/count read server-side. 769 tests.

## [2.0.0-build.T-R7] — BUILD PHASE — 2026-07-18
### T-R7 — DSAR export decrypts Contact PII before serialize (WP11 remediation, QC 8.9)
- processExport decrypts every Contact's PII before serializing the GDPR/CCPA export (JSON+CSV); per-field safe degradation on decrypt failure (marked-unavailable, no crash/no ciphertext leak). Deletion/FINRA carve-out/legal-hold unchanged. 725 tests.
- Follow-up (T-R9): decrypt User.solution_number in the export + exclude password_hash/MFA material.

## [2.0.0-build.T22] — BUILD PHASE — 2026-07-17
### T-22 — The Vault: contact ingestion + encrypted PII + idempotent import (WP02, QC 8.6) — first Wave 3 unit
- Four ingestion modalities (CSV, iOS native, Android native, Google Contacts) converge on one encrypting upsert. Contact PII (first/last name, phone, email, notes) is AES-256-GCM encrypted at rest (CONTACT_ENCRYPTION_KEY, fail-closed); dedup/match via keyed HMAC (phone_hash/email_hash), never plaintext. Fixes a pre-existing plaintext-PII bug in contact.service.ts.
- Idempotent + resumable import via a new ImportBatch model (replay a completed key = no-op; infra failure resumes at the row without advancing the cursor; cross-key HMAC dedupe). Minors (under-18, fail-toward-caution) set do_not_contact + DO_NOT_CONTACT + OptOutRegistry(reason:minor) — unreachable for outreach. /api/contacts/import is session-gated (withOnboardingGate), never trusts a forged header. 724 tests.
- NOTE: Contact PII columns are now ciphertext — downstream consumers must decrypt via decryptContactPII (tracked: T-23 memory-jogger/pipeline; T-R7 data-rights DSAR export [compliance, do early]; T-R8 legacy dedup).

## [2.0.0-build.T21R] — BUILD PHASE — 2026-07-17
### T-21R — GDPR consent capture (WP01 §6.10-10 remediation, QC 8.7)
- Dedicated O-8.5 consent micro-step (explicit affirmative, default-off, Continue disabled until acted) → POST /api/onboarding/consent (session-authed) calls WP11 ConsentManager, writes a versioned+timestamped ComplianceConsent('gdpr', given:true) row and sets User.gdpr_consent=true.
- Completion precondition (role-agnostic, fail-closed): /api/onboarding/complete rejects with 400 GDPR_CONSENT_REQUIRED unless gdpr_consent===true — no role can reach GATED_COMPLETE without a recorded consent (proven across all 5 roles).
- Revoke path (DELETE /api/onboarding/consent) writes a given:false record and clears the flag. The §6.10-1 downstream route gate is untouched. 694 tests.
- Closes the WP01 wave-gate GDPR gap. Follow-up (tracked in T-20): wire the dense UPLINE/RVP/DUAL onboarding UI to the consent route + have the durable completion writer read User.gdpr_consent.

## [2.0.0-build.T20] — BUILD PHASE — 2026-07-17
### T-20 — Onboarding UI (O-1..O-9) + end-to-end §6.10-1 gate enforcement + encrypted solution-number on register (WP01, QC 9.1, 2 QC loops)
- O-1..O-9 onboarding screens + dense upline/RVP track, consuming the merged WP01 engines (identity/org-gate, Seven Whys invisible-score contract, sponsor matching/waitlist, tracks + §16.5 licensing hard-block), on the Living Field design tokens (no raw hex). Includes O-5 outreach-consent toggle (default off), O-2 photo capture (+initials fallback), DUAL persona switcher, Hidden Earnings Reveal (safe-harbor + zero-data growth path + no-share + single SR utterance).
- §6.10-1 hard gate now enforced end-to-end: middleware redirects non-GATED_COMPLETE users off all WP02–WP10 page subtrees; withOnboardingGate wraps all downstream data API routes (deny-by-default, live-DB status wins over a stale token). /api/auth/register now 7-digit-checks + AES-256-GCM-encrypts the solution number (no plaintext). Legacy onboarding service path retired. 653 tests.

## [2.0.0-build.T19] — BUILD PHASE — 2026-07-17
### T-19 — Sponsor matching, invites, access-tier assignment, downstream contracts (WP01, QC 9.0, 1 QC loop)
- Sponsor matching never dead-ends (no eligible sponsor → waitlist, not an error); invite state machine (7-day expiry, resend cap ≤3 / 24h cooldown); 9 typed §6.9 downstream contracts (projectToWP02..WP10).
- Access tier derives ONLY from §6.7 signals (auth source + sponsor/org), NEVER a commitment score — closes a payment bug where a sponsored user could be assigned a PAID tier. Live /api/onboarding/complete + /api/auth/register + the legacy determineAccessTier all route through assignAccessTierFromSignals. Tiers: FREE_ORG_LINKED/$0, FREE_PAID_EXTERNAL/$0, PAID_INDIVIDUAL/$297, ENTERPRISE/$25,000 (no $49/$199). RBAC: invite own-only for reps, tier admin-only. 571 tests.

## [2.0.0-build.T18] — BUILD PHASE — 2026-07-17
### T-18 — Seven Whys engine: Sonnet runtime, invisible >70 resonance gate as care, consent-off (WP01, QC 8.8)
- Sonnet-5 guided conversation (one question per turn, DI-mockable; missing ANTHROPIC_API_KEY throws with no non-Claude fallback).
- Hidden 0–100 resonance score gates progression at >70 but is INVISIBLE by construction (rendered-turn type has no score field; verified by key+JSON scan and mutation test). A ≤70 turn triggers a caring re-prompt, never a failure/score message.
- Anchor statement composed, doctrine-vocabulary-guarded, AES-256-GCM encrypted at rest (WHY_SESSION_ENCRYPTION_KEY, fail-closed). use_in_outreach_consent defaults false at schema/create/update; only an explicit setter flips it.
- Any anchor routed toward outreach passes through the CFE (fail-closed; consent-false short-circuits; only a released verdict allows). 508 tests.

## [2.0.0-build.T17] — BUILD PHASE — 2026-07-17
### T-17 — WP01 onboarding core: identity gate, 5 roles, org gate, solution-number, tracks A/B/D (QC earned 9.0/10, 1 QC loop) — first Wave 2 unit
- Fail-closed master identity gate (401/403, no coercion); only GATED_COMPLETE onboarding status unlocks downstream.
- Five roles + DUAL: canInPersona decomposes DUAL to the active persona's base role (no REP∪UPLINE bleed); PersonaScopedStore partitions rep- vs upline-persona data; §17.2 self-review escalation.
- Org gate locks the §17.1 branch (PRIMERICA vs universal); data-layer Primerica-leak tripwire matches raw + normalized text (catches mixed-case + camelCase field names); universal users are Primerica-free by construction.
- Solution-number: 7-digit format-check only, verified=false, masked, encrypted at rest, never logged/echoed/trusted-as-auth; a valid number cannot buy the Primerica branch (only org_type does). Legacy 6-8-digit validator retired (delegates to the authoritative 7-digit check); legacy OrgType/AccessTier enums retired to the Prisma enums.
- Tracks A/B/D state-machine shells with the T-13 licensing hard-block (only LICENSED clears; unlicensed/pre/expired route to compliance advisory). 486 tests.
- NOTE: end-to-end route-level gate enforcement (wiring these modules into WP02-WP10 routes + /api/auth/register solution-number encryption) is contracted to T-20.

## [2.0.0-build.T15] — BUILD PHASE — 2026-07-16
### T-15 — Breach notification & incident response, GDPR 72h (WP11, QC earned 9.1/10) — FINAL WP11 unit
- SecurityEvent correlation: weighted 60-min sliding-window classifier declares an incident at threshold; a lone breach_incident declares alone. Deterministic.
- GDPR Art.33 72-hour clock: starts for every breach class except (human-triaged) NOT_PERSONAL_DATA (fail-toward-caution); missing start reports maximally urgent (never "no clock"); freezes at notification; late notification recorded as late. Un-triaged breach can never be silently dropped.
- Incident runbook state machine (DETECTED→TRIAGED→CONTAINED→NOTIFIED→RESOLVED) with a hard "notify before resolve" guard for clock-applicable breaches. RBAC: incident_response is RVP/ADMIN only via the §16.6 matrix.
- Append-only IncidentEvent ledger (current state = read-time projection, no mutable status column), mirrored into T-10's hash-chained audit store. SecurityEvent bridge is a pure decorator (T-12's security-event.ts byte-unchanged). Additive schema (IncidentEvent) + migration. 423 tests.
- Completes WP11 (compliance) — all 7 units (CFE, audit, data-rights, account-security, licensing, RBAC, incident-response) now in trunk.

## [2.0.0-build.T12] — BUILD PHASE — 2026-07-16
### T-12 — Account security: MFA/TOTP, rate limiting, credential-stuffing, session-hijack defense (WP11, QC earned 9.25/10, 1 QC loop)
- Real RFC 6238 TOTP (otplib), secret AES-256-GCM at rest, fail-closed without MFA_ENCRYPTION_KEY; single-use bcrypt-hashed recovery codes.
- Step-up MFA freshness is bound to a SERVER-side single-use proof (User.mfa_stepped_up_at, atomic compare-and-swap consume) — the jwt callback ignores any client-supplied timestamp, closing a self-certification bypass. All /api/auth/mfa/* and /api/auth/session/* routes wrapped in withSessionSecurity; re-enrolling a second factor requires fresh step-up.
- Rate limiting (per account+IP, sliding window, exponential backoff) FAILS CLOSED on store error; credential-stuffing defenses (offline breached-password screen, success-only anomaly scoring, non-enumerating hashed keys, timing-equalized login).
- Session-hijack defense: device-fingerprint binding, 30-min idle + 12h absolute lifetime, security_version "sign out everywhere" revocation. SecurityEvent emitted at every decision point. Additive schema (User.security_version, User.mfa_stepped_up_at) + migrations. 364 tests. NOTE: in-memory rate/session stores must be swapped for a shared store (Redis) before multi-instance deploy — tracked T-R5.

## [2.0.0-build.T10] — BUILD PHASE — 2026-07-16
### T-10 — Immutable append-only audit store, hash-chained (WP11, QC earned 9.2/10)
- Append-only AuditRepository/AuditService — NO update/delete API on audit rows (verified codebase-wide); InMemory rows frozen; duplicate-id append rejected.
- SHA-256 hash chain + monotonic sequence: verifyChain detects any in-chain mutation (hash mismatch) or deletion (sequence gap / broken prev_hash). Tail-truncation resistance left to a future external anchoring checkpoint (getChainHead/Tail hooks provided) — documented.
- Durable sinks funnel CFE / licensing / data-rights events via their UNCHANGED interfaces (no edits to engine/licensing/data-rights). FINRA regulation tag preserved with priority so T-11's legal-hold carve-out query still matches.
- Rep-visible Activity Ledger, RBAC-scoped via the T-14 §16.6 matrix (own-scope always; cross-user via can(compliance_audit,read); downline resolver fail-closed). Additive schema (sequence/prev_hash/entry_hash + CFEOutcome.RECORDED) + migration. 273 tests.

## [2.0.0-build.T11] — BUILD PHASE — 2026-07-16
### T-11 — Data-rights: complete PII deletion sweep (WP11, QC earned 9.1/10, 3 QC loops)
- Right-to-erasure now scrubs ALL 12 user-owned PII models (User incl password_hash/image, Contact, ContactInteraction, OnboardingSession, WhySession, WarmMarketExercise, Message, DraftMessage incl cfe_classifier_data, UplineInvite recipient_email (direct + cross-user), LicensingRecord.license_number, AgentRun narrative fields, Milestone.shareable_asset_ref) — verified by an independent full-schema audit (no PII model missed).
- FINRA-tagged AuditEntry rows are never deleted (regulatory carve-out); an active LegalHold blocks all scrubbing (deletion held, nothing touched); deletion certificate honestly lists only models actually scrubbed.
- Retention schedules per §16.3 category; RBAC-gated legal-hold place/lift (ADMIN+RVP); CSV formula-injection guard on export. Integrated with the T-14 §16.6 Role. 211 tests.

## [2.0.0-build.T14] — BUILD PHASE — 2026-07-16
### T-14 — Authoritative §16.6 RBAC matrix enforcement (WP11, QC earned 9.35/10)
- src/lib/auth/rbac-matrix.ts encodes all 9 §16.6 rows as resource×action×role data; can(role,resource,action) is fail-closed (unknown resource/action/role all deny, ADMIN included — no implicit bypass).
- Downline raw-PII / conversation content is audited-only: the grant table is empty for everyone incl ADMIN; the sole path is canAccessDownlinePIIAudited(role, auditContext). Cross-org access for RVP is gated behind admin approval.
- requireCapability/withCapability extend T-04's requireRole/withRole. The older compliance ROLE_PERMISSIONS is now DERIVED from the matrix (one source of truth); data_rights:manage remains ADMIN+RVP only.
- Retired the stale 6-value compliance Role type (removed the spec-retired EXTERNAL) in favor of the Prisma Role enum. 218 tests.

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
