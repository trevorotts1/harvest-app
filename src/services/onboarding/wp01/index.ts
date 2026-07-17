// WP01 onboarding core (T-17, T-19) — the onboarding spine per master-spec §6.1–§6.9.
//
// This barrel is the single import surface downstream WP01 work (Seven Whys, the T-20 onboarding
// UI) and the org-gated WPs (WP03 overlay, WP08 orchard, WP12 quotes) consume:
//
//   §6.1  Master identity gate ....... ./identity-gate  (resolveIdentity / requireIdentity + the
//                                       hard onboarding gate evaluateOnboardingGate)
//   §6.2  Five roles + DUAL isolation  ./roles          (canInPersona, PersonaScopedStore,
//                                       resolveApprovalReviewer — the no-bleed boundary)
//   §6.3  Org gate (§17.1 branch lock) ./org-gate       (lockOrgBranch, assertPrimericaGate,
//                                       assertNoPrimericaLeak, buildOrgContext)
//   §6.3  Solution-number check ....... ./solution-number (checkSolutionNumberForOrg, mask, encrypt)
//   §6.3  Tracks A/B/D shells ......... ./tracks         (stepsForRole, evaluateTrackCompletion*)
//   §6.4  Seven Whys (T-18) ........... ./seven-whys     (startSevenWhys / submitSevenWhysAnswer —
//                                       the Sonnet-5 conversation engine, the invisible >70
//                                       resonance gate, anchor composition, the outreach CFE gate)
//   §6.5  Sponsor matching (T-19) ..... ./sponsor-matching (matchSponsor — waitlist never a dead end)
//   §6.6  Invite state machine (T-19)   ./invite-state-machine (transitionInvite, expireStaleInvites)
//   §6.7  Access-tier assignment (T-19) ./access-tier    (assignAccessTier, adminProvisionEnterpriseTier)
//   §6.9  Downstream contracts (T-19) . ./downstream-contracts (emitOnboardingCompleted, projectToWPxx)
//   Orchestration (T-19) .............. ./sponsor-invite.service (SponsorInviteService — wires the above to Prisma)

export * from './identity-gate';
// The Auth.js server binding for the identity gate (pulls next-auth; server call-sites only).
export * from './identity-gate.server';
export * from './roles';
export * from './org-gate';
export * from './solution-number';
export * from './tracks';
export * from './seven-whys';
export * from './sponsor-matching';
export * from './invite-state-machine';
export * from './access-tier';
export * from './downstream-contracts';
export * from './sponsor-invite.service';
