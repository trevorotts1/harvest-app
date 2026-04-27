import { ContactService, ContactInput } from '../../src/services/warm-market/contact.service';
import { PipelineService } from '../../src/services/warm-market/pipeline.service';
import { MemoryJoggerService } from '../../src/services/warm-market/memory-jogger.service';
import { ContactSource, PipelineStage } from '../../src/types/warm-market';

// Mock PrismaClient
const mockContactFindMany = jest.fn();
const mockContactFindFirst = jest.fn();
const mockContactFindUnique = jest.fn();
const mockContactCreate = jest.fn();
const mockContactUpdate = jest.fn();
const mockInteractionFindFirst = jest.fn();

const mockPrisma = {
  contact: {
    findMany: mockContactFindMany,
    findFirst: mockContactFindFirst,
    findUnique: mockContactFindUnique,
    create: mockContactCreate,
    update: mockContactUpdate,
  },
  contactInteraction: {
    findFirst: mockInteractionFindFirst,
  },
} as any;

describe('Warm Market Engine', () => {
  const userId = 'user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ContactService', () => {
    let contactService: ContactService;

    beforeEach(() => {
      contactService = new ContactService(mockPrisma);
    });

    test('should import and deduplicate contacts', async () => {
      // First call returns null (no existing contact), second returns existing
      mockContactFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'existing-contact',
          name: 'John Doe',
          email: 'john@example.com',
        });
      mockContactCreate.mockResolvedValue({
        id: 'contact-1',
        name: 'John Doe',
        email: 'john@example.com',
        user_id: userId,
        source: ContactSource.MANUAL,
        pipeline_stage: 'DISCOVERY',
        relationship_strength: 0,
      });

      const data: ContactInput[] = [
        { userId, name: 'John Doe', email: 'john@example.com', source: ContactSource.MANUAL },
        { userId, name: 'John Doe', email: 'john@example.com', source: ContactSource.MANUAL },
      ];

      const imported = await contactService.importContacts(userId, ContactSource.MANUAL, data);
      expect(imported).toHaveLength(1);
      expect(mockContactFindFirst).toHaveBeenCalledTimes(2);
      expect(mockContactCreate).toHaveBeenCalledTimes(1);
    });

    test('should normalize contact data', () => {
      const contact = { name: 'Alice', phone: '(555) 123-4567', email: 'Alice@Example.COM' };
      const normalized = contactService.normalize(contact);
      expect(normalized.phone).toBe('5551234567');
      expect(normalized.email).toBe('alice@example.com');
    });

    test('should calculate scoring based on interactions', () => {
      const contactHigh = { interactions: Array(6).fill({}) };
      expect(contactService.scoreContact(contactHigh)).toBe(80);

      const contactLow = { interactions: Array(2).fill({}) };
      expect(contactService.scoreContact(contactLow)).toBe(20);
    });

    test('should calculate hidden earnings with safe harbor framing', () => {
      mockContactFindUnique.mockResolvedValue({
        id: 'contact-1',
        name: 'Test Contact',
        interactions: Array(6).fill({}),
      });

      const earnings = contactService.calculateHiddenEarnings('contact-1');
      expect(earnings).resolves.toBe(80000); // strength 80 * 1000
    });

    test('should get pipeline contacts by stage', async () => {
      const mockContacts = [
        { id: 'c1', name: 'Alice', pipeline_stage: PipelineStage.DISCOVERY },
        { id: 'c2', name: 'Bob', pipeline_stage: PipelineStage.DISCOVERY },
      ];
      mockContactFindMany.mockResolvedValue(mockContacts);

      const result = await contactService.getPipelineContacts(userId, PipelineStage.DISCOVERY);
      expect(result).toHaveLength(2);
      expect(mockContactFindMany).toHaveBeenCalledWith({
        where: { user_id: userId, pipeline_stage: PipelineStage.DISCOVERY },
      });
    });

    test('should handle contacts without phone or email', async () => {
      mockContactFindFirst.mockResolvedValue(null);
      mockContactCreate.mockResolvedValue({
        id: 'contact-2',
        name: 'No Phone Guy',
        phone: null,
        email: null,
        user_id: userId,
        source: ContactSource.MANUAL,
        pipeline_stage: 'DISCOVERY',
        relationship_strength: 0,
      });

      const data: ContactInput[] = [
        { userId, name: 'No Phone Guy', source: ContactSource.MANUAL },
      ];

      const imported = await contactService.importContacts(userId, ContactSource.MANUAL, data);
      expect(imported).toHaveLength(1);
      expect(imported[0].name).toBe('No Phone Guy');
    });
  });

  describe('PipelineService', () => {
    let pipelineService: PipelineService;

    beforeEach(() => {
      pipelineService = new PipelineService(mockPrisma);
    });

    test('should progress pipeline stage', async () => {
      mockContactUpdate.mockResolvedValue({
        id: 'contact-1',
        name: 'Alice',
        pipeline_stage: PipelineStage.QUALIFY,
      });

      const updated = await pipelineService.moveContact('contact-1', PipelineStage.QUALIFY);
      expect(updated.pipeline_stage).toBe(PipelineStage.QUALIFY);
    });

    test('should return pipeline summary', async () => {
      mockContactFindMany.mockResolvedValue([
        { id: 'c1', name: 'Alice', pipeline_stage: 'DISCOVERY' },
        { id: 'c2', name: 'Bob', pipeline_stage: 'DISCOVERY' },
        { id: 'c3', name: 'Charlie', pipeline_stage: 'NURTURE' },
      ]);

      const summary = await pipelineService.getPipelineSummary(userId);
      expect(summary.DISCOVERY).toHaveLength(2);
      expect(summary.NURTURE).toHaveLength(1);
      expect(summary.QUALIFY).toHaveLength(0);
    });
  });

  describe('MemoryJoggerService', () => {
    let memoryJogger: MemoryJoggerService;

    beforeEach(() => {
      memoryJogger = new MemoryJoggerService(mockPrisma);
    });

    test('should generate prompts for contact with data', async () => {
      mockContactFindUnique.mockResolvedValue({
        id: 'contact-1',
        name: 'Sarah',
        industry: 'insurance',
        interactions: [{ type: 'CALL', notes: 'Discussed term life options' }],
      });

      const prompts = await memoryJogger.generatePrompts('contact-1');
      expect(prompts).toHaveLength(2);
      expect(prompts[0]).toContain('Sarah');
      expect(prompts[0]).toContain('insurance');
    });

    test('should return null for contacts with no interactions', async () => {
      mockInteractionFindFirst.mockResolvedValue(null);
      const result = await memoryJogger.getLastInteraction('contact-1');
      expect(result).toBeNull();
    });

    test('should return empty prompts for non-existent contact', async () => {
      mockContactFindUnique.mockResolvedValue(null);
      const prompts = await memoryJogger.generatePrompts('non-existent');
      expect(prompts).toEqual([]);
    });
  });
});
