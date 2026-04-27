# The Harvest: 2 Hour CEO Business Agent — Master PRD
## Foundation Phase: Sections 1–3

---

## 1. Project Overview — Start with the End in Mind

### 1.1 Governing Instruction Hierarchy

This PRD is an AI-facing build constitution for **The Harvest: 2 Hour CEO Business Agent**. Every downstream planning, task decomposition, implementation decision, QA pass, and orchestration loop must obey the following authority order:

1. **AI Instructions v5** — governing operating system for how the PRD must be written, how the build must be orchestrated, how agents are used, how QC loops work, and how completion is judged.
2. **Complete Product Roadmap v5** — authoritative source for product scope, feature inventory, work-package definitions, sequencing constraints, and technical dependency payload.
3. **Brand Concept Document** — authoritative source for doctrine, mission, movement logic, glossary, positioning language, belief system, and product-philosophy constraints.

If these appear to conflict:
- Use **AI Instructions v5** to decide process and artifact structure.
- Use **Product Roadmap v5** to decide feature truth and dependency truth.
- Use **Brand Concept Document** to decide meaning, framing, terminology, emotional logic, and behavioral intent.
- Do not silently flatten conflicts. Resolve them explicitly in favor of the higher-order authority above.

### 1.2 End-State Definition

The product being specified is not "an app with automation." It is a **full-stack AI-operated business system for warm-market, downline-driven sales organizations** that converts a rep's existing relationship graph into a guided, compliant, measurable business engine.

The intended shipped Phase 1 end state is:

- A rep can onboard on web, iOS, or Android.
- The system identifies their organization and gates product behavior accordingly.
- The system converts the rep's contact universe into a structured warm-market pipeline.
- AI agents perform prospecting, nurturing, follow-up, reporting, scheduling, motivation, and re-engagement work on the rep's behalf.
- Mission Control presents the rep and upline with a command layer, not a passive CRM.
- Uplines receive visibility, intervention points, and calendar alignment needed to close.
- Primerica-specific behaviors remain hidden unless Primerica is selected.
- Compliance review is a standing infrastructure layer across all outbound content.
- Subscription and access logic distinguish free organizational access from paid external access.
- Product behavior reinforces the brand doctrine: the opportunity already exists in the user's phone, the system activates it, the business is built through service, and the movement logic is collective rather than purely individualistic.

The app must produce the lived outcome implied by the promise:

> Give us 30 minutes a day. We will run your business. You just show up to close.

This promise is not decorative copy. It is a systems requirement. Any architecture that shifts too much operational burden back to the rep violates the product definition.

### 1.3 Product Identity to Preserve in Build Decisions

The Harvest must be implemented as the first mainstream platform built for **Downline Maxxing**. This means the software is not optimizing only for isolated personal productivity. It is optimizing for:

- relationship activation
- team multiplication
- upline/downline visibility
- compounding warm introductions
- coordinated follow-up
- belief reinforcement
- network-level economic lift

Brand doctrine that materially affects behavior must be treated as implementation logic, not marketing garnish. At minimum, the following concepts must be embedded consistently across the PRD and later build:

- **Downline Maxxing** — maximize relationship-network compounding, not cold lead volume
- **Collective Benefit** — system incentives, visibility, and reporting must strengthen the team, not isolate the rep
- **Community Introduction** — outreach and referral logic should prefer warm relational bridges over impersonal selling behavior
- **Hidden Earnings Estimate** — product must make latent value visible, but always as potential rather than guarantee
- **Social 4.0 / People Compounding** — the product exists at the convergence of relationships, AI, CRM, and community-scale business growth
- **2 Hour CEO** — UX and agent behavior must minimize cognitive load and compress owner effort into short, high-leverage daily engagement windows

If a proposed feature implementation increases admin work, requires frequent manual babysitting, or makes the user act like a conventional CRM operator, it is off-doctrine and must be corrected.

### 1.4 Product Category Definition

The Harvest is:

- not a conventional CRM
- not a simple messaging tool
- not a course portal
- not only a rep dashboard
- not merely a warm-market calculator

It is a **Mission Control operating layer** over:
- onboarding identity and hierarchy data
- warm-market relationship data
- AI agent execution systems
- upline calendar and intervention systems
- messaging and compliance infrastructure
- motivation and accountability systems
- payment, privacy, and access governance

The correct mental model is: **business-in-a-box command system with autonomous execution agents**.

### 1.5 User System and Role Architecture

The product must serve four primary role types:

1. **Rep**
   - primary execution beneficiary
   - provides warm contacts, goals, availability, and onboarding context
   - receives daily Mission Control
   - appears at close-ready moments

2. **Upline / Field Trainer**
   - receives visibility into rep activity and pipeline
   - connects calendar
   - inherits closing responsibility
   - may require approval/review authority during early rep lifecycle

3. **RVP / Organization Leader**
   - receives team-wide visibility and configuration surfaces
   - controls master calendar layers and later command-center functions
   - sits above rep/upline flows as an organizational operator

4. **External Non-Primerica User**
   - gets universal warm-market and AI-agent product
   - does not see Primerica-only systems
   - defaults to paid subscription pathway unless/until valid org linkage rules say otherwise

The system must also support dual-role users who are simultaneously rep and upline. This is not edge behavior; it is structural.

### 1.6 Universal vs. Primerica-Specific System Law

A foundational architectural law of the product is **organization-conditional behavior**.

The platform is designed to serve any downline-driven organization, but the flagship use case is Primerica. Therefore:

- **Universal features** must work for all users.
- **Primerica-specific features** must remain completely hidden unless Primerica is selected.
- Hidden means hidden in:
  - navigation
  - backend access rules
  - agent flows
  - data requirements
  - language weighting
  - motivational systems
  - milestone systems
  - upline-linking logic where applicable

Primerica-only systems include, at minimum:
- Harvest Warm Market Method
- Taprooting
- Primerica-specific timeline/milestones
- Primerica-weighted quote engine behavior
- solution number workflows
- free-access org linkage logic tied to Primerica hierarchy assumptions

This conditionality is a hard architecture branch, not a content toggle.

### 1.7 The 11 Work Packages as the Product Backbone

The product roadmap must be realized through these 11 work packages, each retained as a distinct implementation domain inside the master PRD and later build plan:

1. **Onboarding & Profile Engine**
2. **Warm Market & Contact Engine (Universal)**
3. **Harvest Warm Market Method (Primerica-Specific)**
4. **AI Agent Layer & Mission Control**
5. **Messaging Engine & Outreach System**
6. **Social, Content & Launch Kit**
7. **Accountability, Gamification & Motivation**
8. **Taprooting, Timeline & Primerica-Specific Features**
9. **Team Calendar & Upline Dashboard**
10. **Payment & Subscription Infrastructure**
11. **Data Privacy, Security & Compliance Architecture**

No package may be treated as optional if it is in Phase 1 scope. The PRD must preserve each package's explicit responsibilities and the dependencies between them.

### 1.8 Dependency Truths That Govern the Build

The core dependency truths are:

- Onboarding/Profile architecture is the first major systems anchor.
- Data Privacy, Security, and Compliance is foundational and must constrain all later data and outreach design.
- AI Agent Layer and Mission Control must be defined before outreach/content behavior is finalized, because those systems are execution hosts for later features.
- Warm Market universal engine must exist before Primerica-specific warm-market logic can layer on top.
- Messaging cannot be finalized before compliance logic and agent boundaries are stable.
- Team Calendar depends on onboarding identity/hierarchy plus agent appointment logic.
- Payment depends on onboarding access tier logic.
- Primerica-specific later-phase package behavior depends on organization gating established at onboarding.

The practical critical spine is:

**Privacy/Compliance → Onboarding/Profile → Warm Market Universal → AI Agent Layer/Mission Control → Messaging/Outreach**

Secondary and tertiary systems branch from that spine only after it is stable.

### 1.9 Business Logic Assumptions That Must Be Preserved

The PRD and later implementation must preserve these project truths already established:

- Primerica has **no dependable accessible API** for this product's current build assumptions.
- Solution numbers are treated as **user-declared and format-checked**, not externally verified truth.
- MIT ratios are bounded context for earnings-estimate and IPA-value logic, not global architecture law.
- Brand philosophy is core logic, not optional copy.
- Compliance filtering is a standing layer, not a post-hoc moderation idea.
- The product is being specified now; the app itself is **not** being built in this phase.
- The PRD must be detailed enough that an AI build workforce could execute from it without human re-interpretation.

### 1.10 Compliance Interception Architecture

### Timing
Interception occurs at two points:
1. **Pre-generation:** Agent prompt templates contain embedded compliance rules (prohibited terms injected as negative constraints). This prevents non-compliant output at the source.
2. **Pre-send:** Every agent-generated message passes through the Compliance Filter Engine (CFE) as a synchronous gate before reaching any delivery channel.

### Enforcement
- Dedicated Compliance Filter Engine (WP11) with five classifiers: Income Claim, Testimonial, Opportunity Statement, Insurance Recommendation, Referral Request
- Risk scoring: 0-10 auto-deploy, 11-70 flag for upline manual review, 71-100 physically blocked
- Blocked content returns HTTP 403 to the agent — physically prevented from deployment

### Failure Handling
| Score | Action | Fallback |
|-------|--------|----------|
| 0-10 | Auto-deploy with audit log | — |
| 11-70 | Route to upline review queue | Escalate to compliance officer after 48hr |
| 71-100 | Physically blocked | Alert agent and compliance officer; content quarantined |

### Minimum Schema
```
ComplianceRule {
  ruleId: string
  classifier: IncomeClaim | Testimonial | Opportunity | Insurance | Referral
  confidenceThreshold: float (0.0-1.0)
  action: Pass | Flag | Block
  regulation: FINRA | FTC | StateInsurance | TCPA | CAN-SPAM | GDPR
  lastUpdated: timestamp
  parameterized: boolean  // true = updateable via config, false = code change required
}
```

### 1.10.1 Agent Integration Contract

Every AI agent in WP04–WP07 that generates outbound content MUST call the Compliance Filter Engine (CFE) as a synchronous gate BEFORE content delivery. The contract is:

1. **Pre-Generation:** Agent prompt templates embed compliance constraints as system-level directives. Prohibited terms (income guarantees, benefit claims, medical advice) are injected as negative constraints in the system prompt.

2. **Pre-Send:** After generation, agent calls CFE endpoint: `POST /api/v1/compliance/review` with payload `{content, channel, context}`. CFE returns one of:
   - `pass (0-10)`: Auto-deploy. Content sent to delivery channel.
   - `flag (11-70)`: Held in queue. Upline notified for manual review. Content NOT sent.
   - `block (71-100)`: Physically blocked. Agent receives HTTP 403. Content quarantined with full audit trail.

3. **Agent Response Protocol on CFE Block:**
   - Agent logs reason for block to audit trail
   - Agent generates alternative version with compliance issues corrected
   - Agent resubmits to CFE
   - If block persists after 3 attempts: content escalated to human compliance officer via notification

4. **CFE Timeout Behavior:**
   - CFE must respond within 2 seconds
   - If CFE is non-responsive: all outbound messaging PAUSED. No messages sent.
   - Agent queue enters safe-fail state: "Messaging paused pending compliance system"
   - Upline and system admin notified of compliance system downtime

5. **Audit Requirements:**
   - Every CFE review call logged: timestamp, agent_id, content_hash, risk_score, outcome, reviewer_id (if human)
   - Audit trail is immutable (append-only)
   - Full audit history available to compliance officers within Mission Control

### 1.11 What "Done" Means for This PRD Foundation

Sections 1–3 of the master PRD are done only when they make the following unambiguous to a downstream AI builder:

- what the product is
- what the product is not
- what success looks like
- what must be true before later work can begin
- what order work must happen in
- what brand doctrine must shape behavior
- what dependencies are hard vs. soft
- what packages make up the complete Phase 1 system
- how to verify that each foundation constraint has been respected

---

## 2. Success Criteria and Verification Standards

### 2.1 Master Verification Principle

This PRD is successful only if it can govern a full AI-coordinated build from zero ambiguity to shippable product behavior. Therefore, success is not measured by "good writing." It is measured by whether an implementation workforce can use it to produce the intended system without inventing missing architecture.

All verification in this project must answer four questions:

1. **Coverage** — Is every required work package and dependency represented?
2. **Coherence** — Do the sections agree with one another and with the three governing sources?
3. **Executability** — Can the build be sequenced and delegated without hidden assumptions?
4. **Doctrine fidelity** — Does the product still behave like The Harvest rather than a generic sales app?

### 2.2 Foundation-Level Success Criteria

The foundation phase succeeds only if all of the following are true.

#### 2.2.1 Source Correlation Success
- All product-defining instructions in Sections 1–3 are traceable to the three-document correlation rule.
- No section is written from roadmap alone without AI Instructions process logic or Brand doctrine where relevant.
- No brand principle overrides a hard product dependency from the roadmap.
- No process instruction from AI Instructions rewrites product scope from the roadmap.

#### 2.2.2 Product Definition Success
- The PRD clearly defines the shipped Phase 1 end state.
- The difference between universal and Primerica-specific systems is explicit.
- The product promise ("30 minutes/day," "we run the business," "show up to close") is translated into operational system requirements.
- The Mission Control model is explicit enough to prevent downstream teams from building a passive CRM.

#### 2.2.3 Package Completeness Success
All 11 work packages must be represented in the workflow and dependency map with:
- package purpose
- blocking prerequisites
- blocked descendants
- package ordering logic
- notes where brand doctrine materially changes implementation

#### 2.2.4 Dependency Integrity Success
- No package appears before its prerequisite package.
- No Primerica-specific package is allowed to proceed without organization gating.
- No messaging/outreach work is allowed to proceed without compliance architecture constraints.
- No appointment-setting logic is allowed to proceed without calendar dependency planning.
- No payment build is allowed to proceed without access-tier and org-linkage assumptions clarified.
- No data-collecting workflow is allowed to proceed without privacy/security architecture alignment.

#### 2.2.5 AI-Executability Success
The foundation must be sufficiently explicit that a downstream agent can answer:
- what to build first
- what to defer
- what to parallelize
- what cannot be parallelized
- what constitutes a blocker
- how to verify a work package before unblocking the next

If an implementation agent would need to ask "what did they probably mean?" then the foundation is not complete.

#### 2.2.6 Brand and Movement Fidelity Success
The foundation must force downstream builders to preserve:
- warm-market-first logic
- service-over-extraction framing
- collective/team visibility mechanics
- relationship-compounding behavior
- belief-building and motivation as system functions, not cosmetic extras
- respectful handling of income-potential framing

If implementation would drift toward spammy automation, cold-lead growth hacking, generic SaaS gamification, or solo-hustle framing, the foundation has failed.

### 2.3 Verification Standards by Category

#### 2.3.1 Structural Verification
Verify that:
- Sections 1–3 exist and are complete.
- The 11 work packages are named consistently and fully.
- Phase and wave sequencing is explicit.
- Critical path is identified.
- Parallelizable vs. non-parallelizable work is identified.
- Dependencies are described in both narrative and map form.

#### 2.3.2 Source Fidelity Verification
Verify that:
- AI Instructions process rules are represented.
- Product Roadmap dependencies are represented.
- Brand Concept terms and doctrines are represented where they affect product behavior.
- Terms such as Downline Maxxing, Collective Benefit, Community Introduction, Hidden Earnings Estimate, Mission Control, and 2 Hour CEO are used consistently and not redefined casually.

#### 2.3.3 Behavioral Verification
Verify that:
- Rep workload remains compressed and high leverage.
- Upline visibility is preserved.
- Warm-market mechanics remain central.
- Team benefit logic exists where required.
- Compliance review is interceptive, not advisory-only.
- Primerica-specific content cannot leak into non-Primerica experience.

#### 2.3.4 Risk Verification
Verify that the foundation explicitly prevents:
- feature-order inversion
- hidden dependency collisions
- compliance-last design
- code-first implementation without system architecture
- treating solution number linkage as an API-guaranteed truth
- over-generalizing MIT ratios into product law
- substituting generic motivational copy for brand doctrine

### 2.4 Pass/Fail Standards for Foundation Approval

The foundation phase should be considered **passable for downstream expansion** only if all conditions below are met:

- **Completeness:** every required section objective is covered
- **Dependency clarity:** no unresolved sequence ambiguity in the foundation waves
- **Brand fidelity:** doctrine-impacting features are flagged and integrated
- **No critical contradictions:** nothing in Sections 1–3 conflicts with prior accepted project truths
- **Execution readiness:** a separate AI writer can take the foundation and expand later PRD sections without first re-deriving architecture

Automatic fail conditions:
- missing work packages
- missing dependency map
- no distinction between universal and Primerica-specific behavior
- no compliance-first constraint
- no explanation of Mission Control vs. CRM model
- no validation standard for downstream package completion
- vague references to "later define" where foundation architecture is required now

### 2.5 Quality Bar for AI-Orchestrated Build Use

The AI Instructions v5 standard implies this document must support a push/loop workflow. Therefore, foundation content must be robust enough for later QC to grade package outputs against it.

A package should not be marked complete unless:
- its parent dependencies are complete
- its outputs match the package role defined here
- no blocked downstream package is relying on unresolved ambiguity
- verification evidence exists for the package's foundational assumptions

Minimum evidence types expected later:
- schema/field coverage checks
- flow/role access checks
- gating logic checks
- dependency completion checks
- compliance interception checks
- parity checks across web/iOS/Android where relevant
- role visibility checks
- subscription/access state checks

### 2.6 Non-Negotiable Standards to Carry Forward

The following standards are mandatory and non-negotiable:

- **AI-facing specificity over executive-summary style**
- **Dependency-aware sequencing over flat feature lists**
- **Brand doctrine as product logic**
- **Compliance as infrastructure**
- **Warm-market primacy**
- **Upline-aware architecture**
- **Universal/platform-agnostic foundation with Primerica-specific gated overlays**
- **Human effort minimization as a real system requirement**
- **No code generation from incomplete architecture**
- **No claiming completion without verification artifacts**

---

## 3. Build Workflow — Phases, Waves, Task Sequence, and Dependency Map

### 3.1 Workflow Operating Principle

The build workflow must follow a **foundation-first, dependency-honoring, QC-gated** sequence. It is explicitly not a flat swarm where all packages are drafted or built at once.

The workflow must preserve:
- early anchor establishment
- constrained parallelism only after prerequisites stabilize
- package-level verification before descendant release
- doctrine preservation during decomposition
- orchestration separation from implementation

The master orchestrator governs sequence, delegation, QC routing, and integration. Subagents produce package content/work. Subagents do not become the authority.

### 3.2 Macro Phases

The full PRD-package creation and later build-prep workflow is organized into the following macro phases:

#### Phase A — Foundation
Purpose:
- establish product truth
- define success criteria
- define dependency-aware build workflow
- lock doctrine and package map

Outputs:
- Section 1 Project Overview
- Section 2 Success Criteria and Verification Standards
- Section 3 Build Workflow

Blocking condition to exit Phase A:
- all 11 work packages named and sequenced
- dependency spine explicit
- brand doctrine integration explicit
- verification standards explicit

#### Phase B — Expansion
Purpose:
- expand each work package into explicit AI-build instructions
- define schemas, flows, constraints, access rules, integrations, and edge cases
- preserve package boundaries while maintaining cross-package coherence

Outputs:
- detailed sections for all work packages
- package-by-package implementation detail
- explicit dependency handoffs

Blocking condition to exit Phase B:
- every work package fully specified
- no orphaned dependency assumptions remain
- all major external integration needs identified

#### Phase C — Integration and Harmonization
Purpose:
- reconcile cross-package contradictions
- ensure terminology, doctrine, and access rules are consistent
- validate that package interactions still produce one coherent system

Outputs:
- integrated master PRD
- resolved conflicts
- cross-reference consistency
- final dependency coherence

Blocking condition to exit Phase C:
- no package contradicts another
- terminology is stable
- gating logic is consistent across all sections
- role visibility rules align across the system

#### Phase D — QC and Grading
Purpose:
- score the PRD against completeness, coherence, executability, and doctrine fidelity
- send failures into loop repair
- only release once whole-system quality standard is met

Outputs:
- QC pass/fail findings
- fixes if needed
- final release-ready PRD package

Blocking condition to exit Phase D:
- passes final grading threshold
- no critical failures
- whole-system readiness confirmed

### 3.3 Wave Structure for the 11 Work Packages

The product roadmap dependencies should be executed in waves as follows.

#### Wave 0 — Master Foundation Control
Required before all product packages expand:
- **Work Package 11 — Data Privacy, Security & Compliance Architecture** (foundation package; must be complete and operational before any other package)
- Project Overview
- Success Criteria and Verification Standards
- Build Workflow / Dependency Map

This wave defines the law for all later work.

#### Wave 1 — Anchor Packages
These establish non-negotiable system foundations and should be completed first.

1. **Work Package 1 — Onboarding & Profile Engine**
2. **Work Package 2 — Warm Market & Contact Engine (Universal)**

Reasoning:
- Package 1 creates identity, organization gating, hierarchy, access tier seeds, and profile truth.
- Package 2 is required before the relationship engine can feed agent execution at scale.
- Package 2 must stabilize before Primerica-specific warm-market overlays.

Execution note:
- Packages 1 and 2 may proceed in close coordination once foundation logic is stable.
- Package 2 should not finalize data models until Package 11 compliance constraints are known.

#### Wave 2 — Core Pipeline Packages
These convert onboarding truth into business activation.

3. **Work Package 4 — AI Agent Layer & Mission Control**
4. **Work Package 5 — Messaging Engine & Outreach System**
5. **Work Package 9 — Team Calendar & Upline Dashboard**
6. **Work Package 10 — Payment & Subscription Infrastructure**
7. **Work Package 3 — Harvest Warm Market Method (Primerica-Specific)**
8. **Work Package 6 — Social, Content & Launch Kit**
9. **Work Package 7 — Accountability, Gamification & Motivation**

Reasoning:
- Package 4 defines the execution layer that many later features plug into; it depends on Package 1 identity truth and Package 11 compliance boundaries.
- Package 5 depends on Package 4 agent definitions and Package 11 compliance constraints.
- Package 9 depends on onboarding hierarchy plus Package 4 appointment-setting logic.
- Package 10 depends on onboarding access tiers and org-linkage rules.
- Package 3 requires Package 1 gating plus Package 2 universal contact architecture.
- Package 6 should inherit messaging/compliance rules before defining launch mechanics.
- Package 7 should inherit Mission Control, anchor statement, and activity truth before finalizing motivation logic.

Execution note:
- Packages 9 and 10 may proceed in constrained parallel once Package 1 and relevant upstream logic are stable.
- Packages 6 and 7 may proceed in parallel once Package 5 boundaries are stable.
- Primerica overlay work may proceed in parallel with universal amplification work only after Package 2 is stable and gating truth from Package 1 is locked.

#### Wave 3 — Primerica Overlay and Growth Systems
These layer specialized and amplification behaviors on top of the core engine.

10. **Work Package 8 — Taprooting, Timeline & Primerica-Specific Features**

Reasoning:
- Package 8 must not run ahead of Package 3 and depends on Primerica branch coherence.
- Package 8 also inherits motivation and team context from Package 7.

### 3.4 Package-by-Package Dependency Map

> **Note on blocked descendants:** The lists below show **direct blocks only** — packages that cannot begin until this package is complete. Transitive blocks (e.g., WP01 transitively blocks WP06 through the chain WP04 → WP05 → WP06) are omitted to avoid redundancy. The Package Index Table (Section 3.13) and Visual Dependency Map (Section 3.6) provide the complete transitive picture.

#### Work Package 1 — Onboarding & Profile Engine
Must define:
- role architecture
- organization gate
- solution number assumptions
- Seven Whys / anchor logic
- time commitment/intensity
- upline linkage
- calendar connection entry points
- access tier seeds
- visibility foundations

Directly blocks:
- WP02, WP03, WP04, WP05, WP09, WP10

#### Work Package 11 — Data Privacy, Security & Compliance Architecture
Must define:
- contact data classification
- encryption posture
- user rights
- role-based access control
- compliance review interception model
- retention/deletion logic
- outbound content governance

Directly blocks:
- all packages (WP01–WP10)

#### Work Package 2 — Warm Market & Contact Engine (Universal)
Depends on:
- WP01
- WP11 for lawful data handling constraints

Must define:
- native/mobile and desktop contact ingestion
- segmentation
- hidden earnings estimate mechanics
- memory jogger/contact activation structure
- universal contact-to-prospect pipeline

Directly blocks:
- WP03, WP04, WP05

#### Work Package 4 — AI Agent Layer & Mission Control
Depends on:
- WP01
- WP11
- WP02 for fully grounded contact-fed execution flows

Must define:
- agent inventory
- role of each agent
- daily briefing/reporting
- inactivity/re-engagement behavior
- appointment-setting logic
- Mission Control structure
- rep vs. upline visibility surfaces

Directly blocks:
- WP05, WP06, WP07, WP09

#### Work Package 5 — Messaging Engine & Outreach System
Depends on:
- WP01
- WP04
- WP11
- WP02 for contact and segment context

Must define:
- outbound channel logic
- handoff system
- script generation
- cadence logic
- approval/review logic
- compliance interception path
- income-language constraints

Directly blocks:
- WP06

#### Work Package 9 — Team Calendar & Upline Dashboard
Depends on:
- WP01
- WP04
- WP11

Must define:
- upline/team calendar hierarchy
- attendance visibility
- pace indicators
- org-level mission-control surfaces
- scheduling oversight mechanics

Directly blocks:
- (none — terminal package)

#### Work Package 10 — Payment & Subscription Infrastructure
Depends on:
- WP01
- WP11

Must define:
- free vs. paid access logic
- Stripe subscription flows
- failure/grace/revocation behavior
- restoration flows
- org-linked free access assumptions

Directly blocks:
- (none — terminal package)

#### Work Package 3 — Harvest Warm Market Method (Primerica-Specific)
Depends on:
- WP01
- WP02

Must define:
- proprietary Primerica warm-market exercise layers
- how outputs feed agent and messaging queues
- how Primerica-only flows stay gated

Directly blocks:
- WP08

#### Work Package 6 — Social, Content & Launch Kit
Depends on:
- WP01
- WP05
- WP11

Must define:
- launch content generation
- rep-identity asset use
- sharing mechanics
- compliance-safe social content behavior
- Mission Control reporting hooks for social activity

Directly blocks:
- (none — terminal package)

#### Work Package 7 — Accountability, Gamification & Motivation
Depends on:
- WP01
- WP04
- WP11
- WP05 (soft/parallel — may proceed once WP05 boundaries are stable; motivation logic benefits from messaging cadence definitions but does not require full WP05 completion)
- brand doctrine inputs

Must define:
- 48-hour countdown
- momentum score
- celebration engine
- quote engine weighting
- referral script motivation context
- notification architecture
- anchor/goal reinforcement loops

Directly blocks:
- WP08

#### Work Package 8 — Taprooting, Timeline & Primerica-Specific Features
Depends on:
- WP01
- WP03
- WP07
- WP09 for coherent leadership/team context where needed

Must define:
- Primerica-specific org visualization
- rules-of-building surfaces
- milestone timeline logic
- objection-handling structures
- activity-based unlock sequencing

Directly blocks:
- (none — terminal package)

### 3.5 Critical Path

The minimum critical path for coherent system definition is:

**Foundation → WP11 → WP01 → WP02 → WP04 → WP05**

This is the backbone that makes the rest of the system meaningful.

Why this is the spine:
- WP01 defines who the user is, what org they belong to, and what system branch they get.
- WP11 defines what is legally and structurally allowed.
- WP02 defines what relationship data exists to activate.
- WP04 defines how AI acts on that data and reports back.
- WP05 defines how those actions are expressed through outreach.

If this spine is weak, all later packages become speculative or contradictory.

