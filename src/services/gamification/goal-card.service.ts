import { GoalCommitmentCard } from '../../types/gamification';

const store = new Map<string, GoalCommitmentCard>();

export const goalCardService = {
  getGoalCard(userId: string): GoalCommitmentCard | null {
    return store.get(userId) ?? null;
  },

  updateGoalCard(
    userId: string,
    data: Partial<Pick<GoalCommitmentCard, 'primaryGoal' | 'targetDate' | 'commitmentLevel' | 'motivationStatement' | 'progress'>>,
  ): GoalCommitmentCard {
    const existing = store.get(userId);
    const updated: GoalCommitmentCard = {
      userId,
      primaryGoal: data.primaryGoal ?? existing?.primaryGoal ?? '',
      targetDate: data.targetDate ?? existing?.targetDate ?? '',
      commitmentLevel: data.commitmentLevel ?? existing?.commitmentLevel ?? 0,
      motivationStatement: data.motivationStatement ?? existing?.motivationStatement ?? '',
      progress: data.progress ?? existing?.progress ?? 0,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    store.set(userId, updated);
    return updated;
  },

  getGoalProgress(userId: string): number {
    return store.get(userId)?.progress ?? 0;
  },

  /** Reset store (for tests) */
  _reset(): void {
    store.clear();
  },
};