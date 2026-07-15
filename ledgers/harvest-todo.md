# The Harvest — Build To-Do & Checklist

**File:** `harvest-todo.md` · **Package version:** 1.0.0 · **Authored:** 2026-07-14 by `[Fable x1]`
**Governing sources:** `harvest-master-spec.md` §19 (waves, roster, QC) and §0.7 (dependency spine); `harvest-qc-checklist.md` (the per-WP QC blocks each gate cites); `harvest-SLASH-GOALS.md` (the run rules this list executes under).

This is the checklist the `/goal` document orders into existence at build start — this authored version is the authoritative task list the build run adopts and then **keeps current** (the /goal's "CREATE AT START, KEEP CURRENT" contract). Every item below mirrors one row in `harvest-LEDGER.md`; the box here and the ledger row change state together, the instant the state changes — per unit, never wave-end.

## How to use this list

- **Status boxes:** `[ ]` pending · `[~]` in progress · `[x]` done. A unit is `done` when its builder finishes; it becomes **`verified` in the ledger** only when its QC gate passes — the box stays the ledger's mirror, the ledger stays the source of truth.
- **QC gate (every unit):** judged by `[Sonnet 5 x1]` — a separate QC agent that did not build the unit (a different model wherever practical; the builder never grades its own work — same agent) — under `/Users/erspaulding/Downloads/PROMPT-QC-INSTRUCTIONS 2.md`, against the cited `harvest-qc-checklist.md` block/checkpoints. **High-risk escalation (qc-checklist §0.2):** for the WP11 (compliance/CFE) and WP10 (payments) packages the judge is REQUIRED to be a different model than the builder — `[Opus 4.8 x1]` judges Sonnet-built units, `[Sonnet 5 x1]` judges Opus-built units. Pass = an **earned 8.5+ with zero critical failures**; below 8.5 = the auto-fix loop (fixer re-dispatched, fresh judge, fresh break-it pass), **loop-until-earned**. On any pass: merge NOW, then ripple (changelog, readme, version, tag, scripts).
- **Builder models (by complexity, master spec §0.3/§19.1):** `[Opus 4.8 x1]` = extremely-complex units + orchestration; `[Sonnet 5 xN]` = medium execution; `[Haiku 4.5 xN]` = easy/mechanical. Every spawned task is named `[<Model> x<count>] <short task>`, and that exact label goes in the ledger row and session-log entry.
- **Parallelism:** `parallel-OK` items in the same wave may fan out **only when mutually independent** (master spec §19.2); `serial` items are spine-order. All merges into `harvest-app` land through **one merge-writer** — a fast queue, not a hold.
- **Supervision — the /goal never-stop ledger model:** on agent death, session limit, or 429, read the ledger and refire a fresh agent at the first unfinished unit; if the ledger's last-progress stamp goes stale, treat the run as dead and refire; on any restart, run the RESUME protocol (ledger + log first, re-verify the last `in_progress` unit from the primary source). Never park; never ask the operator mid-run.
- **Secrets:** never written to repo, logs, or state files; `~/.harvest-secrets` is never read; env vars are checked by name only.

## Operator decision gates (master spec §20.3 — non-blocking now, needed by the wave named)

| id | Decision | Assumed default | Needed by |
|---|---|---|---|
| D-1 | Scaffold disposition | **Evolve** (schema/services kept, UI rebuilt) | Wave 0 (T-03 proceeds on the default) |
| D-2 | Auth provider | **Auth.js (NextAuth)** — operator-confirmed | Wave 0 (T-04) |
| D-3 | Native-shell technology | **Capacitor** — operator-confirmed | Wave 4 (T-37) |
| D-4 | Durable-queue provider — Inngest vs QStash-class | none (pick one) | Wave 4 (T-30) |
| D-5 | Repo/package governance commit trigger (`prd` branch governs on approval) | commit at build start | Wave 0 (T-01) |
| D-6 | Supervision-machinery exit (prior external cron/gateway supervision fully retired for Harvest) | /goal ledger model governs | Wave 0 (run start) |
| D-7 | Legal-review milestone owner & timing (risk 1) | unassigned | Launch gate (before GA — see T-60 notes) |

---

## Wave 0 — Foundations (master spec §19.2 Wave 0; §2)

- [ ] **T-01 — Create the `harvest-app` GitHub repo:** `main` + `prd` branches, the package docs committed to `prd` (D-5), `ledgers/` path established, branch protection with the one-merge-writer convention, repo created with the operator's stored token (used by name, never printed).
  WP ref: foundations (§2.2) · deps: none · serial (first unit of the run) · build: `[Haiku 4.5 x1]` · QC: `[Sonnet 5 x1]` — proof on the GitHub remote, earned 8.5+
- [ ] **T-02 — Vercel project + environments:** project linked to the repo, preview-per-PR + production promoted from `main`, all env vars wired **by name only** (§0.4).
  WP ref: foundations (§2.1–2.2) · deps: T-01 · parallel-OK (with T-03, T-05) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` — live preview URL as proof, earned 8.5+
- [ ] **T-03 — Postgres + Prisma baseline:** evolve the scaffold schema (D-1) to master spec §3 — enums (five-role), kept baseline entities extended, the ~20 new entities (incl. `SecurityEvent`), integrity rules; migrations run in CI.
  WP ref: foundations (§3) · deps: T-01 · parallel-OK (with T-02, T-05) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` — migration run + schema read, earned 8.5+
- [ ] **T-04 — Auth + five-role RBAC scaffold:** **Auth.js (NextAuth)** (D-2 confirmed) wired to the five roles (§3.1) with MFA-capable session architecture (§16.4 consumes this in Wave 1).
  WP ref: foundations (§3.1, §16.6) · deps: T-03 · serial (after T-03; D-2 confirmed = Auth.js) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` — earned 8.5+
- [ ] **T-05 — Living Field design-system token layer:** uiux §1 implemented as the app's tokens — hue ramps from the real seeds, semantic tokens (incl. the corrected `--soil-550` contrast fix), type scale + Big Text, 8pt grid, elevations, icons, motion tokens + binding rules.
  WP ref: foundations (uiux §1) · deps: T-01 · parallel-OK (with T-02, T-03) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist UI/UX block checkpoints for §1, earned 8.5+
- [ ] **T-06 — CI/CD:** lint, typecheck, unit-test harness, preview deploys, prod promotion, and the per-unit `ledgers/` commit hook (§19.4).
  WP ref: foundations (§2.2, §19.4) · deps: T-01, T-02 · parallel-OK (with T-03–T-05) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` — green pipeline run as proof, earned 8.5+
- [ ] **T-07 — Wave 0 gate:** foundations judged as a set against §19.2 Wave 0 scope + §2 (repo, Vercel, DB, auth scaffold, tokens, CI all real and connected — no stubs).
  WP ref: foundations · deps: T-01–T-06 · serial (wave gate) · build: n/a (judging unit) · QC: `[Sonnet 5 x1]` under the rulebook, earned 8.5+

## Wave 1 — WP11 first (compliance; the critical path — master spec §0.7, §19.2 Wave 1)

**Nothing content-producing ships before this wave is green.**

- [ ] **T-08 — CFE core:** the five Haiku 4.5 classifiers, risk scoring/banding, and the **fail-closed** short-circuit on the synchronous content path (§5.2–§5.4, §2.3).
  WP ref: WP11 (§5) · deps: T-07 · serial (spine) · build: `[Opus 4.8 x1]` · QC: `[Sonnet 5 x1]` (different-model rule met — builder is Opus 4.8) vs qc-checklist WP11 block, earned 8.5+
- [ ] **T-09 — CFE adjudication + human loop:** Sonnet 5 adjudication, Opus 4.8 escalation, review queues, org-gated upline review (§5.5).
  WP ref: WP11 (§5.5) · deps: T-08 · parallel-OK (with T-10) · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-10 — Immutable audit store + integration points:** append-only audit trail, the rep-visible ledger hooks, and the gate hookups every content-producing WP will call (§5.6–§5.7, §17.8).
  WP ref: WP11 (§5.6–5.7) · deps: T-08 · parallel-OK (with T-09) · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-11 — Data rights:** minimization, retention schedules, deletion with the FINRA carve-out and legal-hold behavior (§16.3).
  WP ref: WP11 (§16.3) · deps: T-03 · parallel-OK (with T-09–T-15) · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-12 — Account security controls:** MFA, rate limiting, credential-stuffing defense, session-hijack protections (§16.4, §18.10).
  WP ref: WP11 (§16.4) · deps: T-04 · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-13 — State insurance licensing state machine** (§16.5) — consumed by WP01 hard-blocks and WP03 exclusions.
  WP ref: WP11 (§16.5) · deps: T-03 · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-14 — RBAC matrix enforcement:** the authoritative §16.6 matrix as middleware every WP consumes.
  WP ref: WP11 (§16.6) · deps: T-04 · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-15 — Breach notification & incident response:** runbooks, `SecurityEvent` wiring, GDPR 72-hour clock (§16.7).
  WP ref: WP11 (§16.7) · deps: T-10 · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11) vs WP11 block, earned 8.5+
