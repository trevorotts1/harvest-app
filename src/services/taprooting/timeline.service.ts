// WP08: Timeline Service

const MOCK_TIMELINE: any[] = [
  { type: 'CONTACT_ADDED', timestamp: '2026-04-26T10:00:00Z', summary: 'Added 3 new contacts to pipeline', impact: 5 },
  { type: 'APPOINTMENT_SET', timestamp: '2026-04-25T14:30:00Z', summary: 'Set appointment with Sarah Johnson', impact: 8 },
  { type: 'APPOINTMENT_COMPLETED', timestamp: '2026-04-24T11:00:00Z', summary: 'Client meeting with Mike Chen - policy review', impact: 7 },
  { type: 'MILESTONE', timestamp: '2026-04-23T09:00:00Z', summary: 'First 10 contacts reached milestone unlocked', impact: 3 },
  { type: 'AGENT_ACTION', timestamp: '2026-04-22T16:45:00Z', summary: 'Prospecting agent processed 5 action items', impact: 4 },
];

export const timelineService = {
  getActivityTimeline(userId: string, dateRange?: { from: string; to: string }) {
    let events = [...MOCK_TIMELINE];
    if (dateRange) {
      events = events.filter(e => {
        const ts = new Date(e.timestamp);
        return ts >= new Date(dateRange.from) && ts <= new Date(dateRange.to);
      });
    }
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return events;
  },
};
