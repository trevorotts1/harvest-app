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
The Warm Market & Contact Engine (Universal) must deliver a seamless ingestion framework that handles native mobile synchronization for both iOS and Android, robust desktop and CSV import capabilities complete with field-level mapping, and a streamlined manual contact entry pipeline. Central to this deliverable is a high-fidelity contact database built on relationship-first segmentation taxonomy rather than superficial lead-list categorization. The system must perform exhaustive deduplication and normalization on all ingested data, populate high-confidence contact scoring signals, and implement memory jogger structures that remain contextually accessible to the user. A critical deliverable is the Hidden Earnings Estimate, calculated using relationship strength and industry benchmarks, strictly wrapped in safe-harbor framing to avoid prohibited income guarantees. All data must be encrypted both at rest and in transit, with full privacy compliance achieved via consent-gated processing and documented data export/deletion paths, ensuring full alignment with the security protocols defined in WP11 Data Classification.

### Checkpoints — Verify Each Before Scoring
- [ ] Native mobile contact ingestion (iOS/Android address book sync) functional
- [ ] Desktop and CSV import flows functional with field mapping
- [ ] Manual contact entry flow functional
- [ ] Deduplication and normalization logic verified — no duplicate contacts after import
- [ ] Contact scoring signals defined and producing meaningful differentiation
- [ ] Hidden Earnings Estimate computed correctly based on relationship strength and industry benchmarks
- [ ] All contact data encrypted at rest and in transit per WP11 requirements
- [ ] Privacy-aware handling enforced: consent-gated processing, rights export/delete paths defined
- [ ] Contact-to-prospect pipeline stages operational for all segments
- [ ] Relationship-first segmentation taxonomy implemented — contacts are categorized by trust and relationship strength, not lead-list scoring
- [ ] Memory jogger structures defined and accessible within contact context to help user recall relationship details
- [ ] Hidden Earnings Estimate always displays with safe-harbor framing — never presented as guarantee or projected certainty
- [ ] No forbidden sales terms (prospect, lead, pitch, sales call, guaranteed income) appear in user-facing contact management interfaces
- [ ] Integration contracts for WP04 (agent feeds) explicitly defined with field names and formats
- [ ] Integration contracts for WP05 (message personalization) explicitly defined with field names and formats
- [ ] Contact data classified according to WP11 data classification rules — sensitivity levels assigned per field

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
The Harvest Warm Market Method (Primerica-Specific) is a proprietarily-engineered engine, requiring a hard security gate that renders all functionality absolute-zero invisible for users outside of a Primerica organization. The deliverables include fully functional, state-persistent exercises (Blank Canvas, Qualities Flip, Background Matching) that utilize complex scoring and ranking logic to transform universal contact data from WP02 into high-priority action queues. The core deliverable is the automated, intervention-free feeding of these queues into WP04 (agents) and WP05 (messaging), ensuring that all outreach framing is relationship-first and service-first—strictly avoiding cold-sell or pressure-based tactics. It must strictly adhere to compliance constraints defined in WP11 for all method-generated content and provide clean, consumable data contracts to WP08 (taprooting/timeline). The integrity of this method relies on total Primerica-only visibility, with any leakage into the non-Primerica experience constituting a critical failure.

