# Harvest QC Checklist

## 1. Task-Level QC Criteria

Each Work Package (WP) must satisfy the following specific criteria to pass QC.

## QC Block — WP01: Onboarding & Profile Engine
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
Exhaustive verification of identity architecture and enterprise gating is paramount. The system must correctly identify role (Rep, Upline, RVP, External User) and strictly gate Primerica-specific features from the moment the user authenticates. The 'Seven Whys' belief exercise must be fully functional and block further navigation if the user's commitment score falls below the required threshold, ensuring that only those truly prepared for the methodology proceed. Upline linkage and dual-role mapping must be active, accurate, and bidirectional, allowing for proper reporting structures. The onboarding wizard must handle varying network conditions, user drop-offs, and state persistence without failing. Furthermore, the system needs to validate that tier seeds—whether they are free org-linked accounts or paid consumer accounts—are assigned correctly based on the authentication source. Any failure to strictly segment user data based on their organizational affiliation represents a major architectural flaw, especially concerning the Primerica-specific methodology access which must never leak to non-Primerica users, establishing the root of the secure data architecture.

### Checkpoints — Verify Each Before Scoring
- [ ] Organization gate correctly branches Primerica vs. Non-Primerica as hard architecture (not content toggle or feature flag)
- [ ] All four roles defined with explicit visibility boundaries: Rep, Upline/Field Trainer, RVP/Org Leader, External Non-Primerica
- [ ] Dual-role (simultaneous Rep + Upline) is structurally supported — not treated as edge case
- [ ] Solution number is user-declared and format-validated only — no external API dependency exists anywhere in the flow
- [ ] Seven Whys workflow enforces minimum completion threshold as a hard progression gate — cannot be skipped or bypassed
- [ ] Goal Commitment Card captures seed data that feeds downstream motivation systems (WP07)
- [ ] Time commitment/intensity calibration is present and feeds 2 Hour CEO operating mode
- [ ] Upline linkage and invitation model is fully defined with explicit invite flow
- [ ] Calendar connection entry points are defined with contracts compatible with WP09
- [ ] Profile schema includes all fields required by downstream packages (WP02, WP03, WP04, WP05, WP09, WP10)
- [ ] Access-tier seed state correctly distinguishes org-linked free from paid external
- [ ] State transition map exists for onboarding completion and all downstream unlocks
- [ ] No Primerica-specific feature screens are exposed beyond organization selection and gated flags
- [ ] No forbidden sales terms (prospect, lead, pitch, sales call, guaranteed income) appear in user-facing onboarding language
- [ ] Explicit consent capture and lawful basis tracking are present per WP11 requirements
- [ ] Data contracts for WP02, WP03, WP04, WP05, WP09, and WP10 are explicitly defined and consumable

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests
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
Structured relationship data must be present for all ingested contacts, ensuring a high-fidelity representation of the user's network. Native mobile/desktop ingestion, CSV import functionalities, and robust deduplication and normalization algorithms must pass exhaustive testing with dirty data sets. The Hidden Earnings Estimate must be calculated correctly based on relationship strength and industry benchmarks, providing the user with actionable insights while simultaneously maintaining the absolute confidentiality of the contact data. This entire pipeline must be engineered from the ground up to be privacy-compliant, with encryption enforced at rest. The system needs to support staged pipeline visualization for all segments, allowing users to see exactly where contacts are in the journey from initial ingestion through the 'Warm Market' qualification process. Ensuring data integrity despite varied source formats is crucial, as this data fuels the entire subsequent agent layer, making any ingestion or deduplication failure a systemic issue.

### Checkpoints — Verify Each Before Scoring
- [ ] Native/mobile and desktop ingestion ritual successful.
- [ ] CSV deduplication and normalization verified.
- [ ] Hidden Earnings Estimate logic calibrated and accurate.
- [ ] Contact data encrypted and privacy-compliant per WP11.
- [ ] Universal contact-to-prospect pipeline stages operational for all segments.
- [ ] Duplicate management system operational.
- [ ] Contact field mapping matches standardized schema.
- [ ] Contact ingestion speed within performance thresholds.
- [ ] Edge case: Extremely large CSV files handled.
- [ ] Edge case: Contacts with incomplete or non-standard formatting processed.
- [ ] Privacy controls applied on a per-contact basis.
- [ ] Data sanitization prevents injection attacks.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
Proprietary methodology (Blank Canvas, Qualities Flip, Background Matching) must be fully implemented and hard-gated specifically to Primerica organizations only. The system must ingest universal contact data and feed only authorized Primerica users into agent/messaging queues with the context provided by these methods. This layer must transform neutral contact lists into prioritized, context-aware action queues that honor the relationship-first focus of the methodology. It is imperative that this entire functional block be completely invisible to users of non-Primerica organizations, ensuring the proprietary nature of this specific technique. Furthermore, the methodology implementations need to be calibrated to produce outputs that genuinely reflect the 'Blank Canvas' philosophy, ensuring that conversational starters or action items derived are not generic but specific to the contact context. Any leak of these specific features to non-Primerica users constitutes a major security failure; additionally, any failure in the translation from method output to actionable queue items undermines the entire purpose of the Harvest system.

