import { MessageChannel, MessageTemplate } from '../../types/messaging';
import { ComplianceFilterEngine } from '../compliance/engine';

export class TemplateService {
  private templates: MessageTemplate[] = [
    { id: 't1', name: 'Welcome', channel: MessageChannel.SMS, body: 'Welcome {{name}}!', category: ['onboarding'] },
  ];
  private cfe: ComplianceFilterEngine;

  constructor(cfe: ComplianceFilterEngine) {
    this.cfe = cfe;
  }

  getTemplates(channel: MessageChannel, category: string): MessageTemplate[] {
    return this.templates.filter(t => t.channel === channel && t.category.includes(category));
  }

  async renderTemplate(templateId: string, variables: Record<string, string>): Promise<string> {
    const template = this.templates.find(t => t.id === templateId);
    if (!template) throw new Error('Template not found');
    
    let rendered = template.body;
    for (const [key, value] of Object.entries(variables)) {
      rendered = rendered.replace(`{{${key}}}`, value);
    }
    
    const result = await this.cfe.review({
      content: rendered,
      channel: template.channel as any,
      userContext: { user_id: 'system', role: 'ADMIN' },
    });
    
    if (result.blocked) throw new Error('Rendered template blocked by CFE');
    
    return rendered;
  }
}