### 3.6 Visual Dependency Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        THE HARVEST — CRITICAL PATH MAP                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                   │
│  │   WAVE 0    │────▶│   WAVE 1    │────▶│   WAVE 2    │────▶ ┌─────────┐  │
│  │    WP11     │     │ WP01  WP02  │     │ WP04  WP05  │      │  WAVE 3 │  │
│  │  Compliance │     │ Onboard│Warm│     │ Agent│Msg  │      │   WP08  │  │
│  │  Foundation │     │ Profile│Mkt │     │ Layer│Out  │      │ Primerica│  │
│  └─────────────┘     └─────────────┘     └─────────────┘      └─────────┘  │
│        │                   │   │               │   │                        │
│        │                   │   │               │   │                        │
│        └───────────────────┘   └───────────────┘   │                        │
│              (hard gate)           (hard gate)      │                        │
│                                                     │                        │
│  ┌─────────────────────────────────────────────────┘                        │
│  │                                                                           │
│  ▼                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │    WP09     │  │    WP10     │  │    WP03     │  │    WP06     │         │
│  │   Calendar  │  │   Payment   │  │  Primerica  │  │   Social    │         │
│  │  Dashboard  │  │    Sub      │  │ Warm Market │  │   Content   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘         │
│        ▲                                              │                      │
│        │                                              │                      │
│  ┌─────────────┐                               ┌─────────────┐              │
│  │    WP07     │───────────────────────────────▶│    WP08     │              │
│  │ Motivation  │                                │  Taprooting │              │
│  └─────────────┘                                └─────────────┘              │
│                                                                             │
│  LEGEND: ───▶ = hard dependency (must complete before next)                 │
│          ─ ─▶ = soft/parallel dependency (may proceed in parallel)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.7 Parallelization Rules

Allowed parallelism:
- WP01 and WP11 can be developed in close coordination once foundation is stable.
- After WP01/WP11/WP04 are coherent, WP09 and WP10 may proceed in parallel if dependency conditions are met.
- After WP05 boundaries are stable, WP06 and WP07 may proceed in parallel.
- Primerica overlay work may proceed in parallel with universal amplification work only after WP02 is stable and gating truth from WP01 is locked.

Disallowed parallelism:
- WP03 before WP02
- WP08 before WP03
- WP05 before WP04 and WP11
- WP09 before WP04
- WP10 before WP01
- any Primerica-only package before organization gate logic is explicit
- any outreach package that assumes compliance will be "added later"

### 3.8 Dependency Failure and Blocker Rules

A package is blocked if any of the following are true:
- a prerequisite package is incomplete
- prerequisite terminology or access rules are contradictory
- required external integration assumptions are undefined
- compliance/privacy rules affecting the package are missing
- package output would force later re-architecture of already-defined upstream systems

When blocked:
- do not continue by guessing
- mark the blocker explicitly
- identify the missing upstream truth
- return to the prerequisite package or escalation path

### 3.9 Doctrine Injection Points Across the Workflow

Brand doctrine must actively shape these packages:

- **Package 1:** Seven Whys, anchor logic, 2 Hour CEO framing, role dignity
- **Package 2:** Hidden Earnings Estimate, relationship activation, warm-market-first worldview
- **Package 3:** Community Introduction and relational matching behavior
- **Package 4:** Mission Control as business companion, not admin console
- **Package 5:** service framing, non-spam outreach, recommendation-specialist positioning
- **Package 6:** launch content that feels movement-led, not hype-led
- **Package 7:** belief reinforcement, collective uplift, celebration as retention infrastructure
- **Package 8:** multiplication and team-building logic rendered visibly
- **Package 9:** upline visibility in service of support, not surveillance
- **Package 10:** access rules aligned with org membership logic
- **Package 11:** data stewardship consistent with trust-centered brand promise

### 3.10 Completion Gate for Each Wave

A wave is complete only when:
- all packages in the wave meet their own completion standards
- downstream packages no longer depend on unresolved ambiguity from that wave
- cross-package terminology is aligned
- doctrine-impacting behaviors are preserved
- QC has checked for dependency violations

Wave completion is not "draft text exists." It is "downstream work can proceed safely."

### 3.11 Final Workflow Outcome Required Before Master Assembly

Before the master PRD is assembled for final grading, the workflow defined here must yield:
- complete coverage of all 11 work packages
- explicit dependency satisfaction
- universal vs. Primerica branch integrity
- Mission Control-centered system coherence
- compliance and privacy as embedded architecture
- AI-agent executability with minimal interpretive burden

If those conditions are not met, the PRD remains in loop status and must not be treated as release-ready.

### 3.12 Wave Summary Table

| Wave | Packages | Unblocking Condition |
|------|----------|---------------------|
| Wave 0 | WP11 | None (foundation package) |
| Wave 1 | WP01, WP02 | WP11 complete + WP01 gates downstream |
| Wave 2 | WP03–WP07, WP09, WP10 | WP01/WP02 complete + WP11 operational + WP04 gates WP05–WP07 |
| Wave 3 | WP08 | All prior waves complete + Primerica org selected |

### 3.13 Package Index Table

| Package # | Package Name | Wave | Hard Prerequisites | Blocked Descendants (Direct) | Critical Path? |
|-----------|-------------|------|--------------------|------------------------------|----------------|
| WP01 | Onboarding & Profile Engine | Wave 1 | WP11 | WP02, WP03, WP04, WP05, WP09, WP10 | Y |
| WP02 | Warm Market & Contact Engine | Wave 1 | WP01, WP11 | WP03, WP04, WP05 | Y |
| WP03 | Harvest Warm Market Method (Primerica) | Wave 2 | WP01, WP02, WP11 | WP08 | N |
| WP04 | AI Agent Layer & Mission Control | Wave 2 | WP01, WP02, WP11 | WP05, WP06, WP07, WP09 | Y |
| WP05 | Messaging Engine & Outreach | Wave 2 | WP04, WP11 | WP06 | N |
| WP06 | Social, Content & Launch Kit | Wave 2 | WP01, WP05, WP11 | — | N |
| WP07 | Accountability, Gamification & Motivation | Wave 2 | WP01, WP04, WP11 | WP08 | N |
| WP08 | Taprooting, Timeline & Primerica Features | Wave 3 | WP01–WP03, WP07, WP11 | — | N |
| WP09 | Team Calendar & Upline Dashboard | Wave 2 | WP01, WP04, WP11 | — | N |
| WP10 | Payment & Subscription | Wave 2 | WP01, WP11 | — | N |
| WP11 | Data Privacy & Compliance | Wave 0 (Foundation) | None | All packages | Y (First) |

---

**END OF FOUNDATION PHASE — SECTIONS 1–3**

**Status: Ready for master assembly**


## Section 4: Agent and Sub-Agent Instruction Blocks

WORK PACKAGE 1: Onboarding & Profile Engine

What This Sub-Agent Is Building:
  Full first-run onboarding and identity foundation for web/mobile including role architecture (Rep, Upline/Field Trainer, RVP/Org Leader, External Non-Primerica, dual-role support), organization selection with hard branch gating (Primerica vs Non-Primerica), solution number intake as user-declared/format-checked (not API-verified), Seven Whys workflow with minimum completion threshold as progression gate, Goal Commitment Card seed data capture, time commitment/intensity calibration for 2 Hour CEO operating mode, upline linkage/invitation model, calendar connection entry points, profile schema, and access-tier seed state (org-linked free vs paid external). Includes UI flows, backend state machine definitions, data contracts, validation rules, and role visibility foundations used by all downstream packages.

Inputs Required Before This Package Can Begin:
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md (Sections 1-3 governing product definition and dependency truths)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md (WP01 scope and dependency map)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md (behavioral triggers for onboarding, timeline, commitment)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md (consent, disclosures, data-rights hooks)
  - Product-level naming vocabulary and forbidden-term replacements from doctrine/compliance extracts

Sequential Dependency:
  WORK PACKAGE 11 must be fully complete and QC-approved before this package begins.

Can Run In Parallel With:
  None during initial build. After WP01 completes, WP02 and WP04 structural tracks may begin in constrained parallel.

Output Delivered:
  - Onboarding flow specification (screen-by-screen and API-by-API)
  - Profile and role schema specification (including dual-role logic)
  - Organization gating specification and visibility flags
  - Seven Whys progression gate specification
  - Access tier seed rules feeding subscription logic
  - Upline linkage and invitation model specification
  - Calendar connection entry-point contracts
  - Validation and attestation rules for solution number and profile fields
  - State transition map for onboarding completion and downstream unlocks

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  The Harvest is a Mission Control operating system, not a generic CRM. Onboarding is not merely account setup; it is the architectural root for identity, branch selection, permissions, and all downstream behavior. Brand philosophy must be encoded at this stage: Downline Maxxing (relationship-network compounding over cold acquisition), Collective Benefit (team-level uplift and visibility), and Community Introduction (warm relationship bridges instead of hard-sell language). The 2 Hour CEO doctrine requires low-friction setup and bounded cognitive load. Technical constraints are fixed: Next.js frontend, Node.js backend, PostgreSQL with Prisma, KIE.ai used later for agent/media behaviors, Stripe used later for paid tiers. Compliance constraints start here: explicit consent capture, lawful basis tracking, role-linked visibility, and clear framing that Hidden Earnings Estimate is potential only, never guarantee. Naming and language constraints apply globally: avoid prospect/lead/pitch/sales-call framing in user-facing artifacts. This package establishes organization-conditional architecture that controls whether Primerica overlays ever appear. Solution number is attested and format-validated only; no external verification assumptions permitted. Outputs here directly unblock WP02, WP03, WP04, WP05, WP09, WP10 and feed WP11 RBAC alignment.

Specific Restrictions for This Work Package:
  - Do not design or expose Primerica-specific feature screens directly in onboarding beyond organization selection and gated flags.
  - Do not assume any Primerica external API for identity or solution-number verification.
  - Do not skip Seven Whys minimum threshold gating.
  - Do not finalize subscription charge flows (those belong to WP10); only define access tier seeds.

WORK PACKAGE 2: Warm Market & Contact Engine (Universal)

What This Sub-Agent Is Building:
  Universal contact ingestion and relationship-activation engine across iOS/Android/web/desktop import flows including contact sync/import (phone address book, CSV/manual), deduplication and normalization, relationship-first segmentation taxonomy, contact scoring signals, memory jogger structures, Hidden Earnings Estimate computation framework with safe-harbor framing, and conversion of raw contacts into structured warm-market pipeline stages. Includes data model contracts for contact entities, import jobs, segment states, enrichment metadata, and pipeline statuses. Includes privacy-aware handling requirements for contact data and integration hooks for AI agents/messaging consumers.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: organization gating flags, user identity/profile schema, role context
  - Output from WORK PACKAGE 11: contact-data classification, encryption, consent, retention, and rights constraints
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md (The Vault ritual, Hidden Earnings behavior)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md (safe harbor and no-sale contact constraints)

Sequential Dependency:
  WORK PACKAGE 1 and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  WORK PACKAGE 4 (structural design tracks may run in parallel after WP1/WP11 lock)

Output Delivered:
  - Universal contact ingestion specification (mobile/native/CSV/manual)
  - Contact canonical schema and dedup/merge rules
  - Segmentation model and scoring heuristics
  - Warm-market pipeline stage definitions and transition rules
  - Hidden Earnings Estimate logic + required safe-harbor language insertion points
  - Contact privacy handling rules mapped to implementation checkpoints
  - Integration contracts for WP04 (agent feeds) and WP05 (message personalization)

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  This package is universal across organizations and must not embed Primerica-only assumptions. It operationalizes Downline Maxxing by treating the user’s contacts as a relationship network, not a lead list. Community Introduction doctrine requires language and scoring logic to prioritize trust pathways and warm bridges. Collective Benefit requires segment definitions that can support team-level visibility later without violating role boundaries. Technical stack is fixed: Next.js UI surfaces, Node.js services, PostgreSQL/Prisma persistence. Data in this package is highly sensitive and governed by WP11: encryption at rest/in transit, rights export/delete, auditability, and strict “contact data never sold” policy. Hidden Earnings Estimate is a motivational unlock but must always be framed as potential with disclaimers; never guaranteed or projected certainty. This package must produce clean, reliable contact context feeding WP03, WP04, and WP05. Any model or copy that drifts into cold outreach, spam automation, or hard-sell framing violates product doctrine.

Specific Restrictions for This Work Package:
  - Do not implement Primerica-only warm market methods (that belongs to WP03).
  - Do not use forbidden sales terms in user-facing templates.
  - Do not expose unconsented contact processing paths.
  - Do not present Hidden Earnings values without mandatory potential/disclaimer framing.

WORK PACKAGE 3: Harvest Warm Market Method (Primerica-Specific)

What This Sub-Agent Is Building:
  Primerica-gated proprietary Harvest Warm Market Method workflows layered on top of universal contact engine data, including Blank Canvas, Qualities Flip, and Background Matching exercises, prioritized action queue generation, and mapping outputs into agent/message execution queues. Includes state machine for method progression, Primerica-only navigation visibility, and transformation logic from relationship insights to outreach-ready tasks while preserving service-first framing.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: organization gate (Primerica), role/profile context
  - Output from WORK PACKAGE 2: normalized contacts, segments, pipeline entities
  - Output from WORK PACKAGE 11: compliance and disclosure constraints for business-opportunity language
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 2, and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  WORK PACKAGE 6 and WORK PACKAGE 7 (after prerequisites above are satisfied)

Output Delivered:
  - Primerica-only Harvest Warm Market Method specification
  - Exercise logic for Blank Canvas, Qualities Flip, Background Matching
  - Prioritized action queue data contract feeding WP04/WP05
  - Org-gated visibility and access enforcement rules
  - Compliance-safe content constraints specific to method-generated outputs

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  WP03 is strictly Primerica-specific and must never leak into non-Primerica experiences. It extends universal warm-market infrastructure with doctrinally aligned method mechanics that turn known relationships into trust-based introductions. Downline Maxxing and Community Introduction are primary here: users should see pathway-building, not pressure-based selling. Collective Benefit matters because outputs must support team multiplication and downstream upline collaboration. Technical constraints remain fixed (Next.js, Node.js, PostgreSQL/Prisma). Outputs from this method are consumed by agents and messaging, so field definitions and queue semantics must be explicit and deterministic. Compliance is non-negotiable: business opportunity language, income framing, and insurance context must follow FTC/FINRA/state constraints with safe harbor where required. Hidden Earnings framing remains potential-only. This package is a hard prerequisite for WP08 taprooting/timeline overlays.

Specific Restrictions for This Work Package:
  - Hard block all functionality unless org_type = Primerica.
  - Do not create generic/non-organization variants of this method inside this package.
  - Do not bypass WP11 classifier/disclaimer requirements for method-generated scripts.
  - Do not depend on unavailable Primerica APIs.

WORK PACKAGE 4: AI Agent Layer & Mission Control

What This Sub-Agent Is Building:
  Core autonomous agent architecture and Mission Control command layer including agent inventory, role-specific responsibilities, action boundaries, daily briefing generation, inactivity detection and re-engagement logic, appointment-setting behaviors, handoff orchestration points, rep/upline dashboard visibility contracts, and event pipelines consuming contact/warm-market signals. Includes mission-control data surfaces for action queues, momentum indicators, and operational alerts.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: role architecture, org gating, profile context
  - Output from WORK PACKAGE 11: compliance interception architecture and policy constraints
  - Output from WORK PACKAGE 2: segmented contact data and pipeline context (for grounded execution)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md (agent behavior triggers)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1 and WORK PACKAGE 11 must be fully complete and QC-approved. Finalized grounded behaviors require WORK PACKAGE 2 completion.

Can Run In Parallel With:
  WORK PACKAGE 2 (structural work in parallel after WP1/WP11)

Output Delivered:
  - Agent catalog and responsibility matrix
  - Mission Control information architecture for rep/upline
  - Agent execution lifecycle and event model
  - Daily brief/re-engagement/appointment logic specs
  - Compliance handoff integration points (pre-send CFE pathway)
  - Interfaces consumed by WP05, WP07, WP09

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  Mission Control is the product’s execution center and must behave like a business operating layer, not passive CRM reporting. The 2 Hour CEO promise requires autonomous action, low cognitive load, and clear close-ready moments surfaced to reps/uplines. Downline Maxxing and Collective Benefit require agent logic that multiplies relationship effects across teams while maintaining strict role visibility boundaries. Community Introduction requires outreach behavior design to remain warm, helpful, and referral-centric. Technical stack constraints are fixed (Next.js frontend, Node.js orchestration services, PostgreSQL/Prisma persistence). KIE.ai is the designated AI provider family for agent behaviors and related generation capabilities, but all generated content is constrained by WP11 Compliance Filter Engine, FINRA/state/FTC logic, and safe-harbor requirements. This package gates WP05, WP07, and WP09 and partially informs WP06.

Specific Restrictions for This Work Package:
  - Do not define outbound messaging execution that bypasses WP05/WP11 pipelines.
  - Do not expose cross-team data to roles without explicit RBAC entitlement.
  - Do not implement manual-heavy workflows that violate 2 Hour CEO constraints.
  - Do not finalize appointment scheduling without calendar contract compatibility for WP09.

WORK PACKAGE 5: Messaging Engine & Outreach System

What This Sub-Agent Is Building:
  Multi-channel outreach and handoff system including message generation architecture, cadence logic, channel routing (SMS/email/in-app), personalization using contact/warm-market context, compliance interception path enforcement, upline review path for flagged content, script generation for introductions/referrals/follow-ups, response-state handling, and performance telemetry hooks. Includes explicit support for service-first language transformation and forbidden-term replacement.

> **CFE Integration Note:** This WP integrates with the CFE per the Agent Integration Contract in Section 1.10.1 — all generated content passes through the synchronous compliance gate before delivery.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: role/user profile and org branch data
  - Output from WORK PACKAGE 2: contact/segment context
  - Output from WORK PACKAGE 4: agent intent/action payloads and orchestration points
  - Output from WORK PACKAGE 11: CFE policy classifiers, thresholds, audit requirements
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 2, WORK PACKAGE 4, and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  None

Output Delivered:
  - Messaging architecture specification by channel
  - Template/script generation system spec with doctrine vocabulary rules
  - Cadence/state machine and handoff model spec
  - CFE integration contract (pass/flag/block outcomes)
  - Review/escalation flow for flagged content
  - Metrics and analytics event schema for outreach outcomes

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  WP05 is the outward expression layer of agent activity and must be doctrine-safe, regulation-safe, and role-safe. Community Introduction replaces hard-sell framing, and Collective Benefit means scripts should promote collaborative network expansion, not extractive persuasion. Technical constraints: Next.js channel controls/UI, Node.js message orchestration, PostgreSQL/Prisma state persistence, CFE synchronous gating from WP11 before any send. FINRA/state insurance/FTC requirements apply continuously; safe-harbor text is mandatory where earnings/opportunity language appears; Hidden Earnings wording must remain potential-only. TCPA/CAN-SPAM/GDPR/CCPA obligations must be reflected in consent/opt-out flow behavior. WP05 directly gates WP06 and influences WP07.

Specific Restrictions for This Work Package:
  - No message dispatch may occur without successful CFE pass path.
  - Do not include forbidden terms (prospect, lead, pitch, sales call, guaranteed income) in generated output logic.
  - Do not implement outreach assumptions that depend on cold lead acquisition.
  - Do not bypass review queue logic for medium/high-risk compliance scores.

WORK PACKAGE 6: Social, Content & Launch Kit

What This Sub-Agent Is Building:
  Content and social launch toolkit for reps including launch asset generation specifications, channel-adapted post/caption scaffolds, sharing mechanics, compliance-safe publication pathways, rep-identity content personalization, and mission-control reporting hooks for social activity and engagement. Includes launch-kit packaging rules and asset-state tracking.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: rep identity/profile and organization gating context
  - Output from WORK PACKAGE 5: messaging templates, doctrine-safe phrasing, compliance send boundaries
  - Output from WORK PACKAGE 11: content compliance rules and mandatory disclosures
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 5, and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  WORK PACKAGE 7

Output Delivered:
  - Social/launch kit functional specification
  - Asset templates and personalization rules specification
  - Compliance-safe publication and review rules
  - Activity telemetry contracts feeding Mission Control
  - Integration boundaries with WP05 messaging and WP07 motivation systems

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  Social/content output must reinforce movement language and community orientation, not hype-led growth hacking. Downline Maxxing in this package means content should activate real relationships and referrals, not vanity metrics. Collective Benefit requires visibility that supports team momentum and coaching. Technical stack remains fixed (Next.js/Node.js/PostgreSQL/Prisma), with generation logic integrated through approved AI tooling pathways and compliance interception from WP11 before publish/send. FTC/native advertising and testimonial rules apply to social outputs; safe-harbor and disclosure requirements are mandatory when opportunity/income framing appears. This package depends on WP05 boundaries and runs parallel to WP07 once those boundaries are stable.

Specific Restrictions for This Work Package:
  - Do not publish content pathways that bypass compliance checks.
  - Do not optimize for “viral” cold audience acquisition at expense of warm-market doctrine.
  - Do not include Primerica-only artifacts unless org gating rules explicitly allow them.
  - Do not redefine core messaging vocabulary outside WP05 doctrine constraints.

WORK PACKAGE 7: Accountability, Gamification & Motivation

What This Sub-Agent Is Building:
  Behavior reinforcement engine including 48-hour countdown mechanics, momentum scoring framework, milestone detection, celebration triggers, quote/motivation scheduling, anchor statement reinforcement loops, inactivity nudges, and leaderboard/ranking surfaces where permitted by role. Includes event model for IPA logs and mission-control-integrated motivational interventions.

> **CFE Integration Note:** This WP integrates with the CFE per the Agent Integration Contract in Section 1.10.1 — all generated content passes through the synchronous compliance gate before delivery.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: Seven Whys/anchor and profile context
  - Output from WORK PACKAGE 4: agent activity streams and mission-control event context
  - Output from WORK PACKAGE 11: notification/privacy/compliance constraints
  - Output from WORK PACKAGE 5: messaging boundaries for motivational/referral scripts (stable boundaries required)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 4, and WORK PACKAGE 11 must be fully complete and QC-approved. WORK PACKAGE 5 boundaries must be stable before finalization.

Can Run In Parallel With:
  WORK PACKAGE 6

Output Delivered:
  - Countdown/momentum/milestone engine specification
  - Motivation quote and notification scheduling specification
  - Celebration logic and badge/event model
  - Anchor reinforcement and inactivity intervention workflows
  - Role-based leaderboard visibility rules and team uplift metrics

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  Motivation in Harvest is not generic gamification; it is a doctrine-bearing system that sustains belief, consistency, and community outcomes. Downline Maxxing requires measurement of relationship-building actions, not vanity activity. Collective Benefit requires team-aware scoring that encourages shared wins and upline-supported progress. Community Introduction framing must carry through script prompts and nudges. Technical constraints are fixed (Next.js, Node.js, PostgreSQL/Prisma). Notification behavior must respect privacy, consent, timezone logic, and compliance constraints from WP11. Any earnings-phrased motivation must include safe framing and never imply guarantees. This package informs WP08 milestone/timeline overlays and receives core activity data from WP04 and messaging boundaries from WP05.

Specific Restrictions for This Work Package:
  - Do not implement exploitative or shame-based gamification patterns.
  - Do not expose team leaderboard data outside authorized visibility boundaries.
  - Do not send motivational content that violates earnings/opportunity compliance rules.
  - Do not remove anchor statement linkage from reinforcement logic.

WORK PACKAGE 8: Taprooting, Timeline & Primerica-Specific Features

What This Sub-Agent Is Building:
  Primerica-only advanced overlays including taprooting/org visualization features, 30-day phased timeline mechanics, milestone unlock sequencing, objection-handling integration points, and Primerica-specific progression logic tied to prior warm-market and motivation outputs. Includes feature gating, role-tailored visibility, and timeline status surfaces.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: organization gating and role context
  - Output from WORK PACKAGE 3: Harvest Warm Market Method outputs and action queues
  - Output from WORK PACKAGE 7: motivation/milestone events and progression indicators
  - Output from WORK PACKAGE 9: team calendar/upline visibility context where needed
  - Output from WORK PACKAGE 11: compliance/disclosure constraints for Primerica-specific language
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 3, WORK PACKAGE 7, WORK PACKAGE 9, and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  None

Output Delivered:
  - Primerica-only taprooting and timeline specification
  - Milestone unlock and progression rules
  - Org visualization data contracts and rendering requirements
  - Primerica-specific objection/timeline integration rules
  - Strict gating and visibility controls preventing non-Primerica exposure

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  WP08 is a late-stage specialized overlay and must remain strictly hidden from non-Primerica users. It operationalizes Downline Maxxing through visible team multiplication pathways and staged activation discipline, while preserving Collective Benefit and community-centered framing. Technical stack remains fixed (Next.js frontend visualization, Node.js orchestration, PostgreSQL/Prisma data models). It depends on stable outputs from WP03 and WP07 and aligns with upline calendar context from WP09. Compliance remains active: any opportunity/income/insurance-adjacent phrasing must follow FINRA/state/FTC requirements and safe-harbor standards from WP11. No assumption of external Primerica API truth is allowed.

Specific Restrictions for This Work Package:
  - Absolute hard gate: no functionality visible unless org_type = Primerica.
  - Do not define dependencies that bypass WP03 warm-market outputs.
  - Do not expose taprooting/team structures to unauthorized roles.
  - Do not include guaranteed timeline or earnings claims in milestone language.

WORK PACKAGE 9: Team Calendar & Upline Dashboard

What This Sub-Agent Is Building:
  Team scheduling and leadership visibility layer including shared availability logic, dual-calendar overlap checks, appointment routing rules, attendance/pace indicators, upline dashboard surfaces, and team-level mission-control calendar intelligence. Includes role-aware visibility constraints and schedule-state integration with agent appointment actions.

> **CFE Integration Note:** This WP integrates with the CFE per the Agent Integration Contract in Section 1.10.1 — all generated content passes through the synchronous compliance gate before delivery.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: hierarchy and role linkage, calendar entry points
  - Output from WORK PACKAGE 4: appointment-setting and mission-control event logic
  - Output from WORK PACKAGE 11: RBAC/privacy rules for schedule data
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md

Sequential Dependency:
  WORK PACKAGE 1, WORK PACKAGE 4, and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  WORK PACKAGE 10

Output Delivered:
  - Team calendar architecture specification
  - Availability overlap and appointment eligibility rules
  - Upline dashboard visibility and pace indicator spec
  - Role-based schedule access matrix
  - Integration contracts with WP04 actions and WP08 timeline dependencies

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  Calendar infrastructure is an execution-enabler for close-ready moments and upline support. It must reduce friction for reps and preserve the 2 Hour CEO operating model. Collective Benefit and Downline Maxxing require dashboard visibility that supports coaching and coordination, not surveillance theater. Technical constraints: Next.js schedule surfaces, Node.js scheduling/orchestration services, PostgreSQL/Prisma for availability and event state. Privacy and RBAC from WP11 are strict: schedule data visibility must follow role hierarchy boundaries. Appointment logic must align with WP04 agent actions and feed WP08 where timeline/milestone logic needs schedule context.

Specific Restrictions for This Work Package:
  - Do not permit appointment booking without dual-availability validation.
  - Do not expose private schedule details cross-team or cross-role without entitlement.
  - Do not implement standalone calendar logic that diverges from WP04 mission-control events.
  - Do not include payment/access gating behavior (belongs to WP10).

WORK PACKAGE 10: Payment & Subscription Infrastructure

What This Sub-Agent Is Building:
  Billing and access-governance architecture using Stripe for subscription lifecycle, including tier model support (free/org-linked vs paid), checkout/subscription state machine, failed-payment handling, grace/revocation/restoration flows, entitlement checks tied to onboarding access seeds, and admin/upline visibility for billing status where allowed.

