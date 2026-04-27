import {
  MethodStep,
  MethodState,
  BlankCanvasData,
  QualitiesFlipData,
  BackgroundMatchingData,
  PrioritizedContact,
  METHOD_STEP_ORDER,
} from '../../types/harvest-method';

// ── Gate helper ────────────────────────────────────────────
function isPrimericaUser(userId: string): boolean {
  return userId.startsWith('user-primerica');
}

function gated<T>(userId: string, value: T): { available: boolean; reason?: string; data?: T } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  return { available: true, data: value };
}

// ── In-memory store ────────────────────────────────────────
const methodStore = new Map<string, MethodState>();

function ensureState(userId: string): MethodState {
  let state = methodStore.get(userId);
  if (!state) {
    state = {
      userId,
      currentStep: MethodStep.BLANK_CANVAS,
      blankCanvas: null,
      qualitiesFlip: null,
      backgroundMatching: null,
      prioritizedQueue: null,
      available: true,
    };
    methodStore.set(userId, state);
  }
  return state;
}

// ── Mock contact data ──────────────────────────────────────
interface MockContact {
  contactId: string;
  name: string;
  relationshipStrength: number;
  matchQuality: number;
  needAlignment: number;
}

const mockContactStore: MockContact[] = [
  { contactId: 'c1', name: 'Alice Johnson', relationshipStrength: 9, matchQuality: 8, needAlignment: 7 },
  { contactId: 'c2', name: 'Bob Smith', relationshipStrength: 6, matchQuality: 7, needAlignment: 9 },
  { contactId: 'c3', name: 'Carol Williams', relationshipStrength: 8, matchQuality: 9, needAlignment: 5 },
  { contactId: 'c4', name: 'David Brown', relationshipStrength: 5, matchQuality: 6, needAlignment: 8 },
  { contactId: 'c5', name: 'Eve Davis', relationshipStrength: 7, matchQuality: 5, needAlignment: 6 },
];

// ── Composite scoring ─────────────────────────────────────
export function calculateCompositeScore(
  relationshipStrength: number,
  matchQuality: number,
  needAlignment: number,
): number {
  return +(relationshipStrength * 0.4 + matchQuality * 0.3 + needAlignment * 0.3).toFixed(2);
}

// ── Service methods ────────────────────────────────────────
export function getMethodState(userId: string): { available: boolean; reason?: string; state?: MethodState } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const state = ensureState(userId);
  return { available: true, state };
}

export function submitBlankCanvas(
  userId: string,
  data: BlankCanvasData,
): { available: boolean; reason?: string; state?: MethodState } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const state = ensureState(userId);
  state.blankCanvas = data;
  state.currentStep = MethodStep.QUALITIES_FLIP;
  return { available: true, state };
}

export function submitQualitiesFlip(
  userId: string,
  data: QualitiesFlipData,
): { available: boolean; reason?: string; state?: MethodState } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const state = ensureState(userId);
  state.qualitiesFlip = data;
  state.currentStep = MethodStep.BACKGROUND_MATCHING;
  return { available: true, state };
}

export function submitBackgroundMatching(
  userId: string,
  data: BackgroundMatchingData,
): { available: boolean; reason?: string; state?: MethodState } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const state = ensureState(userId);
  state.backgroundMatching = data;
  state.currentStep = MethodStep.PRIORITIZED_QUEUE;
  return { available: true, state };
}

export function generatePrioritizedQueue(
  userId: string,
): { available: boolean; reason?: string; queue?: PrioritizedContact[] } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const state = ensureState(userId);

  const ranked: PrioritizedContact[] = mockContactStore
    .map((c) => ({
      contactId: c.contactId,
      name: c.name,
      relationshipStrength: c.relationshipStrength,
      matchQuality: c.matchQuality,
      needAlignment: c.needAlignment,
      compositeScore: calculateCompositeScore(c.relationshipStrength, c.matchQuality, c.needAlignment),
      reason: `Score ${calculateCompositeScore(c.relationshipStrength, c.matchQuality, c.needAlignment)} from R:${c.relationshipStrength} M:${c.matchQuality} N:${c.needAlignment}`,
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore);

  state.prioritizedQueue = ranked;
  state.currentStep = MethodStep.COMPLETE;
  return { available: true, queue: ranked };
}

// Export stores for testing
export { methodStore, mockContactStore };