- [ ] **T-16 — WP11 gate (Wave 1 green):** the **full** qc-checklist WP11 block (18 checkpoints, highest adversarial bar) including the CFE fail-closed drill — CFE forced offline → zero sends, queued items "held for review".
  WP ref: WP11 · deps: T-08–T-15 · serial (wave gate) · build: fixes by roster as needed · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP11), earned 8.5+ with zero critical failures → WP11 `verified` in the ledger

## Wave 2 — WP01 (onboarding; master spec §19.2 Wave 2)

- [ ] **T-17 — Identity, org gate & roles:** the master gate, five roles, org selection locking the §17.1 branch, solution-number format check ("not verified" caption), onboarding tracks A/B/D shells (§6.1–§6.3).
  WP ref: WP01 (§6.1–6.3) · deps: T-16 · serial (spine) · build: `[Opus 4.8 x1]` (org-gating/role-architecture core — extremely-complex per qc-checklist WP01) · QC: `[Sonnet 5 x1]` vs qc-checklist WP01 block, earned 8.5+
- [ ] **T-18 — Seven Whys conversation engine:** Sonnet 5 runtime, one question per turn, the invisible >70 resonance gate rendered as care, anchor composition, `use_in_outreach_consent` default **off** (§6.4).
  WP ref: WP01 (§6.4) · deps: T-17 · parallel-OK (with T-19) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP01 block, earned 8.5+