### Checkpoints — Verify Each Before Scoring
- [ ] Hard gate verified: all WP03 functionality completely hidden when org_type != Primerica
- [ ] Blank Canvas exercise fully implemented with state persistence
- [ ] Qualities Flip exercise fully implemented with state persistence
- [ ] Background Matching exercise fully implemented with scoring/ranking logic
- [ ] Method progression state machine defined with clear stage transitions
- [ ] Prioritized action queue generated from method outputs — ranked by relationship strength and match quality
- [ ] Action queue feeds agent (WP04) and messaging (WP05) queues without manual intervention
- [ ] Universal contact data from WP02 is correctly ingested and transformed by method logic
- [ ] No method content or Primerica-specific UI elements leak into universal (non-Primerica) experience
- [ ] Method-generated outreach framing is relationship-first and service-first — not cold-sell or pressure-based
- [ ] Compliance constraints from WP11 applied to all method-generated scripts and content
- [ ] Outputs produce clean data contracts consumable by WP08 (taprooting/timeline)

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
The AI Agent Layer & Mission Control acts as the system's operational command, producing a fully deployed inventory of specialized autonomous agents (Prospecting, Nurture, Appointment, Re-engagement) each restricted by defined role-specific responsibilities. Mission Control must output two distinct, high-fidelity views: the Rep view, delivering a contextually grounded daily briefing integrated with real-time pipeline data, and the Upline view, offering performance metrics, pace indicators, and coaching surfaces. The deliverables include the active command layer logic that manages agent task execution without passive CRM characteristics, inactivity detection systems triggering Three Laws corrective nudges, and appointment-setting agents that robustly verify handoffs with dual-calendar availability. All agent-generated content must pass through, and be produced within, the CFE compliance interception path, and all agent event pipelines must integrate with contact signals from WP02 and provide valid integration payloads for WP05, WP07, and WP09. The system must operate within the strict cognitive load limits defined by the 2 Hour CEO construct.

### Checkpoints — Verify Each Before Scoring
- [ ] Full agent inventory deployed: Prospecting Agent, Nurture Agent, Appointment Agent, Re-engagement Agent
- [ ] Each agent has defined role-specific responsibilities and action boundaries
- [ ] Mission Control provides Rep view with daily briefing, action queue, and momentum indicators
- [ ] Mission Control provides Upline view with team oversight, pace indicators, and coaching surfaces
- [ ] Mission Control behaves as active command layer — not passive CRM reporting
- [ ] Daily briefing generation operational and contextually grounded in real contact/pipeline data
- [ ] Inactivity detection triggers re-engagement logic per Three Laws monitoring rules
- [ ] Three Laws corrective nudges fire on neglect — verified with test scenarios
- [ ] Appointment-setting agent handoff logic verified with dual-calendar availability checks
- [ ] Appointment scheduling contracts are compatible with WP09 calendar architecture
- [ ] Role visibility surfaces maintain strict data integrity — no cross-role data leakage
- [ ] All agent-generated content passes through CFE compliance interception path before delivery
- [ ] Event pipelines correctly consume contact and warm-market signals from WP02
- [ ] Integration contracts for WP05, WP07, and WP09 are explicitly defined and consumable
- [ ] No manual-heavy workflows that violate 2 Hour CEO bounded cognitive load constraints

### Written Feedback to Sub-Agent (Required If Failing)

### Edge Case Tests

### What a Failing Result Looks Like
Agents fail to execute autonomously; Mission Control shows incorrect or missing data; Three Laws monitoring fails to detect neglect; appointment setting logic misfires.

### Critical Failure Conditions — Loop Immediately Regardless of Score
- [ ] Agent data leakage across roles.

### Scoring
Score: ___ / 10
Pass threshold: 8 or above with no critical failures
Result: [ ] PASS  [ ] FAIL (Attempt ___ of 3)

## QC Block — WP05: Messaging Engine & Outreach System
Code Written By: Ollama GLM 5.1 (thinking: High)
QC Performed By: Ollama Kimi 2.6 (thinking: High)

### What Correct Completion Looks Like
The Messaging Engine & Outreach System must deliver the absolute security of a synchronous CFE interception gate, which physically prevents *any* outbound message (SMS, email, or in-app) from being sent without passing compliance review. Deliverables include a robust messaging transport engine with verifiable delivery confirmations, intelligent channel routing logic that dynamically selects the channel based on contact preferences and availability, and content generation logic that rigorously avoids brand-doctrine forbidden terms while actively substituting prohibited language with service-first, doctrine-approved alternatives. The system must produce automated cadence rules maintaining pacing guidelines, integrated Upline-to-Rep-to-Three-Way communication flows with state-tracked interaction, and comprehensive response-state handling that autonomously updates agent behavior based on recipient replies. It must demonstrate full TCPA/CAN-SPAM/GDPR/CCPA compliance including capture and opt-out workflows, consistently apply Hidden Earnings safe-harbor framing, and supply valid telemetry data for reporting outcomes.

