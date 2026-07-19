// T-36 (§10.3) — the Twilio A2P 10DLC client boundary. Twilio's Messaging/Brand/Campaign REST API
// is called through this narrow, DI-mockable interface only; nothing in a2p-service.ts ever reaches
// for `fetch`/an SDK directly. This is the seam that keeps a missing/absent Twilio account
// fail-safe rather than a crash: `createTwilioClient()` reads TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN
// BY NAME, lazily (called once per request from inside a route/service method — never at module
// scope, never at import time), and returns `null` when either is unset. Every caller treats a
// `null` client as "Twilio is UNCONFIGURED" and must resolve to the UNCONFIGURED/PENDING posture
// (never crash, never fabricate an APPROVED/sendable result) — see a2p-service.ts.
//
// No `twilio` npm SDK dependency is added here on purpose: the REST calls this client makes are a
// handful of simple JSON/form-encoded HTTP requests, made with the runtime's built-in `fetch`
// (Node 18+/Next.js 14 target, see package.json), so this stays true to "DEPENDENCY-INJECTED +
// mockable" without pulling in a large SDK whose own construction patterns would need auditing for
// the same module-scope-key-read hazard.

import { A2PProvisioningStatus } from '../../types/deliverability';

/** Referenced by name only (§0.4) — this module never logs, returns, or otherwise exposes the
 *  value of either variable, only whether both are present. */
export const TWILIO_ACCOUNT_SID_ENV_VAR = 'TWILIO_ACCOUNT_SID';
export const TWILIO_AUTH_TOKEN_ENV_VAR = 'TWILIO_AUTH_TOKEN';

export interface TwilioBrandSubmission {
  organizationId: string;
  legalBusinessName: string;
  ein: string;
  entityType: string;
}

export interface TwilioCampaignSubmission {
  organizationId: string;
  brandSid: string;
  useCase: string;
  optInLanguage: string;
  sampleMessages: string[];
}

export interface TwilioStatusResult {
  status: A2PProvisioningStatus;
  failureReason: string | null;
  throughputTier?: string | null;
}

export interface TwilioProvisionedNumber {
  phoneNumberSid: string;
  phoneNumber: string;
}

/**
 * The narrow surface a2p-service.ts needs. Every method is a single, idempotent Twilio REST call;
 * polling/webhook reconciliation both funnel through `getBrandStatus`/`getCampaignStatus`.
 */
export interface TwilioA2PClient {
  submitBrandRegistration(input: TwilioBrandSubmission): Promise<{ brandSid: string }>;
  getBrandStatus(brandSid: string): Promise<TwilioStatusResult>;
  submitCampaignRegistration(input: TwilioCampaignSubmission): Promise<{ campaignSid: string }>;
  getCampaignStatus(campaignSid: string): Promise<TwilioStatusResult>;
  provisionPhoneNumber(organizationId: string): Promise<TwilioProvisionedNumber>;
  assignNumberToCampaign(phoneNumberSid: string, campaignSid: string): Promise<void>;
}

/** True iff both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set. Read at call time, never cached
 *  at module scope, so a build/typecheck run with no env at all never touches these. */
export function isTwilioConfigured(): boolean {
  return Boolean(process.env[TWILIO_ACCOUNT_SID_ENV_VAR] && process.env[TWILIO_AUTH_TOKEN_ENV_VAR]);
}

const TWILIO_API_BASE = 'https://messaging.twilio.com/v1';

/**
 * The real Twilio REST client. Constructed ONLY by `createTwilioClient()` below, and only after
 * `isTwilioConfigured()` has already confirmed both env vars are present — so this class itself
 * never needs to guard against a missing credential; that guard lives at the factory boundary,
 * the one place callers actually ask "do I have a usable client at all."
 */