- [ ] **T-19 — Sponsor matching, invites, tiers & contracts:** matching + waitlist (never a dead end), the invite state machine, access-tier assignment, downstream event contracts (§6.5–§6.7, §6.9).
  WP ref: WP01 (§6.5–6.9) · deps: T-17 · parallel-OK (with T-18) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP01 block, earned 8.5+
- [ ] **T-20 — Onboarding UI:** uiux §5.1 — O-1..O-9 (vision splash → Reveal → First-48 handoff) + the dense upline/RVP tracks; resume-exact behavior; the Reveal's safe-harbor + zero-data growth path + no-share rule.
  WP ref: WP01 (uiux §5.1) · deps: T-18, T-19 · serial (assembles both) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP01 block + uiux AC-5.1-*, earned 8.5+
- [ ] **T-21 — WP01 gate:** full qc-checklist WP01 block (15 checkpoints).
  WP ref: WP01 · deps: T-17–T-20 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP01 `verified`

## Wave 3 — WP02 → WP03 (master spec §19.2 Wave 3)

- [ ] **T-22 — The Vault:** four ingestion modalities, encrypted contact PII storage, import resumability/idempotency (§7.1, §18.5).
  WP ref: WP02 (§7.1) · deps: T-21 · serial (spine) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP02 block, earned 8.5+