### Checkpoints — Verify Each Before Scoring
- [ ] CFE synchronous interception gate functional on ALL outbound content — no message can be sent without passing through CFE
- [ ] Messaging engine handles SMS channel reliably with delivery confirmation
- [ ] Messaging engine handles email channel reliably with delivery confirmation
- [ ] Messaging engine handles in-app channel reliably
- [ ] Channel routing logic correctly selects channel based on contact preferences and availability
- [ ] Script generation respects brand doctrine vocabulary: no forbidden terms
- [ ] Service-first language transformation applied to all generated scripts
- [ ] Cadence rules enforce pacing guidelines — no over-messaging or spam-like behavior
- [ ] Rep to Upline to Three-Way handoff flows work seamlessly with state tracking
- [ ] Performance telemetry hooks capture outreach outcomes for reporting
- [ ] Forbidden-term replacement logic actively substitutes prohibited language (prospect, lead, pitch, sales call, guaranteed income) with doctrine-approved alternatives in all generated scripts
- [ ] Upline review path for flagged content (CFE risk score 11–70) is functional — flagged messages route to upline for manual review before send
- [ ] 48-hour escalation rule implemented: flagged content unreviewed after 48 hours escalates to compliance officer
- [ ] TCPA/CAN-SPAM consent and opt-out flow behavior implemented for SMS and email channels
- [ ] GDPR/CCPA data rights reflected in messaging opt-out and data deletion flows
- [ ] Hidden Earnings language in any outreach message always carries safe-harbor framing — never presented as guarantee
- [ ] Response-state handling tracks contact replies and adjusts agent cadence behavior accordingly
- [ ] Integration contracts from WP04 (agent intent/action payloads) correctly consumed — field names and formats match WP04 output spec

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
The Social, Content & Launch Kit generation system must produce fully compliance-safe, branded launch content that operates within strict CFE gates before any social publication. Deliverables include highly personalized rep-identity assets that leverage individual, not generic, templates; dynamically generated, platform-adapted post/caption scaffolds across all supported social networks; and sharing mechanics that prioritize community-building movement-led tone over follower-chasing growth-hacking behavior. The system must actively block any content displaying anti-hustle behavior or spam-style patterns, maintain Mission Control reporting hooks for both publishing activity and engagement metrics, and enforce strict timezone-aware content scheduling that respects user-set consent and boundary conditions. All generated content must automatically embed mandatory disclosures per WP11 requirements, and ensure no forbidden sales terminology exists in any published asset.

### Checkpoints — Verify Each Before Scoring
- [ ] Launch content generation operates within compliance boundaries — all content passes through CFE before publication
- [ ] Rep-identity content personalization active — assets reflect individual rep identity, not generic templates
- [ ] Channel-adapted post/caption scaffolds generated for each target platform
- [ ] Sharing mechanics functional across supported platforms
- [ ] Movement-led tone enforced: community-building framing, not follower-chasing or growth-hacking behavior
- [ ] Anti-hustle/spam behavior detection active — blocks content that drifts toward prohibited patterns
- [ ] Mission Control reporting hooks for social activity and engagement functional
- [ ] Launch-kit packaging rules defined and asset-state tracking operational
- [ ] Mandatory disclosures from WP11 embedded in all publishable social content
- [ ] No forbidden sales terms in any generated social content
- [ ] Content scheduling logic respects timezone and consent constraints

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
The Accountability, Gamification & Motivation system must deliver a belief-first intervention architecture that actively monitors and reports progress against the Three Laws composite model from WP04. Deliverables consist of a functional 48-hour momentum countdown, a celebration engine that triggers exclusively on verifiable, honest milestones rather than inflated events, and a belief-restoration system that proactively detects low-belief states to intervene *before* attempting work-related nudges. To reinforce team health, the system must deploy anti-hoarder and wealth distribution fairness metrics, and ensure all motivational notifications are compliant with WP11's privacy/consent and timezone logic. This engine must prohibit manipulative earnings-phrased motivation without complete safe-harbor language injection, strictly forbid exploitative or shame-based gamification, and produce high-fidelity event/milestone outputs consumable by the taprooting/timeline system defined in WP08.

