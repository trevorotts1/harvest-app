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

### 1.5 Compliance Interception Architecture

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

### 1.6 User System and Role Architecture

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

### 1.7 Universal vs. Primerica-Specific System Law

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

### 1.8 The 11 Work Packages as the Product Backbone

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

### 1.9 Dependency Truths That Govern the Build

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

**Onboarding/Profile → Privacy/Compliance → Warm Market Universal → AI Agent Layer/Mission Control → Messaging/Outreach**

Secondary and tertiary systems branch from that spine only after it is stable.

### 1.10 Business Logic Assumptions That Must Be Preserved

The PRD and later implementation must preserve these project truths already established:

- Primerica has **no dependable accessible API** for this product's current build assumptions.
- Solution numbers are treated as **user-declared and format-checked**, not externally verified truth.
- MIT ratios are bounded context for earnings-estimate and IPA-value logic, not global architecture law.
- Brand philosophy is core logic, not optional copy.
- Compliance filtering is a standing layer, not a post-hoc moderation idea.
- The product is being specified now; the app itself is **not** being built in this phase.
- The PRD must be detailed enough that an AI build workforce could execute from it without human re-interpretation.

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
Not one of the 11 product packages, but required before they expand:
- Project Overview
- Success Criteria and Verification Standards
- Build Workflow / Dependency Map

This wave defines the law for all later work.

#### Wave 1 — Anchor Packages
These establish non-negotiable system foundations and should be completed first.

1. **Work Package 1 — Onboarding & Profile Engine**
2. **Work Package 11 — Data Privacy, Security & Compliance Architecture**
3. **Work Package 4 — AI Agent Layer & Mission Control**

Reasoning:
- Package 1 creates identity, organization gating, hierarchy, access tier seeds, and profile truth.
- Package 11 constrains data handling, encryption, access, and compliance interception.
- Package 4 defines the execution layer that many later features plug into.

Execution note:
- Package 11 may begin as soon as foundation logic is stable and in coordination with Package 1.
- Package 4 should not finalize agent behavior until Package 1 and Package 11 constraints are known.

#### Wave 2 — Core Pipeline Packages
These convert onboarding truth into business activation.

4. **Work Package 2 — Warm Market & Contact Engine (Universal)**
5. **Work Package 5 — Messaging Engine & Outreach System**
6. **Work Package 9 — Team Calendar & Upline Dashboard**
7. **Work Package 10 — Payment & Subscription Infrastructure**

Reasoning:
- Package 2 is required before the relationship engine can feed agent execution at scale.
- Package 5 depends on Package 4 agent definitions and Package 11 compliance constraints.
- Package 9 depends on onboarding hierarchy plus Package 4 appointment-setting logic.
- Package 10 depends on onboarding access tiers and org-linkage rules.

Execution note:
- Package 2 should stabilize before Primerica-specific warm-market overlays.
- Packages 9 and 10 may proceed in constrained parallel once Package 1 and relevant upstream logic are stable.

#### Wave 3 — Primerica Overlay and Growth Systems
These layer specialized and amplification behaviors on top of the core engine.

8. **Work Package 3 — Harvest Warm Market Method (Primerica-Specific)**
9. **Work Package 6 — Social, Content & Launch Kit**
10. **Work Package 7 — Accountability, Gamification & Motivation**
11. **Work Package 8 — Taprooting, Timeline & Primerica-Specific Features**

Reasoning:
- Package 3 requires Package 1 gating plus Package 2 universal contact architecture.
- Package 6 should inherit messaging/compliance rules before defining launch mechanics.
- Package 7 should inherit Mission Control, anchor statement, and activity truth before finalizing motivation logic.
- Package 8 must not run ahead of Package 3 and depends on Primerica branch coherence.

### 3.4 Package-by-Package Dependency Map

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

Blocks:
- 2, 3, 4, 5, 6, 7, 8, 9, 10

#### Work Package 11 — Data Privacy, Security & Compliance Architecture
Must define:
- contact data classification
- encryption posture
- user rights
- role-based access control
- compliance review interception model
- retention/deletion logic
- outbound content governance

Blocks:
- 4, 5, 6, 9, 10 and all packages that store or expose user/contact data

#### Work Package 2 — Warm Market & Contact Engine (Universal)
Depends on:
- 1
- 11 for lawful data handling constraints

Must define:
- native/mobile and desktop contact ingestion
- segmentation
- hidden earnings estimate mechanics
- memory jogger/contact activation structure
- universal contact-to-prospect pipeline

Blocks:
- 3
- practical completion of 4 and 5 execution behaviors at scale

#### Work Package 4 — AI Agent Layer & Mission Control
Depends on:
- 1
- 11
- practically also 2 for fully grounded contact-fed execution flows

Must define:
- agent inventory
- role of each agent
- daily briefing/reporting
- inactivity/re-engagement behavior
- appointment-setting logic
- Mission Control structure
- rep vs. upline visibility surfaces

Blocks:
- 5, 7, 9 and partially 6

#### Work Package 5 — Messaging Engine & Outreach System
Depends on:
- 1
- 4
- 11
- 2 for contact and segment context

Must define:
- outbound channel logic
- handoff system
- script generation
- cadence logic
- approval/review logic
- compliance interception path
- income-language constraints

Blocks:
- 6 and informs 7

#### Work Package 9 — Team Calendar & Upline Dashboard
Depends on:
- 1
- 4
- 11

Must define:
- upline/team calendar hierarchy
- attendance visibility
- pace indicators
- org-level mission-control surfaces
- scheduling oversight mechanics

#### Work Package 10 — Payment & Subscription Infrastructure
Depends on:
- 1
- 11