Inputs Required Before This Package Can Begin:
  - Output from WORK PACKAGE 1: access tier seeds and organization linkage logic
  - Output from WORK PACKAGE 11: payment data security/compliance and retention constraints
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md (subscription behavior references)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md
  - Stripe integration credentials and webhook requirements definition (from platform integration setup)

Sequential Dependency:
  WORK PACKAGE 1 and WORK PACKAGE 11 must be fully complete and QC-approved.

Can Run In Parallel With:
  WORK PACKAGE 9

Output Delivered:
  - Subscription and entitlement architecture specification
  - Stripe integration contract (checkout, webhooks, status sync)
  - Grace/revocation/restoration policy specification
  - Access-tier decision and enforcement matrix
  - Billing visibility/reporting boundaries by role

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  Payment is downstream of identity/access truth, not an isolated commerce module. The system must distinguish org-linked free access from external paid access exactly as seeded in onboarding. Technical constraints: Next.js billing surfaces, Node.js billing/webhook services, PostgreSQL/Prisma entitlement state, Stripe as payment processor. Compliance and privacy requirements from WP11 apply to billing metadata, logs, retention, and user rights handling. Product doctrine requires monetization to avoid adding operational burden or confusion; access transitions must be predictable and transparent. This package is terminal but must not conflict with role visibility or organization gating logic.

Specific Restrictions for This Work Package:
  - Do not redefine access logic independently of WP01 seed state.
  - Do not store raw payment instrument data outside Stripe-sanctioned paths.
  - Do not gate Primerica-specific visibility through billing checks (that gating is organizational first).
  - Do not alter compliance retention/deletion obligations for billing records.

WORK PACKAGE 11: Data Privacy, Security & Compliance Architecture

What This Sub-Agent Is Building:
  Foundational compliance and security infrastructure governing all packages: Compliance Filter Engine (CFE) with classifier pipeline (Income Claim, Testimonial, Opportunity Statement, Insurance Recommendation, Referral Request), pre-generation and pre-send interception logic, pass/flag/block risk scoring thresholds, audit trail architecture, role-based access control matrix, consent and lawful-basis capture rules, encryption standards (transit/rest), data-rights workflows (export/delete/rectify), retention/deletion policies, no-sale contact-data policy, safe-harbor language injection rules, and regulatory parameterization framework for FINRA/state insurance/FTC/TCPA/CAN-SPAM/GDPR/CCPA updates.

Inputs Required Before This Package Can Begin:
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/foundation-revision-v6.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/roadmap-extraction-v2.md
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/behavior-matrix-v5.md (compliance-triggered behaviors)
  - /Users/erspaulding/.openclaw/workspace/prd-packages/harvest-app/inbox/compliance-extraction-v4.md (authoritative regulatory extraction)
  - Role definitions from WORK PACKAGE 1 for final RBAC mapping (coordination dependency)

Sequential Dependency:
  None

Can Run In Parallel With:
  WORK PACKAGE 1

Output Delivered:
  - Full CFE architecture and decision matrix spec
  - Regulatory classifier definitions, thresholds, and multipliers
  - RBAC and data access policy specification
  - Encryption, session, auth, and security baseline specification
  - Consent/data-rights/retention/deletion workflows
  - Audit logging and compliance review workflow specification
  - Safe-harbor templates and forbidden language controls

Code Writing Model: Ollama GLM 5.1 (thinking: High) — FIXED. No substitution permitted.
QC Model: Ollama Kimi 2.6 (thinking: High) — evaluates this work package after completion.
Helper Agents Allowed: Yes — up to 4 additional agents may be spawned
Helper Agent Model: Ollama GLM 5.1 (thinking: High) — same as the primary sub-agent.
Reports To: Master Orchestrator only

Context This Sub-Agent Must Know:
  WP11 is a foundational hard gate for the entire product. Compliance is infrastructure, not advisory text. Every outbound artifact must be physically blocked unless CFE permits send path. Risk banding (pass/flag/block), immutable auditability, and escalation workflows are mandatory. Regulatory obligations include FINRA communications fairness, state insurance license gating, FTC earnings/testimonial/opportunity controls, TCPA/CAN-SPAM messaging obligations, and GDPR/CCPA rights/retention requirements. Hidden Earnings Estimate is allowed only as potential with explicit safe-harbor language; no guarantee framing permitted. Contact data is sacred-vault user property and cannot be sold or repurposed. Technical constraints remain fixed: Next.js policy/admin surfaces, Node.js policy engines/services, PostgreSQL/Prisma secure persistence; integration with all package pipelines is required. WP11 constraints must be parameterized where regulations change, with versioned rule updates and full traceability.

Specific Restrictions for This Work Package:
  - Do not permit a “monitor-only” compliance mode for outbound production sends.
  - Do not leave regulatory rules hardcoded without parameterization/version controls where updates are expected.
  - Do not define RBAC without final reconciliation against WP01 role model.
  - Do not allow fallback behavior that sends content when compliance systems are unavailable.

## Section 5: Global Sub-Agent Rules and Behavioral Constraints

# The Harvest: 2 Hour CEO Business Agent — Master PRD

---

## 5.1 Governing Principle

Sub-agents are execution workers, not decision authorities. The master orchestrator alone holds governing authority over the build, the PRD package files, the GitHub repository, and all quality gates. Every rule in this section is absolute, non-negotiable, and enforceable by the master orchestrator without exception.

This section derives authority from the three-document hierarchy defined in Section 1.1:
1. AI Instructions v5 — process and control logic
2. Complete Product Roadmap v5 — feature scope and dependency truth
3. Brand Concept Document (Doctrine v4) — behavioral intent and language constraints

If any rule in this section appears to conflict with a source document, the hierarchy in Section 1.1 governs resolution.

---

## 5.2 Sub-Agent Hard Limits — Absolute Prohibitions

No sub-agent may ever perform any of the following actions. Violation is a **critical build failure** and triggers immediate termination of the offending agent, logging in `harvest-changelog.md`, and escalation to the master orchestrator.

| # | Prohibition | Consequence if Violated |
|---|-------------|------------------------|
| 1 | **Trigger any restart** (gateway, system, service, or infrastructure) | Breaks build stability; only master orchestrator in main session may authorize restarts |
| 2 | **Push to or update the GitHub repository** | Corrupts source of truth; GitHub is the single governing source |
| 3 | **Push to Vercel or any deployment target** | Unauthorized deployment outside orchestrator control |
| 4 | **Upload, modify, overwrite, or delete any `.md` file in the PRD package** (PRD, todo, QC checklist, changelog, handoff) | Corrupts operational control documents |
| 5 | **Check off, mark complete, or add items on `todo.md`** | Breaks operational status tracking and QC gating |
| 6 | **Self-authorize the start of a new task, phase, or work package** | Violates dependency gating and orchestrator authority |
| 7 | **QC its own work or any work package other than one explicitly assigned for QC** | Compromises quality assurance integrity |
| 8 | **Access or view any work package other than the one assigned** | Information leakage, scope creep, cross-contamination |
| 9 | **Spawn more than 4 additional helper agents** | Exceeds helper agent cap (4 per sub-agent) |
| 10 | **Exceed the 50 parallel agent cap** (including helpers and QC agents) | System overload, resource exhaustion |
| 11 | **Modify OpenClaw configuration** (timeout, model, gateway, cron, or system settings) | Unauthorized system alteration |
| 12 | **Self-assign a replacement task if original task fails or stalls** | Bypasses orchestrator authority and recovery protocol |
| 13 | **Work from local copy as a source of decisions** (always reference GitHub) | Local drift, stale truth, silent divergence |

### 5.2.1 Sub-Agent Authorized Scope (Permitted Actions Only)

Sub-agents are permitted **only** the following actions:

- Execute the assigned work package per PRD instructions
- Report results to the master orchestrator
- Spawn up to 4 helper agents (using same model: GLM 5.1) to assist with the assigned work package
- Request clarification from the master orchestrator if instructions are materially ambiguous
- Produce code, schemas, flows, and documentation for their assigned package only
- Return deliverables to the master orchestrator for QC routing

---

## 5.3 Master Orchestrator Exclusive Permissions

The following permissions are **non-delegable, non-transferable, and exclusive** to the master orchestrator. No sub-agent may perform them under any circumstance.

| # | Permission | Why It Matters |
|---|-----------|----------------|
| 1 | Create, update, or modify any `.md` file in the PRD package | Maintains operational control document integrity |
| 2 | Check off completed tasks on `todo.md` | Ensures QC-gated progress tracking |
| 3 | Add new tasks to `todo.md` | Controls scope and sequencing |
| 4 | Push to the GitHub repository | Protects source of truth |
| 5 | Push to Vercel or any deployment target | Controls deployment |
| 6 | Authorize a sub-agent to begin a new task or phase | Enforces dependency gating |
| 7 | Approve a task as complete after QC passes | Final quality gate |
| 8 | Update the changelog | Maintains version history |
| 9 | Update the README | Maintains project documentation |
| 10 | Distribute work packages to sub-agents | Controls build execution |
| 11 | Evaluate QC results and decide pass / loop / fail | Final quality authority |
| 12 | Trigger Gateway restart (in main session only) | Recovery from hard failures |
| 13 | Execute the teardown sequence | Controlled build shutdown |
| 14 | Update `handoff.md` at session close | Ensures continuity |
| 15 | Grade the PRD (score 10/10 required before any build begins) | PRD completeness and executability gate |
| 16 | Update version number and changelog entry on every push | Maintains version discipline |

### 5.3.1 Master Orchestrator Role Boundary

The master orchestrator **does NOT write code or execute work packages**. Its functions are strictly: think, plan, delegate, evaluate, and manage. Code production is delegated to GLM 5.1 sub-agents. QC evaluation is delegated to Kimi 2.6. The master orchestrator sits above both, routing work and deciding outcomes.

---

## 5.4 Global Behavioral Constraints

All sub-agents must operate under the following standing behavioral constraints. These are not style guides or suggestions; they are **system architecture requirements** that affect implementation logic across all 11 work packages.

### 5.4.1 Compliance Filter — Always On

Compliance review is a **standing infrastructure layer**, not an advisory or post-hoc moderation layer.

- **Pre-generation:** Agent prompt templates contain embedded compliance rules (prohibited terms injected as negative constraints). This prevents non-compliant output at the source.
- **Pre-send:** Every agent-generated message passes through the Compliance Filter Engine (CFE) as a synchronous gate before reaching any delivery channel.
- **CFE Classifiers:** Five classifiers operate on every outbound artifact: Income Claim, Testimonial, Opportunity Statement, Insurance Recommendation, Referral Request.
- **Risk Scoring:**
  - **0–10:** Auto-deploy with audit log
  - **11–70:** Flag for upline manual review; escalate to compliance officer after 48 hours if unreviewed
  - **71–100:** Physically blocked — content returns HTTP 403 to the agent, physically prevented from deployment

**Sub-agent implementation requirement:** Any sub-agent building messaging (WP05), social content (WP06), agent scripts (WP04), motivational notifications (WP07), or any outbound-generating system must embed compliance constraints in its prompt architecture and define its interception path explicitly. No outbound system may be marked complete without a defined compliance gate.

### 5.4.2 Universal vs. Primerica Gating — Hard Architecture

The platform is designed to serve **any downline-driven organization**, but the flagship use case is Primerica. This conditionality is a **hard architecture branch**, not a content toggle or feature flag.

- **Universal features** must work for all users regardless of organization.
- **Primerica-specific features** must remain **completely hidden** unless Primerica is selected at onboarding.
- Hidden means hidden in: navigation, backend access rules, agent flows, data requirements, language weighting, motivational systems, milestone systems, and upline-linking logic.

**Sub-agent implementation requirement:**
- Sub-agents building **universal packages** (WP02, WP04, WP05, WP06, WP07, WP09, WP10, WP11) must not assume Primerica context, terminology, or data structures.
- Sub-agents building **Primerica-only packages** (WP03, WP08) must not inject Primerica-specific logic into universal surfaces or APIs.
- Organization gate logic defined in WP01 is the single source of branch truth. No package may invent its own org-detection mechanism.

**Primerica-only systems include, at minimum:**
- Harvest Warm Market Method (WP03)
- Taprooting (WP08)
- Primerica-specific timeline / milestones (WP08)
- Primerica-weighted quote engine behavior
- Solution number workflows
- Free-access org linkage logic tied to Primerica hierarchy assumptions

### 5.4.3 Brand Doctrine as Implementation Logic, Not Copy

Brand doctrine terms are **system behavior requirements**, not marketing garnish or decorative copy. The following concepts must be embedded as functional logic, not surface text:

| Doctrine Concept | Implementation Logic Requirement |
|-----------------|----------------------------------|
| **Downline Maxxing** | System optimizes for relationship-network compounding, not cold lead volume. Contact scoring, outreach prioritization, and gamification must measure network-level multiplication, not isolated conversions. |
| **Collective Benefit** | Visibility, incentives, and reporting must strengthen the team, not isolate the rep. Upline dashboards must show team health, not just individual rep activity. Motivation systems must celebrate team milestones, not only personal wins. |
| **Community Introduction** | Outreach logic must prefer warm relational bridges over impersonal selling. Script templates must lead with care and relationship context, never with pitch-first framing. |
| **Hidden Earnings Estimate** | Product must make latent value visible through relationship scoring and IPA projections, but **always as potential rather than guarantee**. No income claim may be generated or displayed without CFE clearance. |
| **Social 4.0 / People Compounding** | The product exists at the convergence of relationships, AI, CRM, and community-scale business growth. Architecture must treat relationships as the unit of economy, not content or ad impressions. |
| **2 Hour CEO** | UX and agent behavior must minimize cognitive load and compress owner effort into short, high-leverage daily engagement windows. Any feature that increases admin work or requires frequent manual babysitting is off-doctrine. |
| **Trust-First Architecture** | Always lead with relationship; never lead with pitch. All automated outreach must include relational context and memory of prior interactions. |
| **Sow Before Reaping** | Sustainable wealth requires a cycle of intentional planting and tending before expecting harvest. Cadence logic must enforce nurturing sequences before conversion asks. |

**Off-doctrine detection rule:** If a proposed implementation increases admin work, requires frequent manual babysitting, makes the user act like a conventional CRM operator, leans into spammy automation, cold-lead growth hacking, generic SaaS gamification, or solo-hustle framing — it is off-doctrine and must be rejected or corrected before the package is marked complete.

---

## 5.5 Cross-Package Consistency Rules

Sub-agents must preserve consistency across all 11 work packages. The following rules apply to all work without exception.

| Rule | Requirement | Verification Method |
|------|-------------|---------------------|
| **Terminology Stability** | Terms defined in Section 1.3 and the Brand Glossary (v4) must not be redefined, diluted, or substituted. Downline Maxxing, Mission Control, 2 Hour CEO, Community Introduction, Hidden Earnings Estimate, Social 4.0, People Compounding, and others must retain their defined meanings across all packages. | Cross-reference glossary before introducing new terminology. QC agent flags any redefinition. |
| **Gating Logic Consistency** | Organization gate logic defined in WP01 is the single source of branch truth. No package may invent its own org-detection mechanism, access tier logic, or role assignment system. | Verify gate assumptions against WP01 output before proceeding. |
| **Role Visibility Alignment** | Rep, Upline, RVP, and External role visibility rules defined in Section 1.5 must be consistent across all packages. No package may grant unauthorized visibility or omit required visibility. | Role access matrix must be referenced in every package that surfaces data to any role. |
| **Doctrine Injection** | Every package must identify which brand doctrine concepts materially shape its behavior (per Section 3.9). Doctrine injection is not optional; it is a deliverable requirement for every work package. | Package output must explicitly list doctrine injection points. QC verifies. |
| **Dependency Honor** | No sub-agent may begin work on a package whose prerequisites are incomplete. Capacity does not override dependencies. Hard prerequisites listed in Section 3.4 must be confirmed complete before authorization. | Master orchestrator confirms dependency status via `todo.md` and package index table before authorizing any task. |
| **Compliance Interception** | Every package that generates or transmits outbound content must define its compliance interception path. No exceptions. Universal packages and Primerica packages alike. | QC must verify that interception path is explicitly defined in package output. |
| **Primerica Containment** | Primerica-specific logic must be isolated to WP03 and WP08. Universal packages must remain organization-agnostic. Primerica terminology, milestones, and workflows must not leak into universal surfaces. | Code review must flag cross-contamination. CFE must not trigger on universal content due to Primerica-only rule leakage. |
| **Mission Control Coherence** | WP04 defines the Mission Control model. All packages that surface rep or upline dashboards (WP05, WP06, WP07, WP09) must align with Mission Control structure, not build independent dashboard logic. | Cross-reference WP04 output for Mission Control schema before building dependent surfaces. |
| **Subscription/Access State Consistency** | Free vs. paid access logic defined in WP01 and WP10 must be respected by all packages. No package may bypass access tier restrictions or invent new subscription rules. | Verify access tier assumptions against WP01 and WP10 outputs. |

---

## 5.6 Model Assignment Rules

Model roles are **fixed, non-interchangeable, and non-negotiable**. Sub-agents must not swap models, substitute fallback models, or override model assignments without explicit master orchestrator authorization.

| Role | Model | Thinking Level | Purpose | Fallback / Substitution Rule |
|------|-------|---------------|---------|------------------------------|
| **Master Orchestrator** | ChatGPT 5.4 (or highest available primary reasoning model) | High | Think, plan, delegate, evaluate, manage. Does NOT write code. | None — this is the top reasoning model available |
| **Code Writing (all sub-agents)** | Ollama GLM 5.1 | High | Write all application code, components, integrations | **NO FALLBACK.** If GLM 5.1 is unavailable, halt that work package, log the issue, and wait. Do NOT substitute Kimi 2.6 for code writing. |
| **QC Agent (all QC events)** | Ollama Kimi 2.6 | High | Evaluate all work packages, task-level QC, and final system pressure test | **NO FALLBACK.** If Kimi 2.6 is unavailable, hold completed work in QC queue. GLM 5.1 may continue writing other packages, but NO output advances past QC gate until Kimi 2.6 is back. |
| **PRD Writing — Foundation (Sections 1–3)** | ChatGPT 5.4 | High | Sequential foundation writing | Same as master orchestrator |
| **PRD Writing — Expansion (Sections 4–9)** | ChatGPT 5.4 | High | Parallel section writing (one agent per section) | Same as master orchestrator |
| **PRD Writing — Integration (Phase C)** | ChatGPT 5.4 | High | Full coherence pass across assembled PRD | Same as master orchestrator |
| **PRD QC / Final Pressure Test** | Ollama Kimi 2.6 | High | Grade PRD completeness, coherence, executability, doctrine fidelity | Same QC model rule — no substitution |

### 5.6.1 Critical Role Separation Rule

> **GLM 5.1 builds. Kimi 2.6 checks. Always. No exceptions.**

This separation is structural, not preferential. GLM 5.1 is optimized for code generation. Kimi 2.6 is optimized for evaluation and pressure testing. Crossing these roles degrades both build quality and QC integrity.

### 5.6.2 PRD Documentation Model Assignment

PRD documentation (Sections 1–9) is authored by **ChatGPT 5.4** during Phases A, B, and C. PRD documentation is graded and QC'd by **Kimi 2.6** during the final pressure test. The master orchestrator uses ChatGPT 5.4 for PRD writing because PRD authorship requires reasoning, synthesis, and architecture design — not code generation.

---

## 5.7 Error Handling and Escalation Rules

### 5.7.1 QC Loop Rules

A work package enters the QC loop when **either** of the following is true:
- QC score is below 8
- **Any** critical failure condition is present (regardless of score)

**QC Loop Process:**

| Step | Action | Actor |
|------|--------|-------|
| 1 | Master orchestrator receives QC results | Master Orchestrator |
| 2 | If score < 8 OR critical failure: send work back to original sub-agent (or new sub-agent) with specific written feedback | Master Orchestrator |
| 3 | Rework agent must use **GLM 5.1 (thinking: High)** — same model that wrote it originally | Sub-Agent |
| 4 | Kimi 2.6 re-evaluates the reworked output | QC Agent |
| 5 | Track attempt number | Master Orchestrator |

**Attempt Limits:**

| Attempt | Action |
|---------|--------|
| 1 | First rework + re-evaluation |
| 2 | Second rework + re-evaluation |
| 3 | Third rework + re-evaluation |
| >3 (after 3 failures) | **Escalate to human review.** Master orchestrator reviews the work package instruction block in the PRD for deficiency before reassigning. Rework model remains GLM 5.1 even after escalation. |

**Queue Management During QC Holds:**
- If Kimi 2.6 is unavailable: hold all completed work packages in a QC queue
- GLM 5.1 may continue writing code for other packages during the hold
- **No output advances past the QC gate until Kimi 2.6 is back online and QC queue is cleared**

### 5.7.2 Stalled Agent Recovery Protocol

| Step | Action | Condition |
|------|--------|-----------|
| 1. IDENTIFY | Confirm agent running >20 min with no output | Always |
| 2. CHECK LOCK | If session lock held >25 min → Gateway restart + log | Lock detected |
| 3. SOFT RECOVERY | Re-ping sub-agent with original instructions, wait 3 min | No lock issue |
| 4. HARD RECOVERY | Mark task incomplete, log failure, spawn new sub-agent, increment attempt | No response to soft recovery |
| 5. ESCALATE | Flag for human review, deliver immediate report, hold task, continue other work | After 3 total failed attempts |

### 5.7.3 Out-of-Sync Protocol

If local copy and GitHub diverge at any point:

1. **Stop** all work immediately.
2. **Pull** from GitHub.
3. **Overwrite** local with GitHub state.
4. **Verify** sync (checksum or file comparison).
5. **Log** event in `harvest-changelog.md`.
6. **Resume** from verified state.

**Rule:** Never push local to resolve conflict. GitHub always wins. Sub-agents must not attempt to resolve sync conflicts.

### 5.7.4 Critical Failure Triggers

The following conditions trigger **immediate escalation** to the master orchestrator and, if unresolved within one recovery cycle, to human review:

- Compliance filter bypassed, disabled, or missing from a package that generates outbound content
- Primerica-specific content, terminology, or data requirements leaking into universal experience
- Sub-agent modifies any PRD `.md` file
- Sub-agent pushes to GitHub, Vercel, or any deployment target
- QC score below 8 after 3 loop attempts
- Session lock held >25 minutes
- Agent stall >20 minutes with no output after soft recovery
- Dependency violation (package begins before prerequisites complete)
- Model substitution without master orchestrator authorization
- Sub-agent self-authorizes a new task or phase
- Sub-agent QC's its own work

---

## 5.8 Session Management and Checkpoint Requirements

### 5.8.1 Context Checkpoint Protocol

When any session (master orchestrator or sub-agent) approaches **~90% context window utilization**, it must save a checkpoint before continuing.

**Checkpoint file naming convention:**
```
memory/YYYY-MM-DD-[PROJECT]-[AGENT]-checkpoint.md
```

**Checkpoint must include:**
- Current task state and progress
- Key decisions made during the session
- Unresolved blockers or open questions
- Next steps and priorities
- Reference to any in-progress deliverables

**Resume protocol:** New session loads the checkpoint to resume. Do not restart from scratch if a checkpoint exists.

### 5.8.2 HEARTBEAT.md Population

- HEARTBEAT.md must remain **populated with the full active monitoring checklist** for the entire build duration.
- **Empty = deactivated** = build supervision gap = critical failure.
- HEARTBEAT.md must include:
  - Agent health checks (session duration, lock status)
  - Task status checks (stalled tasks, QC loop status)
  - Build continuity checks (handoff.md recency, GitHub sync status)
- Sub-agents must not modify, clear, or interact with HEARTBEAT.md.

### 5.8.3 handoff.md Updates

- Update `handoff.md` at the **close of every working session**.
- Update `handoff.md` **before any context compaction event**.
- Must capture:
  - Completed tasks since last update
  - Tasks currently in progress
  - Blockers and dependencies
  - Next priorities
  - Version state and GitHub sync status
- Sub-agents must not write to `handoff.md`.

### 5.8.4 Supervision Infrastructure Requirements

Before any sub-agent is deployed, the following infrastructure must be active and verified:

| Infrastructure | Specification | Verification Command |
|----------------|---------------|---------------------|
| **Cron Supervisor** | `harvest-build-supervisor`, every 15 minutes, timezone America/Chicago | `openclaw cron status harvest-build-supervisor` |
| **Sub-Agent Timeout** | 1,200 seconds (20 minutes) | `openclaw config get agents.defaults.timeoutSeconds` |
| **LLM Idle Timeout** | 120 seconds | `openclaw config get agents.defaults.llm.idleTimeoutSeconds` |
| **HEARTBEAT.md** | Populated with full checklist | Read file — must not be empty |
| **handoff.md** | Updated with current state | Read file — timestamp must be recent |
| **Gateway Status** | Operational | `openclaw gateway status` |

**Rule:** Supervision infrastructure must be active **before** any sub-agent is deployed. Neither cron nor HEARTBEAT.md alone is sufficient. Both must be active simultaneously.


- Status notifications held between **11 PM – 7 AM local time**.
  - Gateway freeze
  - Session lock held 25+ minutes
  - Compliance filter bypass
  - Primerica content leakage into universal experience

### 5.8.6 Teardown Gate

Build teardown may begin **only when ALL FOUR conditions are met simultaneously**:

1. Final QC passed with score **8+ and zero critical failures**
2. All push destinations confirmed — GitHub current, Vercel live, all others verified
3. Changelog final entry written with final version number
4. GitHub repo and local folder confirmed in sync

**Post-teardown requirement:** Run `openclaw doctor` and confirm clean system state. Build is **not officially closed** until the health check passes.

**Teardown sequence (exact order):**
1. Disable cron supervisor
2. Verify cron shows `Enabled: false`
3. Remove cron job
4. Confirm job is gone (repeat removal if silent failure occurs)
5. Clear HEARTBEAT.md checklist (leave headers; delete items)
6. Verify no new heartbeat runs post-clear
7. Log teardown in changelog
8. Run `openclaw doctor` — build closed only on clean pass

---

## 5.9 Enforcement and Violation Logging

Every violation of Section 5 must be logged in `harvest-changelog.md` with:
- Timestamp
- Violated rule number and description
- Offending agent identifier (if known)
- Master orchestrator remediation action taken
- Whether human escalation was triggered

The master orchestrator maintains the authority to terminate any sub-agent immediately upon violation, remove it from the build, and requeue its work package to a new agent.

---

**End of Section 5 — Global Sub-Agent Rules and Behavioral Constraints**

**Status: Ready for integration into master PRD assembly**


## Section 6: QC Standards, Loop Rules, and QC Criteria

## 6.0 Overview
This section defines the mandatory Quality Control (QC) framework for The Harvest project. Every work package produced by sub-agents must undergo strict, independent verification before advancement.

## 6.1 Role Separation & Cross-Model Verification
To prevent self-confirmation bias, strict cross-model role separation is enforced:
*   **Production Role (GLM 5.1):** Responsible for writing all code and content.
*   **QC Role (Kimi 2.6):** Responsible for evaluating all outputs.

**Hard Rule:** The model that produces the work **must never** be the model that performs the QC evaluation.

### 6.1.1 QC Queue Mechanics
When Kimi 2.6 is unavailable, completed work packages enter a **FIFO QC queue**.
*   **Max Queue Depth:** 8 work packages before backpressure is signaled to the Master Orchestrator.
*   **Backpressure Action:** Orchestrator pauses new GLM 5.1 production assignments until queue depth drops below 4.
*   **Escalation Timeout:** If Kimi 2.6 remains unavailable for **>30 minutes**, the Master Orchestrator escalates to human review with a summary of queued packages and their critical-path status.

