// T-09 (master-spec §5.5 CFE adjudication + human loop) — the adjudication module public surface.
//
// The Inngest `{ cron }` wrapper (`complianceAdjudicationInngestFunctions`) lives in
// ./adjudication-inngest-functions.ts (imports the `inngest` package), intentionally NOT re-exported
// here — same convention as agent-runtime's index (the package-free handler `runSlaEscalationSweep`
// and its constants ARE exported; the Inngest wrapper is not).

export {
  CfeAdjudicationService,
} from './cfe-adjudication.service';
export type {
  CfeAdjudicationPrismaClient,
  UplineActor,
  AdjudicationAction,
  AdjudicateResult,
  QueueItem,
  AdjudicationDraftRow,
  ReviewQueueRow,
  AdjudicationContactRow,
} from './cfe-adjudication.service';

export { AdjudicationAdvisor, parseRecommendation, ADJUDICATION_ADVISOR_AGENT_KEY } from './adjudication-advisor';
export type {
  AdjudicationRecommendation,
  AdjudicationAdvisorDeps,
  AdjudicationRequest,
} from './adjudication-advisor';

export {
  detectEscalationTrigger,
  coerceClassifierResults,
  ADJUDICATION_SIGNAL_FLOOR,
} from './escalation-triggers';
export type { EscalationTrigger, EscalationReason } from './escalation-triggers';

export {
  runSlaEscalationSweep,
  PrismaSlaEscalationStore,
  defaultAlertComplianceContact,
  SLA_ESCALATION_FUNCTION_ID,
  SLA_ESCALATION_CRON,
  SLA_WINDOW_MS,
} from './sla-escalation';
export type {
  SlaEscalationStore,
  SlaEscalationDeps,
  SlaEscalationResult,
  OverdueQueueRow,
  DraftAuditContext,
  ComplianceEscalationAlert,
  AlertComplianceContactFn,
} from './sla-escalation';
