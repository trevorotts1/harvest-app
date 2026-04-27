import { PrioritizedContact, ActionQueueItem } from '../../types/harvest-method';

// ── Gate helper ────────────────────────────────────────────
function isPrimericaUser(userId: string): boolean {
  return userId.startsWith('user-primerica');
}

// ── In-memory store ────────────────────────────────────────
const actionQueueStore = new Map<string, ActionQueueItem[]>();

function ensureQueue(userId: string): ActionQueueItem[] {
  let queue = actionQueueStore.get(userId);
  if (!queue) {
    queue = [];
    actionQueueStore.set(userId, queue);
  }
  return queue;
}

// ── Service methods ────────────────────────────────────────
export function getActionQueue(
  userId: string,
): { available: boolean; reason?: string; queue?: ActionQueueItem[] } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const queue = ensureQueue(userId);
  return { available: true, queue };
}

export function markActionComplete(
  userId: string,
  actionId: string,
): { available: boolean; reason?: string; success?: boolean } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const queue = ensureQueue(userId);
  const item = queue.find((a) => a.id === actionId);
  if (item) {
    item.status = 'COMPLETE';
    return { available: true, success: true };
  }
  return { available: true, success: false };
}

export function queueFeedsAgents(
  userId: string,
  prioritizedContacts: PrioritizedContact[],
): { available: boolean; reason?: string; queue?: ActionQueueItem[] } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const queue = ensureQueue(userId);

  const items: ActionQueueItem[] = prioritizedContacts.map((contact, index) => ({
    id: `agent-${contact.contactId}-${Date.now()}`,
    contactId: contact.contactId,
    contactName: contact.name,
    actionType: 'AGENT_OUTREACH' as const,
    priority: index + 1,
    status: 'PENDING' as const,
    content: `Agent outreach: Reach out to ${contact.name} (score: ${contact.compositeScore})`,
    createdAt: new Date(),
  }));

  queue.push(...items);
  return { available: true, queue: items };
}

export function queueFeedsMessaging(
  userId: string,
  prioritizedContacts: PrioritizedContact[],
): { available: boolean; reason?: string; queue?: ActionQueueItem[] } {
  if (!isPrimericaUser(userId)) {
    return { available: false, reason: 'not_available' };
  }
  const queue = ensureQueue(userId);

  const items: ActionQueueItem[] = prioritizedContacts.map((contact, index) => ({
    id: `msg-${contact.contactId}-${Date.now()}`,
    contactId: contact.contactId,
    contactName: contact.name,
    actionType: 'MESSAGE' as const,
    priority: index + 1,
    status: 'PENDING' as const,
    content: `Message draft for ${contact.name}: Personalized outreach based on ${contact.reason}`,
    createdAt: new Date(),
  }));

  queue.push(...items);
  return { available: true, queue: items };
}

// Export store for testing
export { actionQueueStore };