## 6.2 QC Standards & Rating Criteria
Every work package is assigned a numeric score out of 10 by the QC Agent (Kimi 2.6).

*   **Pass Threshold:** Minimum score of **8/10**.
*   **Fail Condition:** Score below 8, or the presence of any **Critical Failure** (regardless of numeric score).

### 6.2.1 Scoring Rubric
The 10-point score is derived from weighted categories:

| Category | Weight | Points | Focus |
| --- | --- | --- | --- |
| Functionality / Requirement Coverage | 40% | 4 pts | All stated requirements implemented; no missing acceptance criteria |
| Security & Compliance | 30% | 3 pts | No hard-rule violations; no injection/XSS/secret leakage; auth enforced |
| Code Quality / Documentation | 20% | 2 pts | Readable, maintainable code; inline docs match implementation; no dead code |
| Performance / Edge Handling | 10% | 1 pt | Graceful error handling; boundary conditions tested; no obvious performance regressions |

**Scoring Guidance:**
*   4/4 Functionality = all requirements met with no workarounds.
*   3/3 Security = zero compliance or security gaps.
*   2/2 Quality = self-documenting structure, consistent style, no TODOs without tickets.
*   1/1 Performance = handles null/empty/malformed inputs without crash or data loss.

### 6.2.2 Critical Failure Taxonomy
The following overrides trigger an **immediate QC Fail** regardless of total score:

1.  **Hard-rule violation** from `compliance-extraction-v4.md` (e.g., unlicensed carrier mention, prohibited benefit language).
2.  **Security vulnerability:** SQL injection, XSS, secret leakage in logs or responses, missing auth on protected endpoints.
3.  **Breaking public API contract** without versioning or migration path.
4.  **Data loss or irreversible migration risk:** schema change without rollback plan, destructive operation without backup.
5.  **Sub-agent exceeding permission boundaries:** modifying core PRD files, changing orchestrator state, or accessing unauthorized scopes.
6.  **PRD section self-reference loop:** a section referencing itself as its own source of truth, creating circular dependency.

## 6.3 Work-Package-Type QC Criteria
QC evaluation adapts to the artifact type. The following per-type criteria supplement the rubric:

*   **UI/Frontend:** Accessibility (WCAG 2.1 AA minimum), responsive breakpoints verified at 320px/768px/1440px, asset optimization (images <500KB, lazy loading).
*   **API/Backend:** OpenAPI spec adherence (if applicable), uniform error response envelope (`{success, data, error, message}`), auth enforcement on all non-public routes.
*   **Database:** Migration reversibility (down script present and tested), index coverage on lookup columns, foreign-key constraint integrity enforced.
*   **Infrastructure:** Idempotency (rerunning script produces same result), rollback procedure documented, heartbeat/cron job verified active with last-run timestamp <5 min old.
*   **Documentation:** Accuracy against committed code (no stale paths or renamed functions), completeness of setup steps (fresh clone → running system).

## 6.4 Quality Control Loop (QC Loop) Rules
If a work package fails QC (score < 8 or any critical failure), it enters the QC Loop.

### 6.4.1 Loop Process
1.  **Notification:** Master Orchestrator marks the package as "Failed" and appends the QC feedback.
2.  **Revision:** Original production model (GLM 5.1) receives the work plus the written feedback.
3.  **Re-evaluation:** Kimi 2.6 performs a fresh evaluation of the revised code.

### 6.4.2 Loop Termination & Escalation
*   **Maximum Loops:** A work package is permitted a **maximum of 3 revision loops**.
*   **Escalation:** If a package fails QC after the 3rd attempt, it is escalated to human review. The Master Orchestrator must hold further development on dependencies of that package until human review resolves the bottleneck.

### 6.4.3 QC Feedback Format
Every failure report must include the following five elements:

(a) **Overall score** (numeric out of 10)
(b) **Rubric breakdown by category** (4-category table with points awarded)
(c) **Critical failure list** (if any; list by taxonomy ID from 6.2.2)
(d) **Actionable correction list** with specific PRD section references (e.g., "Add FK constraint per Section 4.3.2; restore rollback script per Section 7.1.4")
(e) **Re-evaluation scope** declaration: `FULL` or `DELTA`

### 6.4.4 Re-Evaluation Scope Rules
*   **Critical failures → FULL re-evaluation:** The entire work package is re-evaluated from scratch.
*   **Non-critical failures → DELTA re-evaluation:** Only the changed items and their direct dependents are re-evaluated.

## 6.5 Final System-Level QC (Pressure Test)
Once all individual work packages pass, the final PRD undergoes a system-level pressure test performed by Kimi 2.6.

*   **Objective:** Verify end-to-end integration, functional coherence, and alignment with original user stories.
*   **Pass Criteria:** 8/10 score with **zero Critical Failures**.
*   **Result:** A pass authorizes final deployment; a fail returns the system to reassessment overseen by the Master Orchestrator.

### 6.5.1 Verification Questions (Pressure Test Script)
Kimi 2.6 must answer the following 8 questions with a yes/no or scored response:

1.  Does the integrated system satisfy all user stories in Section 1 without workaround?
2.  Are all hard rules from `compliance-extraction-v4.md` enforced in code?
3.  Does the critical path (WP11 → WP01 → WP02 → WP04 → WP05) match implementation?
4.  Is Universal vs Primerica gating implemented as hard architecture?
5.  Are all 11 work packages covered with no orphaned functionality?
6.  Does the compliance filter intercept all outbound content?
7.  Does payment/subscription logic match the 3-tier model?
8.  Can the system survive a session compaction and resume from checkpoint?

## 6.6 Expanded Document-Specific QC Checklists

| PRD Section | Mandatory QC Focus |
| --- | --- |
| Section 1 (User Stories) | Every story maps to ≥1 WP; no story left unimplemented; acceptance criteria testable |
| Section 2 (Architecture) | Hard boundaries between Universal/Primerica; no logic leakage; diagram matches code |
| Section 3 (Work Packages) | All 11 WPs defined; dependencies acyclic; no WP references undefined WP |
| Section 4 (Data Model) | Migrations reversible; indexes present; FK constraints match ERD; no PII in plain text |
| Section 5 (API Contracts) | OpenAPI/spec matches implementation; error envelopes uniform; versioning strategy followed |
| Section 6 (QC Standards) | This section itself is current; rubric applied consistently; critical failures logged |
| Section 7 (Infrastructure) | Cron/heartbeat verified live; rollback scripts tested; env vars documented |
| Section 8 (Compliance) | All hard rules from extraction v4 enforced; filter active on all outbound paths |
| Section 9 (Deployment) | Deploy script idempotent; secrets injected securely; health-check endpoint responds 200 |


## Section 7: Delivery and Push Destinations

# Section 7 — Delivery and Push Destinations

## 7.1 Governing Principle: GitHub as Source of Truth

The Harvest build pipeline operates under a single, non-negotiable authority:

> **The GitHub repository is the sole governing source of truth. The local folder is a carbon copy only.**

This authority applies to all artifacts produced during the PRD phase and the build phase: `.md` files, configuration files, source code, documentation, and operational control documents. No local file may override or supersede its GitHub counterpart under any circumstance.

### 7.1.1 Repository Identity

| Attribute | Value |
|-----------|-------|
| **GitHub Repository** | `harvest-app` |
| **Local Carbon Copy** | `~/.openclaw/workspace/prd-packages/harvest-app/` |
| **Default Branch** | `main` |
| **PRD Branch** | `prd` (separate from application code; see Section 7.6) |
| **Deployment Target** | Vercel (production environment) |

### 7.1.2 Authority Hierarchy

```
GitHub Repository (harvest-app)
  ├── PRD Branch (prd)
  │   ├── harvest-prd.md
  │   ├── harvest-todo.md
  │   ├── harvest-qc-checklist.md
  │   ├── harvest-changelog.md
  │   └── harvest-handoff.md
  └── Main Branch (main)
      ├── /src (application source)
      ├── /docs
      ├── /tests
      ├── package.json
      ├── vercel.json
      └── README.md

Local Carbon Copy (prd-packages/harvest-app/)
  └── Mirrors GitHub exactly at all times
```

**Rule:** If GitHub and local ever disagree, GitHub wins unconditionally. The local copy is overwritten, never the other way around.

---

## 7.2 Push Protocol: Master Orchestrator Exclusive

Only the master orchestrator may push to the `harvest-app` GitHub repository. Sub-agents, helper agents, and external processes are strictly prohibited from pushing, updating, or modifying any repository content.

### 7.2.1 Push Trigger Conditions

A push to GitHub occurs only after the following conditions are met:

| Condition | Verification |
|-----------|-------------|
| 1. Work package approved after QC | QC score ≥ 8/10 with zero critical failures |
| 2. PRD version updated | Version number incremented per semantic rules |
| 3. Changelog entry written | Entry dated, versioned, and describes the change |
| 4. Local file integrity confirmed | File contents verified against expected state |
| 5. Dependency gating satisfied | All prerequisite packages marked complete |

### 7.2.2 Push Sequence

```
Step 1: Master orchestrator approves work package completion
Step 2: Update harvest-changelog.md with version + description
Step 3: Update relevant .md file(s) with approved content
Step 4: Stage files: git add [modified files]
Step 5: Commit with versioned message: "[vX.Y.Z] — [Package] — [Brief description]"
Step 6: Push to origin/[branch]
Step 7: Verify remote HEAD matches local HEAD
Step 8: Sync local carbon copy to match remote
Step 9: Log push event in harvest-handoff.md
```

### 7.2.3 Commit Message Convention

All commits must follow this format:

```
[vX.Y.Z] — [WP##] — [Action verb] [subject]

[Optional: Brief description of what changed and why]
[Optional: QC score reference]
```

**Examples:**
- `[v1.3.0] — WP01 — Complete Onboarding & Profile Engine specification`
- `[v1.3.1] — WP04 — Revise agent boundary definitions per QC feedback (score: 9/10)`

---

## 7.3 Out-of-Sync Resolution Protocol

When the local carbon copy drifts from GitHub, the following protocol is mandatory:

### 7.3.1 Detection

| Scenario | Detection Method |
|----------|-----------------|
| Pre-work sync check | `git fetch origin` then `git status` |
| Post-push verification | `git log --oneline -5` compared to remote |
| Cron supervisor check | Automated diff between local and origin every 15 minutes |
| Manual suspicion | Visual inspection of file contents or timestamps |

### 7.3.2 Resolution Steps (Exact Order)

```
1. STOP all local edits immediately.
2. PULL from GitHub: git pull origin [branch] --force
3. OVERWRITE local with remote: git reset --hard origin/[branch]
4. VERIFY local now matches remote: git diff --exit-code
5. LOG the event in harvest-changelog.md with timestamp and cause
6. RESUME work from the now-synced local copy
```

**Critical Rule:** Never push local changes to resolve a conflict. Never merge local over remote. The only resolution path is `pull → overwrite → verify`.

### 7.3.3 Conflict Caused by Sub-Agent Error

If a sub-agent produced content that was never approved or pushed, and that content exists only locally:

1. Do not push the unapproved content.
2. Pull from GitHub to overwrite the local state.
3. Log the event as "Unapproved local content discarded — GitHub source of truth enforced."
4. The approved version from GitHub stands.

---

## 7.4 Local Sync Confirmation

After every push to GitHub, the master orchestrator must confirm that the local carbon copy is synchronized.

### 7.4.1 Sync Verification Checklist

- [ ] `git status` reports `nothing to commit, working tree clean`
- [ ] `git log --oneline -3` matches remote HEAD exactly
- [ ] All 5 PRD package files present in local folder with matching timestamps
- [ ] No untracked files in PRD package directory
- [ ] `git diff origin/[branch]` returns empty output

### 7.4.2 Failure Recovery

If any check fails:

1. Run the Out-of-Sync Protocol (Section 7.3.2) immediately.
2. Do not proceed with new work until sync is confirmed.
3. Log the sync failure in `harvest-changelog.md`.

---

## 7.5 Five-File PRD Package Structure

The PRD package consists of exactly five files. No file may be skipped. No additional files may be added to the PRD package without master orchestrator approval.

### 7.5.1 File Inventory

| # | File Name | Purpose | Authority |
|---|-----------|---------|-----------|
| 1 | `harvest-prd.md` | Master blueprint — product definition, work packages, dependency map, build workflow | Master orchestrator only |
| 2 | `harvest-todo.md` | Live task tracker — operational status board with checkboxes | Master orchestrator only (read by all) |
| 3 | `harvest-qc-checklist.md` | Work-package-specific QC criteria + Final QC pressure test protocol | Master orchestrator + QC agents |
| 4 | `harvest-changelog.md` | Version-controlled log of every change, push, sync event, and recovery | Master orchestrator only |
| 5 | `harvest-handoff.md` | Session memory and continuity file — current state snapshot | Master orchestrator only |

### 7.5.2 Storage Locations

| Environment | Path |
|-------------|------|
| **GitHub** | `harvest-app` repository, `prd` branch, root directory |
| **Local** | `~/.openclaw/workspace/prd-packages/harvest-app/` |

### 7.5.3 File Rules

- All five files must exist before any sub-agent is deployed.
- All five files must remain in the root of the PRD branch on GitHub.
- No sub-agent may create, modify, or delete any `.md` file in the PRD package.
- The master orchestrator is the sole entity with write authority over these five files.

---

## 7.6 Application Codebase Structure

The application code lives alongside the PRD package within the same `harvest-app` GitHub repository, but on a separate branch to preserve clean separation.

### 7.6.1 Branch Architecture

```
harvest-app repository
│
├── prd branch (protected, PRD package only)
│   ├── harvest-prd.md
│   ├── harvest-todo.md
│   ├── harvest-qc-checklist.md
│   ├── harvest-changelog.md
│   └── harvest-handoff.md
│
├── main branch (protected, application code)
│   ├── /src
│   │   ├── /components
│   │   ├── /services
│   │   ├── /hooks
│   │   ├── /lib
│   │   └── /types
│   ├── /tests
│   ├── /docs
│   ├── package.json
│   ├── next.config.js / vercel.json
│   ├── tsconfig.json
│   └── README.md
│
└── feature/* branches (ephemeral, per-work-package)
```

### 7.6.2 Code Placement Rules

| Rule | Description |
|------|-------------|
| PRD stays on `prd` branch | Never mix PRD `.md` files into `main` or feature branches |
| Code stays on `main` and feature branches | Never merge application code into `prd` branch |
| Feature branches originate from `main` | Each work package gets a dedicated `feature/wp##-*` branch |
| PRD updates merge to `prd` only | No code review required; master orchestrator authority |
| Code merges require QC pass | Kimi 2.6 QC approval before any code merges to `main` |

### 7.6.3 Directory Conventions

```
harvest-app/
├── src/
│   ├── app/                    # Next.js app router
│   ├── components/
│   │   ├── ui/                 # Shared UI primitives
│   │   ├── onboarding/         # WP01
│   │   ├── warm-market/        # WP02, WP03
│   │   ├── agents/             # WP04
│   │   ├── messaging/          # WP05
│   │   ├── social/             # WP06
│   │   ├── motivation/         # WP07
│   │   ├── taprooting/         # WP08
│   │   ├── calendar/           # WP09
│   │   └── payment/            # WP10
│   ├── services/
│   │   ├── compliance/         # WP11
│   │   ├── api/
│   │   ├── ai/
│   │   └── integrations/
│   ├── lib/
│   ├── types/
│   └── hooks/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
├── public/
└── scripts/
```

---

## 7.7 Vercel Deployment Rules

Vercel hosts the production application. Deployment is governed by the following rules.

### 7.7.1 Deployment Authority

| Action | Permitted Actor |
|--------|----------------|
| Production deployment to Vercel | Master orchestrator only |
| Preview deployments from feature branches | Vercel auto-deploy (via Git integration) |
| Manual promotion to production | Master orchestrator only |

### 7.7.2 Deployment Trigger

Production deployment occurs only when:

1. QC final pressure test passes (score ≥ 8/10, zero critical failures).
2. All four teardown prerequisites are met (see AI Instructions Part 14).
3. Changelog final entry is written.
4. `main` branch HEAD is tagged with release version.

### 7.7.3 Deployment Sequence

```
Step 1: Confirm main branch passes all tests
Step 2: Tag release: git tag -a vX.Y.Z -m "Release vX.Y.Z"
Step 3: Push tag: git push origin vX.Y.Z
Step 4: Vercel detects tag and triggers production build
Step 5: Monitor build logs for errors
Step 6: Verify deployment URL returns HTTP 200
Step 7: Log deployment in harvest-changelog.md
Step 8: Confirm in harvest-handoff.md
```

### 7.7.4 Rollback Protocol

If a production deployment fails or introduces critical errors:

1. Identify last known good deployment in Vercel dashboard.
2. Execute Vercel rollback to previous stable deployment.
3. Log rollback event in `harvest-changelog.md`.
4. File incident report in `harvest-handoff.md`.
5. Create hotfix branch from last good commit.
6. Repair and re-deploy through normal QC-gated pipeline.

### 7.7.5 Environment Configuration

| Environment | Branch | Vercel Domain | Purpose |
|-------------|--------|---------------|---------|
| Production | `main` | `harvest-app.vercel.app` | Live user-facing application |
| Preview | `feature/*` | `[branch]-harvest-app.vercel.app` | Per-PR preview and testing |
| Development | Local only | `localhost:3000` | Local development and debugging |

---

## 7.8 Branch Strategy: PRD Separate from Application Code

The repository enforces strict branch separation to prevent PRD operational documents from polluting the application codebase and vice versa.

### 7.8.1 Branch Definitions

| Branch | Purpose | Protection |
|--------|---------|----------|
| `prd` | Contains only the five PRD package files. Master orchestrator authority. | Force-push disabled; direct commits by master orchestrator only |
| `main` | Production application code. All code merges require QC pass. | Pull request required; QC gate enforced |
| `feature/wp##-[name]` | Per-work-package development branches. Auto-deploy previews. | Auto-deleted after merge |
| `hotfix/[description]` | Emergency repairs to production. Fast-tracked QC. | Same protection as `main` |

### 7.8.2 Cross-Branch Rules

| Rule | Enforcement |
|------|-------------|
| Never merge `main` into `prd` | `prd` remains PRD-only forever |
| Never merge `prd` into `main` | PRD files do not belong in application build |
| Feature branches merge to `main` only | Via pull request + QC pass |
| PRD updates commit directly to `prd` | No pull request; master orchestrator authority |
| Tags on `main` trigger production | Semantic version tags only |

### 7.8.3 Versioning

| Artifact | Versioning Scheme | Example |
|----------|-------------------|---------|
| PRD package | Semantic (`vX.Y.Z`) | `v1.5.2` |
| Application releases | Semantic (`vX.Y.Z`) | `v1.5.2` |
| Changelog entries | Dated + versioned | `2026-04-27 — v1.5.2 — WP05 final approved` |

**Synchronization Rule:** On every push, the PRD package version, changelog version, and README version must all carry the same version number. No push with mismatched versions is permitted.

---

## 7.9 Delivery Verification Standards

Every delivery action must be verifiable. The following standards apply:

### 7.9.1 Push Verification

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Remote commit exists | `git log origin/prd --oneline -1` | Matches local commit hash |
| File contents identical | `git diff origin/prd --name-only` | Empty output |
| Version number updated | Read `harvest-changelog.md` | Contains entry matching commit version |
| Changelog entry present | `grep "vX.Y.Z" harvest-changelog.md` | At least one match |

### 7.9.2 Deployment Verification

| Check | Method | Pass Criteria |
|-------|--------|---------------|
| Vercel build success | Vercel dashboard / API | Status = `READY` |
| Application responds | `curl -I https://harvest-app.vercel.app` | HTTP 200 |
| No runtime errors | Vercel logs | Zero critical errors in last 10 minutes |
| Correct version served | Check API endpoint or meta tag | Matches release tag |

### 7.9.3 Sync Audit Trail

Every synchronization event must leave an audit trail in `harvest-changelog.md`:

```
[YYYY-MM-DD HH:MM] — vX.Y.Z — [Event Type]
  Action: [What happened]
  Cause: [Why it happened, if applicable]
  Resolution: [How it was resolved]
  Verified: [Yes/No — by whom]
```

---

## 7.10 Summary Table: Delivery Authorities and Rules

| Action | Actor | Branch | QC Required | Log Required |
|--------|-------|--------|-------------|--------------|
| Write/update PRD `.md` files | Master orchestrator | `prd` | No | Yes (changelog) |
| Push PRD to GitHub | Master orchestrator | `prd` | No | Yes (changelog + handoff) |
| Write application code | GLM 5.1 sub-agent | `feature/*` | Yes (Kimi 2.6) | No (code commits) |
| Merge code to `main` | Master orchestrator | `main` | Yes (Kimi 2.6) | Yes (changelog) |
| Deploy to Vercel production | Master orchestrator | `main` | Yes (final QC) | Yes (changelog) |
| Resolve out-of-sync | Master orchestrator | Any | No | Yes (changelog) |
| Update todo.md | Master orchestrator | `prd` | No | Yes (changelog) |
| Create feature branch | Master orchestrator | `feature/*` | No | No |
| Tag release | Master orchestrator | `main` | Yes (final QC) | Yes (changelog) |

---

**End of Section 7 — Delivery and Push Destinations**


## Section 8: Compliance, Legal, and Data Privacy Standards

This section defines the compliance, legal, and data privacy framework that governs The Harvest Platform and all AI-generated content. These standards are foundational to product architecture, ensuring all platform activities—from agent growth to wealth tracking—remain within the highest regulatory and ethical constraints.

## 8.1 Regulatory Compliance & Financial Products

### 8.1.1 FINRA Rule 2210 & Rule 3110 (Supervisory Requirements)
All platform-generated content concerning financial products or investments must adhere strictly to **FINRA Rule 2210** (Communications with the Public) and **FINRA Rule 3110** (Supervision).

- **Rule 2210 — Communications Compliance:**
  - Any agent-driven discussion of financial products triggers the Compliance Filter Engine (CFE) for automated FINRA evaluation.
  - Content must be fair and balanced, providing a sound basis for evaluating facts. No content may be promissory or misleading.
  - Communications must be suitable for the intended audience and must not contain exaggerated or unwarranted claims.

- **Rule 3110 — Supervisory Requirements:**
  - The platform must maintain a supervisory system reasonably designed to achieve compliance with applicable securities laws, regulations, and FINRA rules.
  - **Principal Review Triggers:** All agent-generated outbound communications that score in the CFE **Flag range (11–70)** require principal review by a registered principal before deployment. Communications in the **Block range (71–100)** require principal review AND compliance officer sign-off before any remediation or manual override.
  - The supervisory system must include review of incoming and outgoing written (including electronic) correspondence and internal communications related to the platform’s business.
  - Annual compliance meetings for principals and compliance officers must be documented and tracked within the platform.

### 8.1.2 State Insurance Restrictions
For multi-state insurance operations, the platform adopts the **"strictest-governs"** rule.

- If a state has stricter content requirements than the base regulatory framework, the platform enforces those restrictions across all related content generation.
- Reps must ensure licensing disclosures are accurate for the specific insurance products/states discussed.

- **State Regulatory Matrix Service (Enforcement Mechanism):**
  - A dedicated `StateRegulatoryMatrix` service maps state-by-state insurance content requirements, including state-specific disclosure mandates, licensing triggers, and prohibited language.
  - The service **auto-applies the strictest applicable rule** across all content generation contexts. When content targets multiple states, the system dynamically computes the intersection of requirements and enforces the highest standard.
  - Rules are **parameterized via configuration** (not hardcoded). State requirements are stored as configuration records (`state_code`, `rule_type`, `severity`, `template_override`, `effective_date`, `sunset_date`) and applied at runtime.
  - Configuration updates (e.g., a new state law or rule change) are deployed via config change, **not code change**. Updates propagate within 5 minutes of config publication.
  - The matrix is versioned; historical rule states are retained for audit purposes.
  - Automated regression tests validate that the strictest rule is correctly applied for all multi-state combinations on every config update.

### 8.1.3 FTC Income Claim Rules
- **Income Claims:** All claims regarding income or earnings potential must be substantiated by empirical data.
- **Native Advertising:** All agent-generated content must explicitly disclose its commercial nature if the content could be interpreted as non-commercial by a reasonable consumer.
- **Testimonials:** Any testimonials included in outreach or training must be substantiated, accompanied by a disclosure indicating the results are not typical.

### 8.1.4 Communications Recordkeeping (FINRA Rule 2210 / 3110)
All agent-generated outbound communications are subject to mandatory recordkeeping under FINRA Rule 2210 and supervisory recordkeeping under Rule 3110.

- **Retention Period:** Communications records must be retained for **3 years** (or longer if required by state law), with the first 2 years in an easily accessible place.
- **Accessible Format Requirement:** All records must be stored in a non-proprietary, searchable format that permits rapid retrieval by date, recipient, sender, content classifier, and CFE score. PDF or HTML rendering is generated and indexed at time of creation.
- **WORM or Equivalent:** Records are stored on Write-Once-Read-Many (WORM) media or an equivalent tamper-evident storage system (e.g., immutable object storage with object lock, cryptographically signed append-only ledgers). No record may be altered, overwritten, or deleted during the retention period.
- **Retrieval SLA:** Any communication record must be retrievable within **30 seconds** for compliance officer queries and within **2 hours** for bulk regulatory requests (e.g., FINRA or state AG document demands).
- **Supervisory Review Log:** Principal review actions (approve, reject, annotate) are logged as separate immutable records linked to the original communication, with principal identity, timestamp, and rationale captured.

---

## 8.2 Data Privacy Standards (GDPR, CCPA/CPRA, CDPA, CPA)

### 8.2.1 GDPR (General Data Protection Regulation)
The Harvest Platform fully complies with the EU General Data Protection Regulation (Regulation (EU) 2016/679).

- **Lawful Bases for Processing (Article 6):** The platform recognizes and implements all six GDPR lawful bases, applying the correct basis to each processing activity:

  | Lawful Basis | When Applied on The Harvest Platform |
  | :--- | :--- |
  | **Consent** | Marketing communications, optional profiling, cookies and tracking, AI-driven personalization where not covered by contract. Must be explicit, granular, and freely given. |
  | **Contract** | Processing necessary to deliver core platform services (agent onboarding, contact management, commission tracking) under the Terms of Service. |
  | **Legal Obligation** | Retention of financial/commission records for tax and regulatory compliance; response to lawful requests from supervisory authorities. |
  | **Vital Interests** | Rare; applies only in emergency scenarios (e.g., safeguarding a user’s life if reported through platform channels). |
  | **Public Task** | Not typically applicable; reserved for any future regulatory reporting mandated by EU or member state law. |
  | **Legitimate Interest** | Internal analytics, fraud detection, platform security monitoring, and network diagnostics—balanced against user rights via Legitimate Interest Assessment (LIA). Users may object; objection is honored unless overriding legal grounds exist. |

- **Data Subject Rights:** Users may access, rectify, or port their data through the Data Rights Portal.
- **Deletion SLA:** Deletion requests must be fully serviced (cascading across systems) within 30 days.
- **DPIA (Data Protection Impact Assessment):** Mandatory for all automated agent-driven decision pipelines and any high-risk data processing activities.

### 8.2.2 CCPA & CPRA (California Consumer Privacy Act / California Privacy Rights Act)
The platform complies with the CCPA (Cal. Civ. Code § 1798.100 et seq.) as amended and superseded in key areas by the **CPRA (effective January 1, 2023)**.

- **CPRA Updates / Superseding CCPA Provisions:**
  - CPRA introduces a new category of **"sensitive personal information"** (SPI), including government ID numbers, financial account data, geolocation, and contact list contents. Users must be notified of SPI collection and given the right to limit its use and disclosure.
  - CPRA expands the definition of "sharing" to include cross-context behavioral advertising, triggering opt-out rights beyond traditional "sale."
  - CPRA establishes the **California Privacy Protection Agency (CPPA)** as the enforcement authority with independent audit and penalty authority.
  - CPRA requires data minimization and purpose limitation principles (not present in original CCPA).
  - CPRA mandates **Risk Assessments** for processing that presents significant risk to consumer privacy (mirroring GDPR DPIAs).