### Checkpoints — Verify Each Before Scoring
- [ ] Primerica-branch hard-gating verified; completely hidden for non-Primerica.
- [ ] Three-layer methodology (Blank Canvas, Qualities Flip, Background Matching) complete.
- [ ] Prioritized action queue generation based on method outputs functional.
- [ ] Outputs feed agent and messaging queues without manual intervention.
- [ ] Method output fidelity to brand doctrine verified.
- [ ] Edge case: Contact data mapping fails in method layer.
- [ ] Edge case: Primerica-Specific features trigger on non-Primerica users.
- [ ] Logic for 'Background Matching' handles sparse contact info.
- [ ] Performance of action queue generation from large contact lists.
- [ ] Persistence of methodology state across user sessions.
- [ ] Compliance filter integration for method-generated output.
- [ ] User feedback loop integration operational.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
The autonomous agent execution system must be fully operational, with specialized agents—Prospecting, Nurture, Appointment, etc.—executing their respective tasks with reliability and context awareness. Mission Control must provide a precise, high-fidelity view for both the Representative and the Upline, ensuring that data is surfaced correctly without unauthorized cross-role leakage. The Three Laws monitoring system must actively trigger corrective nudges when neglect is detected, ensuring agents remain on track even when the user is inactive. Appointment-setting logic must be thoroughly integrated with all calendar systems, allowing for seamless handoffs. Agents must be able to gracefully handle errors, retries, and context switching, demonstrating true autonomous behavior within the defined mission parameters. The system's ability to maintain role-based visibility while simultaneously allowing for upline oversight is technically complex and requires careful RBAC implementation. Any failure here directly affects the user experience, as the Mission Control dashboard is the central hub for the entire Harvest operational experience.

### Checkpoints — Verify Each Before Scoring
- [ ] Agent inventory fully deployed (Prospecting, Nurture, Appointment, etc.).
- [ ] Daily Mission Control briefing operational (Rep+Upline view).
- [ ] Three Laws monitoring triggers corrective nudges on neglect.
- [ ] Appointment-setting agent handoff logic verified.
- [ ] Role visibility surfaces maintain data integrity (no cross-role leakage).
- [ ] Agent-to-Agent communication flows correctly.
- [ ] Monitoring system handles high agent concurrency.
- [ ] Edge case: Agent fails to perform action due to API error.
- [ ] Edge case: User interaction conflicts with agent action.
- [ ] Mission Control reporting frequency matches requirements.
- [ ] Agent state recovery after system restart.
- [ ] Three-way appointment handoff tested end-to-end.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
Compliance-safe communication is the bedrock of this outreach system, and it must be operational without exception. Every single outbound message must pass through the CFE (Compliance Filter Engine) *before* being queued for transport, ensuring no non-compliant language, prohibited income claims, or unsafe interaction patterns ever reach a contact. The messaging engine itself must be multi-channel, robustly handling SMS, email, and in-app channels with consistent, doctrine-enforced vocabulary and a service-first tone that treats the recipient as an individual rather than a lead. This system requires sophisticated queue management to ensure that handoffs between the Representative, Upline, and Three-Way interaction stages appear natural and fluid to the end user. Messaging logic must strictly enforce cadence rules at all times to prevent spam-like behavior, and the CFE must be updated to detect even subtle deviations from the brand doctrine, particularly regarding income language constraints, making this a high-stakes, critical component of the overall architectural framework.

### Checkpoints — Verify Each Before Scoring
- [ ] CFE interception gate functional for ALL outbound content.
- [ ] Messaging engine handles SMS, email, in-app reliably.
- [ ] Script generation respects brand doctrine (income language constraints).
- [ ] Rep → Upline → Three-Way handoff flows work seamlessly.
- [ ] Cadence rules enforce pacing guidelines.
- [ ] Fallback mechanism for channel failures implemented.
- [ ] Dynamic variable injection (contact names, context) verified.
- [ ] Edge case: Message queue overflow scenario handled.
- [ ] Edge case: Invalid recipient contact info processed.
- [ ] Message threading integrity across channels.
- [ ] Compliance logs accurately map to original trigger events.
- [ ] Ability to pause outbound outreach via system controls.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
Social content and launch assets generated within compliance boundaries must feel authentic to the Representative's identity. The system needs to ensure that generated assets are branded according to the brand doctrine and that platforms are treated as community-building environments rather than merely platforms for spamming growth-oriented tactics. The compliance interception layer must be active for all social publishing flows, blocking any content that drifts toward 'hustle culture' or prohibited follower-chasing behavior. All generated content should be reviewed against compliance constraints to ensure the Representative's voice remains the dominant force. The system must track interaction metrics through Mission Control to report on social activity effectiveness without violating the privacy of contacts or the Representatives. This WP acts as an external face of the Harvest system, and therefore, it is susceptible to regulatory scrutiny, requiring strict adherence to the defined compliance gates, language constraints, and community engagement protocols outlined during the earlier phases.

