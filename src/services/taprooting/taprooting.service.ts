// WP08: Taprooting Service
// 3-level organizational tree builder with Primerica gating

const MOCK_ORG_TREE: Record<string, any> = {
  'rep-1': {
    repId: 'rep-1',
    repName: 'Maria Santos',
    role: 'RVP',
    activeCount: 4,
    totalCount: 6,
    production: 85,
    downlines: [
      {
        repId: 'rep-2',
        repName: 'James Wilson',
        role: 'Upline',
        activeCount: 2,
        totalCount: 2,
        production: 60,
        downlines: [
          { repId: 'rep-4', repName: 'Carlos Garcia', role: 'Rep', activeCount: 1, totalCount: 1, production: 40, downlines: [], metrics: { activeCount: 1, totalCount: 1, newRecruits: 0, avgProduction: 40 } },
          { repId: 'rep-5', repName: 'Tanya Brown', role: 'Rep', activeCount: 1, totalCount: 1, production: 50, downlines: [], metrics: { activeCount: 1, totalCount: 1, newRecruits: 1, avgProduction: 50 } },
        ],
        metrics: { activeCount: 2, totalCount: 2, newRecruits: 1, avgProduction: 50 },
      },
      {
        repId: 'rep-3',
        repName: 'Aisha Patel',
        role: 'Upline',
        activeCount: 2,
        totalCount: 2,
        production: 70,
        downlines: [
          { repId: 'rep-6', repName: 'Devon Harris', role: 'Rep', activeCount: 1, totalCount: 2, production: 35, downlines: [], metrics: { activeCount: 1, totalCount: 2, newRecruits: 1, avgProduction: 35 } },
        ],
        metrics: { activeCount: 2, totalCount: 2, newRecruits: 1, avgProduction: 52.5 },
      },
    ],
    metrics: { activeCount: 4, totalCount: 6, newRecruits: 2, avgProduction: 52 },
  },
};

const PRIMERICA_USERS = ['rep-1', 'rep-2', 'rep-3', 'rep-4', 'rep-5', 'rep-6'];
const NON_PRIMERICA_USERS = ['rep-ext-1'];

const isPrimerica = (userId: string) => PRIMERICA_USERS.includes(userId);

function deepCloneTree(node: any, maxDepth: number = 3, currentDepth: number = 0): any {
  if (!node || currentDepth > maxDepth) return null;
  const clone = { ...node };
  if (clone.downlines) {
    clone.downlines = clone.downlines
      .map((d: any) => deepCloneTree(d, maxDepth, currentDepth + 1))
      .filter(Boolean);
  }
  return clone;
}

function countDescendants(node: any): number {
  if (!node?.downlines?.length) return 0;
  let count = node.downlines.length;
  for (const d of node.downlines) count += countDescendants(d);
  return count;
}

export const taprootingService = {
  getOrgTree(uplineId: string, maxDepth: number = 3) {
    if (!isPrimerica(uplineId)) {
      return {
        repInfo: { name: '', role: '' },
        downlines: [],
        metrics: { activeCount: 0, totalCount: 0, newRecruits: 0, avgProduction: 0 },
      };
    }
    const rootData = MOCK_ORG_TREE[uplineId];
    if (!rootData) {
      return {
        repInfo: { name: 'Unknown', role: 'Rep' },
        downlines: [],
        metrics: { activeCount: 0, totalCount: 0, newRecruits: 0, avgProduction: 0 },
      };
    }
    const cloned = deepCloneTree(rootData, maxDepth, 0);
    return {
      repInfo: { name: cloned.repName, role: cloned.role },
      downlines: cloned.downlines || [],
      metrics: cloned.metrics,
    };
  },

  getDownlineMetrics(uplineId: string): DownlineMetrics {
    if (!isPrimerica(uplineId)) {
      return { activeCount: 0, totalCount: 0, newRecruits: 0, avgProduction: 0 };
    }
    const rootData = MOCK_ORG_TREE[uplineId];
    if (!rootData) {
      return { activeCount: 0, totalCount: 0, newRecruits: 0, avgProduction: 0 };
    }
    return rootData.metrics;
  },
};