- **Collection Disclosure:** Full transparency regarding the categories of personal data collected, processing purposes, and downstream data sharing.
- **Opt-Out:** Users have absolute rights to opt-out of data sharing (which is prohibited for contact data, see Section 8.5) and, under CPRA, to limit the use of sensitive personal information.
- **Deletion SLA:** Deletion requests serviced within 45 days (with a possible 45-day extension for complex requests, per CPRA).

### 8.2.3 Virginia CDPA & Colorado CPA
The platform extends privacy protections to users in jurisdictions with comprehensive privacy statutes.

- **Virginia Consumer Data Protection Act (CDPA — effective January 1, 2023):**
  - Applies to controllers processing personal data of ≥100,000 Virginia consumers or ≥25,000 consumers with >50% revenue from personal data sales.
  - Grants Virginia consumers rights to access, correct, delete, and obtain a copy of their personal data, plus the right to opt out of processing for targeted advertising, sale, or profiling.
  - Requires controllers to conduct and document Data Protection Assessments (DPAs) for processing activities involving heightened risk (targeted advertising, sale, profiling, sensitive data).
  - **Harvest Platform Action:** CDPA rights are serviced through the same Data Rights Portal as GDPR/CCPA. DPA obligations are fulfilled through the existing DPIA framework, extended to cover CDPA-specific risk scenarios.

- **Colorado Privacy Act (CPA — effective July 1, 2023):**
  - Grants Colorado consumers rights to opt out of targeted advertising, sale of personal data, and profiling in furtherance of decisions with legal or similarly significant effects.
  - Requires controllers to respond to consumer rights requests within 45 days (extendable by 45 days).
  - Mandates that controllers provide a clear and accessible privacy notice and obtain opt-in consent for processing sensitive personal data.
  - **Harvest Platform Action:** CPA opt-out mechanisms are integrated into the platform’s universal privacy controls. Sensitive data processing for Colorado users is gated behind explicit opt-in consent, with granular toggles in the Privacy Settings dashboard.

### 8.2.4 Cross-Border Data Transfers
When personal data leaves the European Economic Area (EEA), the platform ensures lawful transfer mechanisms are in place.

- **Standard Contractual Clauses (SCCs):** All transfers from EEA controllers to non-EEA processors use EU Commission-approved SCCs (2021/914). Module Two (Controller to Processor) and Module Three (Processor to Processor) are applied as appropriate.
- **Adequacy Decisions:** Transfers to jurisdictions with an EU adequacy decision (e.g., UK, selected territories) rely on the adequacy finding. The list of adequate jurisdictions is reviewed quarterly.
- **Transfer Impact Assessment (TIA):** Before any data transfer to a non-adequate jurisdiction, a documented TIA is completed. The TIA evaluates:
  - The laws and practices of the destination country relevant to data protection.
  - The effectiveness of the SCCs in light of those laws.
  - Any supplementary technical measures (e.g., end-to-end encryption with keys held in the EEA) applied to mitigate risks.
  - TIAs are reviewed annually or upon material legal change in the destination jurisdiction.
- **Schrems II Compliance:** In jurisdictions where local surveillance laws may impinge on SCC effectiveness, supplementary measures (field-level encryption, split-key architecture, EEA-only decryption) are mandatory.

---

## 8.3 Financial Content & Safe Harbor Standards

### 8.3.1 Hidden Earnings Estimate
The Hidden Earnings Estimate must frame latent value as **potential** only.
- It is **NEVER** a guarantee, projection, or statement of certainty.
- It must be based on verified industry averages and the user's specific network characteristics.

### 8.3.2 Safe Harbor Language Templates
All content containing income, earnings, wealth, or financial potential must be accompanied by relevant safe harbor language.

| Content Type | Required Safe Harbor Template |
| :--- | :--- |
| **Income/Earnings** | "The income figures discussed are for illustration purposes only and represent the potential earnings of top performers. Your actual earnings will depend on your individual effort, dedication, and market conditions. There is no guarantee of any specific level of income. Past performance does not guarantee future results." |
| **Business Opportunity** | "This is a business opportunity, not a job. Success requires significant effort, skill, and persistence. There is no assurance that you will achieve the results described. Individual results will vary based on personal commitment and market conditions." |
| **Testimonial** | "This testimonial reflects the experience of one individual. Results are not typical. Your results will depend on your personal effort, skill, and market conditions. This is not a guarantee of similar outcomes." |
| **Insurance Product** | "Insurance products are subject to state regulation and licensing requirements. This information is for educational purposes only and does not constitute a recommendation to purchase any specific product. Consult with a licensed insurance professional in your state." |
| **Hidden Earnings Estimate** | "This estimate is based on industry averages and your network characteristics. It represents POTENTIAL only, not a guarantee or projection of actual earnings. Actual results depend entirely on your effort, consistency, and market conditions." |

---

## 8.4 Technical Security & Authentication

### 8.4.1 Data Encryption
- **In-Transit:** Mandatory TLS 1.2+ for all data transfer.
- **At-Rest:** AES-256 for all stored platform and user data.

### 8.4.2 Authentication & RBAC
- **Authentication:** Multi-factor authentication (MFA) is mandatory for all user roles.
- **Policy:** Minimum 12-character passwords; 30-minute inactivity session timeout; absolute 24-hour session expiration.
- **Role-Based Access Control (RBAC):** Access is governed by a rigid matrix (Rep, Upline, RVP, Compliance, Admin), prioritizing the lowest-common-denominator for data access.

### 8.4.3 Security Audits & Assessments
The platform maintains a continuous, multi-layered security audit program.

- **Annual Penetration Testing:** An independent, credentialed third-party firm conducts full-scope penetration testing (network, application, API, social engineering) at least annually. Tests include authenticated and unauthenticated attack vectors. Remediation of critical and high findings must be completed within 30 days and 60 days, respectively. Retests are mandatory before sign-off.
- **Vulnerability Disclosure Program:** The platform operates a public vulnerability disclosure policy (VDP) with a secure, monitored reporting channel. All submitted reports are triaged within 72 hours. Validated vulnerabilities are tracked in a private bug bounty system (where applicable) and patched according to severity SLAs (Critical: 7 days; High: 14 days; Medium: 30 days; Low: 90 days).
- **Third-Party Audits:**
  - **SOC 2 Type II:** An independent auditor evaluates the platform’s controls against the Trust Services Criteria (Security, Availability, Processing Integrity, Confidentiality, Privacy). The Type II report covers a minimum 12-month observation period and is renewed annually.
  - **ISO 27001:** The platform maintains an Information Security Management System (ISMS) certified to ISO/IEC 27001:2022. Internal audits are conducted semi-annually; surveillance audits by the certification body occur annually.
  - **Audit Artifacts:** All audit reports, remediation plans, and management responses are stored in the Compliance Document Vault with 7-year retention. Access is restricted to the Compliance Officer, CISO, and external auditors under NDA.

---

## 8.5 Contact Data Integrity ("The Sacred Vault")

- **Non-Disclosure:** Contact list data is **NEVER sold, rented, shared, or monetized** to third parties.
- **Platform Integrity:** Data may not be used by the platform for marketing, training, or profiling.
- **Ownership:** Contact lists remain the user's property. The platform acts as a data processor, not a controller for contact data.

- **Technical Controls for the Sacred Vault:**
  - **Field-Level Encryption:** All contact data fields (name, phone, email, address, notes) are encrypted at the field level using AES-256-GCM with unique data encryption keys (DEKs) per record. DEKs are themselves encrypted by a master key stored in a hardware security module (HSM) or cloud KMS with strict IAM policies.
  - **Access Audit Logging:** Every read, write, or delete operation against contact data is logged with user identity, timestamp, IP address, action type, and record identifier. Logs are forwarded to an immutable SIEM store in real time. Audit logs are retained for 7 years and are non-deletable by any platform role.
  - **Zero-Copy / Zero-Knowledge Architecture:** The platform never creates secondary copies of contact data for analytics, model training, or marketing. Contact data is accessed only at runtime through ephemeral, decrypted views. Platform staff and administrators cannot view decrypted contact data without a validated, logged access request tied to a specific support ticket or legal obligation.
  - **Row-Level Security (RLS):** Database queries enforce row-level security so that a Rep can only access contact records they own or that have been explicitly shared with them by their upline. RLS policies are enforced at the database engine level, not application level, preventing bypass.
  - **Access Request Approval Workflow:** Any privileged access to contact data (e.g., support escalation, data migration, regulatory subpoena response) requires:
    1. A ticketed access request with business justification.
    2. Approval by the user’s upline or RVP (for operational access) or the Compliance Officer (for legal/regulatory access).
    3. Time-bounded access grants (default: 4 hours, max: 24 hours).
    4. Automatic revocation and post-access audit review.

---

## 8.6 Primerica Affiliation Disclaimers

These disclosures are gated to users identifying as Primerica Affiliates.
- **Independent Contractor Disclosure:** Reps must disclose status as an independent contractor, not a Primerica employee.
- **License Disclosure:** Reps must disclose their licensing status for any financial advice-adjacent discussion.
- **Product Disclaimer:** Disclose relationship with Primerica Financial Services/PFS Investments as required.

---

## 8.7 Compliance Filter Engine (CFE) Architecture

The CFE is the gatekeeper for all agent-generated outbound content.

### 8.7.1 CFE Pipeline
1. **Classifier Layer:** Content is analyzed by 5 specialized classifiers: Income Claim, Testimonial, Opportunity, Insurance, Referral.
2. **Scoring Layer:** A weighted risk score (0-100) is calculated based on classifier confidence and regulatory multipliers (FINRA 1.4x, Insurance 1.5x, etc.).
3. **Enforcement Layer:**
    - **Pass (0–10):** Auto-deploy.
    - **Flag (11–70):** Hold in queue; route for Upline / Principal review.
    - **Block (71–100):** Physically prevent; return 403; notify compliance officer.

4. **Human Review Gate for Block Decisions:**
    - All content scoring in the **Block range (71–100)** is automatically routed to a dedicated **Compliance Officer Review Queue** before any enforcement action (return 403, notify user, or log) is finalized.
    - A compliance officer must manually review the blocked content, classifier rationale, and regulatory context, then render one of three decisions:
      - **Uphold Block:** Content is permanently blocked; user is notified with a non-negotiable violation summary.
      - **Remediate and Release:** Compliance officer edits or annotates the content to reduce risk, then approves for deployment with mandatory principal co-sign if the revised score remains > 40.
      - **Override (Exception):** Compliance officer documents a written justification (minimum 50 characters) for overriding the Block. Overrides are auto-escalated to the Chief Compliance Officer (CCO) for secondary review within 48 hours. All overrides are included in the monthly compliance dashboard.
    - **Flag-Queue SLA:** The Compliance Officer Review Queue operates under a strict **24-hour review window** SLA. Any Block decision not reviewed within 24 hours triggers an escalation alert to the CCO and a holding message to the content submitter indicating the review is in progress.
    - **Audit Trail:** Every human review action (review start, decision, rationale, reviewer identity, timestamp) is appended to the immutable CFE audit log and linked to the original classification record.

### 8.7.2 Audit Trail
Every decision made by the CFE is logged in an immutable, cryptographically signed audit trail, retained for 7 years as required by regulatory retention protocols.

---

## 8.8 Incident Response & Breach Notification

The platform maintains a formal incident response program to detect, contain, assess, and report security incidents and personal data breaches.

### 8.8.1 Detection Procedures
- **Automated Detection:** SIEM rules, anomaly detection models, and DLP (Data Loss Prevention) tools monitor for unauthorized access, bulk exfiltration, privilege escalation, and anomalous API usage patterns. Alerts are triggered in real time to the Security Operations Center (SOC) channel.
- **Manual Detection:** Employees, users, and external researchers may report suspected incidents via the Vulnerability Disclosure Program or a dedicated `security@` hotline. All reports are triaged within 4 hours of receipt during business hours, 8 hours otherwise.
- **Incident Classification:** Incidents are classified by severity:
  - **P1 (Critical):** Confirmed unauthorized access to production systems, contact data exfiltration, or ransomware.
  - **P2 (High):** Suspected breach, significant system compromise, or exposure of sensitive personal data without confirmed exfiltration.
  - **P3 (Medium):** Limited exposure, internal policy violation, or unsuccessful attack attempt.
  - **P4 (Low):** Minor configuration drift or policy deviation with no data exposure.

### 8.8.2 Breach Containment Steps
- **Immediate Isolation:** Affected systems, services, or user accounts are isolated within 1 hour of confirmed P1/P2 classification. Isolation includes revoking active sessions, rotating credentials, and suspending data replication to affected nodes.
- **Evidence Preservation:** Forensic snapshots of affected systems are captured before any remediation. Logs are locked to append-only storage. Chain of custody is documented for all evidence.
- **Root Cause Analysis (RCA):** An internal RCA is initiated within 24 hours. For P1 incidents, an external forensic firm is engaged within 48 hours.
- **Remediation & Recovery:** Systems are restored from known-clean backups. Affected users are notified of temporary service disruptions with estimated recovery times.

### 8.8.3 GDPR — 72-Hour Supervisory Authority Notification
- **Trigger:** Any personal data breach likely to result in a risk to the rights and freedoms of natural persons.
- **Timeline:** The Data Protection Officer (DPO) or delegated compliance officer must notify the relevant EU supervisory authority **without undue delay and, where feasible, no later than 72 hours** after becoming aware of the breach (Article 33 GDPR).
- **Content:** Notifications include: nature of breach, categories and approximate number of affected data subjects, likely consequences, and measures taken or proposed.
- **Documentation:** Even if notification is not required (e.g., breach is unlikely to result in risk), an internal record of the breach and rationale for non-notification is maintained.

### 8.8.4 State Attorney General Notifications
- **Trigger:** Breaches affecting residents of US states with statutory notification requirements.
- **State-Specific Timelines:**
  - **California (CCPA/CPRA):** Notification to the California Attorney General required if the breach affects more than 500 California residents.
  - **Virginia (CDPA):** Notification to the Attorney General and affected consumers without unreasonable delay.
  - **Colorado (CPA):** Notification to the Attorney General within 30 days of discovery if the breach affects 500+ Colorado residents.
  - Other states: The State Regulatory Matrix service maps all applicable state AG notification deadlines; the strictest applicable timeline is auto-selected.
- **Content:** AG notifications include: date of breach, types of personal information involved, steps taken to secure systems, and contact information for consumer inquiries.

### 8.8.5 Consumer Notice Procedures
- **Timeline:** Affected individuals must be notified **without unreasonable delay** and, where a specific state deadline applies, within that deadline (commonly 72 hours to 60 days depending on jurisdiction and severity).
- **Method:** Notice is delivered via email, in-app notification, and (for large-scale breaches) a prominent banner on the platform login page. If email addresses were compromised, notice is supplemented by postal mail.
- **Content:** Consumer notices include: a plain-language description of what happened, what information was involved, what the platform is doing, what consumers can do (e.g., credit monitoring enrollment), and contact details for questions.
- **Credit Monitoring:** For breaches involving financial data or SSNs, affected US consumers are offered complimentary credit monitoring and identity theft protection for 12–24 months, depending on severity.

### 8.8.6 Post-Incident Review & Remediation
- All P1 and P2 incidents trigger a mandatory post-incident review (PIR) within 2 weeks of containment.
- The PIR produces a remediation plan with assigned owners, deadlines, and acceptance criteria.
- Remediation plans are tracked in the Compliance Task Board and reviewed weekly by the CCO until closure.
- Lessons learned are incorporated into the Security Incident Response Plan (SIRP) and, where applicable, into platform security controls, training, and threat models.


## Section 9: Technical Dependencies and Sequential Gating Rules

# Section 9 — Technical Dependencies and Sequential Gating Rules

This section defines the mandatory build order, architectural gating, and technical dependencies for The Harvest development. System integrity depends on strict adherence to this sequence; skipping gates or bypassing architectural branches will lead to downstream system failure.

---

## 9.1 Critical Path Spine

The foundational execution engine of The Harvest must be built in this strict sequence to ensure data integrity, privacy governance, and grounded agent behavior:

```
Foundation (Core) → WP11 → WP01 → WP02 → WP04 → WP05
```

Any work package attempt that deviates from this spine without explicit architectural review will be rejected by the orchestrator.

## 9.2 Wave Definitions and Gating Conditions

Development is managed by wave. No wave may commence until its unblocking conditions are validated at the kernel level.

| Wave | Work Packages | Unblocking Condition |
| :--- | :--- | :--- |
| **Wave 0** | WP11 (Security/Privacy) | Must be fully complete, tested, and operational before anything else. |
| **Wave 1** | WP01 (Onboarding), WP02 (Contacts) | Unblocked upon successful verification of WP11. |
| **Wave 2** | WP03, WP04, WP05, WP06, WP07, WP09, WP10 | Unblocked ONLY when WP01 AND WP02 are 100% complete. Note: WP04 specifically gates WP05, WP06, and WP07. WP03 is unblocked for all organizations, but its Primerica-specific content and logic only activate when org=Primerica (see §9.4, §9.6, §9.7). For non-Primerica orgs, WP03 delivers standard Wave 2 functionality without Primerica-specific behaviors. |
| **Wave 3** | WP08 (Primerica-Specific) | Unblocked ONLY when all Wave 0-2 packages are complete AND organization branch = Primerica. |

## 9.3 Technical Dependency Inventory by Work Package

Each work package must adhere to this defined technical payload.

| WP | Technical Dependencies (APIs/Services/Models) | Primary Data Source | Gating Condition |
| :--- | :--- | :--- | :--- |
| **WP11** | Audit Logging Service, RBAC Controller, Compliance Filter Engine, Encryption (KMS) | Foundation | — |
| **WP01** | Identity Service, Profile Service, Org Branching Engine, Profile Form State Machine | User Input | — |
| **WP02** | Contact Ingestion API, Normalization Service, Hidden Earnings Model (Probabilistic) | Device Contacts / CSV | — |
| **WP04** | Agent Orchestration Engine, LLM (Kimi/OpenRouter), Embedding Model (Gemini), Vector DB | WP1, WP11, WP02 | — |
| **WP05** | Message Queue, SMS Gateway, Email Gateway, Template Interception Service, Scoring Engine | WP1, WP4, WP11 | — |
| **WP03** | Warm-Market Logic Engine, Primerica-Logic Service | WP01, WP02 | org=Primerica (feature activation) |
| **WP06** | Social Content Gen (Media Generation Models), Sharing/Publishing APIs | Brand Concept | — |
| **WP07** | Momentum Score Engine, Notification Service, Streaks Engine | WP04 | — |
| **WP08** | Org-Tree Visualizer, Milestone State Machine | WP03, WP07 | org=Primerica (hard requirement) |
| **WP09** | Calendar APIs (Google/Microsoft Graph), Conflict Normalizer API | Device Calendar | — |
| **WP10** | Stripe API, Subscription Management Service, Feature Gating Service | Stripe | — |

## 9.4 Parallelization Rules

- **Allowed Parallelism:** WP09 and WP10 may proceed in parallel during Wave 2 once all Wave 1 anchors are stable. WP06 and WP07 may proceed in parallel during Wave 2 if WP05 and WP04 boundaries are confirmed.
- **Prohibited Parallelism:** No Primerica-gated package (WP03, WP08) may initiate until org-branch logic is locked. No messaging (WP05) may initiate until compliance interception (WP11/WP05 design phase) is fully verified.

## 9.5 Hybrid Dependencies (Overlapping Development)

- **Co-design WP1 + WP11:** Access tiers and RBAC roles must be defined collaboratively.
- **Co-design WP04 + WP02:** AI agent grounding requires specific contact segmentation inputs stabilized in WP02.
- **Co-design WP05 + WP11:** All messaging templates must be pre-approved by the messaging compliance interception layer.

## 9.6 Sequential Gates Summary

- **Gate 1 (Foundation):** WP11 completion required.
- **Gate 2 (Identity/Data):** WP01 + WP02 completion required.
- **Gate 3 (Agent Execution):** WP04 completion required before WP05, WP06, and WP07 can proceed.
- **Gate 4 (Organizational Branching):** Org = Primerica must be set by WP01 to allow WP03/WP08 initialization.

## 9.7 Primerica Conditionality — Hard Architectural Branch

Primerica-specific features (WP03 and WP08) are physically separated via a hard architectural branch at the kernel level. Logic for these packages MUST NOT exist in the Non-Primerica binary builds.
1. Kernel check: `org_id == PRIMERICA_TENANT_ID`.
2. This is not a content flag; it is a build-time and runtime exclusion branch.
3. **Cross-references:** This hard branch propagates from the Wave 2 gating rules defined in §9.2 and the sequential organizational gate defined in §9.6 (Gate 4). WP03 and WP08 initialization is blocked until both the Wave 1 anchor conditions (WP01 + WP02 complete) and the Primerica org-branch condition are satisfied.

---
*Section 9 End.*


## Appendices
- Appendix A: Brand Doctrine Glossary

# Brand Doctrine & Concept Analysis (v4)
## Structured Briefing for AI-Driven Product Behavior

---

## 1. MISSION STATEMENT & USP
Harvest's mission is to systematize the ancient principle of sowing and reaping, empowering individuals to turn their unique network of relationships into sustainable, compound wealth. Our USP is the operationalization of Downline Maxxing: providing a unified, AI-driven framework that integrates growth (outreach/connections), engagement (relationship deepening), and wealth accumulation (tracking/projection) into a single, cohesive engine that transforms community-level trust into a decentralized distribution model.

---

## 2. FULL GLOSSARY (24 Terms)
| Term | Definition |
|---|---|
| **The Base** | Active members in the downline who believe, contribute, and engage. |
| **Collective Benefit** | The principle that everyone contributing reaps value, not just the leader. |
| **Community Introduction** | Warm, relational first reach-out; leads with care, never a transaction. |
| **Community-Style Marketing** | Introducing products you believe in to those you already trust. |
| **Diminishing Returns** | The depreciation of traditional career paths and credentials. |
| **The Downline** | The full, multi-layered network of relationships (customers, audience, community). |
| **Downline Leak** | The loss of momentum, conversions, or base engagement before multiplication. |
| **Downline Maxxer** | A person specializing in building, growing, and optimizing the downline. |
| **Downline Maxxing** | The active discipline of growing, engaging, and accumulating wealth together. |
| **Downline Maxxing Business** | A business strategy tracking all three laws (grow, engage, wealth) explicitly. |
| **Downline Maxxing Company** | An organization that formalizes the model into culture/compensation (e.g., LTK). |
| **Downline Maxxing Professional** | A practitioner treating downline building with rigorous portfolio-like discipline. |
| **Downline Maxxing Sponsor** | A person/org underwriting a beginner's access as a business investment. |
| **Downline Maxxing Startup** | Built from day one on Collective Benefit and People Compounding. |
| **Downline-Driven Business** | Businesses depending on structured people networks for sustainable growth. |
| **Economic Replacement** | AI and automation displacing traditional career stability. |
| **Engagement Maxxing** | Deliberately keeping the base active, energized, and believing. |
| **Harvest Hoarder** | Someone who reaps harvest but extracts benefit from rather than serves builders. |
| **Hidden Earnings Estimate** | Dormant wealth locked in existing relational networks. |
| **Out-Maxx** | Systematically outperforming on growth, engagement, and wealth simultaneously. |
| **People Compounding** | Multiplication of output achieved as each level develops members to develop members. |
| **Reverse Downline Maxxing** | The decay process starting the moment active building stops. |
| **Social 4 / Social 4.0** | The convergence era of social media + AI + CRM + Downline-Driven business. |
| **Social Maxxing** | Optimizing social presence *for* relationship building and community connection. |
| **Sowing and Reaping** | Foundational principle: plant seeds, nurture relational soil, reap rewards. |
| **The Three Laws of Downline Maxxing** | Grow Downline + Engage Base + Increase Wealth. |
| **Wealth Maxxing** | The quantification and proof that growth and engagement are compounding wealth. |

---

## 3. BOTH BELief PROBLEMS
1. **The Belief Void:** Accepting Downline Maxxing intellectually but lacking personal conviction.
   - *Symptoms:* Hesitation in outreach, shallow connections, inconsistent follow-through.
   - *Re-frame:* Belief comes from understanding "why." It's not about the product's mechanics, but your personal *why* for building sustainable wealth for others.
   - *Fix:* Mandatory "Seven Whys" exercise to surface core motivation and align action with that conviction.
2. **The Stigma Paradox:** Believing in the opportunity but fearing social judgment or emotional "exploitation."
   - *Symptoms:* Avoiding warm-market outreach, masking the nature of the opportunity, apologizing for checking in.
   - *Re-frame:* Sharing value that genuinely helps people is an obligation, not an extraction. The "manipulation" is the fear, not the sharing.
   - *Fix:* Re-framing outreach as an act of service—if you don't share it, you're denying them the solution you *know* works.

---

## 4. ALL 8 RULES OF DOWNLINE MAXXING
1. **Trust-First Architecture:** Always lead with relationship; never lead with pitch.
2. **Engagement is Non-Negotiable:** A growing network without engagement is just a leaky bucket.
3. **Compound from the Bottom Up:** Growth thrives when engagement happens at *every* level, not just the top.
4. **Collectively Benefit or Don't Build:** If the model inherently Hoards, it’s not Downline Maxxing.
5. **Sow Before Reaping:** Sustainable wealth requires a cycle of intentional planting and tending *before* expecting harvest.
6. **Triple-Law Measurement:** Never judge health by one metric—assess growth, engagement, and wealth together daily.
7. **Wealth is the Final Proof:** If the network is growing but wealth isn't compounding, the engine is leaking energy.
8. **Professional Stewardship:** Treat your downline with the rigor and care you would apply to a portfolio management practice.

---

## 5. SCORING MATRIX
*Dimensions (10): Outreach Consistency, Engagement Frequency, Base Retention, Wealth Velocity, Downline Multiplier, Belief Strength, Pipeline Health, Collective Benefit Score, Anti-Hoarder Compliance, Social 4 Activation.*

| Level | Traits | Symptoms | Gaps | Growth Path |
|---|---|---|---|---|
| **0 - Dormant** | Passive networker | No intentional outreach | Unaware of Three Laws | Learn fundamentals |
| **1 - Seed** | Curious beginner | Sporadic outreach | Lack of system | Adopt 3 Laws |
| **2 - Grower** | Consistent practitioner | 3-5 intro/week | Wealth volatility | Systems/Architecture |
| **3 - Thriver** | Community architect | 6-7 intro/week | Leader dependency | Empower others |
| **4 - Master** | Movement builder | Fully automated ops | Refinement | Spread the movement |

---

## 6. SOCIAL 4 ERAS BREAKDOWN
- **Social 1.0 (2004-2009):** The Directory Era. Basic connection, profiling. Focus on "friending."
- **Social 2.0 (2010-2015):** The Broadcast Era. Content-led. Focus on metrics, likes, and reach. 
- **Social 3.0 (2016-2023):** The Creator Economy Era. Content/Commerce integration. Influencers as channels.
- **Social 4.0 (2024+):** The Convergence Era. Social + AI + CRM + Downline-Driven Business converge. Relationships are the unit of economy, not content.

---

