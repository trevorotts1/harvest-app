// WP08: Objection Handler Service

import { ObjectionCategory, ObjectionResponse } from '../../types/taprooting';

const MOCK_OBJECTIONS: ObjectionResponse[] = [
  { id: 'cost-1', category: ObjectionCategory.COST, objection: 'I can\'t afford it right now', response: 'This program is designed to be self-funding through the commissions you earn. Many start with just a few hours a week to test the waters.', doctrineAligned: true },
  { id: 'cost-2', category: ObjectionCategory.COST, objection: 'How much does it cost to get started?', response: 'The initial licensing and training costs are minimal compared to traditional business startups. You can begin building your business for under $200.', doctrineAligned: true },
  { id: 'time-1', category: ObjectionCategory.TIME, objection: 'I don\'t have enough time', response: 'The 2 Hour CEO model is designed specifically for busy professionals. Just 2 hours a day, 5 days a week is all it takes to start seeing results.', doctrineAligned: true },
  { id: 'skeptic-1', category: ObjectionCategory.SKEPTICISM, objection: 'This sounds too good to be true', response: 'I understand the skepticism. That\'s why I encourage you to see the results for yourself — start with the free resources and see if the system resonates with you.', doctrineAligned: true },
  { id: 'skeptic-2', category: ObjectionCategory.SKEPTICISM, objection: 'I\'ve tried things like this before', response: 'Fair point. What makes this different is the AI-powered system that handles the heavy lifting — scheduling, follow-ups, and compliance — so you focus only on relationships.', doctrineAligned: true },
  { id: 'comp-1', category: ObjectionCategory.COMPETITION, objection: 'I\'m already with another company', response: 'I respect your current commitment. The Harvest system is complementary to existing businesses — it\'s an operations and AI tool, not a replacement.', doctrineAligned: true },
  { id: 'commit-1', category: ObjectionCategory.COMMITMENT, objection: 'I\'m not sure I can commit long-term', response: 'That\'s perfectly fine. Start with the free tier and our 2-hour weekly commitment. No pressure, just results at your own pace.', doctrineAligned: true },
];

export const objectionService = {
  getObjections(category: ObjectionCategory): ObjectionResponse[] {
    return MOCK_OBJECTIONS.filter(o => o.category === category);
  },

  getResponse(objectionId: string): ObjectionResponse | null {
    return MOCK_OBJECTIONS.find(o => o.id === objectionId) || null;
  },
};