### Checkpoints — Verify Each Before Scoring
- [ ] 48-hour momentum countdown tracking functional and visible to rep
- [ ] Momentum score calculation matches Three Laws composite model from WP04
- [ ] Celebration engine triggers on actual milestones — not hollow or inflated events
- [ ] Belief-first intervention active: detects low belief state and triggers restoration before pushing work actions
- [ ] Anchor/goal reinforcement explicitly tied to Seven Whys outputs from WP01
- [ ] Collective uplift framing enforced: team-level wins prioritized over individual hustle metrics
- [ ] Anti-hoarder/wealth distribution fairness metrics enabled where applicable
- [ ] Motivational notifications respect privacy, consent, and timezone logic per WP11
- [ ] No earnings-phrased motivation without safe-harbor framing
- [ ] No exploitative or shame-based gamification patterns implemented
- [ ] Role-based leaderboard visibility respects authorized boundaries — no cross-team leakage
- [ ] Activity data consumed from WP04 agent events and WP05 messaging boundaries
- [ ] Nudges based on actual agent activity data — not arbitrary timers
- [ ] Outputs produce milestone/event data consumable by WP08 (taprooting/timeline)

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
The Taprooting, Timeline & Primerica-Specific Features engine must guarantee absolute hard-visibility gating, rendering all organizational features completely hidden for non-Primerica users. The deliverable is a high-performance taprooting visualization system that dynamically maps the Primerica organizational hierarchy based on real-time activity and growth metrics, coupled with a 30-day phased timeline engine that unlocks developmental milestones exclusively through verifiable activity outcomes instead of arbitrary chronological time. The system must embed robust, context-sensitive objection-handling structures specifically tailored for Primerica conversational contexts, consume and integrate both warm-market outputs (from WP03) and motivation/event signals (from WP07), and provide seamless data integration for the upline/team schedule (from WP09). The entire package must maintain full compliance with regulatory content constraints per WP11 and guarantee zero reliance on external Primerica API dependencies to ensure system sovereignty.

### Checkpoints — Verify Each Before Scoring
- [ ] Absolute hard gate verified: no WP08 functionality visible unless org_type = Primerica
- [ ] Taprooting visualization correctly renders organizational hierarchy tree
- [ ] Visualization updates dynamically based on team activity and growth
- [ ] 30-day phased timeline mechanics implemented with correct stage sequencing
- [ ] Milestone unlock logic based on actual activity metrics — not time-based auto-unlocks
- [ ] Objection-handling integration points functional and contextually appropriate
- [ ] Primerica-specific progression logic correctly consumes WP03 warm-market outputs
- [ ] Primerica-specific progression logic correctly consumes WP07 motivation/milestone events
- [ ] Team calendar/upline context from WP09 integrated where timeline logic needs schedule data
- [ ] Integration with daily briefing (WP04) functional — timeline status appears in Mission Control
- [ ] Role-tailored visibility enforced: upline sees team tree, rep sees own progression
- [ ] No guaranteed timeline or earnings claims in milestone language
- [ ] Compliance constraints from WP11 applied to all Primerica-specific language and content
- [ ] No dependency on any external Primerica API for identity or verification data

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
The Team Calendar & Upline Dashboard system must deliver a verified, robust hierarchical calendar rendering that correctly reflects the upline/team relationship structure. The central deliverable is an appointment-setting logic engine that strictly forbids double-booking via real-time identification of shared availability windows and robust conflict detection between appointment requests and existing calendar state. The dashboard must offer privacy-compliant, role-specific visibility (based on WP11 RBAC), providing RVP/Upline oversight without enabling the privacy-violating exposure of private rep schedule details. The deliverable includes attendance and pace indicators reflective of actual team activity, real-time schedule-state integration with the agent mission-control (WP04) event pipeline, and schedule-based timeline status integration (WP08). The architecture must strictly uphold privacy boundaries and demonstrate low-friction interaction design compliant with the 2 Hour CEO constraint.