Must define:
- free vs. paid access logic
- Stripe subscription flows
- failure/grace/revocation behavior
- restoration flows
- org-linked free access assumptions

#### Work Package 3 — Harvest Warm Market Method (Primerica-Specific)
Depends on:
- 1
- 2

Must define:
- proprietary Primerica warm-market exercise layers
- how outputs feed agent and messaging queues
- how Primerica-only flows stay gated

Blocks:
- 8

#### Work Package 6 — Social, Content & Launch Kit
Depends on:
- 1
- 5
- 11

Must define:
- launch content generation
- rep-identity asset use
- sharing mechanics
- compliance-safe social content behavior
- Mission Control reporting hooks for social activity

#### Work Package 7 — Accountability, Gamification & Motivation
Depends on:
- 1
- 4
- 5
- brand doctrine inputs

Must define:
- 48-hour countdown
- momentum score
- celebration engine
- quote engine weighting
- referral script motivation context
- notification architecture
- anchor/goal reinforcement loops

#### Work Package 8 — Taprooting, Timeline & Primerica-Specific Features
Depends on:
- 1
- 3
- 7
- 9 for coherent leadership/team context where needed

Must define:
- Primerica-specific org visualization
- rules-of-building surfaces
- milestone timeline logic
- objection-handling structures
- activity-based unlock sequencing

### 3.5 Critical Path

The minimum critical path for coherent system definition is:

**Foundation → 1 → 11 → 2 → 4 → 5**

This is the backbone that makes the rest of the system meaningful.

Why this is the spine:
- 1 defines who the user is, what org they belong to, and what system branch they get.
- 11 defines what is legally and structurally allowed.
- 2 defines what relationship data exists to activate.
- 4 defines how AI acts on that data and reports back.
- 5 defines how those actions are expressed through outreach.

If this spine is weak, all later packages become speculative or contradictory.

### 3.6 Parallelization Rules

Allowed parallelism:
- 1 and 11 can be developed in close coordination once foundation is stable.
- After 1/11/4 are coherent, 9 and 10 may proceed in parallel if dependency conditions are met.
- After 5 boundaries are stable, 6 and 7 may proceed in parallel.
- Primerica overlay work may proceed in parallel with universal amplification work only after Package 2 is stable and gating truth from Package 1 is locked.

Disallowed parallelism:
- 3 before 2
- 8 before 3
- 5 before 4 and 11
- 9 before 4
- 10 before 1
- any Primerica-only package before organization gate logic is explicit
- any outreach package that assumes compliance will be "added later"

### 3.7 Dependency Failure and Blocker Rules

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

### 3.8 Doctrine Injection Points Across the Workflow

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

### 3.9 Completion Gate for Each Wave

A wave is complete only when:
- all packages in the wave meet their own completion standards
- downstream packages no longer depend on unresolved ambiguity from that wave
- cross-package terminology is aligned
- doctrine-impacting behaviors are preserved
- QC has checked for dependency violations

Wave completion is not "draft text exists." It is "downstream work can proceed safely."

### 3.10 Final Workflow Outcome Required Before Master Assembly

Before the master PRD is assembled for final grading, the workflow defined here must yield:
- complete coverage of all 11 work packages
- explicit dependency satisfaction
- universal vs. Primerica branch integrity
- Mission Control-centered system coherence
- compliance and privacy as embedded architecture
- AI-agent executability with minimal interpretive burden

If those conditions are not met, the PRD remains in loop status and must not be treated as release-ready.

---

**END OF FOUNDATION PHASE — SECTIONS 1–3**

**Status: Ready for master assembly**

---

## 3.10 Package Index Table

| Package # | Package Name | Wave | Hard Prerequisites | Blocked Descendants | Critical Path? |
|-----------|-------------|------|--------------------|--------------------|----------------|
| WP01 | Onboarding & Profile Engine | Wave 1 | WP11 | WP02-WP10 | Y |
| WP02 | Warm Market & Contact Engine | Wave 1 | WP01, WP11 | WP03, WP04, WP08 | Y |
| WP03 | Harvest Warm Market Method (Primerica) | Wave 2 | WP01, WP02, WP11 | WP08 | N |
| WP04 | AI Agent Layer & Mission Control | Wave 2 | WP01, WP02, WP11 | WP05, WP06, WP07 | Y |
| WP05 | Messaging Engine & Outreach | Wave 2 | WP04, WP11 | WP06 | N |
| WP06 | Social, Content & Launch Kit | Wave 2 | WP01, WP05, WP11 | — | N |
| WP07 | Accountability, Gamification & Motivation | Wave 2 | WP01, WP04, WP11 | WP08 | N |
| WP08 | Taprooting, Timeline & Primerica Features | Wave 3 | WP01-WP03, WP07, WP11 | — | N |
| WP09 | Team Calendar & Upline Dashboard | Wave 2 | WP01, WP11 | — | N |
| WP10 | Payment & Subscription | Wave 2 | WP01, WP11 | — | N |
| WP11 | Data Privacy & Compliance | Wave 0 (Foundation) | None | All packages | Y (First) |

## 3.11 Wave Summary Table

| Wave | Packages | Unblocking Condition |
|------|----------|---------------------|
| Wave 0 | WP11 | WP11 complete and operational |
| Wave 1 | WP01, WP02 | WP11 complete + WP01 gates downstream |
| Wave 2 | WP03-WP07, WP09, WP10 | WP01/WP02 complete + WP11 operational + WP04 gates WP05-WP07 |
| Wave 3 | WP08 | All prior waves complete + Primerica org selected |


