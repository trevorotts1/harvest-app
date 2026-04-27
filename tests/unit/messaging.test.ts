import { MessagingEngine } from '../../src/services/messaging/engine.service';
import { ComplianceFilterEngine } from '../../src/services/compliance/engine';
import { MessageChannel, MessageStatus } from '../../src/types/messaging';

describe('MessagingEngine', () => {
  let engine: MessagingEngine;
  let mockCfe: jest.Mocked<ComplianceFilterEngine>;

  beforeEach(() => {
    mockCfe = {
      review: jest.fn(),
    } as any;
    engine = new MessagingEngine(mockCfe);
  });

  it('blocks content with forbidden terms', async () => {
    mockCfe.review.mockResolvedValue({ blocked: true, outcome: 'BLOCK' } as any);
    const msg = await engine.createMessage('u1', 'c1', 'forbidden content', MessageChannel.SMS);
    expect(msg.status).toBe(MessageStatus.CFE_BLOCKED);
  });

  it('passes safe content and queues for sending', async () => {
    mockCfe.review.mockResolvedValue({ blocked: false, outcome: 'PASS' } as any);
    const msg = await engine.createMessage('u1', 'c1', 'safe content', MessageChannel.SMS);
    expect(msg.status).toBe(MessageStatus.QUEUED);
  });

  it('flags borderline content for upline approval', async () => {
    mockCfe.review.mockResolvedValue({ blocked: false, outcome: 'FLAG' } as any);
    const msg = await engine.createMessage('u1', 'c1', 'borderline content', MessageChannel.SMS);
    expect(msg.requiresUplineApproval).toBe(true);
    expect(msg.status).toBe(MessageStatus.DRAFT);
  });

  it('respects max messages/week', async () => {
    const { CadenceService } = require('../../src/services/messaging/cadence.service');
    const service = new CadenceService();
    expect(service.checkCadenceCompliance('u1', 'c1')).toBe(true);
  });

  it('renders template correctly', async () => {
    const { TemplateService } = require('../../src/services/messaging/template.service');
    const service = new TemplateService(mockCfe);
    mockCfe.review.mockResolvedValue({ blocked: false } as any);
    const rendered = await service.renderTemplate('t1', { name: 'Trevor' });
    expect(rendered).toBe('Welcome Trevor!');
  });

  it('completes handoff flow', async () => {
    const { HandoffService } = require('../../src/services/messaging/handoff.service');
    const service = new HandoffService();
    const id = service.initiateThreeWay('r1', 'u1', 'c1');
    service.completeHandoff(id);
    expect(service.getHandoffStatus(id)?.status).toBe('COMPLETED');
  });
});
