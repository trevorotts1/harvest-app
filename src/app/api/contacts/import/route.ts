import { NextRequest, NextResponse } from 'next/server';
import {
  ContactSource,
  PipelineStage,
  SAFE_HARBOR_EARNINGS_DISCLAIMER,
  ImportContactInput,
} from '@/types/warm-market';

// ── In-memory demo contact store (per user) ─────────────────────
// Keyed by `${userId}:${contactId}` so multi-user demos don't bleed.
interface DemoContact {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  industry: string | null;
  notes: string | null;
  source: ContactSource;
  pipelineStage: PipelineStage;
  relationshipStrength: number;
  createdAt: string;
  updatedAt: string;
}

const demoContactStore = new Map<string, DemoContact>();

// Pre-seed a few demo contacts so pipeline isn't empty
function ensureSeedData(userId: string): void {
  const prefix = `${userId}:`;
  const existing = [...demoContactStore.keys()].filter((k) => k.startsWith(prefix));
  if (existing.length > 0) return;

  const seeds: Omit<DemoContact, 'id' | 'createdAt' | 'updatedAt'>[] = [
    { userId, name: 'Sarah Johnson', phone: '555-0101', email: 'sarah@example.com', industry: 'insurance', notes: 'Met at community event', source: ContactSource.MANUAL, pipelineStage: PipelineStage.QUALIFY, relationshipStrength: 45 },
    { userId, name: 'Marcus Chen', phone: '555-0102', email: 'marcus@example.com', industry: 'finance', notes: 'Referred by Sarah', source: ContactSource.MANUAL, pipelineStage: PipelineStage.DISCOVERY, relationshipStrength: 10 },
    { userId, name: 'Aisha Patel', phone: '555-0103', email: null, industry: 'healthcare', notes: null, source: ContactSource.SOCIAL, pipelineStage: PipelineStage.NURTURE, relationshipStrength: 60 },
    { userId, name: 'David Kim', phone: null, email: 'david@example.com', industry: 'real_estate', notes: 'LinkedIn connection', source: ContactSource.SYNC, pipelineStage: PipelineStage.APPOINTMENT, relationshipStrength: 75 },
    { userId, name: 'Lisa Thompson', phone: '555-0105', email: 'lisa@example.com', industry: 'education', notes: 'Former colleague', source: ContactSource.MANUAL, pipelineStage: PipelineStage.CLIENT, relationshipStrength: 90 },
  ];

  const now = new Date().toISOString();
  for (const s of seeds) {
    const id = `demo-contact-${seeds.indexOf(s) + 1}`;
    demoContactStore.set(`${userId}:${id}`, { ...s, id, createdAt: now, updatedAt: now });
  }
}

function normalize(input: ImportContactInput): { phone: string | null; email: string | null } {
  return {
    phone: input.phone?.replace(/\D/g, '') || null,
    email: input.email?.toLowerCase().trim() || null,
  };
}

// ── POST /api/contacts/import ────────────────────────────────────
// Accepts an array of contacts and imports them (dedup by phone/email).
// No real outbound side effects — this is demo-only.
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
  }

  ensureSeedData(userId);

  let body: { source?: ContactSource; contacts?: ImportContactInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const source = body.source || ContactSource.MANUAL;
  const contacts = body.contacts || [];

  if (!Array.isArray(contacts)) {
    return NextResponse.json({ error: 'contacts must be an array' }, { status: 400 });
  }

  const imported: DemoContact[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const c of contacts) {
    if (!c.name) {
      skipped.push({ name: '(unnamed)', reason: 'Missing name' });
      continue;
    }

    const norm = normalize(c);
    // Dedup check
    let duplicate = false;
    for (const [, existing] of demoContactStore) {
      if (existing.userId !== userId) continue;
      if (norm.email && existing.email === norm.email) { duplicate = true; break; }
      if (norm.phone && existing.phone === norm.phone) { duplicate = true; break; }
    }
    if (duplicate) {
      skipped.push({ name: c.name, reason: 'Duplicate phone or email' });
      continue;
    }

    const id = `demo-contact-${Date.now()}-${imported.length}`;
    const now = new Date().toISOString();
    const contact: DemoContact = {
      id,
      userId,
      name: c.name,
      phone: norm.phone,
      email: norm.email,
      industry: c.industry || null,
      notes: c.notes || null,
      source,
      pipelineStage: PipelineStage.DISCOVERY,
      relationshipStrength: 0,
      createdAt: now,
      updatedAt: now,
    };
    demoContactStore.set(`${userId}:${id}`, contact);
    imported.push(contact);
  }

  return NextResponse.json(
    {
      imported: imported.length,
      skipped: skipped.length,
      importedContacts: imported,
      skippedContacts: skipped,
      safeHarbor: SAFE_HARBOR_EARNINGS_DISCLAIMER,
      _meta: { demo: true, hint: 'In-memory demo store. No real database writes.' },
    },
    { status: 201 },
  );
}

// ── GET /api/contacts/import ────────────────────────────────────
// Returns the current demo contact list for the user.
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
  }

  ensureSeedData(userId);

  const userContacts = [...demoContactStore.values()].filter(
    (c) => c.userId === userId,
  );

  return NextResponse.json({
    count: userContacts.length,
    contacts: userContacts,
    _meta: { demo: true },
  });
}