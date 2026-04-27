# Product-Behavior Matrix: The Harvest: 2 Hour CEO Business Agent

## 1. Rep Onboarding Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| R-ONB-01 | User initializes onboarding | System maps user to CRM profile | Welcome dashboard initialization | R-ONB-02 |
| R-ONB-02 | User completes profile data | Agent initiates credential sync | Persona personalization prompt | R-ONB-01 |

## 2. Upline Onboarding Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| U-ONB-01 | Upline initiates connection | Agent links upline to rep account | Permissions management panel | U-ONB-02 |
| U-ONB-02 | Upline sets team goals | System benchmarks team performance data | Real-time performance chart | U-ONB-01 |

## 3. Seven Whys Conversation Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| WHYS-01 | Rep starts Seven Whys conversation | Agent formulates first root-cause question | Dynamic questioning interface displayed | WHYS-02 |
| WHYS-02 | User answers first Why question | Agent performs sentiment analysis and asks Why #2 | Follow-up inquiry generated | WHYS-03 |
| WHYS-03 | User answers second Why question | Agent identifies pattern and asks Why #3 | Third-level inquiry generated | WHYS-04 |
| WHYS-04 | User answers third Why question | Agent reframes motivation and asks Why #4 | Fourth-level inquiry generated | WHYS-05 |
| WHYS-05 | User answers fourth Why question | Agent surfaces emotional driver and asks Why #5 | Fifth-level inquiry generated | WHYS-06 |
| WHYS-06 | User answers fifth Why question | Agent probes deeper purpose and asks Why #6 | Sixth-level inquiry generated | WHYS-07 |
| WHYS-07 | User answers sixth Why question | Agent synthesizes final root-cause insight | Seven Whys summary report generated | WHYS-01 |

## 4. Organization Selection Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| ORG-SEL-01 | Rep selects organization | Agent validates organizational credentials | Configuration sync confirmation | ORG-SEL-01 |

## 5. Warm Market Contact Upload Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| WMC-UP-01 | User uploads CSV | Agent parses, deduplicates, encrypts data | Preview table with mapped fields | WMC-UP-02 |
| WMC-UP-02 | User syncs phone contacts | Agent cleans and normalizes contacts | Normalized contact database | WMC-UP-01 |

## 6. Harvest Warm Market Method (Primerica)
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| HWM-01 | Rep activates warm market method | Agent cross-references warm list against database | Outreach priority list generated | HWM-02 |
| HWM-02 | User initiates outreach from warm list | System logs method progress step-by-step | Method completion streak modal shown | HWM-03 |
| HWM-03 | Warm market contact responds | Agent categorizes response type and updates priority | Warm market pipeline status updated | HWM-01 |

## 7. Contact Segmentation & Scoring Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| SEG-S-01 | Contact data updated | Agent calculates engagement score | Updated score bubble displayed | SEG-S-01 |

## 8. Community Introduction Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| CI-01 | Rep enters community | System prompts profile creation | Introduction prompt modal displayed | CI-02 |
| CI-02 | Profile submitted | Agent posts community introduction | Welcome message stream published | CI-01 |

## 9. Three-Way Handoff Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| THW-01 | Rep schedules three-way handoff | System matches upline and lead availabilities | Appointment invitation link generated | THW-01 |

## 10. Appointment Setting Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| APP-SET-01 | User requests appointment | System scans team availability | Available slot selector displayed | APP-SET-01 |

## 11. SMS/E-mail Outreach Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| MSG-OUT-01 | Rep initiates outreach | System checks compliance filters | Outreach draft window displayed | MSG-OUT-01 |

## 12. Social Launch Kit Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| SOC-LAUNCH-01 | Rep requests social content | Agent generates content variants | Social media posts preview displayed | SOC-LAUNCH-01 |

## 13. Objection Handling Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| OBJ-HAND-01 | Lead raises objection | Agent analyzes objection intent | Objection-specific scripts displayed | OBJ-HAND-01 |

## 14. Referral Generation Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| REF-GEN-01 | Lead closes | Agent prompts for referral | Referral request modal displayed | REF-GEN-01 |

## 15. Mission Control (Rep View) Dashboard
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| MC-REP-01 | Rep logs in | Agent pulls performance metrics | Real-time performance widgets displayed | MC-REP-01 |

## 16. Upline Mission Control View Dashboard
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| MC-UPL-01 | Upline logs in | Agent aggregates team performance | Team analytics hierarchy displayed | MC-UPL-01 |

## 17. Team Calendar Dashboard
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| TCAL-01 | Rep navigates calendar | Agent populates team appointments | Team schedule view displayed | TCAL-01 |

## 18. Compliance Filter Engine
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| COMP-ENG-01 | Outreach initiated | Agent scans for non-compliant keywords | Compliance warning modal displayed | COMP-ENG-01 |

## 19. Hidden Earnings Engine
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| EARN-ENG-01 | Performance data updated | Agent computes potential commission | Earnings projection widget displayed | EARN-ENG-01 |

## 20. Messaging Engine
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| MSG-ENG-01 | Event triggered | Agent selects messaging template | Personalized message draft generated | MSG-ENG-01 |

## 21. Celebration & Milestone Engine
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| CELEB-ENG-01 | Milestone achieved | Agent activates celebration script | Celebration animation overlay displayed | CELEB-ENG-01 |

## 22. Prospecting Agent
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| AGNT-PROS-01 | New contact added | Agent enriches prospect profile | Enriched lead database updated | AGNT-PROS-02 |
| AGNT-PROS-02 | Scoring triggered | System qualifies lead status | Lead qualification score generated | AGNT-PROS-01 |

## 23. Nurture Agent (Pre-Sale)
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| AGNT-NURT-01 | Qualification confirmed | Agent starts nurture campaign | Nurture campaign schedule generated | AGNT-NURT-01 |

## 24. Appointment Setting Agent
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| AGNT-APP-01 | Negotiation stage reached | Agent proposes available slot | Meeting availability choice displayed | AGNT-APP-01 |

## 25. Inactivity & Re-engagement Agent
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| AGNT-INAC-01 | Interaction absent | Agent triggers re-engagement sequence | Re-engagement message draft generated | AGNT-INAC-01 |

## 26. Momentum Score & Gamification
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| SCORE-GAM-01 | Action performed | Agent updates momentum score | Updated score status displayed | SCORE-GAM-01 |

## 27. Closing Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| CLI-CLO-01 | Sale negotiation initiated | Generate closing script from pipeline context | Closing guide modal with 3 script options | AGNT-PROS-01, AGNT-APP-01 |
| CLI-CLO-02 | Client verbally agrees | Initiate contract delivery workflow | Contract sent to client email | CLI-CLO-01, COMP-ENG-01 |

## 28. Contract/Policy Execution Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| CLI-CON-01 | Contract sent to client | Track e-signature/acknowledgment status | Signing status dashboard visible to rep | CLI-CLO-02, COMP-ENG-01 |
| CLI-CON-02 | Contract signed by client | Trigger policy binding and commission recording | Policy confirmation + next steps sent to client | CLI-CON-01 |

## 29. Client Onboarding Flow
| Behavior ID | Trigger | System Response | Output | Dependencies |
|---|---|---|---|---|
| CLI-ONB-01 | Contract/policy confirmed | Send welcome sequence (email + SMS) | Client receives welcome kit with next steps | CLI-CON-02 |
| CLI-ONB-02 | Client logs in for first time | Activate client dashboard with personalized content | Client portal initialized with onboarding checklist | CLI-ONB-01 |