## 7. ALL 9 CASE STUDIES (Pattern: Community + Shared Value)
- **LTK:** Creators converting audience trust into direct affiliate revenue systems.
- **Obama (2008):** Empowered supporters to become owners/recruiters in political movement. 
- **Madame CJ Walker:** Agents built local community-based businesses using shared products.
- **Dropbox:** File-sharing growth fueled by users *recruiting* their own network for storage upgrades.
- **Alibaba:** Affiliate network where everyone in the chain benefited from system growth.
- **LeBron James:** Ecosystem-based partnership model that enriches stakeholders across his sphere.
- **Taylor Swift:** Fans converted into active community members who recruit and defend the brand.
- **Jay-Z:** Distribution and brand ownership creating opportunities vertically for his network.
- **Harley-Davidson:** Owner community-led loyalty/recruitment, creating a self-sustaining node.

---

## 8. COUNTER-ARGUMENTS
1. **"It's just an MLM"**: *Steelman:* Structural similarities exist, specifically multi-level compensation. *Rebuttal:* MLM is a business structure (allowed in law); a Pyramid Scheme is an ethical failure. Harvest's Collective Benefit requirement and anti-hoarder metrics forbid extraction, focusing distribution vertically.
2. **"Leveraging relationships is manipulative"**: *Steelman:* Using personal trust for transactions is unethical. *Rebuttal:* Reframe as value extension. Sharing a genuine solution with trust-partners is an obligation, not a manipulation. Hiding value is more manipulative than sharing it.
3. **"This approach is too high-pressure"**: *Steelman:* Constant outreach can feel robotic and pushy. *Rebuttal:* It feels high-pressure only when the *belief* is absent. When care is the driver and outreach is the method, the genuine belief of the practitioner makes the connection relational rather than mechanical.

---

## 9. WHAT DOWNLINE MAXXING IS NOT
1. **Not an MLM:** Does not necessitate a specific, extractive 1099 compensation structure.
2. **Not a Get-Rich-Quick Gamble:** Requires disciplined adherence to the Three Laws over time.
3. **Not Just Recruiting:** Recruiting without engagement is just harvesting what you don't tend.
4. **Not a Pyramid Scheme:** Pyramid schemes concentrate value; Downline Maxxing mandates Collective Benefit.
5. **Not a One-Time Task:** Continuous, disciplined practice of the Three Laws is mandatory.

---

## 10. AUDIENCE-SPECIFIC FRAMINGS
- **Doctor:** "Multiply patient outcomes and office sustainability through trusted peer/specialist referral circles."
- **Professional:** "Apply portfolio-style rigor to relationships to create independent, passive avenues of career security."
- **Marketer:** "Move beyond paid traffic; use network-based community introductions for superior quality and lifetime value."
- **Entrepreneur:** "Systems-based design to ensure your network compoundly grows rather than linearly plateaus."
- **Teacher:** "Steward your school/community hub into a resource-sharing engine that benefits all families involved."
- **Musician:** "Own the relationship with your fans as a compounding network that distributes your work and grows your ecosystem."
- **Skeptic:** "A disciplined framework to maximize the value existing in your relationships, inherently structured to *prevent* the exploitation you're rightfully wary of."
- Appendix B: Product Behavior Matrix

# Harvest Product Behavior Matrix (v5 - Part 2)

> **Note:** The full behavior matrix (v5) contains 36 behaviors across two parts. Part 1 (behaviors 1–18) covers Rep Onboarding, Upline Onboarding, Seven Whys, Warm Market Contact Engine, HWM Method, Prospecting Agent, Nurture Pre-Sale, Nurture Post-Sale, Appointment Setting, Reporting, Quota, IPA Value, Inactivity/Re-engagement, Mission Control Dashboard, Messaging Engine, Three-Way Handoff, Team Calendar, and 2-Hour CEO Daily Check-In. See `behavior-matrix-v5.md` (sections 1–18) for the full specifications. Part 2 (behaviors 19–36) follows below.

## 19. Downline Maxxing Visualization
- **Trigger**: Rep selects org_type = Primerica AND has at least 3 contacts in pipeline.
- **System Response**: Render live org chart from downline data; project potential multi-level tree structure (3-wide-4-deep); calculate income projections using Hidden Earnings Estimate model; overlay "Rules of Building" compliance indicators per sub-team.
- **User-facing Output**: Interactive org chart visualization, potential vs. actual income projections, color-coded health indicators for sub-teams based on Rules of Building.
- **Dependencies**: Organization Hierarchy Service, Hidden Earnings Estimate Model, Pipeline Data Service.
- **Primerica-gated**: Yes
- **Edge Cases & Failure Modes**: Missing downline data (render partially), income projection calculation mismatch (re-run model), org chart render timeout (fallback to flat view).
- **Data Model**: `OrgNode { node_id, parent_id, rep_type, rules_of_building_status }`, `ProjectionResult { level_depth, projected_income }`.
- **Concurrency/Priority**: High priority; runs as background job update on organization change; might conflict with live org data syncing.

## 20. 30-Day Phased Timeline
- **Trigger**: New rep onboarding completion.
- **System Response**: Initialize phased unlock logic; Days 1-7: Launch Phase (IBA/POL filing, list upload, HWM method initiation, first intro, HWM targets); Days 8-30: Scaling Phase (PFSU enrollment, pre-licensing, state exam scheduling, Memory Jogger access, Objection Tree access, team calendar activation).
- **User-facing Output**: Progress visualization of phasing, phased task lists, unlocks as activity milestones are hit.
- **Dependencies**: User Profile Service, Task Management Service, Licensing Service.
- **Primerica-gated**: Yes
- **Edge Cases & Failure Modes**: Accelerated completion (allow advance phasing), paused onboarding (suspend timeline), licensing delay (alert), IBA filing failure (retry alert).
- **Data Model**: `PhasedTimeline { rep_id, current_phase, phase_start_date, phase_end_date, completed_milestones[] }`.
- **Concurrency/Priority**: Normal priority; runs sequentially; check phasing at daily log-in.

