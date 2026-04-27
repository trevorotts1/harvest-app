# Harvest: 2 Hour CEO Business Agent — Product Behavior Matrix

## Matrix Structure
**Rows:** User-facing systems and behaviors  
**Columns:** Product attributes — Flow, Dashboard, Engine, Agent, Calculator, Timeline, Notification, Score, Gated (Primerica-only)

---

## 1. User-Facing Flows

| # | Flow Name | Description | Primerica-Gated | Owner Role | Depended By |
|---|-----------|-------------|-----------------|------------|-------------|
| 1.1 | **Rep Onboarding Track** | Name, photo, rank, intensity setting, monthly income goal, weekly time commitment | No | Rep | All downstream flows |
| 1.2 | **Upline Onboarding Track** | Profile, Google Calendar connection, availability settings, closing preferences, Mission Control orientation | No | Upline/Field Trainer | 3-way handoff, Team Calendar |
| 1.3 | **Seven Whys Conversation** | Guided one-question-at-a-time conversation; anchor statement capture and visual attachment | No | Rep | Goal Commitment, Motivation |
| 1.4 | **Organization Selection** | Primerica vs. other; gates all downstream Primerica-specific systems | No (selector itself) | Rep | All gated systems |
| 1.5 | **Goal Commitment Card** | Digital goal-setting: income target, promotion timeline, activities per week; anchor statement integration | No | Rep | Momentum Score, Gamification |
| 1.6 | **Warm Market Contact Upload** | Native contact access (iOS CNContactStore, Android READ_CONTACTS) + CSV/desktop fallback + Google Contacts | No | Rep | Segmentation, Hidden Earnings |
| 1.7 | **Contact Segmentation** | Auto-categorization of uploaded contacts by relationship type, segment scoring | No | Rep | Hidden Earnings, Agent targeting |
| 1.8 | **Hidden Earnings Estimate** | Math projection based on contact count + MIT ratios (20→5→1); framed as potential, not guarantee | No | Rep | IPA Value Agent, Motivation |
| 1.9 | **Memory Jogger** | Category prompts to help rep recall additional warm-market contacts | No | Rep | Contact enrichment |
| 1.10 | **Harvest Warm Market Method (3-layer)** | Blank canvas free-flow → Qualities Flip → Highlighting & Contact Matching → Background Matching | **Yes** | Rep | Primerica outreach queue |
| 1.11 | **Warm Market Sub-Agent Activation** | Seamless handoff from warm-market exercise into outreach queue | **Yes** | Rep | Messaging queue |
| 1.12 | **Three-Way Handoff** | Rep notification → Upline bridge → Conversation logging; ready-state handoff | No | Rep + Upline | Closing |
| 1.13 | **2-Hour CEO Daily Check-In** | 30-minute daily briefing experience; Mission Control walkthrough | No | Rep | Daily engagement |
| 1.14 | **SMS Broadcast Center** | Send scripted SMS to selected segments via Twilio; rep's number as sender | No | Rep | Outreach |
| 1.15 | **Email Campaign Builder** | Drag/drop or templated email campaigns with compliance pre-check | No | Rep | Outreach |
| 1.16 | **Social Media Launch Kit** | Auto-generated launch graphic, friends/family share kit, viral tag mechanic (Facebook, Instagram, LinkedIn) | No | Rep | Social activation |
| 1.17 | **Referral Script Generator** | Relationship-type tailored scripts, DIME-aligned for insurance context | No | Rep | Warm-market expansion |
| 1.18 | **Objection Handling Decision Tree** | Interactive branching flow for common prospect objections | **Yes** | Rep | Closing support |
| 1.19 | **Subscription Management** | Stripe-powered: subscribe, upgrade, downgrade, cancel, failed payment handling | No | Rep + Admin | Access control |
| 1.20 | **Data Rights Management** | GDPR/CCPA: access, export, delete request flows | No | All users | Compliance |
| 1.21 | **Primerica Solution Number Entry** | Upline linking via solution number as unique org identifier; format-check + attestation | **Yes** | Rep | Free access provisioning |
| 1.22 | **Taprooting Visualization Flow** | Live org tree navigation, Rules of Building status, multiplication math | **Yes** | Rep | Team-building |
| 1.23 | **30-Day Phased Timeline Navigation** | Activity-based unlock sequence; IBA/POL tracking, pre-licensing milestones | **Yes** | Rep | Onboarding progression |
| 1.24 | **RVP Command Center Access** (Phase 2) | Advanced upline management: coaching triggers, team-wide analytics, intervention tools | No (Phase 2) | RVP | Team management |