### Checkpoints — Verify Each Before Scoring
- [ ] Upline/team calendar hierarchy renders correctly based on role relationships
- [ ] Dual-calendar overlap detection functional — identifies shared availability windows
- [ ] Appointment booking strictly forbids scheduling if either party is busy — no double-booking possible
- [ ] Appointment routing rules match WP04 agent appointment-setting contracts
- [ ] Attendance visibility indicators operational and updating in real time
- [ ] Pace indicators operational and reflecting actual team activity
- [ ] Upline dashboard surfaces accurate data from Mission Control (WP04)
- [ ] Privacy rules enforce RBAC settings from WP11 — no unauthorized calendar viewing
- [ ] Schedule-state integration with WP04 mission-control event pipeline verified
- [ ] Role-based schedule access matrix enforced: rep sees own, upline sees team, RVP sees org
- [ ] No private schedule details exposed cross-team or cross-role without entitlement
- [ ] Calendar data feeds WP08 where timeline/milestone logic needs schedule context
- [ ] 2 Hour CEO constraint respected: calendar interactions are low-friction

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
The Payment & Subscription Infrastructure must deliver immediate, fool-proof gating of system functionalities based on the user's assigned access tier (Free, Org-linked, Paid) as determined at the point of onboarding (WP01). Deliverables include a robust Stripe checkout flow fully integrated via secure webhooks to manage the entire subscription lifecycle—including the immediate revocation of paid-tier feature access when a payment lapses, and the immediate, seamless restoration upon successful re-subscription. The system must support and correctly test all failure modes, such as grace periods, to appropriately escalate access restrictions without causing user churn while protecting the platform's revenue. Data privacy in this WP is paramount, as payment data must adhere to PCI-DSS standards, and the infrastructure must be integrated robustly with WP11 to ensure privacy compliance. The ultimate requirement is an immediate, foolproof barrier blocking non-paying users from paid features, ensuring the entire commercial integrity of the Harvest application hinges on these payment-gating mechanisms.

### Checkpoints — Verify Each Before Scoring
- [ ] Access tier assignments match onboarding seed state from WP01: org-linked free vs. external paid
- [ ] Three-tier model implemented correctly: Free, Org-linked, Paid
- [ ] Stripe checkout flow functional for new paid subscriptions
- [ ] Stripe webhook integration robust — handles all subscription lifecycle events
- [ ] Subscription state machine covers: active, past_due, grace_period, revoked, restored
- [ ] Failed-payment handling triggers appropriate alerts and grace period
- [ ] Grace period behavior correctly defined: duration, feature access during grace, escalation
- [ ] Revocation behavior immediately restricts feature access when grace period expires
- [ ] Restoration flow allows seamless re-subscription without data loss
- [ ] Tier-gating operational and immediate upon state change — no delay between payment lapse and access restriction
- [ ] Entitlement checks correctly reference WP01 access-tier seed state
- [ ] Security of payment data compliant with PCI requirements per WP11
- [ ] No raw payment instrument data stored outside Stripe-sanctioned paths
- [ ] Admin/upline billing status visibility respects role boundaries — only authorized roles can see billing data
- [ ] Primerica-specific visibility not gated through billing checks — organizational gating governs that (from WP01)

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
The Data Privacy, Security & Compliance Architecture must act as the absolute, non-advisory standing infrastructure gate (CFE) through which *all* user-facing data interactions and outbound conveyances must pass. Deliverables include the implementation of five specific content classifiers (Income Claim, Testimonial, Opportunity Statement, Insurance Recommendation, Referral Request) enforced by hard block/review thresholds; an immutable audit trail system that captures all AI-generated content decision-making logs; fully enforced at-rest and in-transit data encryption; and comprehensive user data retention/deletion lifecycles governed by regulatory requirements. The WP must include functioning data export, delete, and rectify workflows, strict capture of consent-based lawful foundations, and a parameterized compliance framework that allows for dynamic rule updates (such as forbidden word lists) without requiring code modifications, ensuring the system *blocks* (rather than falls back to) all outbound communications if compliance systems detect failure.