### Checkpoints — Verify Each Before Scoring
- [ ] Launch content generation respects brand doctrine.
- [ ] Rep-identity assets correctly generated and branded.
- [ ] Compliance interception layer active for social publishing.
- [ ] Mission Control reporting hooks for social activity functional.
- [ ] Anti-hustle/follower-chasing behavior detected and blocked.
- [ ] Asset management system (storage/retrieval) operational.
- [ ] Multi-platform asset formatting verified.
- [ ] Edge case: Content draft fails compliance review intermittently.
- [ ] Edge case: User manually attempts to override CFE.
- [ ] Brand doctrine keywords dynamically updated.
- [ ] Social content posting scheduled correctly.
- [ ] Link integrity verification for all outbound social links.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
Motivation systems must reinforce belief and active engagement, not superficial dopamine traps. They need to actively track momentum and reinforce belief throughout the user journey. The celebration engine must trigger appropriately on genuine milestones, providing meaningful reinforcement that aligns with the doctrine. Nudges based on actual agent activity data must be timely and intervention-focused—specifically targeting cases where detected low belief requires restoration. The system should incorporate metrics that actively discourage 'hoarder/extract' behavior in favor of fairness, effectively building a culture of positive reinforcement around actual activity and relationship-based success. The system needs to be sophisticated enough to distinguish between genuine effort and mere system interaction, basing its gamification not on gaming the metrics, but on accelerating the actual outcomes of the Warm Market method. This requires high-fidelity data feeds from previous WPs, making it highly dependent on the accuracy of the agent layer and messaging engine data signals.

### Checkpoints — Verify Each Before Scoring
- [ ] 48-hour momentum countdown and tracking functional.
- [ ] Momentum score calculation matches Three Laws composite model.
- [ ] Celebration engine triggers on actual milestones.
- [ ] Belief-first intervention (detect low belief → restore) functional.
- [ ] Anti-hoarder/wealth distribution fairness metrics enabled.
- [ ] Motivation nudges personalized to user progress.
- [ ] Data linkage from preceding agent activity verified.
- [ ] Edge case: User achieves multiple milestones simultaneously.
- [ ] Edge case: Motivation system triggers during user inactivity.
- [ ] Tracking of long-term belief consistency over time.
- [ ] Integration with Mission Control dashboard reporting.
- [ ] Gamification elements do not violate integrity constraints.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
The Primerica-only organizational visualization and activity-based unlocking systems must be fully operational and tightly integrated with the core Harvest platform. The 'Taprooting' logic, which renders organizational trees and developmental milestones, must be scientifically accurate based on the hierarchical structure of Primerica, ensuring both Representatives and Uplines can visualize the growth correctly. It is essential that this functional block remains completely gated, ensuring no organizational features are ever exposed to anyone outside of a Primerica organization. The milestone timeline must unlock features strictly based on verifiable activity metrics rather than time alone, reinforcing that activity is the prerequisite for growth within the methodology. The system requires complex data visualization, which must maintain high performance even when rendering large organizational trees, and robust objection-handling structures designed specifically for Primerica contexts need to be embedded throughout the user interactions within this WP. Any leak of these specific features to non-Primerica users constitutes a major security failure.

### Checkpoints — Verify Each Before Scoring
- [ ] Org = Primerica hard gate verified for all features.
- [ ] Taprooting visualization renders organizational tree correctly.
- [ ] Milestone timeline logic unlocks based on activity metrics.
- [ ] Objection-handling structures functional.
- [ ] Integration with daily briefing functional.
- [ ] Performance of large org tree rendering.
- [ ] Edge case: User moves between orgs/branches.
- [ ] Edge case: Rapid milestone progression triggering in batches.
- [ ] Data consistency between org visualization and taprooting.
- [ ] User-level permission constraints on org-tree visibility.
- [ ] Real-time updates of taprooting progress.
- [ ] Compliance verification of org-linked content.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
The Upline and Team visibility must be fully synchronized, providing a reliable, dual-directional view for all parties. The appointment-setting agent is the critical hinge, ensuring it absolutely forbids scheduling if either party has a conflict, necessitating robust real-time API integrations with all supported calendar systems. Oversight dashboards must be operational, privacy-compliant, and strictly follow the RBAC settings defined in WP11, ensuring Upline access is restricted appropriately as per the hierarchical design. The system should provide visibility into attendance and pace indicators, helping the Upline identify where the Representatives need support without drifting into micromanaging. The complexity lies in managing the synchronization between different calendar environments and ensuring that the appointment-booking agent does not introduce double-bookings or ignore scheduling constraints, making this WP a focal point for API-driven integration testing and robust privacy-enforcement logic.

