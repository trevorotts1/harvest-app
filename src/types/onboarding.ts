export enum OnboardingStep {
  REGISTER = 'REGISTER',
  ACCOUNT_TYPE = 'ACCOUNT_TYPE',
  SEVEN_WHYS = 'SEVEN_WHYS',
  GOAL_CARD = 'GOAL_CARD',
  INTENSITY = 'INTENSITY',
  COMPLETE = 'COMPLETE',
}

export interface OnboardingData {
  currentStep: OnboardingStep;
  orgType?: string;
  solutionNumber?: string;
  sevenWhys?: string[];
  goalCard?: GoalCardData;
  intensityData?: IntensityData;
}

export interface GoalCardData {
  primaryGoal: string;
  targetDate: string;
  commitmentLevel: number;
  motivationStatement: string;
}

export interface IntensityData {
  commitmentScore: number;
  weeklyHours: number;
  riskTolerance: 'LOW' | 'MEDIUM' | 'HIGH';
  supportNeeds: string[];
}

export interface OnboardingSession {
  id: string;
  userId: string;
  currentStep: OnboardingStep;
  sevenWhys: string[] | null;
  goalCard: GoalCardData | null;
  intensityData: IntensityData | null;
  completed: boolean;
  createdAt: Date;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  orgType: string;
  solutionNumber?: string;
  organizationId?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export const STEP_ORDER: OnboardingStep[] = [
  OnboardingStep.REGISTER,
  OnboardingStep.ACCOUNT_TYPE,
  OnboardingStep.SEVEN_WHYS,
  OnboardingStep.GOAL_CARD,
  OnboardingStep.INTENSITY,
  OnboardingStep.COMPLETE,
];

export const MIN_COMMITMENT_SCORE = 5;