### Checkpoints — Verify Each Before Scoring
- [ ] RBAC permission matrix enforced for all data access — verified against WP01 role model
- [ ] CFE implemented as standing infrastructure block — synchronous gate, not advisory or post-hoc moderation
- [ ] Data encryption enforced at rest and in transit — verified for all data stores
- [ ] Retention and deletion logic functional with defined schedules and automated execution
- [ ] User data rights workflows operational: export, delete, rectify
- [ ] Forbidden word/term lists enforced across all packages that generate user-facing content
- [ ] CFE five classifiers verified by name: Income Claim, Testimonial, Opportunity Statement, Insurance Recommendation, Referral Request — all five must be operational
- [ ] CFE risk scoring threshold behavior verified at all three tiers: 0–10 auto-deploys with audit log entry, 11–70 flags for upline manual review with 48-hour escalation to compliance officer if unreviewed, 71–100 physically blocks content and returns HTTP 403 to the requesting agent
- [ ] Audit trail is immutable — log entries cannot be edited, deleted, or overwritten after creation
- [ ] Audit logs capture all required fields per entry: content text, classifier scores, decision outcome, timestamp, and user context
- [ ] Consent capture present at every data collection point across all packages — not just onboarding
- [ ] No-sale contact-data policy enforced: contact data cannot be sold, exported to third parties, or repurposed beyond stated platform use
- [ ] Regulatory parameterization framework present: compliance rules for FINRA, FTC, state insurance, TCPA, CAN-SPAM, GDPR, and CCPA can be updated without code changes via versioned rule configuration
- [ ] No fallback behavior exists that sends content when CFE is unavailable — if CFE is down, all outbound content is blocked system-wide until CFE is restored
- [ ] Pre-generation compliance constraints embedded in agent prompt templates for WP04, WP05, WP06, and WP07 — prohibited terms injected as negative constraints before content generation begins
- [ ] Safe-harbor language injection rules defined and verified for all contexts where Hidden Earnings, opportunity, or income language appears

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

### Final QC Deployment Configuration

Sub-Agents Deployed: 10–50 (scaled to application complexity and available capacity)
Model Assignment: All Final QC agents use Ollama Kimi 2.6 (thinking: High).
GLM 5.1 built all components. Kimi 2.6 tests them. Roles do not swap at Final QC.

### Edge Case Scenarios — Verify Each During Pressure Test

11. Edge case: Primerica user switches to non-Primerica organization mid-session — verify all Primerica-specific features (WP03, WP08) immediately hide and cannot be accessed.
12. Edge case: Payment lapses during active agent execution — verify feature gating from WP10 triggers immediately, active agents for paid-tier features halt gracefully, and user is notified.
13. Edge case: CFE service becomes unavailable mid-operation — verify all outbound content across WP04, WP05, WP06, and WP07 is blocked (not sent unfiltered). No message may leave the system while CFE is down.
14. Edge case: Dual-role user (simultaneous Rep + Upline) — verify both role surfaces render correctly in Mission Control without data bleed between the two views.
15. Edge case: Hidden Earnings Estimate computed for a contact with zero relationship data — verify safe-harbor disclaimer still displays, no NaN/undefined/null values shown, and estimate gracefully defaults or withholds rather than displaying erroneous numbers.

### Critical Failure Conditions for Final QC — Any One of These Causes Automatic Project-Level Fail

- Any Primerica-specific content visible to a non-Primerica user at any point in any flow
- Any outbound content delivered to any channel without passing through CFE
- Any unencrypted PII found in any data store
- Any payment instrument data stored outside Stripe-sanctioned paths
- Any sub-agent or process that modified a PRD .md file during the build
- CFE operating in advisory/monitor-only mode rather than as a standing synchronous block

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