### Checkpoints — Verify Each Before Scoring
- [ ] Upline/team calendar hierarchy and dual-overlap detection functional.
- [ ] Appointment booking forbids scheduling if either party is busy.
- [ ] Attendance visibility and pace indicators operational.
- [ ] Privacy rules respect RBAC settings from WP11.
- [ ] Upline Mission Control surfaces accurate.
- [ ] Real-time synchronization of calendar metadata.
- [ ] Integration with third-party calendar APIs verified.
- [ ] Edge case: Overlapping appointment requests handled cleanly.
- [ ] Edge case: API downtime during synchronization.
- [ ] RBAC enforcement on team dashboard views.
- [ ] Notification integrity for appointment updates.
- [ ] Audit trail for all appointment booking/modification events.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
The payment and subscription infrastructure must be engineered with absolute precision, ensuring that the tiers (Free vs. Paid) are assigned and gated immediately upon onboarding. When a user creates an account, identifying their onboarding type is mandatory to set the initial subscription state, with Stripe webhooks managing the entire subscription lifecycle—including revocation of access when a subscription lapses, and immediate restoration when payments are resumed. Failure behavior, such as grace periods, must be clearly defined in the system and rigorously tested under various failure conditions to avoid unnecessary churn while protecting the platform's revenue. Data privacy in this WP is paramount, as payment data must adhere to PCI-DSS standards, and the infrastructure must be integrated robustly with WP11 to ensure privacy compliance. The ultimate requirement is an immediate, foolproof barrier blocking non-paying users from paid features, ensuring the entire commercial integrity of the Harvest application hinges on these payment-gating mechanisms.

### Checkpoints — Verify Each Before Scoring
- [ ] Access tier assignments (Free vs Paid) match onboarding hierarchy.
- [ ] Stripe subscription management (webhooks, lifecycle) robust.
- [ ] Failure/grace period behavior defined and tested.
- [ ] Tier-gating operational and immediate upon state change.
- [ ] Security of payment data compliant with WP11.
- [ ] Automated user notification on subscription status change.
- [ ] Edge case: Stripe API webhook failure/message loss.
- [ ] Edge case: User upgrades/downgrades tier mid-billing cycle.
- [ ] Secure audit logging for payment transactions.
- [ ] Subscription management dashboard for admin/users.
- [ ] Handling of credit card expiries and payment failure.
- [ ] Audit compliance for payment data handling procedures.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
Governance is the foundation of the Harvest system, and it must effectively constrain all system behavior from the very start. The Compliance Filter Engine (CFE) is a standing, non-advisory layer that operates as a hard gate, actively blocking any violating content before it reaches a user interface or an outbound transport queue, whether SMS, email, or social media. RBAC enforcement must be absolute for all data access, including PII, sensitive contact information, and organizational trees. Every data handling action, particularly those involving AI interactions, must be fully logged for compliance auditability, ensuring a clear trail of decision-making. Data at rest *must* be encrypted using industry-standard protocols, and the processes for retention and deletion must strictly follow the defined compliance guidelines, particularly regarding the handling of forbidden word lists. This WP is the ultimate arbiter, and any failure here—particularly regarding the CFE's interception capability or the security of PII—invalidates the entire Harvest deployment.

### Checkpoints — Verify Each Before Scoring
- [ ] RBAC permission matrix enforced for all data access.
- [ ] Compliance Filter Engine (CFE) integration complete as a standing block.
- [ ] Proper audit logs generated for all AI content.
- [ ] Data encryption at rest and in transit active.
- [ ] Retention and deletion logic functional.
- [ ] Forbidden word lists enforced.
- [ ] Edge case: Attempted manual override of CFE.
- [ ] Edge case: PII leakage through AI training data.
- [ ] Audit trail integrity verification.
- [ ] Regular security/compliance scan periodicity set.
- [ ] Data portability/export request functionality operational.
- [ ] Compliance documentation dynamically updated from code.

### Written Feedback to Sub-Agent (Required If Failing)

 
### Edge Case Tests

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