---

## 2. Dashboards

| # | Dashboard Name | Description | Primerica-Gated | Primary Viewer | Data Sources |
|---|----------------|-------------|-----------------|----------------|--------------|
| 2.1 | **Mission Control — Rep View** | Live command layer showing: agent activity, who responded, what's next, momentum, today's actions | No | Rep | All agents |
| 2.2 | **Mission Control — Upline View** | Cross-rep pipeline visibility: pace status, ratios, momentum, who needs intervention | No | Upline | Reporting Agent |
| 2.3 | **IPA Value Agent Dashboard** | Per-activity dollar value: $25 call, $125 appointment, etc.; MIT-ratio-derived | No | Rep | Activity logs |
| 2.4 | **Field Trainer Ratio Dashboard** | Team-wide closing ratios, appointment-to-client conversion, rep-by-rep performance | No | Upline | Agent reports |
| 2.5 | **Team Calendar Dashboard** | RVP-controlled master calendar with attendance tracking, availability overlay | No | Upline + RVP | Calendar sync |
| 2.6 | **Taprooting Visualization Dashboard** | Live org tree with Rules of Building status indicators, multiplication math display | **Yes** | Rep + Upline | Org hierarchy |
| 2.7 | **Momentum Score Dashboard** | Activity-weighted score, streaks, trend visualization | No | Rep + Upline | Activity tracking |
| 2.8 | **Subscription Management Dashboard** | Status, billing history, next charge, grace period countdown | No | Rep + Admin | Stripe |
| 2.9 | **Compliance Review Dashboard** | Flagged content queue, approval/rejection status, audit trail | No | Admin + Upline | Messaging Engine |
| 2.10 | **RVP Command Center** (Phase 2) | Team-wide analytics, performance benchmarking, individual rep drill-down, override controls | No (Phase 2) | RVP | All systems |

---

## 3. Engines

| # | Engine Name | Description | Primerica-Gated | Triggers | Outputs |
|---|-------------|-------------|-----------------|----------|---------|
| 3.1 | **Organization Conditional Logic Engine** | Gates UI, backend, agent flows, data requirements based on org selection (Primerica vs. other) | No (foundation) | Onboarding org selection | Branch routing |
| 3.2 | **Warm Market Engine** | Contact ingestion → segmentation → scoring → pipeline activation | No | Contact upload | Segmented pipeline |
| 3.3 | **Hidden Earnings Engine** | Calculates potential income from contact list using MIT ratios; compliance-framed | No | Contact count update | Earnings estimate |
| 3.4 | **Messaging Engine** | Script generation, template assembly, personalization, channel routing | No | Agent trigger or manual | Outbound content |
| 3.5 | **Compliance Filter Engine** | Standing review layer: FINRA, FTC, state insurance; intercepts ALL agent-generated content | No | All outbound content | Pass / Flag / Block |
| 3.6 | **Celebration & Milestone Engine** | Achievement detection, visual moment generation, push notification dispatch | No | Activity milestones | Celebration events |
| 3.7 | **Motivational Quote Engine** | Organization-conditional quote weighting; heavy Primerica leadership language when gated | Partial (weighting) | Scheduled + triggered | Quote delivery |
| 3.8 | **Notification Architecture Engine** | Morning briefing, mid-day motivation, evening recap, action alerts, inactivity nudges | No | Schedule + events | Push/Email/SMS |
| 3.9 | **Social Media Launch Engine** | Auto-graphics generation, rep photo integration, share kit assembly, viral tag mechanics | No | Rep trigger | Shareable assets |
| 3.10 | **Payment & Access Engine** | Stripe integration, subscription state, free/paid gate, failed payment handling | No | Subscription events | Access state |
| 3.11 | **Data Privacy Engine** | GDPR/CCPA compliance, encryption, retention, deletion, user rights | No | Data events | Compliance state |
| 3.12 | **Taprooting Engine** | Org tree rendering, Rules of Building status computation, multiplication math | **Yes** | Org hierarchy data | Visual tree |
| 3.13 | **Timeline Unlock Engine** | Activity-based gating: milestones unlock only when preceding activities complete | **Yes** | Activity completion | Unlocked content |