export class LiveTwilioA2PClient implements TwilioA2PClient {
  constructor(private readonly accountSid: string, private readonly authToken: string) {}

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
  }

  private async request<T>(path: string, method: string, body?: Record<string, string>): Promise<T> {
    const res = await fetch(`${TWILIO_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Twilio API error (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as T;
  }

  private mapTwilioStatus(raw: string): A2PProvisioningStatus {
    // Twilio's own vocabulary (brand: PENDING/APPROVED/FAILED; campaign: IN_PROGRESS/VERIFIED/
    // FAILED, among others) is mapped onto our four-state union defensively — anything not
    // recognized as a positive terminal state stays PENDING rather than being guessed at.
    const upper = raw.toUpperCase();
    if (upper === 'APPROVED' || upper === 'VERIFIED') return 'APPROVED';
    if (upper === 'FAILED' || upper === 'REJECTED') return 'REJECTED';
    return 'PENDING';
  }

  async submitBrandRegistration(input: TwilioBrandSubmission): Promise<{ brandSid: string }> {
    const result = await this.request<{ sid: string }>('/a2p/BrandRegistrations', 'POST', {
      businessName: input.legalBusinessName,
      ein: input.ein,
      entityType: input.entityType,
    });
    return { brandSid: result.sid };
  }

  async getBrandStatus(brandSid: string): Promise<TwilioStatusResult> {
    const result = await this.request<{ status: string; failureReason?: string | null }>(
      `/a2p/BrandRegistrations/${encodeURIComponent(brandSid)}`,
      'GET'
    );
    return { status: this.mapTwilioStatus(result.status), failureReason: result.failureReason ?? null };
  }

  async submitCampaignRegistration(input: TwilioCampaignSubmission): Promise<{ campaignSid: string }> {
    const result = await this.request<{ sid: string }>(
      `/a2p/BrandRegistrations/${encodeURIComponent(input.brandSid)}/Campaigns`,
      'POST',
      {
        usecase: input.useCase,
        description: input.optInLanguage,
      }
    );
    return { campaignSid: result.sid };
  }

  async getCampaignStatus(campaignSid: string): Promise<TwilioStatusResult> {
    const result = await this.request<{ status: string; failureReason?: string | null; throughputTier?: string }>(
      `/a2p/Campaigns/${encodeURIComponent(campaignSid)}`,
      'GET'
    );
    return {
      status: this.mapTwilioStatus(result.status),
      failureReason: result.failureReason ?? null,
      throughputTier: result.throughputTier ?? null,
    };
  }

  async provisionPhoneNumber(_organizationId: string): Promise<TwilioProvisionedNumber> {
    const result = await this.request<{ sid: string; phoneNumber: string }>('/PhoneNumbers', 'POST');
    return { phoneNumberSid: result.sid, phoneNumber: result.phoneNumber };
  }

  async assignNumberToCampaign(phoneNumberSid: string, campaignSid: string): Promise<void> {
    await this.request(`/a2p/Campaigns/${encodeURIComponent(campaignSid)}/PhoneNumbers`, 'POST', {
      phoneNumberSid,
    });
  }
}

/**
 * The fail-safe factory: returns a real, usable `TwilioA2PClient` when both env vars are present,
 * or `null` when either is missing. NEVER throws for a missing credential — a2p-service.ts treats
 * `null` as "Twilio is UNCONFIGURED" and resolves every operation to the UNCONFIGURED/PENDING
 * posture instead of attempting a network call with no credentials (which would either throw or,
 * worse, silently no-op and let a caller believe registration is in flight when it never started).
 */
export function createTwilioClient(): TwilioA2PClient | null {
  const accountSid = process.env[TWILIO_ACCOUNT_SID_ENV_VAR];
  const authToken = process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
  if (!accountSid || !authToken) {
    return null;
  }
  return new LiveTwilioA2PClient(accountSid, authToken);
}

/**
 * Deterministic in-memory client for tests/dev — no network, no credentials. `approveAll`/
 * `rejectAll` flip every outstanding PENDING submission the next time its status is polled,
 * simulating Twilio's own async review process without a real waiting period.
 */
export class InMemoryTwilioA2PClient implements TwilioA2PClient {
  private brandCounter = 0;
  private campaignCounter = 0;
  private numberCounter = 0;
  private brandStatuses = new Map<string, A2PProvisioningStatus>();
  private campaignStatuses = new Map<string, A2PProvisioningStatus>();
  private assignments = new Map<string, string>(); // phoneNumberSid -> campaignSid
  /** Test hook: force every PENDING brand/campaign to the given status on next read. */
  nextBrandStatus: A2PProvisioningStatus = 'PENDING';
  nextCampaignStatus: A2PProvisioningStatus = 'PENDING';

  async submitBrandRegistration(_input: TwilioBrandSubmission): Promise<{ brandSid: string }> {
    const brandSid = `BN_MOCK_${++this.brandCounter}`;
    this.brandStatuses.set(brandSid, 'PENDING');
    return { brandSid };
  }

  async getBrandStatus(brandSid: string): Promise<TwilioStatusResult> {
    const current = this.brandStatuses.get(brandSid) ?? 'PENDING';
    const status = current === 'PENDING' ? this.nextBrandStatus : current;
    this.brandStatuses.set(brandSid, status);
    return { status, failureReason: status === 'REJECTED' ? 'mock rejection' : null };
  }

  async submitCampaignRegistration(_input: TwilioCampaignSubmission): Promise<{ campaignSid: string }> {
    const campaignSid = `CN_MOCK_${++this.campaignCounter}`;
    this.campaignStatuses.set(campaignSid, 'PENDING');
    return { campaignSid };
  }

  async getCampaignStatus(campaignSid: string): Promise<TwilioStatusResult> {
    const current = this.campaignStatuses.get(campaignSid) ?? 'PENDING';
    const status = current === 'PENDING' ? this.nextCampaignStatus : current;
    this.campaignStatuses.set(campaignSid, status);
    return {
      status,
      failureReason: status === 'REJECTED' ? 'mock rejection' : null,
      throughputTier: status === 'APPROVED' ? 'T1' : null,
    };
  }

  async provisionPhoneNumber(_organizationId: string): Promise<TwilioProvisionedNumber> {
    const n = ++this.numberCounter;
    return { phoneNumberSid: `PN_MOCK_${n}`, phoneNumber: `+1555000${String(n).padStart(4, '0')}` };
  }

  async assignNumberToCampaign(phoneNumberSid: string, campaignSid: string): Promise<void> {
    this.assignments.set(phoneNumberSid, campaignSid);
  }

  /** Test helper. */
  isAssigned(phoneNumberSid: string, campaignSid: string): boolean {
    return this.assignments.get(phoneNumberSid) === campaignSid;
  }
}
