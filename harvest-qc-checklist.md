# Harvest QC Checklist

## 1. Task-Level QC Criteria

Each Work Package (WP) must satisfy the following specific criteria to pass QC.

## QC Block — WP01: Onboarding & Profile Engine
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Exhaustive verification of identity architecture and enterprise gating. The system must correctly identify role (Rep, Upline, RVP, External User) and strictly gate Primerica-specific features. The 'Seven Whys' belief exercise must be functional and block progression if the commitment score falls below the required threshold. Upline linkage and dual-role mapping must be active and correct.

### Checkpoints — Verify Each Before Scoring
- [ ] Org-gate logic (Primerica vs. Non-Primerica) verified and hard-gated.
- [ ] Seven Whys progression gate enforcement functional.
- [ ] Role-architecture verification for all four user types.
- [ ] Access tier seeds (free org-linked vs. paid) correct.
- [ ] Upline linkage data model active.
- [ ] Calendar connection entry points exposed.

### What a Failing Result Looks Like
Primerica-only features visible to non-Primerica users; Seven Whys skipped or score-gating ignored; incorrect role assignment or broken upline linkage.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Organization gating bypass allowing Primerica-specific features to leak.
- [ ] Upline linkage data corruption.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP02: Warm Market & Contact Engine (Universal)
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Structured relationship data must be present for all ingested contacts. Native mobile/desktop ingestion, CSV import, deduplication and normalization must pass testing. The Hidden Earnings Estimate must be calculated correctly based on relationship strength and industry benchmarks.

### Checkpoints — Verify Each Before Scoring
- [ ] Native/mobile and desktop ingestion ritual successful.
- [ ] CSV deduplication and normalization verified.
- [ ] Hidden Earnings Estimate logic calibrated and accurate.
- [ ] Contact data encrypted and privacy-compliant per WP11.
- [ ] Universal contact-to-prospect pipeline stages operational for all segments.

### What a Failing Result Looks Like
Failed deduplication resulting in contact duplicates; Hidden Earnings Estimate providing unrealistic or undefined values; contact data stored unencrypted.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Contact data unencrypted (Fatal violation of WP11 requirements).
- [ ] Mass contact leakage or incorrect segmentation.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP03: Harvest Warm Market Method (Primerica-Specific)
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Proprietary methodology (Blank Canvas, Qualities Flip, Background Matching) fully implemented and gated to Primerica organizations only. Must ingest universal contact data and feed into agent/messaging queues.

### Checkpoints — Verify Each Before Scoring
- [ ] Primerica-branch hard-gating verified; completely hidden for non-Primerica.
- [ ] Three-layer methodology (Blank Canvas, Qualities Flip, Background Matching) complete.
- [ ] Prioritized action queue generation based on method outputs functional.
- [ ] Outputs feed agent and messaging queues without manual intervention.

### What a Failing Result Looks Like
Primerica-only method visible to general users; method ignores universal contact data; action queue fails to feed into agent layer.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Primerica-specific features visible to non-Primerica users (Fatal Gating Failure).
- [ ] Method output results in cold-sell behavior rather than relationship-first framing.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP04: AI Agent Layer & Mission Control
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Autonomous agent execution system operational. Mission Control provides precise Rep and Upline views. Three Laws monitoring triggers corrective nudges correctly. Appointment-setting logic integrated with calendar systems.

### Checkpoints — Verify Each Before Scoring
- [ ] Agent inventory fully deployed (Prospecting, Nurture, Appointment, etc.).
- [ ] Daily Mission Control briefing operational (Rep+Upline view).
- [ ] Three Laws monitoring triggers corrective nudges on neglect.
- [ ] Appointment-setting agent handoff logic verified.
- [ ] Role visibility surfaces maintain data integrity (no cross-role leakage).

### What a Failing Result Looks Like
Agents fail to execute autonomously; Mission Control shows incorrect or missing data; Three Laws monitoring fails to detect neglect; appointment setting logic misfires.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Agent data leakage across roles.
- [ ] Failure of compliance interception for any agent-generated content.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP05: Messaging Engine & Outreach System
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Compliance-safe communication operational. Every outbound message passes through the CFE (Compliance Filter Engine). Messaging engine handles SMS, email, and in-app channels with consistent, doctrine-enforced vocabulary and service-first tone.