---

## 4. Agents

| # | Agent Name | Role | Primerica-Gated | Works 24/7 | Human Touchpoint |
|---|------------|------|-----------------|------------|------------------|
| 4.1 | **Prospecting Agent** | Initiates first contact with warm-market prospects via SMS/email/social | No | Yes | Rep notified when prospect responds |
| 4.2 | **Nurture Agent — Pre-Sale** | Maintains contact cadence with not-yet-ready prospects; follow-up without rep lifting finger | No | Yes | Rep sees activity in Mission Control |
| 4.3 | **Nurture Agent — Post-Sale** | Onboards new clients, schedules follow-ups, gathers referrals | No | Yes | Rep sees completion status |
| 4.4 | **Appointment Setting Agent** | Dual Google Calendar sync; reads rep + upline calendars; identifies overlap; books open slots; time-blocking | No | Yes | Rep + Upline receive booking |
| 4.5 | **Reporting Agent** | Generates daily briefing: what agents did, who responded, what's next | No | Yes | Morning Mission Control |
| 4.6 | **Quota Agent** | Tracks weekly activity targets vs. actual; alerts on pace shortfall | No | Yes | Mid-day alerts |
| 4.7 | **IPA Value Agent** | Assigns dollar value to each income-producing activity based on rep's closing ratio; learns over time | No | Yes | Dashboard view |
| 4.8 | **Inactivity & Re-engagement Agent** | Detects rep going quiet; notifies upline; activates re-engagement sequence | No | Yes | Upline notified → Rep nudged |
| 4.9 | **Warm Market Sub-Agent** (Primerica) | Activates after Harvest Warm Market Method completion; auto-queues contacts for outreach | **Yes** | Yes | Seamless handoff |
| 4.10 | **Compliance Review Agent** | Automated first-pass compliance check on all outbound content; flags for human review | No | Yes | Admin review queue |

---

## 5. Calculators

| # | Calculator Name | Formula/Method | Primerica-Gated | Used By |
|---|-----------------|----------------|-----------------|---------|
| 5.1 | **Hidden Earnings Estimate** | Contact count × (MIT ratio: 20 contacts → 5 appointments → 1 client) × estimated value per client | No | Warm Market Engine |
| 5.2 | **IPA Value Calculator** | Activity frequency × rep's actual closing ratio × average client value; self-optimizing over time | No | IPA Value Agent |
| 5.3 | **Momentum Score** | Weighted sum of: outreach sent, responses received, appointments booked, streak days, goal progress | No | Gamification Engine |
| 5.4 | **Taprooting Multiplication Calculator** | Downline count × average team production × compounding weeks; Rules of Building math | **Yes** | Taprooting Engine |
| 5.5 | **Time-Block Availability Calculator** | Rep calendar free slots ∩ Upline calendar free slots - buffer = bookable windows | No | Appointment Agent |
| 5.6 | **Goal Commitment Math** | Income target ÷ average sale value × MIT ratio = required contacts/appointments per week | No | Goal Commitment Card |

---

## 6. Timelines

| # | Timeline Name | Description | Primerica-Gated | Trigger | Duration |
|---|---------------|-------------|-----------------|---------|----------|
| 6.1 | **48-Hour Countdown** | Starts at onboarding completion; creates urgency window for first action | No | Onboarding complete | 48 hours |
| 6.2 | **30-Day Phased Timeline** | Primerica-specific activity-based unlocks: IBA/POL tracking, PFSU enrollment, pre-licensing | **Yes** | Onboarding complete | 30 days |
| 6.3 | **Weekly Streak Tracker** | 7-day rolling window; resets on missed day; visible in Mission Control | No | Daily check-in | Rolling |
| 6.4 | **Follow-Up Cadence Timeline** | Nurture agent schedule: day 1, day 3, day 7, day 14, day 30 | No | First contact | Variable |
| 6.5 | **Grace Period Timeline** | Failed payment → 7-day grace → access revocation → restoration flow | No | Failed payment | 7 days + |
| 6.6 | **Inactivity Escalation Timeline** | Day 1: silent → Day 3: nudge → Day 7: upline alert → Day 14: re-engagement sequence | No | No login | 14 days |

