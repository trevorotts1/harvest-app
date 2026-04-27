import { MessagingEngine } from '../../src/services/messaging/engine.service';
import { TemplateService } from '../../src/services/messaging/template.service';
import { HandoffService } from '../../src/services/messaging/handoff.service';
import { ComplianceFilterEngine } from '../../src/compliance/engine';
import { MessageChannel } from '../../src/types/messaging';

// In-memory store for API demonstration
const cfe = new ComplianceFilterEngine();
const engine = new MessagingEngine(cfe);
const templateService = new TemplateService(cfe);
const handoffService = new HandoffService();

// Mock express-like request handling
export async function handleApiRoute(req: any) {
  const { method, path, body } = req;
  
  if (path === '/api/messages' && method === 'POST') {
    return await engine.createMessage(body.userId, body.contactId, body.content, body.channel);
  }
  if (path === '/api/templates' && method === 'GET') {
    return templateService.getTemplates(body.channel, body.category);
  }
  if (path === '/api/templates/render' && method === 'POST') {
    return await templateService.renderTemplate(body.templateId, body.variables);
  }
  if (path === '/api/handoff/initiate' && method === 'POST') {
    return handoffService.initiateThreeWay(body.repId, body.uplineId, body.contactId);
  }
  return { error: 'Not found' };
}