### Checkpoints — Verify Each Before Scoring
- [ ] CFE interception gate functional for ALL outbound content.
- [ ] Messaging engine handles SMS, email, in-app reliably.
- [ ] Script generation respects brand doctrine (income language constraints).
- [ ] Rep → Upline → Three-Way handoff flows work seamlessly.
- [ ] Cadence rules enforce pacing guidelines.

### What a Failing Result Looks Like
Message sent bypassing CFE; messages sent with prohibited income claims; message channel fails without fallback mechanism.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Content bypassing Compliance Filter Engine (Fatal Compliance Failure).
- [ ] Any content indicating prohibited income guarantees.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP06: Social, Content & Launch Kit
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Social content and launch assets generated within compliance boundaries. Rep-identity assets correctly utilized. Platforms treated as community-building environments.

### Checkpoints — Verify Each Before Scoring
- [ ] Launch content generation respects brand doctrine.
- [ ] Rep-identity assets correctly generated and branded.
- [ ] Compliance interception layer active for social publishing.
- [ ] Mission Control reporting hooks for social activity functional.
- [ ] Anti-hustle/follower-chasing behavior detected and blocked.

### What a Failing Result Looks Like
Content posted without CFE review; content utilizes generic templates instead of rep-identity assets; behavior drifts toward spammy growth hacking.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Social content bypassing Compliance Filter Engine.
- [ ] Content promoting prohibited "hustle culture" that violates identity doctrine.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP07: Accountability, Gamification & Motivation
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Motivation systems actively track momentum and reinforce belief. Celebration engine triggers appropriately on milestones. Nudges based on actual agent activity data.

### Checkpoints — Verify Each Before Scoring
- [ ] 48-hour momentum countdown and tracking functional.
- [ ] Momentum score calculation matches Three Laws composite model.
- [ ] Celebration engine triggers on actual milestones.
- [ ] Belief-first intervention (detect low belief → restore) functional.
- [ ] Anti-hoarder/wealth distribution fairness metrics enabled.

### What a Failing Result Looks Like
Celebrations trigger on hollow milestones; motivation system relies on generic dopamine-traps rather than doctrine; nudges miss agent activity signals.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Motivation system violating doctrine (e.g., reinforcing "hoarder/extract" behavior).
- [ ] Failure in belief-first priority (system nudges work before belief).

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP08: Taprooting, Timeline & Primerica-Specific Features
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Primerica-only organization visualization and activity-based unlocking operational. Taprooting logic correctly renders hierarchy and milestones.

### Checkpoints — Verify Each Before Scoring
- [ ] Org = Primerica hard gate verified for all features.
- [ ] Taprooting visualization renders organizational tree correctly.
- [ ] Milestone timeline logic unlocks based on activity metrics.
- [ ] Objection-handling structures functional.
- [ ] Integration with daily briefing functional.

### What a Failing Result Looks Like
Org features visible to non-Primerica users; milestone unlocks triggered without activity; taprooting visualization incomplete.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Primerica-specific feature leakage to non-Primerica users.
- [ ] Failure of hard organizational boundary control.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP09: Team Calendar & Upline Dashboard
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Upline and Team visibility fully synchronized. Appointment-setting agent ensures both parties are available. Oversight dashboards operational and privacy-compliant.

### Checkpoints — Verify Each Before Scoring
- [ ] Upline/team calendar hierarchy and dual-overlap detection functional.
- [ ] Appointment booking forbids scheduling if either party is busy.
- [ ] Attendance visibility and pace indicators operational.
- [ ] Privacy rules respect RBAC settings from WP11.
- [ ] Upline Mission Control surfaces accurate.

### What a Failing Result Looks Like
Agents schedule appointments despite conflicts; RBAC leakage allows unauthorized viewing of calendars; team visibility fails to update.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Privacy violation (unauthorized role calendar viewing).
- [ ] Scheduling double-bookings due to API failure.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP10: Payment & Subscription Infrastructure
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Payment tiers correctly assigned and gated to onboarding type (Free vs Paid). Stripe subscription management and lifecycle (revocation, restoration) working as defined.

