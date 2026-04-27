// WP03 Harvest Method Types — Full Implementation

export enum MethodStep {
  BLANK_CANVAS = 'BLANK_CANVAS',
  QUALITIES_FLIP = 'QUALITIES_FLIP',
  BACKGROUND_MATCHING = 'BACKGROUND_MATCHING',
  PRIORITIZED_QUEUE = 'PRIORITIZED_QUEUE',
  COMPLETE = 'COMPLETE',
}

export interface BlankCanvasData {
  categories: string[];
  notes?: string;
}

export interface QualitiesFlipData {
  strengths: string[];
  values: string[];
  skills: string[];
}

export interface BackgroundMatchingData {
  matchScores: Record<string, number>;
}

export interface PrioritizedContact {
  contactId: string;
  name: string;
  relationshipStrength: number;
  matchQuality: number;
  needAlignment: number;
  compositeScore: number;
  reason: string;
}

export interface MethodState {
  userId: string;
  currentStep: MethodStep;
  blankCanvas: BlankCanvasData | null;
  qualitiesFlip: QualitiesFlipData | null;
  backgroundMatching: BackgroundMatchingData | null;
  prioritizedQueue: PrioritizedContact[] | null;
  available: boolean;
  reason?: string;
}

export const METHOD_STEP_ORDER: MethodStep[] = [
  MethodStep.BLANK_CANVAS,
  MethodStep.QUALITIES_FLIP,
  MethodStep.BACKGROUND_MATCHING,
  MethodStep.PRIORITIZED_QUEUE,
  MethodStep.COMPLETE,
];

export interface ActionQueueItem {
  id: string;
  contactId: string;
  contactName: string;
  actionType: 'AGENT_OUTREACH' | 'MESSAGE';
  priority: number;
  status: 'PENDING' | 'COMPLETE';
  content: string;
  createdAt: Date;
}