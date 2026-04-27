import { 
  getMethodState, 
  submitBlankCanvas, 
  submitQualitiesFlip, 
  submitBackgroundMatching, 
  generatePrioritizedQueue 
} from '../../src/services/harvest-method/method.service';
import { 
  getActionQueue, 
  markActionComplete, 
  queueFeedsAgents 
} from '../../src/services/harvest-method/action-queue.service';
import { MethodStep } from '../../src/types/harvest-method';

describe('HarvestMethod Integration', () => {
  const userId = 'user-primerica-123';
  const nonUserId = 'user-external-123';

  test('Gate: should block non-Primerica users', () => {
    expect(getMethodState(nonUserId).available).toBe(false);
  });

  test('Step 1: Blank Canvas submission', () => {
    const data = { categories: ['Family', 'Friends'] };
    const result = submitBlankCanvas(userId, data);
    expect(result.available).toBe(true);
    expect(result.state?.currentStep).toBe(MethodStep.QUALITIES_FLIP);
  });

  test('Step 2: Qualities Flip submission', () => {
    const data = { strengths: ['Trust'], values: ['Love'], skills: ['Listening'] };
    const result = submitQualitiesFlip(userId, data);
    expect(result.available).toBe(true);
    expect(result.state?.currentStep).toBe(MethodStep.BACKGROUND_MATCHING);
  });

  test('Step 3: Background Matching submission', () => {
    const data = { matchScores: { 'c1': 9 } };
    const result = submitBackgroundMatching(userId, data);
    expect(result.available).toBe(true);
    expect(result.state?.currentStep).toBe(MethodStep.PRIORITIZED_QUEUE);
  });

  test('Step 4: Prioritized Queue generation', () => {
    const result = generatePrioritizedQueue(userId);
    expect(result.available).toBe(true);
    expect(result.queue?.length).toBeGreaterThan(0);
  });

  test('Step 5: Action Queue feeding', () => {
    const queue = generatePrioritizedQueue(userId).queue!;
    const feedResult = queueFeedsAgents(userId, queue);
    expect(feedResult.available).toBe(true);
    const actionResult = getActionQueue(userId);
    expect(actionResult.queue?.length).toBe(queue.length);
  });

  test('Step 6: Mark action complete', () => {
    const actionId = getActionQueue(userId).queue![0].id;
    const result = markActionComplete(userId, actionId);
    expect(result.success).toBe(true);
    const updated = getActionQueue(userId).queue!.find(a => a.id === actionId);
    expect(updated?.status).toBe('COMPLETE');
  });
});
