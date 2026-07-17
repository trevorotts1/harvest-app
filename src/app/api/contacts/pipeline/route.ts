import { NextResponse } from 'next/server';
import {
  ContactData,
  ContactSource,
  PipelineStage,
  PIPELINE_STAGE_ORDER,
  SAFE_HARBOR_EARNINGS_DISCLAIMER,
} from '@/types/warm-market';
// T-20 §6.10-1: downstream (WP02) route, now behind the real onboarding gate (see briefing/route.ts).
import { withOnboardingGate } from '@/lib/auth/onboarding-gate';

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
      pipelineStage: PipelineStage.APPOINTMENT_CONFIRMED,
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
      pipelineStage: PipelineStage.RESPONDED,
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
      pipelineStage: PipelineStage.INTRODUCED,
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
      pipelineStage: PipelineStage.IDENTIFIED,
      createdAt: now,
      updatedAt: now,
    },
  ];
};

// Per-request: reads the live session via withOnboardingGate → getCurrentSession, so it must not be
// statically prerendered at build (no NEXTAUTH_SECRET then). Same pattern as session/whoami/route.ts.
export const dynamic = 'force-dynamic';

export const GET = withOnboardingGate(async (_req, _ctx, _session, identity) => {
  const userId = identity.userId;
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
      appointmentReady: contacts.filter((contact) => contact.pipelineStage === PipelineStage.APPOINTMENT_CONFIRMED).length,
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
});