- [ ] **T-23 — Segmentation, Memory Jogger & agent pipeline:** Haiku 4.5 segmentation/scoring, the Memory Jogger, the contact pipeline to agents (§7.2, §7.4, §7.5).
  WP ref: WP02 (§7.2–7.5) · deps: T-22 · parallel-OK (with T-24) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP02 block, earned 8.5+
- [ ] **T-24 — Hidden Earnings engine:** the FTC-safe universal formula + Primerica calibration behind the org gate, the 0–3-contact growth path (never NaN/$0), safe-harbor line on every render (§7.3, §8.4).
  WP ref: WP02 (§7.3) · deps: T-22 · parallel-OK (with T-23) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP02 block, earned 8.5+
- [ ] **T-25 — WP02 gate:** full qc-checklist WP02 block (13 checkpoints).
  WP ref: WP02 · deps: T-22–T-24 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP02 `verified`
- [ ] **T-26 — Three-layer method + readiness engine:** Blank Canvas, Qualities Flip (six clusters), Background Matching; the hidden 0–100 readiness score + priority tiers (§8.1–§8.2).
  WP ref: WP03 (§8.1–8.2) · deps: T-25 · serial (WP03 follows WP02) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP03 block, earned 8.5+
- [ ] **T-27 — Action queue + anti-pattern blocks:** the readiness-sorted queue (empty until all three layers complete), architecturally blocked anti-patterns, the doctrine linter in notes (§8.3, §8.5).
  WP ref: WP03 (§8.3–8.5) · deps: T-26 · parallel-OK (with T-28) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP03 block, earned 8.5+
- [ ] **T-28 — Warm-market ritual UI:** uiux §5.4 (three-layer ritual, constellation, tile flips) + the plots/contact-card surfaces (uiux §4.6).
  WP ref: WP03 (uiux §5.4) · deps: T-26 · parallel-OK (with T-27) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP03 block + uiux AC-5.4-*, earned 8.5+
- [ ] **T-29 — WP03 gate:** full qc-checklist WP03 block (13 checkpoints).
  WP ref: WP03 · deps: T-26–T-28 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP03 `verified`

## Wave 4 — WP04 → WP05 (master spec §19.2 Wave 4; requires D-4 resolved; D-3 = Capacitor confirmed)