---

## 7. Notification Systems

| # | Notification | Channel | Timing | Primerica-Gated | Trigger |
|--------------|---------|--------|-----------------|---------|---------|
| 7.1 | **Morning Briefing** | Push + In-app | Daily, configurable | No | Schedule |
| 7.2 | **Mid-Day Motivation** | Push | 12:00 PM local | No | Schedule |
| 7.3 | **Evening Recap** | Push + Email | 6:00 PM local | No | Schedule |
| 7.4 | **Action Alert** | Push + SMS | Real-time | No | Prospect response / booking |
| 7.5 | **Inactivity Nudge** | Push → SMS → Email | Escalating | No | No login for N days |
| 7.6 | **Milestone Celebration** | Push + Visual overlay | Real-time | No | Achievement unlocked |
| 7.7 | **Upline Intervention Alert** | Push + Email | Real-time | No | Rep slipping / inactivity |
| 7.8 | **Appointment Confirmation** | SMS + Email + Calendar invite | Real-time | No | Booking complete |
| 7.9 | **Compliance Flag** | In-app + Email to admin | Real-time | No | Content flagged |
| 7.10 | **Payment Failure** | Email + In-app | Real-time | No | Stripe webhook |
| 7.11 | **Primerica-Specific Milestone** (e.g., IBA achieved) | Push + Visual | Real-time | **Yes** | Milestone completion |
| 7.12 | **Taprooting Update** | In-app | Weekly | **Yes** | Downline changes |

---

## 8. Score Systems

| # | Score Name | Calculation Method | Visibility | Primerica-Gated | Impact |
|---|------------|-------------------|------------|-----------------|--------|
| 8.1 | **Momentum Score** | Activity-weighted: outreach (20%), responses (25%), appointments (30%), streak (15%), goals (10%) | Rep + Upline | No | Gamification, intervention triggers |
| 8.2 | **Warm Market Activation Score** | % of uploaded contacts that have received first touch | Rep | No | Onboarding progress |
| 8.3 | **Closing Ratio Score** | Actual clients ÷ actual appointments; compared to MIT baseline | Rep + Upline | No | IPA value accuracy |
| 8.4 | **Team Pace Status** | Aggregate momentum across team; color-coded: Green (on pace), Yellow (slipping), Red (intervention) | Upline + RVP | No | Coaching priority |
| 8.5 | **Rules of Building Status** | Primerica-specific: multiplication score, promotion readiness indicators | Rep + Upline | **Yes** | Taprooting visualization |
| 8.6 | **Compliance Score** | % of outbound content passing automated filter without flag | Admin | No | System health |

---

## 9. Gated Primerica-Specific Behaviors (Complete Inventory)

These systems are **completely hidden** unless Primerica is selected at onboarding. Hidden means: no navigation, no backend access, no agent flows, no data requirements, no language weighting.

| # | Gated Behavior | System Area | Description | Unlock Dependency |
|---|---------------|-------------|-------------|-------------------|
| 9.1 | **Harvest Warm Market Method** | Warm Market | 3-layer proprietary exercise: blank canvas, qualities flip, highlighting/matching, background matching | Organization = Primerica |
| 9.2 | **Warm Market Sub-Agent** | AI Agents | Auto-activates after Harvest Method; queues contacts for outreach | 9.1 complete |
| 9.3 | **Taprooting Visualization** | Dashboard | Live org tree, Rules of Building status, multiplication math | Organization = Primerica |
| 9.4 | **30-Day Phased Timeline** | Timeline | Activity-based unlocks: IBA/POL, PFSU, pre-licensing, bonus awareness | Organization = Primerica |
| 9.5 | **Primerica Milestone Notifications** | Notifications | IBA achieved, POL issued, licensing passed, promotion earned | 9.4 milestones |
| 9.6 | **Motivational Quote Weighting** | Engine | Heavy lean into Primerica leadership language, field sayings, cultural colloquialisms | Organization = Primerica |
| 9.7 | **Solution Number Workflows** | Onboarding | Upline linking via solution number; format-check + attestation | Organization = Primerica |
| 9.8 | **Free Access Org Linkage** | Payment | Free access for org members tied to solution number validation | 9.7 complete |
| 9.9 | **Objection Handling Tree** | Flows | Primerica-specific objection branches and responses | Organization = Primerica |
| 9.10 | **Taprooting Multiplication Math** | Calculators | Rules of Building compounding calculations | Organization = Primerica |
| 9.11 | **Primerica Quote Engine** | Engine | Leadership quotes, field sayings, cultural weighting | Organization = Primerica |
| 9.12 | **RVP Solution Number Integration** | Payment/Access | Solution number gates free access provisioning | Organization = Primerica |

