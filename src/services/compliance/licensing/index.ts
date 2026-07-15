// WP11 §16.5 — state insurance licensing state machine. Public entry point.
//
// Consumers (per master-spec §16.5, §6, §8, §13):
//   - WP01 onboarding: gate any post-onboarding licensed-activity surface on
//     canPerformLicensedActivity / LicensingService.canPerformLicensedActivity.
//   - WP03 method-exclusions: exclude a contact/action when the rep is not LICENSED in the
//     relevant jurisdiction (the "Excluded: state-unlicensed" tier, §8.2).
//   - WP08 taprooting: gate Primerica milestones / insurance-recommendation content behind
//     licensing state during the Days 8–30 licensing phase (§13.3).
//   - The CFE's Insurance-Recommendation classifier consumes
//     LicensingService.getLicensedJurisdictions() as UserContext.licensed_states
//     (src/types/compliance.ts) — see src/services/compliance/classifiers/insurance.classifier.ts.

export * from '../../../types/licensing';
export * from './licensing-state-machine';
export * from './licensing-repository';
export * from './licensing-audit';
export * from './licensing-service';