- [ ] **T-30 — Nine-agent runtime core:** agent orchestration on the durable queue (D-4), prompt assembly + data-sensitivity rule, the Haiku/Sonnet/Opus runtime model map, CFE on the synchronous critical path (§4.1–§4.4, §2.3).
  WP ref: WP04 (§4) · deps: T-25, D-4 · serial (spine) · build: `[Opus 4.8 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP04 block, earned 8.5+
- [ ] **T-31 — Per-rep cost model + kill-switch + degradation modes** (§4.5–§4.6) — budget metering, the kill-switch, agents-resting behavior (no fabricated content, ever).
  WP ref: WP04 (§4.5–4.6) · deps: T-30 · parallel-OK (with T-32, T-33) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP04 block, earned 8.5+
- [ ] **T-32 — Mission Control / Today:** the six-zone surface, overnight briefing with receipts, the Grove organism (uiux §3), independent zone failure (§9.5; uiux §5.2).
  WP ref: WP04 (§9.5) · deps: T-30 · parallel-OK (with T-31, T-33) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP04 block + uiux AC-5.2-*/§3, earned 8.5+
- [ ] **T-33 — Approval Inbox, Activity Ledger & per-contact controls:** no batch-approve, edit-re-enters-CFE, receipts everywhere (§9.2–§9.4; uiux §5.6).
  WP ref: WP04 (§9.2–9.4) · deps: T-30 · parallel-OK (with T-31, T-32) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP04 block + uiux AC-5.6-*, earned 8.5+
- [ ] **T-34 — The Shift + the two ratios:** the bounded daily ritual with permission-to-stop, Agent's/Field Trainer's ratios with the 20:5:1 learning state (§9.7–§9.8; uiux §5.3).
  WP ref: WP04 (§9.7–9.8) · deps: T-32 · serial (after Today exists) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP04 block + uiux AC-5.3-*, earned 8.5+
- [ ] **T-35 — WP04 gate:** full qc-checklist WP04 block (14 checkpoints).
  WP ref: WP04 · deps: T-30–T-34 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP04 `verified`
- [ ] **T-36 — Deliverability provisioning:** Twilio A2P 10DLC registration flow + email-domain warm-up plan — a **launch gate** (SC5), started early because warm-up takes calendar time (§10.3).
  WP ref: WP05 (§10.3) · deps: T-35 · parallel-OK (with T-37, T-38) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP05 block, earned 8.5+
- [ ] **T-37 — The two SMS paths:** composer handoff via the **Capacitor** native shell (D-3 confirmed) with pre-cleared drafts, and the Twilio platform path — honestly rendered as two distinct paths (§10.1; uiux §4.4).
  WP ref: WP05 (§10.1) · deps: T-35 (D-3 confirmed = Capacitor) · parallel-OK (with T-36, T-38) · build: `[Opus 4.8 x1]` (two-send-path + CFE-cleared-draft core — extremely-complex per qc-checklist WP05) · QC: `[Sonnet 5 x1]` vs WP05 block, earned 8.5+
- [ ] **T-38 — Global opt-out + quiet hours + consent records:** one-tap STOP honored everywhere, contact-timezone quiet hours, TCPA consent ledger (§10.4).
  WP ref: WP05 (§10.4) · deps: T-35 · parallel-OK (with T-36, T-37) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs WP05 block, earned 8.5+
- [ ] **T-39 — Outreach sequences + messaging surfaces:** the doctrine-safe sequence, edification/three-way handoff, objection tree, email campaigns, and the conversation UI (§10.2, §10.5–§10.7; uiux §5.7).
  WP ref: WP05 (§10.2–10.7) · deps: T-37, T-38 · serial (assembles the paths) · build: `[Opus 4.8 x1]` (messaging/CFE-integration core: sequence + three-way handoff assembly — extremely-complex per qc-checklist WP05) · QC: `[Sonnet 5 x1]` vs WP05 block + uiux AC-5.7-*, earned 8.5+
- [ ] **T-40 — WP05 gate:** full qc-checklist WP05 block (13 checkpoints).
  WP ref: WP05 · deps: T-36–T-39 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP05 `verified`

## Wave 5 — WP06, WP07, WP09, WP10 in parallel; WP08 after WP07 + WP09 (master spec §19.2 Wave 5)

- [ ] **T-41 — WP06 social/content:** the three-platform engine (Sonnet 5), vocabulary enforcement, blog/email, launch kit builder, content queue + human review gate (§11; uiux §4/§6 surfaces).
  WP ref: WP06 (§11) · deps: T-40 · parallel-OK (with T-43, T-45, T-47) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP06 block, earned 8.5+
- [ ] **T-42 — WP06 gate:** full qc-checklist WP06 block (12 checkpoints).
  WP ref: WP06 · deps: T-41 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP06 `verified`
- [ ] **T-43 — WP07 accountability & motivation:** Momentum Score, 48-hour countdown + First-48, celebrations, streaks + grace day, org-conditional quotes through the CFE, notification architecture, referral loop, course/Ask-Harvest (§12).
  WP ref: WP07 (§12) · deps: T-40 · parallel-OK (with T-41, T-45, T-47) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP07 block, earned 8.5+
- [ ] **T-44 — WP07 gate:** full qc-checklist WP07 block (12 checkpoints).
  WP ref: WP07 · deps: T-43 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP07 `verified`
- [ ] **T-45 — WP09 calendar & dashboards:** Google dual sync + CalDAV read-only, appointment-agent edge cases, team calendar, anti-surveillance upline dashboard, Sponsor Cockpit + enterprise console (§14; uiux §5.9).
  WP ref: WP09 (§14) · deps: T-40 · parallel-OK (with T-41, T-43, T-47) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP09 block + uiux AC-5.9-*, earned 8.5+
- [ ] **T-46 — WP09 gate:** full qc-checklist WP09 block (12 checkpoints).
  WP ref: WP09 · deps: T-45 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP09 `verified`
- [ ] **T-47 — WP10 payments:** the three locked tiers only ($0 sponsored / $297 monthly / $25,000 yearly), WP01 provisioning contract, sponsor-lapse cascade + anniversary, billing lifecycle, Stripe security/idempotency, billing RBAC (§15; uiux §5.8).
  WP ref: WP10 (§15) · deps: T-40 · parallel-OK (with T-41, T-43, T-45) · build: `[Sonnet 5 x1]` · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP10) vs qc-checklist WP10 block + uiux AC-5.8-*, earned 8.5+
- [ ] **T-48 — WP10 gate:** full qc-checklist WP10 block (12 checkpoints).
  WP ref: WP10 · deps: T-47 · serial (WP gate) · QC: `[Opus 4.8 x1]` (different-model judge — high-risk WP10), earned 8.5+ zero critical failures → WP10 `verified`
- [ ] **T-49 — WP08 taprooting & timeline:** org tree (orchard + universal rings), Rules of Building live chips, the activity-gated phased timeline with the licensing hard-block, milestone detection, org-switch wipe (§13; uiux §5.5). **Not parallel with WP07/WP09** — starts only after both are green (§19.2).
  WP ref: WP08 (§13) · deps: T-44, T-46 · serial (dependency exception within the wave) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist WP08 block + uiux AC-5.5-*, earned 8.5+
- [ ] **T-50 — WP08 gate:** full qc-checklist WP08 block (11 checkpoints).
  WP ref: WP08 · deps: T-49 · serial (WP gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures → WP08 `verified`

## Wave 6 — Cross-cutting hardening (master spec §19.2 Wave 6; §17)

- [ ] **T-51 — Parity verification:** the binding 28-row feature × platform table (uiux §6.3) proven across PWA (iOS/Android) and web, degraded rows behaving as specified (§17.3).
  WP ref: cross-cutting (§17.3) · deps: T-16–T-50 (all WP gates) · parallel-OK (with T-52–T-56) · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs qc-checklist UI/UX block, earned 8.5+
- [ ] **T-52 — WCAG 2.2 AA audit:** contrast tokens, the five binding narration scripts, TTS behavior, keyboard operability — a QC gate, not an aspiration (§17.4; uiux §6.1).
  WP ref: cross-cutting (§17.4) · deps: all WP gates · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs UI/UX block, earned 8.5+
- [ ] **T-53 — i18n EN+ES:** full catalog, Spanish CFE classifiers, copy-lint in both languages, +35% growth rule (§17.5; uiux §6.2).
  WP ref: cross-cutting (§17.5) · deps: all WP gates · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs UI/UX block, earned 8.5+
- [ ] **T-54 — Offline-first & degraded-mode sweep:** local queues, CFE re-validation on reconnect, honest offline banners, agents-resting states (§17.6; uiux §6.4).
  WP ref: cross-cutting (§17.6) · deps: all WP gates · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]` vs UI/UX block, earned 8.5+
