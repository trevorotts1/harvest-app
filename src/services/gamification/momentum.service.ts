import { MomentumScore } from '../../types/gamification';

const store = new Map<string, MomentumScore>();

function createDefault(userId: string): MomentumScore {
  return {
    userId,
    score: 0,
    streakDays: 0,
    activitiesToday: 0,
    daysSinceLastActivity: 0,
    lastActivityAt: null,
    updatedAt: new Date(),
  };
}

function calculateScore(m: MomentumScore): number {
  return m.streakDays * 2 + m.activitiesToday * 5 - m.daysSinceLastActivity * 10;
}

export const momentumService = {
  getMomentumScore(userId: string): MomentumScore {
    return store.get(userId) ?? createDefault(userId);
  },

  updateMomentum(
    userId: string,
    patch: Partial<Pick<MomentumScore, 'streakDays' | 'activitiesToday' | 'daysSinceLastActivity' | 'lastActivityAt'>>,
  ): MomentumScore {
    const current = store.get(userId) ?? createDefault(userId);
    const updated: MomentumScore = {
      ...current,
      ...patch,
      updatedAt: new Date(),
    };
    updated.score = calculateScore(updated);
    store.set(userId, updated);
    return updated;
  },

  /** Record a single activity: bumps activitiesToday and refreshes lastActivityAt */
  recordActivity(userId: string): MomentumScore {
    const current = store.get(userId) ?? createDefault(userId);
    const updated: MomentumScore = {
      ...current,
      activitiesToday: current.activitiesToday + 1,
      lastActivityAt: new Date(),
      daysSinceLastActivity: 0,
      updatedAt: new Date(),
    };
    updated.score = calculateScore(updated);
    store.set(userId, updated);
    return updated;
  },

  /** Simulate inactivity (for testing) */
  simulateInactivity(userId: string, days: number): MomentumScore {
    const current = store.get(userId) ?? createDefault(userId);
    const updated: MomentumScore = {
      ...current,
      daysSinceLastActivity: days,
      updatedAt: new Date(),
    };
    updated.score = calculateScore(updated);
    store.set(userId, updated);
    return updated;
  },

  /** Reset store (for tests) */
  _reset(): void {
    store.clear();
  },
};