## 21. Objection Handling Decision Tree
- **Trigger**: Rep selects "Handle Objection" on an active prospect in the CRM interface.
- **System Response**: Present objection categories (Can't afford / Not ready / Spouse says no / Need more info / Too busy); wait for selection; present clarifying Socratic question; based on input, branch to relevant response script + in-the-moment coaching tip.
- **User-facing Output**: Interactive Socratic decision tree, specific objection script, real-time coaching advice.
- **Dependencies**: Objection Database, Messaging Engine, CRM Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Objection category missing (allow custom query), script generation timeout (fallback to static script), ambiguous answer (request clarification).
- **Data Model**: `ObjectionTree { objection_id, category, script_root, coaching_tip, branching_logic[] }`.
- **Concurrency/Priority**: High priority; real-time interaction; overlaps with active prospect state.

## 22. Motivational Quote Engine
- **Trigger**: Cron events at 07:00 (morning), 12:00 (mid-day), 19:00 (evening).
- **System Response**: If Primerica-gated, draw from field-language-weighted quote pool; otherwise draw from general motivational pool; personalize content based on Goal Commitment Card goals and Seven Whys anchor statement.
- **User-facing Output**: Timed motivational notifications.
- **Dependencies**: Content Database, Goal Management Service, Seven Whys Service.
- **Primerica-gated**: Yes
- **Edge Cases & Failure Modes**: Missing goal/anchor data (fallback to general motivational quotes), cron event failure (queue for immediate retry), user opt-out (suppress).
- **Data Model**: `MotivationalQuote { quote_id, quote_text, context_tag, weight, field_language_gated: boolean }`.
- **Concurrency/Priority**: Low-Medium priority; scheduled run; no concurrency conflicts.

## 23. Notification Architecture
- **Trigger**: Cross-system events (prospect respond, milestone reached, cron events).
- **System Response**: Respect user timezone; immediate push for real-time alerts (prospect response); unmuted celebration push for milestones (first license/appointment); inactivity nudges tied to anchor statement.
- **User-facing Output**: Push notifications, SMS/email alerts, configuration interface for timing/frequency.
- **Dependencies**: Notification Delivery Service, User Preference Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Delivery failure (log error, retry), timezone mismatch (default to system UTC), user opt-out delivery (honor).
- **Data Model**: `NotificationConfig { user_id, timezone, channel_preferences{}, event_priority{} }`.
- **Concurrency/Priority**: Medium-High; asynchronous delivery; conflict prioritization by type (Real-time > Milestone > Nudge).

## 24. Celebration & Milestone Engine
- **Trigger**: KPI target achievement (first response received, first appointment booked, first recruit signed, first licensed team member).
- **System Response**: Activate celebration sequence; trigger confetti animation and generate badge; update milestone data related to vision goal in Seven Whys.
- **User-facing Output**: Celebration push notification, visual celebration animation in dashboard, badge overlay.
- **Dependencies**: Activity Metrics Engine, Notification Architecture, Visualization Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Duplicate event fire (idempotency token check), visual animation trigger fail (fallback to simple notification), milestone data update failure (log error).
- **Data Model**: `Milestone { milestone_type, milestone_date, rep_id, vision_goal_related_id }`.
- **Concurrency/Priority**: High; triggered on activity; immediate UX feedback requirement.

## 25. Momentum Score
- **Trigger**: New IPA (Income Producing Activity) log.
- **System Response**: Update `momentum_score` by `IPA_value`; compare `momentum_score` to team average; generate rank on leaderboard; expose leaderboard to upline views.
- **User-facing Output**: Momentum visualization, team leaderboard.
- **Dependencies**: Activity Metrics Engine, Performance Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Data sync latency (cache result), leaderboard render error (retry), IPA update logic error (rollback transaction).
- **Data Model**: `Momentum { rep_id, momentum_score, team_id, leaderboard_rank }`.
- **Concurrency/Priority**: Medium; real-time accumulation; priority is order of entry.

## 26. 48-Hour Countdown
- **Trigger**: Onboarding completion timestamp storage.
- **System Response**: Start timer; display countdown in UI; identify 3 high-probability contacts; monitor outreach activity; at 24h/no outreach trigger nudge; at 48h/no outreach trigger upline notification.
- **User-facing Output**: Visible 48h countdown, high-intensity outreach alerts, nudge notifications, upline alerts.
- **Dependencies**: Task Management Service, Messaging Engine, Notification Architecture.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Onboarding timestamp missing (wait), outreach detection delay (log), inactivity notifications failed (queue retry).
- **Data Model**: `CountdownTimer { rep_id, onboarding_timestamp, first_outreach_detected: boolean }`.
- **Concurrency/Priority**: High; time-dependent event chain.

## 27. SMS Broadcast Center
- **Trigger**: Manual mass update initiation by rep.
- **System Response**: Load segments (A-list/B-list/recruits/clients); apply compliance filter pre-check; queue sending; track UTM clicks/opens; render analytics dashboard.
- **User-facing Output**: Broadcast UI, compliant template selection, analytics dashboard.
- **Dependencies**: Messaging Engine, Compliance Filter, Analytics Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Compliance filter override (disallow), Broadcast queue overflow (rate limit/throttle), data fetch timeout (retry).
- **Data Model**: `Broadcast { broadcast_id, template_id, target_segment, sent_count, open_rate, click_rate }`.
- **Concurrency/Priority**: Low; batch-processed asynchronously; throttled to rate limit.

## 28. Email Campaign Builder
- **Trigger**: Rep initiates email campaign builder.
- **System Response**: Generate 3-email drip sequence (launch, soft ask, value); personalize with Warm Market Method qualities; implement open/click tracking; enable/manage A/B test splits.
- **User-facing Output**: Email sequence preview, personalization tool, analytics/test results view.
- **Dependencies**: Messaging Engine, Warm Market Method Data.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Personalization data missing (fallback to general script), A/B split imbalance (rebalance), analytic data ingestion fail (retry).
- **Data Model**: `EmailCampaign { campaign_id, sequence_drafts[], personalization_vars, variant_a_results, variant_b_results }`.
- **Concurrency/Priority**: Low; batch processed; A/B traffic split logic needed.

## 29. Social Media Launch Kit
- **Trigger**: User uploads photo or selects existing image.
- **System Response**: Generate announcement graphic with brand wrapper; generate platform-specific captions (FB/IG/LinkedIn); tag selected contacts; generate "Share-my-launch" link for friends/family.
- **User-facing Output**: Asset generation UI, compliance filter results, "Share-my-launch" link.
- **Dependencies**: Compliance Filter, Image Generation Service, Messaging Engine.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Caption compliance violation (disallow/require rewrite), announcement graphic generation fail (retry), shareable link generation fail (re-generate).
- **Data Model**: `LaunchKit { launch_id, photo_url, graphic_url, platform_captions{}, share_url }`.
- **Concurrency/Priority**: Medium; synchronous generation; dependency on image generation service.

## 30. Goal Commitment Card
- **Trigger**: Rep Seven Whys completion.
- **System Response**: Populate fields from Seven Whys and input; link Seven Whys anchor; store commitment; display persistent card in Mission Control.
- **User-facing Output**: Printable PDF card, interactive dashboard view, upline coaching view.
- **Dependencies**: Seven Whys Service, Persistence Service, Dashboard View Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Missing Seven Whys data (prompt user to complete), PDF download fail (retry), goal updates conflict (overwrite with latest commit).
- **Data Model**: `GoalCommitment { rep_id, anchor_statement_ref, income_target, promotion_timeline, dream_list[], weekly_activities }`.
- **Concurrency/Priority**: Normal; infrequent update.

## 31. Referral Script Generator
- **Trigger**: Rep selects a contact and clicks "Generate Referral Script".
- **System Response**: Detect relationship_type from contact data; select script template; customize with contact name and extracted qualities (Warm Market Method); pass through Compliance Filter; provide script + prompt for capturing referred contact.
- **User-facing Output**: Tailored referral script, prompt to add referred contact.
- **Dependencies**: Messaging Engine, Compliance Filter, Contact Database.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Relationship type unknown (fallback to general script), Compliance violation (edit script), referral capture pipeline fail (retry).
- **Data Model**: `ReferralScript { script_id, contact_id, template_id, tailored_script_content }`.
- **Concurrency/Priority**: High; user interaction needed.

## 32. Downline Maxxing Course
- **Trigger**: Rep onboarding completion.
- **System Response**: Unlock Stage 1 (Philosophy); track module completions; reward +5 momentum score on completion; track completion milestones; feed milestones to Celebration & Milestone Engine.
- **User-facing Output**: Progressive curriculum UI, module progress player, badge milestones.
- **Dependencies**: Content Database, Momentum Engine, Milestone Engine.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Module completion update fail (retry), progression logic lock (allow unlock), momentum score sync error (re-calculate).
- **Data Model**: `CourseProgress { rep_id, current_stage, completed_modules[], stage_unlocks_status }`.
- **Concurrency/Priority**: Low; background activity.

## 33. Book: Harvest Integration
- **Trigger**: New account activation.
- **System Response**: Send welcome email with PDF download link; link to purchase physical book store; form to request speaking engagements.
- **User-facing Output**: Welcome email, PDF download link, physical store URL, speaking engagement contact form.
- **Dependencies**: Messaging Engine, Content Database.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Email delivery fail (retry), book file URL broken (update),speaking contact form submission error (retry notification).
- **Data Model**: `HarvestBook { book_version, download_link, physical_store_url }`.
- **Concurrency/Priority**: Low; one-off event.

## 34. Payment & Subscription Infrastructure
- **Trigger**: Subscription interval or status change.
- **System Response**: Interface with Stripe; manage 3 tiers (free, $297/mo, $25K invoiced); monitor status; process failed payments; trigger grace period; handle access revocation with data retention; restore on payment; dashboard for management and RVP billing.
- **User-facing Output**: Billing status, subscription management UI, RVP visibility billing reports.
- **Dependencies**: Stripe API, Persistence Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Stripe API timeout (queue retry), payment failure/card decline (trigger grace period notice), data restoration fail (log error).
- **Data Model**: `Subscription { subscription_id, user_id, tier, status (active/past_due/cancelled), next_billing_date }`.
- **Concurrency/Priority**: High; critical revenue data.

## 35. Compliance Filter (STANDING LAYER)
- **Trigger**: Every outbound message or generate-content action.
- **System Response**: Scan content vs FINRA/State/FTC rules (e.g., check for guaranteed income, license number, disclosures, "results not typical" disclosures); if violation, block send and present reasoning + revision suggestions.
- **User-facing Output**: Real-time compliance check UI, error reason, revision prompt.
- **Dependencies**: Regulatory Database.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Compliance filter engine timeout (block and manual flag), unclear violation signal (block and flag for review), database rule update frequency (keep updated).
- **Data Model**: `ComplianceScanResult { message_id, is_compliant, violation_reasons[], revision_suggestions[] }`.
- **Concurrency/Priority**: Critical Priority (highest); must block before sending.

## 36. Data Privacy & Security
- **Trigger**: Any data access or user data interaction (export/delete request).
- **System Response**: Enforce encryption (TLS 1.2+ transit, AES-256 rest); enforce role-based access control (RBAC); track session activity; implement auto-logout (30m); process user data export/delete requests (72h SLA).
- **User-facing Output**: Privacy settings UI, export/consent tool.
- **Dependencies**: Auth Service, Persistence Service, Log/Audit Service.
- **Primerica-gated**: No
- **Edge Cases & Failure Modes**: Data export failure (retry), delete data failure (log, notify admin), encryption service failure (disable access).
- **Data Model**: `DataSecurityLog { timestamp, user_id, action_type, result_status }`.
- **Concurrency/Priority**: High; critical compliance and security.

- Appendix C: Compliance Extraction (Full)

# The Harvest: Compliance, Legal, Privacy, Security & Regulatory Requirements Extraction (v4)
## Extracted from Master PRD, WP11 Compliance Spec, Brand Doctrine v3, Foundation v5, and Product Behavior Matrix v4

---

## Document Purpose

This extraction compiles ALL compliance, legal, privacy, security, and regulatory requirements for The Harvest: 2 Hour CEO Business Agent. It is sourced from the master PRD, WP11 (Data Privacy, Security & Compliance Architecture), Brand Doctrine v3, Foundation Revision v5, and the Product Behavior Matrix v4. This document serves as the authoritative compliance layer for downstream AI build agents.

**Status:** Foundation Phase Complete | Phase B Expansion Ready
**Extracted:** 2026-04-27
**Quality Gate:** All 13 coverage areas addressed with explicit PRD traceability

---

## Table of Contents

1. [FINRA Compliance](#1-finra-compliance)
2. [State Insurance Regulations](#2-state-insurance-regulations)
3. [FTC Rules](#3-ftc-rules)
4. [GDPR Compliance](#4-gdpr-compliance)
5. [CCPA Compliance](#5-ccpa-compliance)
6. [Hidden Earnings Estimate — Safe Harbor Framing](#6-hidden-earnings-estimate--safe-harbor-framing)
7. [Data Encryption Standards](#7-data-encryption-standards)
8. [Authentication & Access Control](#8-authentication--access-control)
9. [User Data Rights](#9-user-data-rights)
10. [Data Retention Policies](#10-data-retention-policies)
11. [Data Never Sold — Contact List Prohibition](#11-data-never-sold--contact-list-prohibition)
12. [Safe Harbor Language Requirements](#12-safe-harbor-language-requirements)
13. [Primerica Affiliation Disclaimers](#13-primerica-affiliation-disclaimers)
14. [Compliance Filter Engine (CFE) Architecture](#14-compliance-filter-engine-cfe-architecture)
15. [Cross-Reference Matrix](#15-cross-reference-matrix)

---

## 1. FINRA Compliance

### 1.1 Scope
The Harvest platform discusses financial products (life insurance, investments, term insurance) through AI-generated content. FINRA (Financial Industry Regulatory Authority) rules apply to all financial product communications.

### 1.2 FINRA Rule 2210 — Communications with the Public
**Requirement:** All communications must be fair, balanced, and not misleading.

**Implementation:**
- **CFE Classifier:** Insurance Recommendation Classifier (Section 2.1.4 of WP11)
- **Detection Patterns:** "you need whole life", "get $500K coverage", "this policy is cheaper", "go with Company X"
- **Scoring:** ≥ 0.5 confidence → blocked unless IBA/POL license active for state. ≥ 0.8 → always blocked.
- **Pre-generation Guard:** Agent prompt templates inject negative constraints prohibiting specific product recommendations without license verification.

### 1.3 FINRA Prohibited Representations
**Forbidden in all AI-generated content:**
- Guaranteed returns on investment products
- Specific dollar amounts for policy payouts without disclaimers
- Comparative performance claims without substantiation
- "Best" or "top-rated" product claims without regulatory backing
- Predictions of future investment performance

### 1.4 FINRA Disclosure Requirements
**Required on all financial product discussions:**
- Product type identification (term vs. whole life vs. investment)
- Risk disclosure statement
- "Past performance does not guarantee future results" (where applicable)
- Licensing status of the rep (visible to recipient)
- State-specific licensing verification

### 1.5 FINRA Content Pre-Review
**Rule:** All financial content must pass CFE before deployment.

**Verification Standard (from WP11 AC1):**
> "Zero agent-generated content deploys without CFE passage"

**Test:** 50 known-violation messages → 100% blocked (WP11 Section 3 Regulatory Matrix)

### 1.6 Risk Multiplier
FINRA violations trigger a **1.4x multiplier** on the CFE Risk Score (WP11 Section 2.2).

---

## 2. State Insurance Regulations

### 2.1 Licensing State Machine
**States:** Unlicensed → Pre-Licensing (in progress) → Licensed → License Expired

**Gates (from WP11 Section 6):**

| State | Permissions | Blocks |
|-------|------------|--------|
| **Unlicensed** | Education content only | All insurance recommendations blocked at CFE |
| **Pre-Licensing** | Exam scheduling nudges, education | Insurance advice blocked |
| **Licensed** | Full insurance features | None (must maintain active IBA/POL per state) |
| **Expired** | Same as Pre-Licensing | All insurance recommendations blocked; renewal prompts active |

### 2.2 State-Specific Content Restrictions
**Rule:** State insurance rules are **parameterized (not hardcoded)**.

**Requirements:**
- Stricter state governs multi-state reps
- Rule updates via configuration, not code deployment
- CFE must check rep's active state licenses before allowing insurance content
- Each state may have unique: disclosure wording, waiting periods, advertising restrictions

### 2.3 Licensing Verification
**Implementation:**
- Rep must declare state licenses during onboarding
- System must validate IBA/POL status before insurance content generation
- CFE blocks insurance recommendations if license inactive for target state
- Multi-state reps: strictest active state regulation applies

### 2.4 Content Restrictions by State
**Parameterized rules must cover:**
- California: additional disclosure requirements for life insurance illustrations
- New York: strictest advertising rules for insurance products
- Texas: specific licensing display requirements
- Florida: hurricane/flood insurance special restrictions (if applicable)
- All states: unlicensed = zero insurance product discussion

### 2.5 State Insurance Risk Multiplier
State insurance violations trigger a **1.5x multiplier** on the CFE Risk Score — the highest multiplier in the system (WP11 Section 2.2).

---

## 3. FTC Rules

### 3.1 Income Claims — Section 5 of FTC Act
**Rule:** All income/earnings representations must be truthful, non-misleading, and substantiated.

**CFE Income Claim Classifier (WP11 Section 2.1.1):**
- **Detection:** "guaranteed income", "make $X/month", "financial freedom", "replace your income", dollar amounts with timeframes, lifestyle claims, percentage returns
- **Scoring:**
  - 0.0–0.3: Minor reference
  - 0.31–0.7: Moderate → mandatory FTC disclaimer injection
  - 0.71–1.0: Clear claim → auto-blocked if ≥ 0.8

### 3.2 Testimonials and Endorsements — 16 CFR Part 255
**Rule:** Testimonials must reflect honest opinions and typical results must be disclosed.

**CFE Testimonial Classifier (WP11 Section 2.1.2):**
- **Detection:** "I made $10K first month", before/after stories, named testimonials, photo/video claims
- **Scoring:**
  - ≥ 0.5 → requires substantiation
  - ≥ 0.8 → blocked unless signed release + typicality disclaimer

**Required Disclaimers:**
- "Results not typical. Individual results will vary."
- "This testimonial represents exceptional results."
- "Earnings depend on individual effort, market conditions, and other factors."

### 3.3 Native Advertising Disclosure
**Rule:** Commercial messages must be identifiable as advertising.

**Requirements:**
- AI-generated social content must include #ad or #sponsored when promoting business opportunity
- Email campaigns must identify sender as commercial
- SMS must identify business nature
- Cannot disguise commercial intent as personal communication

### 3.4 Business Opportunity Rule — 16 CFR Part 437
**Requirements:**
- Must disclose: total costs, earnings claims substantiation, cancellation/refund policy
- Cannot make earnings claims without written substantiation
- Must provide Earnings Claim Statement if earnings discussed

**CFE Opportunity Statement Classifier (WP11 Section 2.1.3):**
- **Detection:** "join my team", "be your own boss", "sponsor/upline/downline", "unlimited potential"
- **Scoring:**
  - ≥ 0.6 → business opportunity disclaimer required
  - ≥ 0.85 → blocked for unlicensed users in regulated states

### 3.5 FTC Disclosure Language Templates
**Mandatory safe harbor text (injected by CFE when income claim detected):**

```
"The income figures discussed are for illustration purposes only and represent 
the potential earnings of top performers. Your actual earnings will depend on your 
individual effort, dedication, and market conditions. There is no guarantee of 
any specific level of income."
```

### 3.6 FTC Risk Multiplier
FTC violations trigger a **1.0x base multiplier** on CFE Risk Score (applied via Income Claim classifier weight of 0.30).

---

## 4. GDPR Compliance

### 4.1 Lawful Basis for Processing
**Requirement:** All personal data processing must have a lawful basis (consent, contract, legal obligation, vital interests, public task, legitimate interests).

**Implementation:**
- **Consent capture at signup** (WP01 Flow A Step 2 — explicit opt-in)
- Consent record per data type: profile, contacts, calendar, agent logs
- Timestamped, versioned, revocable
- Granular consent (not blanket)

### 4.2 Data Processing Rights (Articles 15–22)
Users have the right to:
- **Access** (Article 15): Full data inventory delivered to registered email
- **Rectification** (Article 16): Correct inaccurate data
- **Erasure** (Article 17 / "Right to be Forgotten"): Deletion within 30 days
- **Restriction** (Article 18): Limit processing while disputing accuracy
- **Portability** (Article 20): Export in structured format (JSON/CSV)
- **Objection** (Article 21): Object to processing based on legitimate interests

### 4.3 Consent Requirements
**Implementation (from WP11 Section 4.1):**
- Explicit opt-in at signup (not pre-checked boxes)
- Separate consent for SMS outreach (TCPA + GDPR dual compliance)
- Separate consent for analytics/tracking cookies
- Consent record structure:
  ```
  ConsentRecord {
    dataType: string
    granted: boolean
    timestamp: ISO8601
    version: string
    revocable: true
    withdrawalMethod: string
  }
  ```

### 4.4 Data Protection Impact Assessment (DPIA)
**Requirement:** DPIA on file for high-risk processing (contact data, AI profiling).

### 4.5 Data Processing Agreement (DPA)
**Requirement:** DPA with all subprocessors (AI providers, cloud infrastructure, Stripe).

### 4.6 GDPR Deletion Timeline
**Requirement:** Complete deletion within **30 days** of request (WP11 AC5).

**Cascading deletion rules:**
- Rep personal data: fully deleted
- Upline-visible team structure: anonymized (not destroyed)
- Agent logs: retained 12 months then anonymized
- Audit logs: retained 7 years (regulatory override)

### 4.7 Cross-Border Transfer
**Requirement:** If EU user data transfers to US, ensure Standard Contractual Clauses (SCCs) or adequacy decision coverage.

---

## 5. CCPA Compliance

### 5.1 Data Collection Disclosure
**Requirement:** At or before collection, disclose:
- Categories of personal information collected
- Purposes for collection
- Categories of third parties information is shared with
- Consumer rights under CCPA

**Implementation:**
- Privacy policy linked at signup
- Just-in-time disclosures during contact import
- Category-by-category collection notice

### 5.2 Right to Know
**Requirement:** Users can request disclosure of specific pieces and categories of personal information collected.

**Implementation:** User Data Rights Portal (WP11 Section 4.4) generates full data inventory within 5 minutes.

### 5.3 Right to Delete
**Requirement:** Users can request deletion of personal information.

**Timeline:** 45-day SLA (WP11 AC6), target 30 days.

**Exceptions (CCPA § 1798.105(d)):**
- Complete transaction
- Security incident detection
- Debugging/repair
- Free speech protections
- Legal compliance
- Internal uses aligned with consumer expectations

### 5.4 Right to Opt-Out
**Requirement:** Users can opt out of "sale" of personal information.

**Implementation:**
- "Do Not Sell My Personal Information" link required
- Opt-out must be honored within 15 business days
- Contact list data explicitly excluded from any sale mechanism

### 5.5 Right to Non-Discrimination
**Requirement:** Cannot deny service, charge different prices, or provide different quality based on CCPA exercise.

### 5.6 CCPA Deletion vs. GDPR Deletion
**Rule:** When both apply, strictest standard wins.
- GDPR: 30 days
- CCPA: 45 days
- **Harvest standard: 30 days** (GDPR stricter)

### 5.7 Verification Requirements
**Requirement:** Must verify consumer identity before disclosing or deleting data.

**Implementation:**
- Multi-factor verification for deletion requests
- Email confirmation loop
- 24-hour cooling-off period for deletion confirmation

---

## 6. Hidden Earnings Estimate — Safe Harbor Framing

### 6.1 Brand Doctrine Requirement (from Brand Doctrine v3)
The **Hidden Earnings Estimate** is a core psychological unlock in onboarding. It quantifies potential wealth already inside existing relationships.

**CRITICAL CONSTRAINT:**
> "It is a core psychological unlock."

But per FTC and brand integrity requirements:
> "Product must make latent value visible, but **always as potential rather than guarantee**" (Foundation v5 Section 1.3)

### 6.2 Mandatory Framing Rules

**MUST USE (safe harbor):**
- "potential earnings"
- "hidden potential"
- "estimated opportunity"
- "what could be possible"
- "based on industry averages"
- "illustrative purposes only"

**NEVER USE (auto-blocked by CFE):**
- "you will earn"
- "guaranteed income"
- "projected earnings" (implies certainty)
- "expected returns"
- Any dollar amount + timeframe without disclaimer

### 6.3 Safe Harbor Template for Hidden Earnings Estimate
```
"Based on your network size and industry benchmarks, your warm market has an 
estimated POTENTIAL value of $X–$Y. This is not a guarantee of earnings. Actual 
results depend entirely on your effort, consistency, market conditions, and other 
factors beyond our control."
```

### 6.4 Calculation Transparency
**Requirement:** If showing a Hidden Earnings Estimate, the calculation methodology must be:
- Explained to the user
- Based on realistic industry averages (not top-performer outliers)
- Clearly labeled as "illustrative"
- Subject to user acknowledgment of variability

### 6.5 CFE Enforcement
- Hidden Earnings Estimate content passes through Income Claim Classifier
- Any framing that implies certainty → auto-blocked (score ≥ 0.8)
- Any dollar amount without "potential" or "estimate" qualifier → flagged (score ≥ 0.5)
- Upline review required for any earnings estimate content (score 11–70)

---

## 7. Data Encryption Standards

### 7.1 Encryption in Transit
**Standard:** TLS 1.3 for all API/data transfer (WP11 Section 5)

**Requirements:**
- Minimum TLS 1.2 (never TLS 1.1 or below)
- TLS 1.3 preferred for all new connections
- Certificate pinning for mobile apps
- HSTS (HTTP Strict Transport Security) headers
- No unencrypted HTTP endpoints

### 7.2 Encryption at Rest
**Standard:** AES-256 for all stored data (WP11 Section 5)

**Coverage:**
- Contact data (The Vault)
- User profiles
- Agent logs
- Calendar data
- Message content
- Audit logs
- Payment data (handled by Stripe PCI DSS Level 1)

### 7.3 Key Management
**Potential:** Google Cloud KMS for encryption key management (WP11 Dependencies)

**Requirements:**
- Keys rotated per compliance schedule
- Key access logged
- Separation of duties for key administration

### 7.4 End-to-End Encryption
**Requirement:** Message content encrypted between sender and recipient where channel supports it.

**Note:** SMS and email are inherently not end-to-end encrypted. Content must still pass CFE before transmission.

### 7.5 Encryption Verification
**Test:** Penetration test must verify no cleartext data exposure at rest or in transit.

---

## 8. Authentication & Access Control

### 8.1 Secure Login
**Requirements:**
- Multi-factor authentication (MFA) mandatory for all roles
- Password policy: minimum 12 characters, complexity requirements
- Rate limiting on login attempts (exponential backoff)
- Account lockout after 5 failed attempts
- Secure password reset flow (token-based, time-limited)
- OAuth 2.0 / OpenID Connect for social login (if offered)
- No plaintext password storage (bcrypt/Argon2)

### 8.2 Session Management
**Requirements (from WP11 Section 5):**
- Session timeout: 30 minutes of inactivity
- Absolute session expiration: 24 hours maximum
- Secure session cookies (HttpOnly, Secure, SameSite=Strict)
- Session revocation on logout (server-side invalidation)
- Concurrent session limits per user
- Session anomaly detection (impossible travel, new device alerts)

### 8.3 Role-Based Access Control (RBAC)
**Role Hierarchy:**

| Role | Contact Data | Team Data | Org Data | Admin | Compliance |
|------|--------------|-----------|----------|-------|------------|
| **Rep** | Own only | Own team's upline view | None | No | View only |
| **Upline/Field Trainer** | Team view | Team full | Limited | No | Review flagged content |
| **RVP/Org Leader** | Org-wide | Org-wide | Full | Partial | Full review + config |
| **External Non-Primerica** | Own only | None | None | No | View only |
| **Compliance Officer** | Audit view | Audit view | Audit view | No | Full + override |
| **System Admin** | None (unless authorized) | None (unless authorized) | Infrastructure only | Full | View only |

**Rules:**
- Rep sees own data only
- Upline sees team data (not cross-team)
- RVP sees org-wide
- Never cross-team data access
- Dual-role users: lowest-common-denominator principle (if Rep+Upline, Upline permissions apply only to their own downline)

### 8.4 Access Control Enforcement
**Implementation:**
- Every API endpoint validates role before response
- Row-level security in database
- Field-level redaction for sensitive data
- Audit log of all access (who, what, when, from where)

---

## 9. User Data Rights

### 9.1 Data Access Right
**Implementation (from WP11 Section 4.4):**
- User requests via Data Rights Portal
- System compiles full data inventory
- Delivered to registered email
- Format: JSON + CSV options
- Timeline: within 5 minutes (WP11 AC7)

### 9.2 Data Export Right
**Implementation:**
- Export format: structured JSON (machine-readable) + CSV (human-readable)
- Includes: profile, contacts, messages, calendar, agent logs, activity data
- Excludes: audit logs (regulatory retention), other users' data
- Download link expires in 24 hours
- Export request logged

### 9.3 Data Deletion Right
**Implementation:**
- User initiates deletion via Data Rights Portal
- 24-hour confirmation cooling-off period
- Cascading deletion after confirmation:
  1. User profile data → deleted
  2. Contact data (The Vault) → deleted
  3. Message history → deleted
  4. Calendar integrations → disconnected
  5. Agent logs → anonymized (not deleted, for team analytics)
  6. Team structure references → anonymized
- Confirmation email sent within 30 days
- Deletion certificate provided

### 9.4 Data Portability
**Implementation:**
- Export in commonly used structured format (JSON)
- Direct transfer to another service (if technically feasible)
- No artificial barriers to data exit

### 9.5 Consent Withdrawal
**Implementation:**
- User can withdraw consent for specific data types
- Withdrawal does not affect lawfulness of processing before withdrawal
- Immediate cessation of processing for withdrawn consent types
- Partial service degradation if essential consent withdrawn (clearly communicated)

---

## 10. Data Retention Policies

### 10.1 Active User Data
**Retention:** Subscription duration + 90 days

**Data types:**
- Profile data
- Contact data (The Vault)
- Message content
- Calendar data
- Activity logs
- Agent execution logs

### 10.2 Deleted User Data
**Retention:** Purged within 30 days of deletion request

**Exceptions (must be documented):**
- Audit logs: 7 years (regulatory requirement)
- Anonymized analytics: retained indefinitely (no PII)
- Payment records: per Stripe retention (7 years)
- Legal hold data: retained per legal requirement

### 10.3 Agent Logs
**Retention:** 12 months, then anonymized (WP11 Section 4.3)

**Content:**
- Agent execution history
- Decision rationale
- User interactions with agents
- Compliance filter decisions

### 10.4 Audit Logs
**Retention:** 7 years (WP11 Section 4.3)

**Content:**
- All CFE decisions
- All access events
- All data modifications
- All consent changes
- Immutable, append-only, cryptographically signed

### 10.5 Inactive Account Policy
**Definition:** No login for 180 days

**Policy:**
- After 180 days: reminder email sent
- After 210 days: data marked for archival
- After 365 days: account suspended, data retained for 30 more days then purged (unless user reactivates)
- User notified at each stage with option to reactivate

### 10.6 Data Retention Verification
**Test:** Verify deletion completes within 30 days (GDPR) / 45 days (CCPA).

---

## 11. Data Never Sold — Contact List Prohibition

### 11.1 Absolute Prohibition
**Brand Doctrine Requirement (from Brand Doctrine v3):**
> "The product must treat contact access/import as a sacred vault-opening ritual, not a utilitarian data grab."

**Legal Requirement:**
- Contact list data is **NEVER sold, rented, shared, or monetized** in any way
- This applies to all data types: names, phone numbers, emails, addresses, relationship graphs
- No third-party access to contact data for advertising or profiling
- No data broker relationships

### 11.2 Contact Data Ownership
**Principle:** Contact data imported by user is **user property**, not platform property.

**Rules:**
- User owns their contact list (The Vault)
- Platform acts as data processor, not data controller for contact data
- Contact data cannot be used to build platform-level datasets
- Contact data cannot be used for platform marketing
- Contact data cannot be used to train AI models without explicit consent

### 11.3 Subprocessor Restrictions
**Requirement:** Any subprocessor with access to contact data must:
- Sign DPA
- Agree to no-sale clause
- Agree to processing only for platform functionality
- Agree to deletion upon contract termination

### 11.4 AI Training Data
**Rule:** Contact data cannot be used to train AI models.

**Exception:** Only with explicit, granular consent per contact, and only for the user's own agent personalization (not global model training).

### 11.5 Privacy Policy Language
**Required statement:**
```
"We will never sell, rent, or share your contact list data with any third party. 
Your contacts are your property. We process this data solely to provide you with 
the Harvest platform services you request."
```

### 11.6 CCPA "Do Not Sell" Alignment
**Requirement:** Contact list data explicitly excluded from any "sale" mechanism.
**Implementation:** "Do Not Sell" toggle automatically applies to all contact data.

---

## 12. Safe Harbor Language Requirements

### 12.1 Universal Safe Harbor Rule
**ALL content containing income, earnings, wealth, or financial potential language MUST include safe harbor disclaimers.**

**Applies to:**
- SMS messages
- Email campaigns
- Social media posts
- Phone scripts
- Training materials
- Onboarding content
- Dashboard copy
- AI-generated agent content

### 12.2 Required Safe Harbor Language Templates

**Template A — Income/Earnings:**
```
"The income figures discussed are for illustration purposes only and represent 
the potential earnings of top performers. Your actual earnings will depend on your 
individual effort, dedication, and market conditions. There is no guarantee of 
any specific level of income. Past performance does not guarantee future results."
```

**Template B — Business Opportunity:**
```
"This is a business opportunity, not a job. Success requires significant effort, 
skill, and persistence. There is no assurance that you will achieve the results 
described. Individual results will vary based on personal commitment and market 
conditions."
```

**Template C — Testimonial:**
```
"This testimonial reflects the experience of one individual. Results are not 
typical. Your results will depend on your personal effort, skill, and market conditions. 
This is not a guarantee of similar outcomes."
```

**Template D — Insurance:**
```
"Insurance products are subject to state regulation and licensing requirements. 
This information is for educational purposes only and does not constitute a 
recommendation to purchase any specific product. Consult with a licensed insurance 
professional in your state."
```

**Template E — Hidden Earnings Estimate:**
```
"This estimate is based on industry averages and your network characteristics. 
It represents POTENTIAL only, not a guarantee or projection of actual earnings. 
Actual results depend entirely on your effort, consistency, and market conditions."
```

### 12.3 CFE Safe Harbor Injection
**Rule:** CFE automatically injects appropriate safe harbor language based on classifier triggers.

**Injection Logic:**
| Classifier Trigger | Template Injected |
|-------------------|---------------------|
| Income Claim ≥ 0.5 | Template A |
| Opportunity ≥ 0.6 | Template B |
| Testimonial ≥ 0.5 | Template C |
| Insurance ≥ 0.5 | Template D |
| Hidden Earnings Estimate | Template E |

### 12.4 Safe Harbor Placement
**Rules:**
- Must be visible (not buried in fine print)
- Must be proximate to the claim (same screen/page/message)
- Must be in same language as primary content
- Must be legible (minimum font size for digital, clear audio for voice)

### 12.5 Forbidden Language (Auto-Block List)
The following terms/phrases in outbound content trigger immediate CFE blocking (score ≥ 0.8):

- "guaranteed income"
- "guaranteed earnings"
- "you will make"
- "promise of income"
- "financial freedom guaranteed"
- "replace your income guaranteed"
- "get rich"
- "quick money"
- "easy money"
- "no effort required"
- "passive income guarantee"
- Any specific dollar amount + "guaranteed" or "will"

---

## 13. Primerica Affiliation Disclaimers

### 13.1 Independent Contractor Status
**Requirement:** All reps must be identified as independent contractors, not employees of Primerica.

**Required language:**
```
"I am an independent contractor with Primerica. I am not an employee, agent, or 
representative of Primerica. The views expressed are my own and do not necessarily 
reflect those of Primerica."
```

### 13.2 Product Provider Disclosure
**Requirement:** When discussing Primerica products, disclose:
- Products are offered by Primerica Financial Services
- Insurance products underwritten by specific carriers (where required)
- Investment products offered through PFS Investments Inc.

### 13.3 Licensing Disclosure
**Requirement:** Rep must disclose their licensing status in any communication that could be construed as financial advice.

**Required:**
- State licenses held
- IBA/POL status
- "Licensed insurance agent in [STATE(S)]"

### 13.4 Organization Gating
**Rule:** Primerica-specific disclaimers only appear when:
- Organization = Primerica (hard gate)
- User has declared Primerica affiliation during onboarding
- Content is in a Primerica-specific feature (WP03, WP08)

**Non-Primerica users:** Never see Primerica branding, disclaimers, or references.

### 13.5 Primerica Content Restrictions
**Additional rules for Primerica-affiliated content:**
- Must comply with Primerica's own compliance guidelines (layered on top of regulatory)
- Cannot make unauthorized product comparisons
- Cannot disparage other companies
- Must use approved product terminology

### 13.6 Dual-Role Disclosure
**Requirement:** If a user is both rep and upline, disclosures must clarify which role they are acting in for each communication.

---

## 14. Compliance Filter Engine (CFE) Architecture

### 14.1 Position in Stack
```
[AI Generation Layer]
    ↓
[WP11: Compliance Filter Engine]
    ├── Risk Score 0-10 → Auto-Deploy
    ├── Risk Score 11-70 → Flag for Upline Review
    └── Risk Score 71-100 → Block (Physically Prevented)
    ↓
[Deployment Layer: SMS/Email/Social/Phone]
```

### 14.2 Five-Classifier Pipeline

| Classifier | Weight | Trigger Threshold | Block Threshold |
|------------|--------|-------------------|-----------------|
| Income Claim | 0.30 | ≥ 0.5 (disclaimer) | ≥ 0.8 (block) |
| Testimonial | 0.20 | ≥ 0.5 (substantiation) | ≥ 0.8 (block) |
| Opportunity | 0.15 | ≥ 0.6 (disclaimer) | ≥ 0.85 (block) |
| Insurance | 0.25 | ≥ 0.5 (license check) | ≥ 0.8 (block) |
| Referral | 0.10 | ≥ 0.6 (TCPA check) | ≥ 0.8 (block) |

### 14.3 Risk Scoring Formula
```
Base Score = Σ(Classifier_Confidence × Weight) × Regulation_Multiplier

Multipliers:
- FINRA: 1.4x
- State Insurance: 1.5x (highest)
- TCPA: 1.3x
- CAN-SPAM: 1.1x
- FTC: 1.0x (base)

Cap: 100
```

### 14.4 Action Matrix

| Score | Classification | Action |
|-------|---------------|--------|
| 0-10 | Pass | Auto-deploy, log audit trail |
| 11-70 | Flag | Route to upline review, hold in queue, notify |
| 71-100 | Block | Physically prevent, return 403 to agent, alert compliance officer |

### 14.5 Upline Review Workflow
**Flagged content (11-70):**
- Upline notified via in-app + email
- Upline sees: content preview, classifier triggers, confidence scores, risk score, recommended action
- Actions: approve (with justification), reject (with feedback), modify (edit and re-submit to CFE)
- All actions logged to immutable audit trail
- Escalate to compliance officer after 48 hours if unreviewed

### 14.6 Audit Trail Requirements
Every CFE decision recorded:
- content ID
- timestamp
- classifiers triggered
- confidence scores
- risk score
- decision (pass/flag/block)
- reviewer (if flagged)
- reviewer action
- rule version

**Immutable:** append-only log, cryptographically signed, write-once storage

### 14.7 Parameterized Rules
**Rule:** Regulatory rules = configuration, not code.

**Benefits:**
- Regulatory changes deploy via config update, not code deployment
- State-specific rules loaded from config
- A/B testing of classifier thresholds
- Versioned rule sets

### 14.8 CFE Failure Handling
**If CFE becomes non-responsive:**
- All agent output paused within 60 seconds (WP11 AC14)
- Error message: "Compliance filter unavailable, agent output suspended"
- Manual messaging still possible with compliance acknowledgment
- Alert sent to compliance officer and engineering

---

## 15. Cross-Reference Matrix

### 15.1 Requirement → PRD Source Mapping

| Requirement | PRD.md | WP11 | Foundation v5 | Brand Doctrine v3 | Behavior Matrix |
|-------------|--------|------|---------------|-------------------|-----------------|
| FINRA compliance | 4.11 | ✓ Full spec | 1.10 | — | #35, #36 |
| State insurance licensing | 4.11 | ✓ Full spec | 1.10 | — | #35, #36 |
| FTC income claims | 4.11 | ✓ Full spec | 1.10, 2.3 | — | #35, #36 |
| GDPR | 4.11 | ✓ Full spec | 1.10 | — | #36 |
| CCPA | 4.11 | ✓ Full spec | 1.10 | — | #36 |
| Hidden Earnings Estimate | 1.3, 7.1 | — | 1.3 | ✓ Core concept | #4 |
| Data encryption | 4.11 | ✓ Full spec | — | — | #36 |
| Authentication/RBAC | 2.1, 4.11 | ✓ Full spec | 1.5 | — | #36 |
| User data rights | 4.11 | ✓ Full spec | — | — | #36 |
| Data retention | 4.11 | ✓ Full spec | — | — | — |
| Data never sold | 4.11 | ✓ Full spec | — | ✓ Sacred vault | — |
| Safe harbor language | 4.11, 6.1 | ✓ Full spec | 2.3 | — | #35 |
| Primerica disclaimers | 3.1, 4.11 | — | 1.6 | — | — |

### 15.2 Work Package Compliance Dependencies

| Work Package | Compliance Prerequisites | Compliance Gates |
|--------------|------------------------|------------------|
| WP01 Onboarding | WP11 operational | Consent capture, org gating |
| WP02 Warm Market | WP11 operational | Data handling, encryption |
| WP03 Primerica Warm Market | WP11 + WP01 | Licensing state machine |
| WP04 Agent Layer | WP11 operational | Agent output paused if CFE down |
| WP05 Messaging | WP11 + WP04 | All messages through CFE |
| WP06 Social Content | WP11 + WP05 | Social content through CFE |
| WP07 Gamification | WP11 + WP04 | Income displays through CFE |
| WP08 Taprooting | WP11 + WP03 + WP07 | Primerica-specific compliance |
| WP09 Calendar | WP11 + WP04 | Calendar data encryption |
| WP10 Payment | WP11 + WP01 | Stripe PCI DSS |
| WP11 Compliance | None (foundation) | Governs all |

### 15.3 Compliance Acceptance Criteria (from WP11)

| ID | Criterion | Status |
|----|-----------|--------|
| AC1 | Zero agent-generated content deploys without CFE passage | ⏳ Build-time |
| AC2 | CFE catches 100% of explicit income guarantee language | ⏳ Build-time |
| AC3 | Blocked content physically prevented (API returns 403) | ⏳ Build-time |
| AC4 | Audit trail immutable and complete | ⏳ Build-time |
| AC5 | GDPR deletion within 30 days | ⏳ Build-time |
| AC6 | CCPA deletion within 45 days | ⏳ Build-time |
| AC7 | Export within 5 minutes | ⏳ Build-time |
| AC8 | Unlicensed reps blocked from insurance recommendations | ⏳ Build-time |
| AC9 | TCPA opt-out halts SMS within 60 seconds | ⏳ Build-time |
| AC10 | Every email contains functional unsubscribe | ⏳ Build-time |
| AC11 | Regulatory rules updated via config | ⏳ Build-time |
| AC12 | CFE processes 100 messages/second | ⏳ Build-time |
| AC13 | Upline review within 4 hours of flag | ⏳ Build-time |
| AC14 | Agent output pauses within 60s of CFE down | ⏳ Build-time |

---

## Appendix A: Forbidden Terms (Auto-Block Glossary)

The following terms are **forbidden** in all AI-generated outbound content per Brand Doctrine v3 (Constraint 1) and trigger CFE blocking:

| Forbidden Term | Required Replacement | Context |
|----------------|----------------------|---------|
| prospect | community contact / downline member | All outbound |
| lead | community contact / warm contact | All outbound |
| pitch | community introduction | All outbound |
| sales call | community conversation | All outbound |
| selling | sharing / introducing | All outbound |
| closing | helping / serving | All outbound |
| funnel (sales) | introduction pipeline / harvest pipeline | All outbound |
| conversion (without community context) | connection / engagement | All outbound |
| guaranteed income | potential earnings / estimated opportunity | Income content |
| get rich | build wealth / grow your harvest | Motivational |
| quick money | consistent effort / steady growth | Motivational |

**Note:** These terms are blocked at the **pre-generation** layer (injected as negative constraints in agent prompts) AND the **pre-send** layer (CFE classifier detection).

---

## Appendix B: Regulatory Contact and Update Protocol

### Update Triggers
- New FINRA rule announcement
- State insurance regulation changes
- FTC guidance updates
- GDPR enforcement action precedents
- CCPA amendment (CPRA, etc.)
- Primerica compliance policy changes

### Update Process
1. Compliance officer reviews new regulation
2. Rules updated in parameterized config (no code deploy)
3. CFE rule version incremented
4. Back-test against historical content
5. Deploy to staging
6. Verify with test suite
7. Deploy to production
8. Audit log records rule change

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v4 | 2026-04-27 | Subagent | Full extraction from all PRD sources |

**Next Review:** Upon completion of WP11 implementation or regulatory change

**Distribution:** All downstream build agents, compliance officer, legal review

---

*END OF COMPLIANCE EXTRACTION v4*

- Appendix D: Roadmap Dependency Map

# The Harvest — Complete Product Roadmap v5: Structured Dependency Map

> **Source documents:** `PRD.md` (Sections 4–5), `_foundation-draft.md` (Sections 1.7–1.8, 3.2–3.10), `harvest-handoff.md`, `inbox/product-behavior-matrix.md`, `inbox/brand-doctrine-v3.md`
> **Extraction date:** 2026-04-26
> **Format:** Per-package dependency specification with sequential chains, parallel groups, hybrid links, technical prerequisites, phase assignments, and completion gates.

---

## Table of Contents

1. [Macro Phase Overview](#macro-phase-overview)
2. [Work Package Dependency Map — Summary](#work-package-dependency-map--summary)
3. [Work Package 1 — Onboarding & Profile Engine](#wp1)
4. [Work Package 2 — Warm Market & Contact Engine (Universal)](#wp2)
5. [Work Package 3 — Harvest Warm Market Method (Primerica-Specific)](#wp3)
6. [Work Package 4 — AI Agent Layer & Mission Control](#wp4)
7. [Work Package 5 — Messaging Engine & Outreach System](#wp5)
8. [Work Package 6 — Social, Content & Launch Kit](#wp6)
9. [Work Package 7 — Accountability, Gamification & Motivation](#wp7)
10. [Work Package 8 — Taprooting, Timeline & Primerica-Specific Features](#wp8)
11. [Work Package 9 — Team Calendar & Upline Dashboard](#wp9)
12. [Work Package 10 — Payment & Subscription Infrastructure](#wp10)
13. [Work Package 11 — Data Privacy, Security & Compliance Architecture](#wp11)
14. [Critical Path Spine](#critical-path-spine)
15. [Parallelization Rules](#parallelization-rules)
16. [Completion Gates by Wave](#completion-gates-by-wave)

---

## Macro Phase Overview

| Phase | Name | Packages Involved | Exit Condition |
|-------|------|-------------------|----------------|
| **Phase A** | Foundation | WP 1, WP 11, WP 4 | Identity, compliance, and agent execution architecture locked |
| **Phase B** | Core Pipeline | WP 2, WP 5, WP 9, WP 10 | Relationship engine, messaging, calendar, and payments operational |
| **Phase C** | Primerica Overlay & Growth Systems | WP 3, WP 6, WP 7, WP 8 | Primerica-specific logic, content, motivation, and org visualization complete |
| **Phase D** | Integration & QC | All 11 | Cross-package coherence verified; no contradictions; doctrine fidelity confirmed |

---

## Work Package Dependency Map — Summary

```
Wave 0 (Foundation Control)
  └── Project Overview + Success Criteria + Build Workflow

Wave 1 (Anchor Packages)
  ├── WP 1 ── Onboarding & Profile Engine
  ├── WP 11 ─ Data Privacy, Security & Compliance
  └── WP 4 ── AI Agent Layer & Mission Control

Wave 2 (Core Pipeline)
  ├── WP 2 ── Warm Market & Contact Engine (Universal)
  ├── WP 5 ── Messaging Engine & Outreach System
  ├── WP 9 ── Team Calendar & Upline Dashboard
  └── WP 10 ─ Payment & Subscription Infrastructure

Wave 3 (Primerica Overlay & Growth)
  ├── WP 3 ── Harvest Warm Market Method (Primerica-Specific)
  ├── WP 6 ── Social, Content & Launch Kit
  ├── WP 7 ── Accountability, Gamification & Motivation
  └── WP 8 ── Taprooting, Timeline & Primerica-Specific Features
```

---

<a name="wp1"></a>
## Work Package 1 — Onboarding & Profile Engine

### Scope
Defines the first-run experience, identity architecture, and all downstream gating logic:
- Role architecture (Rep, Upline, RVP, External Non-Primerica User)
- Organization selection and hard-gating (Primerica vs. Non-Primerica)
- Solution number collection (user-declared, format-checked, not API-verified)
- Seven Whys belief exercise (mandatory; blocks progression until minimum threshold met)
- Upline linkage and dual-role mapping
- Calendar connection entry points
- Access tier seeds (free org-linked vs. paid independent)
- Time commitment / intensity calibration
- Profile data model and CRM mapping

### Sequential Dependencies
- **Blocked by:** Wave 0 Foundation (project overview, success criteria, build workflow)
- **Blocks:** WP 2, WP 3, WP 4, WP 5, WP 6, WP 7, WP 8, WP 9, WP 10, WP 11

### Parallelizable Groups
- WP 1 and WP 11 may proceed in close coordination once Wave 0 is stable.
- Organization gating logic (WP 1) and compliance interception model (WP 11) should be co-designed.

### Hybrid Dependencies
- **Co-design with WP 11:** Access tier seeds must respect privacy classification rules from compliance.
- **Co-design with WP 4:** Agent identity and role visibility depend on onboarding role definitions.
- **Co-design with WP 10:** Access tier seeds directly determine payment/subscription logic.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User identity schema | WP 1 | Defines all role fields, org gating flags, solution number format |
| Organization engine | WP 1 | Hard branch: Primerica vs. Non-Primerica determines feature visibility |
| Calendar API connection points | WP 1 | Entry points for later calendar sync (WP 9) |
| Seven Whys state machine | WP 1 | Must store belief commitment score; blocks Phase 2 unlock |

### Phase Designation
**Wave 1 (Anchor Package)** — Must complete before any other product package.

### Completion Signals
- [ ] Role schema defined with dual-role support
- [ ] Organization selection flow implemented with hard gating
- [ ] Seven Whys state machine blocks progression below threshold
- [ ] Solution number format validation and attestation flow complete
- [ ] Access tier seeds (free vs. paid) established
- [ ] Upline linkage data model and invitation flow defined
- [ ] Calendar connection entry points exposed
- [ ] Downstream packages can reference identity/org state without ambiguity

---

<a name="wp11"></a>
## Work Package 11 — Data Privacy, Security & Compliance Architecture

### Scope
Foundational governance layer that constrains all data handling, AI content, and outbound communication:
- Contact data classification and encryption posture
- User rights (access, deletion, export)
- Role-based access control (RBAC) tied to onboarding roles
- Compliance review interception model (standing layer, not post-hoc)
- Retention and deletion logic
- Outbound content governance (forbidden words: prospect, lead, pitch, sales call, funnel)
- FINRA, state insurance, and FTC compliance filters across ALL agent-generated content
- Audit logs mandatory for all AI-generated content

### Sequential Dependencies
- **Blocked by:** Wave 0 Foundation
- **Co-blocks with:** WP 1 (identity required for RBAC; compliance required for data handling)
- **Blocks:** WP 4, WP 5, WP 6, WP 9, WP 10, and all packages that store or expose user/contact data

### Parallelizable Groups
- WP 11 and WP 1 can be developed in parallel once Wave 0 is locked.

### Hybrid Dependencies
- **Co-design with WP 1:** RBAC requires role definitions from onboarding.
- **Co-design with WP 4:** Agent-generated content must pass compliance interception before delivery.
- **Co-design with WP 5:** Messaging engine cannot finalize templates until compliance boundaries are stable.
- **Co-design with WP 10:** Payment data handling requires privacy architecture alignment.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| Role definitions | WP 1 | RBAC permission matrix |
| Contact data model | WP 2 | Classification and encryption rules |
| Agent content generation | WP 4 | Interception hook for all AI output |
| Messaging templates | WP 5 | Forbidden word filter and income-language constraints |
| Payment data | WP 10 | PCI/security compliance alignment |

### Phase Designation
**Wave 1 (Anchor Package)** — Must establish constraints before any data-handling or outreach package proceeds.

### Completion Signals
- [ ] Contact data classification schema defined
- [ ] Encryption at rest and in transit specified
- [ ] RBAC permission matrix mapped to onboarding roles
- [ ] Compliance interception model designed (kernel-level, not advisory)
- [ ] Forbidden word list and income-language constraints documented
- [ ] Audit log schema mandatory for all AI content
- [ ] Retention/deletion policies defined
- [ ] Downstream packages can reference compliance rules without ambiguity

---

<a name="wp4"></a>
## Work Package 4 — AI Agent Layer & Mission Control

### Scope
The execution nervous system of the product. Defines all autonomous agents and the command interface:
- Agent inventory and role definitions (Prospecting, Nurture, Appointment, Re-engagement, etc.)
- Daily Mission Control briefing structure (Rep view and Upline view)
- Inactivity detection and re-engagement behavior
- Appointment-setting logic
- Momentum scoring and reporting
- Agent boundaries and handoff rules
- Rep vs. Upline visibility surfaces
- Three Laws monitoring (Grow, Engage, Wealth) — triggers corrective nudge if any law is neglected

### Sequential Dependencies
- **Blocked by:** WP 1 (identity/org gating), WP 11 (compliance constraints)
- **Practically also blocked by:** WP 2 (contact data for grounded execution)
- **Blocks:** WP 5, WP 7, WP 9, and partially WP 6

### Parallelizable Groups
- WP 4 can begin structural design as soon as WP 1 and WP 11 are coherent.
- WP 4 finalization requires WP 2 contact architecture for fully grounded agent behaviors.

### Hybrid Dependencies
- **Co-design with WP 1:** Role visibility surfaces depend on onboarding role definitions.
- **Co-design with WP 5:** Agent-generated outreach must pass through compliance interception.
- **Co-design with WP 7:** Momentum scoring and gamification depend on agent activity data.
- **Co-design with WP 9:** Appointment-setting agents require calendar integration logic.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User identity/org state | WP 1 | Agent behavior branching (Primerica vs. Non-Primerica)
| Compliance rules | WP 11 | All agent output must pass interception before delivery
| Contact segmentation | WP 2 | Agent execution requires segmented contact data
| Calendar availability | WP 9 | Appointment-setting requires dual-calendar logic

### Phase Designation
**Wave 1 (Anchor Package)** — Execution layer must be defined before outreach/content can be finalized.

### Completion Signals
- [ ] Agent inventory documented with specific roles and responsibilities
- [ ] Mission Control dashboard structure defined (Rep + Upline views)
- [ ] Daily briefing generation logic specified
- [ ] Three Laws monitoring and corrective nudge flow designed
- [ ] Inactivity detection thresholds and re-engagement sequences defined
- [ ] Appointment-setting agent handoff logic specified
- [ ] Agent boundaries prevent cross-role data leakage
- [ ] Downstream packages can reference agent behaviors without ambiguity

---

<a name="wp2"></a>
## Work Package 2 — Warm Market & Contact Engine (Universal)

### Scope
Converts the user's contact universe into structured relationship data:
- Native/mobile and desktop contact ingestion ("The Vault" — sacred ritual framing)
- CSV import with deduplication and normalization
- Contact segmentation and scoring
- Hidden Earnings Estimate mechanics (quantify potential in existing relationships)
- Memory jogger / contact activation structure
- Universal contact-to-prospect pipeline (relationship-first, not lead-first)
- Contact data encryption and privacy handling per WP 11

### Sequential Dependencies
- **Blocked by:** WP 1 (identity/org gating), WP 11 (lawful data handling constraints)
- **Blocks:** WP 3 (Primerica-specific warm market method), and practical completion of WP 4 and WP 5

### Parallelizable Groups
- WP 2 can proceed in parallel with WP 4 once WP 1 and WP 11 are stable.
- WP 2 must stabilize before Primerica-specific overlays (WP 3) begin.

### Hybrid Dependencies
- **Co-design with WP 1:** Contact import is framed as "opening The Vault" — onboarding must set this belief context.
- **Co-design with WP 3:** Primerica-specific warm market layers on top of universal contact architecture.
- **Co-design with WP 4:** Agent execution requires segmented contact data as input.
- **Co-design with WP 5:** Outreach messaging requires contact context and segment data.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| Identity/org state | WP 1 | Determines contact handling rules (Primerica vs. Non-Primerica)
| Privacy/compliance | WP 11 | Encryption, retention, user rights for contact data |
| Contact schema | WP 2 | Segmentation fields, scoring model, relationship metadata |
| Hidden Earnings model | WP 2 | Contact count × relationship strength × industry benchmarks |

### Phase Designation
**Wave 2 (Core Pipeline)** — Relationship engine must exist before agent execution at scale.

### Completion Signals
- [ ] Contact ingestion flows (mobile sync, CSV, manual) defined
- [ ] Deduplication and normalization rules specified
- [ ] Segmentation model documented (relationship-first categories)
- [ ] Hidden Earnings Estimate calculation logic defined
- [ ] Memory jogger / activation prompts designed
- [ ] Contact data encrypted per WP 11 requirements
- [ ] Universal pipeline stages defined (not "lead stages" — relationship stages)
- [ ] Downstream packages can reference contact data and segments without ambiguity

---

<a name="wp5"></a>
## Work Package 5 — Messaging Engine & Outreach System

### Scope
AI-generated, persona-aware, compliance-safe communication infrastructure:
- Outbound channel logic (SMS, email, in-app)
- Handoff system (Rep → Upline → Three-Way)
- Script generation with brand doctrine vocabulary enforcement
- Cadence logic and timing rules
- Approval/review logic for sensitive content
- Compliance interception path (kernel-level, not advisory)
- Income-language constraints (cannot guarantee earnings)
- Service-over-extraction framing in all generated content

### Sequential Dependencies
- **Blocked by:** WP 1 (identity), WP 4 (agent definitions), WP 11 (compliance constraints), WP 2 (contact/segment context)
- **Blocks:** WP 6 (content/social launch kit), and informs WP 7 (motivation context)

### Parallelizable Groups
- WP 5 can proceed once WP 1, WP 4, WP 11, and WP 2 are coherent.
- WP 6 and WP 7 may begin parallel design after WP 5 boundaries are stable.

### Hybrid Dependencies
- **Co-design with WP 4:** Messaging is the primary output channel for agent execution.
- **Co-design with WP 11:** Every template must pass compliance interception.
- **Co-design with WP 6:** Social content shares messaging DNA but has platform-specific constraints.
- **Co-design with WP 7:** Referral scripts and celebration messages feed motivation systems.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User identity/role | WP 1 | Determines messaging tone and visibility |
| Agent instructions | WP 4 | Defines what agents want to communicate |
| Compliance filter | WP 11 | Standing interception layer for all outbound content |
| Contact segments | WP 2 | Personalization context for each message |
| Brand doctrine | Brand Concept | Mandatory vocabulary replacement and philosophical framing |

### Phase Designation
**Wave 2 (Core Pipeline)** — Messaging cannot be finalized until compliance and agent boundaries are stable.

### Completion Signals
- [ ] Channel logic (SMS, email, in-app) defined with fallback rules
- [ ] Script generation pipeline documented with brand vocabulary enforcement
- [ ] Cadence rules and timing logic specified
- [ ] Approval/review flow for sensitive content designed
- [ ] Compliance interception path integrated with all outbound generation
- [ ] Handoff system (Rep → Upline → Three-Way) flow defined
- [ ] Income-language constraints and forbidden word filtering documented
- [ ] Downstream packages can reference messaging behaviors without ambiguity

---

<a name="wp9"></a>
## Work Package 9 — Team Calendar & Upline Dashboard

### Scope
Synchronized scheduling and upline visibility infrastructure:
- Upline/team calendar hierarchy (dual-calendar overlap identification)
- Appointment booking logic (only if Upline AND Rep are free)
- Attendance visibility and pace indicators
- Org-level Mission Control surfaces for RVP/Upline
- Scheduling oversight mechanics
- Calendar API integrations (Google, Outlook, etc.)

### Sequential Dependencies
- **Blocked by:** WP 1 (onboarding hierarchy), WP 4 (agent appointment-setting logic), WP 11 (privacy/visibility rules)
- **No direct downstream blockers** (terminal package for scheduling)

### Parallelizable Groups
- WP 9 and WP 10 may proceed in parallel once WP 1 and WP 4 are stable.

### Hybrid Dependencies
- **Co-design with WP 1:** Calendar connections are established during onboarding.
- **Co-design with WP 4:** Appointment-setting agents require calendar availability checks.
- **Co-design with WP 11:** Visibility rules must respect role-based access control.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User hierarchy | WP 1 | Upline/Rep/RVP role mapping for calendar sharing |
| Agent appointment logic | WP 4 | Availability checks before booking |
| RBAC | WP 11 | Who can see whose calendar |
| Calendar APIs | External | Google Calendar, Outlook integration points |

### Phase Designation
**Wave 2 (Core Pipeline)** — Scheduling depends on identity hierarchy and agent logic.

### Completion Signals
- [ ] Calendar hierarchy model defined (personal, team, org levels)
- [ ] Dual-calendar overlap detection logic specified
- [ ] Appointment booking rules (both parties free) documented
- [ ] Attendance visibility and pace indicator surfaces designed
- [ ] Upline/RVP Mission Control calendar views specified
- [ ] Calendar API integration points documented
- [ ] Privacy/visibility rules aligned with WP 11 RBAC

---

<a name="wp10"></a>
## Work Package 10 — Payment & Subscription Infrastructure

### Scope
Access and monetization layer:
- Free vs. paid access logic (org-linked free access for Primerica vs. independent subscription)
- Stripe subscription flows and tier management
- Failure, grace period, and revocation behavior
- Restoration flows after lapse
- Org-linked free access assumptions tied to onboarding hierarchy
- Subscription state integration with feature gating

### Sequential Dependencies
- **Blocked by:** WP 1 (access tier seeds), WP 11 (payment data security/compliance)
- **No direct downstream blockers** (terminal package for payments)

### Parallelizable Groups
- WP 10 and WP 9 may proceed in parallel once WP 1 and WP 11 are stable.

### Hybrid Dependencies
- **Co-design with WP 1:** Access tier seeds from onboarding directly determine subscription logic.
- **Co-design with WP 11:** Payment data handling requires security/compliance alignment.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| Access tier seeds | WP 1 | Free (org-linked) vs. paid (independent) determination |
| Security/compliance | WP 11 | PCI, encryption, data handling for payment info |
| Stripe integration | External | Subscription lifecycle, webhooks, tier management |

### Phase Designation
**Wave 2 (Core Pipeline)** — Payment logic depends on onboarding access tiers.

### Completion Signals
- [ ] Access tier logic (free org-linked vs. paid independent) defined
- [ ] Stripe subscription flow and tier management documented
- [ ] Failure, grace, and revocation behavior specified
- [ ] Restoration flow after lapse defined
- [ ] Subscription state integration with feature gating documented
- [ ] Payment data security aligned with WP 11 requirements

---

<a name="wp3"></a>
## Work Package 3 — Harvest Warm Market Method (Primerica-Specific)

### Scope
Proprietary Primerica warm-market activation methodology:
- Three-layer method: Blank Canvas, Qualities Flip, Background Matching
- Guided exercise flow producing prioritized action queue
- Primerica-only gated access (hidden unless Org = Primerica)
- Output feeds agent and messaging queues for execution
- Relationship-first framing consistent with brand doctrine

### Sequential Dependencies
- **Blocked by:** WP 1 (organization gating), WP 2 (universal contact architecture)
- **Blocks:** WP 8 (taprooting and timeline features build on warm market method outputs)

### Parallelizable Groups
- WP 3 may proceed in parallel with WP 6 and WP 7 after WP 2 is stable and WP 1 gating is locked.

### Hybrid Dependencies
- **Co-design with WP 1:** Org = Primerica must be the hard gate for all WP 3 features.
- **Co-design with WP 2:** Warm market method operates on contact data from the universal engine.
- **Co-design with WP 4:** Method outputs feed agent execution queues.
- **Co-design with WP 5:** Messaging templates incorporate warm market method context.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| Organization gate | WP 1 | Primerica-only visibility |
| Contact data | WP 2 | Base contact set for method exercises |
| Agent queues | WP 4 | Method outputs feed agent action items |
| Messaging | WP 5 | Prioritized action queue becomes outreach context |

### Phase Designation
**Wave 3 (Primerica Overlay)** — Cannot proceed until universal contact engine is stable.

### Completion Signals
- [ ] Three-layer method (Blank Canvas, Qualities Flip, Background Matching) documented
- [ ] Exercise flow and state machine defined
- [ ] Prioritized action queue generation logic specified
- [ ] Org = Primerica hard gate verified across all WP 3 features
- [ ] Output integration with agent queues (WP 4) documented
- [ ] Output integration with messaging (WP 5) documented
- [ ] Method stays relationship-first (no cold-pitch anti-patterns)

---

<a name="wp6"></a>
## Work Package 6 — Social, Content & Launch Kit

### Scope
Social content generation and sharing infrastructure:
- Launch content generation aligned with brand doctrine
- Rep-identity asset use (personal brand, not generic templates)
- Sharing mechanics across platforms
- Compliance-safe social content behavior
- Mission Control reporting hooks for social activity
- Content that treats members as community, not followers

### Sequential Dependencies
- **Blocked by:** WP 1 (identity), WP 5 (messaging/compliance boundaries), WP 11 (content governance)
- **No direct downstream blockers**

### Parallelizable Groups
- WP 6 may proceed in parallel with WP 7 after WP 5 boundaries are stable.

### Hybrid Dependencies
- **Co-design with WP 1:** Rep identity assets are established during onboarding.
- **Co-design with WP 5:** Social content shares messaging DNA and compliance constraints.
- **Co-design with WP 7:** Social activity feeds momentum scoring and celebration triggers.
- **Co-design with WP 11:** All generated content must pass compliance interception.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User identity/brand | WP 1 | Rep persona and asset foundation |
| Messaging compliance | WP 5 | Content generation boundaries |
| Content governance | WP 11 | Standing compliance layer |
| Social platforms | External | API integrations for publishing |

### Phase Designation
**Wave 3 (Primerica Overlay & Growth)** — Content generation inherits messaging and compliance rules.

### Completion Signals
- [ ] Content generation pipeline documented with brand doctrine alignment
- [ ] Rep-identity asset system defined
- [ ] Sharing mechanics and platform integrations specified
- [ ] Compliance-safe content rules integrated with WP 11
- [ ] Mission Control social activity reporting hooks designed
- [ ] Anti-pattern detection (follower-chasing, hype-led content) specified

---

<a name="wp7"></a>
## Work Package 7 — Accountability, Gamification & Motivation

### Scope
Belief reinforcement, momentum tracking, and behavioral nudges:
- 48-hour countdown and streak tracking
- Momentum score calculation (Three Laws composite)
- Celebration engine (milestones, wins, belief reinforcement)
- Quote engine with brand doctrine weighting
- Referral script motivation context
- Notification architecture for nudges and alerts
- Anchor/goal reinforcement loops
- Belief-first intervention (detect low belief → restore before productivity push)

### Sequential Dependencies
- **Blocked by:** WP 1 (identity), WP 4 (Mission Control, agent activity data), WP 5 (messaging/motivation context), brand doctrine inputs
- **No direct downstream blockers**

### Parallelizable Groups
- WP 7 may proceed in parallel with WP 6 after WP 5 boundaries are stable.

### Hybrid Dependencies
- **Co-design with WP 1:** Seven Whys output and anchor statement feed motivation loops.
- **Co-design with WP 4:** Momentum score requires agent activity data.
- **Co-design with WP 5:** Referral scripts and celebration messages integrate with messaging.
- **Co-design with Brand Doctrine:** All motivation content must reflect Three Laws, Collective Benefit, and anti-Hoarder principles.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| User identity/anchor | WP 1 | Seven Whys output, personal mission |
| Agent activity | WP 4 | Raw data for momentum scoring |
| Messaging | WP 5 | Celebration and nudge message delivery |
| Brand doctrine | Brand Concept | Quote weighting, celebration framing, belief logic |

### Phase Designation
**Wave 3 (Primerica Overlay & Growth)** — Motivation depends on Mission Control activity data.

### Completion Signals
- [ ] Momentum score formula documented (Three Laws composite)
- [ ] Streak and countdown mechanics defined
- [ ] Celebration engine triggers and outputs specified
- [ ] Quote engine with doctrine-weighted selection documented
- [ ] Notification architecture for nudges designed
- [ ] Belief-first intervention flow (detect low belief → restore) specified
- [ ] Anti-Hoarder metrics integrated (wealth distribution fairness)

---

<a name="wp8"></a>
## Work Package 8 — Taprooting, Timeline & Primerica-Specific Features

### Scope
Primerica-specific organizational visualization and milestone tracking:
- Org tree rendering (taprooting visualization)
- Rules-of-building surfaces
- Milestone timeline logic (activity-based unlocking)
- Objection-handling structures
- Primerica-specific weighted quote engine behavior
- Integration with Mission Control daily briefing
- Activity-based unlock sequencing

### Sequential Dependencies
- **Blocked by:** WP 1 (organization gating), WP 3 (warm market method outputs), WP 7 (motivation/milestone context), WP 9 (team calendar context where needed)
- **No direct downstream blockers**

### Parallelizable Groups
- WP 8 may proceed in parallel with universal growth systems (WP 6, WP 7) after WP 3 is stable.

### Hybrid Dependencies
- **Co-design with WP 1:** Org = Primerica hard gate for all WP 8 features.
- **Co-design with WP 3:** Taprooting builds on warm market method relationship data.
- **Co-design with WP 7:** Milestones trigger celebration/motivation systems.
- **Co-design with WP 9:** Team calendar provides context for org-wide milestones.

### Technical Dependencies
| Dependency | Source | Nature |
|------------|--------|--------|
| Organization gate | WP 1 | Primerica-only visibility |
| Warm market outputs | WP 3 | Relationship data for org tree |
| Motivation system | WP 7 | Milestone triggers and celebration |
| Team calendar | WP 9 | Org-wide event context |

### Phase Designation
**Wave 3 (Primerica Overlay & Growth)** — Must not run ahead of WP 3.

### Completion Signals
- [ ] Taprooting visualization model defined
- [ ] Rules-of-building surfaces documented
- [ ] Milestone timeline logic and activity-based unlocks specified
- [ ] Objection-handling structures designed
- [ ] Org = Primerica hard gate verified across all WP 8 features
- [ ] Integration with Mission Control daily briefing documented

---

## Critical Path Spine

The **minimum critical path** for a coherent system is:

```
Foundation → WP 1 → WP 11 → WP 2 → WP 4 → WP 5
```

### Why this is the spine:
1. **WP 1** defines who the user is, what org they belong to, and what system branch they get.
2. **WP 11** defines what is legally and structurally allowed.
3. **WP 2** defines what relationship data exists to activate.
4. **WP 4** defines how AI acts on that data and reports back.
5. **WP 5** defines how those actions are expressed through outreach.

**If this spine is weak, all later packages become speculative or contradictory.**

---

## Parallelization Rules

### ✅ Allowed Parallelism
| Parallel Group | Conditions |
|----------------|------------|
| WP 1 + WP 11 | Once Wave 0 foundation is stable |
| WP 9 + WP 10 | Once WP 1 and WP 4 are coherent |
| WP 6 + WP 7 | Once WP 5 boundaries are stable |
| WP 3 + (WP 6, WP 7) | Once WP 2 is stable and WP 1 gating is locked |
| WP 8 + (WP 6, WP 7) | Once WP 3 is stable |

### ❌ Disallowed Parallelism
| Blocked Combination | Why |
|---------------------|-----|
| WP 3 before WP 2 | Primerica-specific method requires universal contact engine |
| WP 8 before WP 3 | Taprooting requires warm market method outputs |
| WP 5 before WP 4 | Messaging requires agent definitions and boundaries |
| WP 5 before WP 11 | Outreach requires compliance architecture |
| WP 9 before WP 4 | Calendar requires agent appointment logic |
| WP 10 before WP 1 | Payment requires access tier seeds |
| Any Primerica-only package before org gate is explicit | Hard gating must be locked first |
| Any outreach package that assumes "compliance added later" | Compliance is a standing layer, not post-hoc |

---

## Completion Gates by Wave

### Wave 0 — Foundation Control
**Complete when:**
- [ ] All 11 work packages named and sequenced
- [ ] Dependency spine explicit
- [ ] Brand doctrine integration points identified
- [ ] Verification standards explicit
- [ ] Parallelization rules documented

### Wave 1 — Anchor Packages
**Complete when:**
- [ ] WP 1: Identity, org gating, Seven Whys, access tiers locked
- [ ] WP 11: Privacy, security, compliance, RBAC, interception model locked
- [ ] WP 4: Agent inventory, Mission Control, Three Laws monitoring locked
- [ ] Cross-package terminology aligned between WP 1, WP 11, WP 4
- [ ] Downstream packages (WP 2, WP 5, WP 9, WP 10) can proceed without ambiguity

### Wave 2 — Core Pipeline
**Complete when:**
- [ ] WP 2: Contact ingestion, segmentation, Hidden Earnings, pipeline stable
- [ ] WP 5: Messaging channels, compliance interception, cadence, handoffs stable
- [ ] WP 9: Calendar hierarchy, dual-calendar booking, upline visibility stable
- [ ] WP 10: Subscription tiers, Stripe flows, grace/revocation stable
- [ ] Cross-package coherence verified (contact → agent → message → calendar → payment)

### Wave 3 — Primerica Overlay & Growth
**Complete when:**
- [ ] WP 3: Warm Market Method three-layer flow, action queue generation stable
- [ ] WP 6: Social content, launch kit, compliance-safe sharing stable
- [ ] WP 7: Momentum score, celebration, belief intervention, nudges stable
- [ ] WP 8: Taprooting, milestones, objection handling, unlock sequencing stable
- [ ] Cross-package coherence verified (warm market → taprooting → motivation → social)

### Phase D — Integration & QC
**Complete when:**
- [ ] No package contradicts another
- [ ] Terminology is stable across all 11 packages
- [ ] Gating logic is consistent (Primerica vs. Non-Primerica)
- [ ] Role visibility rules align across the system
- [ ] Doctrine fidelity confirmed (no anti-patterns, no generic sales language)
- [ ] Final QC score ≥ 8/10 with zero critical failures

---

## Dependency Matrix (Quick Reference)

| WP | Name | Phase | Blocks | Blocked By | Can Parallel With |
|----|------|-------|--------|------------|-------------------|
| 1 | Onboarding & Profile | Wave 1 | 2,3,4,5,6,7,8,9,10,11 | Foundation | 11 |
| 11 | Privacy/Security/Compliance | Wave 1 | 4,5,6,9,10 | Foundation | 1 |
| 4 | AI Agent & Mission Control | Wave 1 | 5,7,9 | 1, 11 | — |
| 2 | Warm Market (Universal) | Wave 2 | 3 | 1, 11 | 4 (structural), 5 (after 4) |
| 5 | Messaging & Outreach | Wave 2 | 6 | 1, 2, 4, 11 | — |
| 9 | Team Calendar & Upline Dashboard | Wave 2 | — | 1, 4, 11 | 10 |
| 10 | Payment & Subscription | Wave 2 | — | 1, 11 | 9 |
| 3 | Warm Market Method (Primerica) | Wave 3 | 8 | 1, 2 | 6, 7 |
| 6 | Social, Content & Launch Kit | Wave 3 | — | 1, 5, 11 | 7 |
| 7 | Gamification & Motivation | Wave 3 | — | 1, 4, 5 | 6 |
| 8 | Taprooting & Timeline (Primerica) | Wave 3 | — | 1, 3, 7, 9 | 6, 7 |

---

## Anti-Patterns to Block

| Anti-Pattern | Prevention |
|--------------|------------|
| Treating contact data as "leads" not relationships | Brand doctrine + WP 2 segmentation design |
| Cold outreach at scale | Compliance interception + messaging engine constraints |
| Harvest Hoarder analytics (top-only enrichment) | WP 7 wealth distribution fairness metrics |
| Generic gamification (solo-hustle framing) | WP 7 collective benefit scoring |
| Compliance as afterthought | WP 11 standing layer requirement |
| Primerica features leaking to Non-Primerica | WP 1 hard gating + kernel-level enforcement |
| Rep burden increase (admin work, manual babysitting) | WP 4 agent autonomy + "30 min/day" constraint |
| Code generation before architecture | Foundation-first workflow enforcement |

---

*End of Structured Dependency Map*