---

## 10. Cross-Reference: Behavior × Implementation Package

| Behavior | WP 01 Onboarding | WP 02 Warm Market | WP 03 Primerica Warm | WP 04 AI Agents | WP 05 Messaging | WP 06 Social | WP 07 Gamification | WP 08 Taprooting | WP 09 Calendar | WP 10 Payment | WP 11 Compliance |
|----------|------------------|-------------------|----------------------|-----------------|-----------------|--------------|--------------------|------------------|----------------|-------------|----------------|
| Seven Whys | ✅ | | | | | | | | | | |
| Hidden Earnings | | ✅ | | | | | | | | | |
| Harvest Method | | | ✅ | | | | | | | |
| Prospecting Agent | | | | ✅ | | | | | | | |
| Nurture Agents | | | | ✅ | ✅ | | | | | | |
| Appointment Agent | | | | ✅ | | | | | ✅ | |
| Mission Control | | | | ✅ | | | ✅ | | | | |
| 3-Way Handoff | | | | ✅ | ✅ | | | | ✅ | |
| SMS Broadcast | | | | | ✅ | | | | | | |
| Email Campaigns | | | | | ✅ | | | | | | |
| Social Launch Kit | | | | | | ✅ | | | | |
| Momentum Score | | | | | | | | ✅ | | | | |
| 48-Hour Countdown | ✅ | | | | | | ✅ | | | | |
| Taprooting | | | | | | | | ✅ | | | |
| 30-Day Timeline | | | | | | | | ✅ | | | |
| Team Calendar | | | | | | | | | | ✅ | | |
| Payment/Sub | | | | | | | | | | | ✅ |
| Compliance Filter | | | | | | | | | | | | ✅ |
| Data Privacy | | | | | | | | | | | | ✅ |

---

## 11. Dependency Quick-Map

```
Foundation (this matrix)
    ↓
WP 01 Onboarding + WP 11 Compliance (parallel, coordinated)
    ↓
WP 02 Warm Market Universal
    ↓
WP 04 AI Agent Layer + Mission Control
    ↓
WP 05 Messaging + Outreach
    ↓
    ├── WP 06 Social + Launch (parallel)
    ├── WP 07 Gamification + Motivation (parallel)
    └── WP 09 Team Calendar + WP 10 Payment (parallel)
    
WP 02 ↓
WP 03 Primerica Warm Market (gated)
    ↓
WP 08 Taprooting + Timeline (gated)
```

**Critical Path:** 01 → 11 → 02 → 04 → 05 (backbone for all other work)

---

## 12. Master-Orchestrator PRD Usability Notes

This matrix is designed to be consumed by a master-orchestrator PRD as:

1. **Feature inventory checklist** — verify every behavior is assigned to a work package
2. **Gating verification** — confirm Primerica-only behaviors are isolated and conditional
3. **Dependency validator** — confirm downstream packages only consume from upstream completed packages
4. **Role-access auditor** — verify Rep/Upline/RVP/External user views are correctly scoped
5. **Compliance scope checker** — ensure every outbound system touches the compliance filter
6. **Notification coverage map** — verify no critical user moment is missing a notification trigger
7. **Score system coherence check** — confirm all score inputs have defined data sources
8. **Engine-agent binding** — confirm every engine has executing agents and every agent has engine support

---

*End of Product Behavior Matrix*