- [ ] **T-55 — Empty/zero-data state sweep:** every surface renders its designed empty state (never a blank), per the platform rule and the uiux gallery (§17.7; uiux §6.6).
  WP ref: cross-cutting (§17.7) · deps: all WP gates · parallel-OK · build: `[Sonnet 5 x1]` (with `[Haiku 4.5 xN]` surface enumeration) · QC: `[Sonnet 5 x1]` vs UI/UX block, earned 8.5+
- [ ] **T-56 — Cost model + kill-switch verification drill:** per-rep budget metering proven under load; the kill-switch fires and degrades gracefully within the Claude roster (§4.5).
  WP ref: cross-cutting (§4.5) · deps: all WP gates · parallel-OK · build: `[Sonnet 5 x1]` · QC: `[Sonnet 5 x1]`, earned 8.5+
- [ ] **T-57 — UI/UX package gate:** the **full** qc-checklist UI/UX block — 22 grouped checkpoints covering all 117 uiux ACs (design system, Grove, components, nine screens, cross-cutting).
  WP ref: UI/UX (uiux §0–§7) · deps: T-51–T-56 · serial (wave gate) · QC: `[Sonnet 5 x1]`, earned 8.5+ zero critical failures

## Integration → Final QC → Deploy

- [ ] **T-58 — Full-system integration pass:** event-bus contracts wired end-to-end across WPs, cross-WP flows exercised, PWA build + thin native shell (Capacitor, D-3 confirmed) packaging both green.
  WP ref: system (§2, §6.9, §17.3) · deps: T-57 · serial · build: `[Opus 4.8 x1]` · QC: `[Sonnet 5 x1]`, earned 8.5+
