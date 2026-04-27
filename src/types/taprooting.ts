// WP08: Taprooting, Timeline & Objection Handler - Types

export interface TreeViewNode {
  repId: string;
  repName: string;
  role: string;
  activeCount: number;
  totalCount: number;
  production: number;
  downlines: TreeViewNode[];
  metrics: DownlineMetrics;
}

export interface DownlineMetrics {
  activeCount: number;
  totalCount: number;
  newRecruits: number;
  avgProduction: number;
}

export interface OrganizationMilestone {
  name: string;
  achievedAt: string;
  progress: number;
}

export interface ActivityTimelineEvent {
  type: string;
  timestamp: string;
  summary: string;
  impact: number;
}

export enum ObjectionCategory {
  COST = 'COST',
  TIME = 'TIME',
  SKEPTICISM = 'SKEPTICISM',
  COMPETITION = 'COMPETITION',
  COMMITMENT = 'COMMITMENT',
}

export interface ObjectionResponse {
  id: string;
  category: ObjectionCategory;
  objection: string;
  response: string;
  doctrineAligned: boolean;
}
