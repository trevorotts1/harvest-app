import { NextRequest, NextResponse } from 'next/server';
import {
  ContactData,
  ContactSource,
  PipelineStage,
  PIPELINE_STAGE_ORDER,
  SAFE_HARBOR_EARNINGS_DISCLAIMER,
} from '@/types/warm-market';

const demoContacts = (userId: string): ContactData[] => {
  const now = new Date();
  return [
    {
      id: 'demo-contact-1',
      userId,
      name: 'Maya Johnson',
      phone: '5550101',
      email: 'maya@example.com',
      relationshipStrength: 86,
      source: ContactSource.MANUAL,
      industry: 'education',
      notes: 'Former colleague. Strong trust and recent conversation.',
      linkedUserId: null,
      pipelineStage: PipelineStage.APPOINTMENT,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-contact-2',
      userId,
      name: 'Derrick Miles',
      phone: '5550102',
      email: 'derrick@example.com',
      relationshipStrength: 72,
      source: ContactSource.SOCIAL,
      industry: 'finance',
      notes: 'Asked about creating more flexible income options.',
      linkedUserId: null,
      pipelineStage: PipelineStage.NURTURE,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-contact-3',
      userId,
      name: 'Tasha Green',
      phone: null,
      email: 'tasha@example.com',
      relationshipStrength: 64,
      source: ContactSource.CSV,
      industry: 'healthcare',
      notes: 'Needs a service-first follow-up, not a pitch.',
      linkedUserId: null,
      pipelineStage: PipelineStage.QUALIFY,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-contact-4',
      userId,
      name: 'Andre Carter',
      phone: '5550104',
      email: null,
      relationshipStrength: 41,
      source: ContactSource.MOBILE,
      industry: 'real_estate',
      notes: 'Reconnect after community event.',
      linkedUserId: null,
      pipelineStage: PipelineStage.DISCOVERY,
      createdAt: now,
      updatedAt: now,
    },
  ];
};

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id') || 'demo-user';
  const contacts = demoContacts(userId);
  const summary = PIPELINE_STAGE_ORDER.map((stage) => ({
    stage,
    count: contacts.filter((contact) => contact.pipelineStage === stage).length,
    contacts: contacts.filter((contact) => contact.pipelineStage === stage),
  }));

  return NextResponse.json({
    userId,
    summary,
    totals: {
      contacts: contacts.length,
      appointmentReady: contacts.filter((contact) => contact.pipelineStage === PipelineStage.APPOINTMENT).length,
      averageRelationshipStrength: Math.round(
        contacts.reduce((total, contact) => total + contact.relationshipStrength, 0) / contacts.length,
      ),
    },
    safeHarbor: SAFE_HARBOR_EARNINGS_DISCLAIMER,
    _meta: {
      demo: true,
      sideEffects: 'none',
      hint: 'Pipeline data is demo fallback until database-backed contact state is connected.',
    },
  });
}