- [ ] **T-59 — Final QC — Full System Pressure Test:** run exactly per the qc-checklist final block, deployed by `[Sonnet 5 x{5-50}]` — the 5 E2E flows, the §18 edge battery (org-switch mid-session, payment lapse mid-execution, CFE fail-closed, dual-role, zero-data Hidden Earnings, account security, messaging/import/calendar edges, offline/degraded), SC1–SC12 verification, and the §0.4 sweep. **Loop-until-earned 8.5+ with zero critical failures.**
  WP ref: system (qc-checklist final block) · deps: T-58 · serial · build: fixes by roster per defect list · QC: `[Sonnet 5 x{5-50}]` pressure test + `[Sonnet 5 x1]` verdict, earned 8.5+
- [ ] **T-60 — Production deploy + ripple:** promote `main` to Vercel production, verify the live URL reachable, push the annotated version tag, ripple changelog/readme/version/scripts. **Launch-gate notes:** public launch additionally requires the D-7 legal-review sign-off (risk 1) and deliverability provisioning green (SC5, T-36) — tracked with the operator, not skipped.
  WP ref: system (§2.2, §19.6) · deps: T-59 · serial · build: `[Haiku 4.5 x1]` mechanical + `[Sonnet 5 x1]` verification · QC: `[Sonnet 5 x1]` — proof from the live production URL and the GitHub remote, earned 8.5+
- [ ] **T-61 — DONE verification:** every `harvest-SLASH-GOALS.md` DONE box proven from primary sources — merged-to-main on the remote, annotated tag on the remote, restart survival from the running system, ledger fully `verified` (nothing pending/in_progress/failed), ripple complete, production reachable, Final QC earned, WP01–WP11 all `verified`, the CFE-offline hold drill re-proven on production, and the repo-wide no-secret scan clean.
  WP ref: system (SLASH-GOALS DONE) · deps: T-60 · serial (final unit) · build: n/a (verification unit) · QC: `[Sonnet 5 x1]`, earned 8.5+ — the run ends only when every box is true

---

**Totals:** 61 units — 7 foundations (Wave 0), 9 compliance-first (Wave 1), 5 onboarding (Wave 2), 8 warm market + method (Wave 3), 11 agents + messaging (Wave 4), 10 layered WPs (Wave 5), 7 hardening (Wave 6), 4 integration/Final-QC/deploy. Every unit carries a separate-agent QC gate — `[Sonnet 5 x1]` by default, escalated to a different-model judge for the high-risk WP11/WP10 packages per qc-checklist §0.2 (`[Opus 4.8 x1]` for Sonnet-built units there; T-08's Opus-built CFE core keeps its different-model `[Sonnet 5 x1]` judge); T-59's pressure test is deployed by `[Sonnet 5 x{5-50}]`; WP-level `verified` status maps 1:1 to the eleven qc-checklist WP blocks plus the UI/UX block. This list supersedes every prior task list (the baseline's 47-vs-44 count disagreement is retired by this regeneration — master spec §20.4).