### Checkpoints — Verify Each Before Scoring
- [ ] Access tier assignments (Free vs Paid) match onboarding hierarchy.
- [ ] Stripe subscription management (webhooks, lifecycle) robust.
- [ ] Failure/grace period behavior defined and tested.
- [ ] Tier-gating operational and immediate upon state change.
- [ ] Security of payment data compliant with WP11.

### What a Failing Result Looks Like
Users in wrong paid tier; subscriptions fail to revoke on lapse; payment failure alerts fail to trigger.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Payment data leakage (PCI violations).
- [ ] Failure to restrict features when subscription lapses.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP11: Data Privacy, Security & Compliance Architecture
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Foundation governance layer effectively constraining all system behavior. Compliance filter is a standing layer, not advisory. RBAC and data handling protocols enforced.

### Checkpoints — Verify Each Before Scoring
- [ ] RBAC permission matrix enforced for all data access.
- [ ] Compliance Filter Engine (CFE) integration complete as a standing block.
- [ ] Proper audit logs generated for all AI content.
- [ ] Data encryption at rest and in transit active.
- [ ] Retention and deletion logic functional.
- [ ] Forbidden word lists enforced.

### What a Failing Result Looks Like
Compliance filter engine as an advisory ("flagging" content but not blocking it); RBAC bypass; storage of unencrypted PII.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Storage of unencrypted PII (Major Security Breach).
- [ ] Failure of Compliance Filter Engine to intercept/block violating content.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)


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

## 6. PRD Pressure Test Protocol (8 Questions)

Run these 8 questions against the assembled PRD before final grading. Each must pass or the PRD fails.

| # | Question | Pass Criteria |
|---|----------|---------------|
| 1 | Are all 11 work packages scoped with no orphan functions? | All features map to a WP. No "general" bucket. |
| 2 | Is compliance a hard gate (physical block, not advisory)? | CFE blocks >70 risk. No override without escalation. |
| 3 | Does the critical spine sequence make logical sense? | WP11 → WP01 → WP02 → WP04 → WP05 flows correctly. |
| 4 | Are universal-vs-Primerica gates hard architecture? | Primerica features hidden when org != Primerica. |
| 5 | Are all outbound messages compliance-filtered? | Every WP05-WP07 message path goes through CFE. |
| 6 | Does the payment model match the 3-tier system? | Free/Org/Paid tiers map to feature access correctly. |
| 7 | Is the brand doctrine embedded, not decorative? | Doctrine terms appear in behavior definitions, not just prose. |
| 8 | Can Phase C begin from this PRD without gaps? | All dependencies resolved, no unresolved TODOs. |

## 7. Scoring Examples

**Example A — Passing Score (8.5/10):**
- WP01: Org-gate logic verified ✅
- WP11: CFE interception verified ✅
- Critical spine correct ✅
- Brand doctrine embedded ✅
- Minor issue: Missing edge case for "Primerica user enters non-Primerica solution number" → docked 0.5
- Minor issue: WP04 agent inventory listed but no agent count verified → docked 0.5
- Score: 4 + 3 + 2 + 0 - 0.5 - 0.5 = 8.0. Wait, let me recalculate: No missing requirements (4), compliance tight (3), code well-documented (2), edge cases mostly covered (0.5), total = 9.5 - 1.0 = 8.5 ✅

**Example B — Failing Score (5/10):**
- Missing WP08 Primerica-specific behavior gates → -1
- CFE not intercepting WP07 motivational content → Critical Failure → Auto-fail
- Score: FAIL due to Critical Failure (CFE bypass)

**Example C — Re-evaluation Score (8/10):**
- After loop revision: CFE integration fixed ✅
- All WPs scoped ✅
- Minor: RBAC table missing user-level permissions → -1
- Score: 4 + 3 + 1 + 0.5 = 8.5 - 0.5 = 8.0 ✅ (no critical failures)
