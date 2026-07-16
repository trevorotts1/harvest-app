// WP01 onboarding core (T-17) — the onboarding spine per master-spec §6.1–§6.3.
//
// This barrel is the single import surface downstream WP01 work (Seven Whys, sponsor matching, the
// T-20 onboarding UI) and the org-gated WPs (WP03 overlay, WP08 orchard, WP12 quotes) consume:
//
//   §6.1  Master identity gate ....... ./identity-gate  (resolveIdentity / requireIdentity + the
//                                       hard onboarding gate evaluateOnboardingGate)
//   §6.2  Five roles + DUAL isolation  ./roles          (canInPersona, PersonaScopedStore,
//                                       resolveApprovalReviewer — the no-bleed boundary)
//   §6.3  Org gate (§17.1 branch lock) ./org-gate       (lockOrgBranch, assertPrimericaGate,
//                                       assertNoPrimericaLeak, buildOrgContext)
//   §6.3  Solution-number check ....... ./solution-number (checkSolutionNumberForOrg, mask, encrypt)
//   §6.3  Tracks A/B/D shells ......... ./tracks         (stepsForRole, evaluateTrackCompletion*)

export * from './identity-gate';
// The Auth.js server binding for the identity gate (pulls next-auth; server call-sites only).
export * from './identity-gate.server';
export * from './roles';
export * from './org-gate';
export * from './solution-number';
export * from './tracks';
