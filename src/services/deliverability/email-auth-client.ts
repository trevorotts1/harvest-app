// T-36 (§10.3 "email domain authentication (SPF, DKIM, DMARC)") — the email-authentication check
// boundary. SPF and DMARC are checked via real, public DNS TXT lookups (Node's built-in
// `node:dns/promises`) — genuinely functional with NO credentials of any kind, since SPF/DMARC
// records are public DNS by design. DKIM verification needs to know which selector the sending
// provider publishes under, which IS provider-specific configuration (not a secret, but unset by
// default); `checkDkim` resolves to NOT_CONFIGURED — never a crash, never a fabricated VERIFIED —
// when no selector is configured, exactly mirroring twilio-client.ts's "no credential -> explicit
// unconfigured state" posture for the one piece of this file that needs external configuration.

import { resolveTxt } from 'node:dns/promises';
import { EmailAuthRecordStatus } from '../../types/deliverability';

/** Referenced by name only. A DKIM selector is a DNS label (e.g. "s1", "google"), not a secret —
 *  but it's still read by name, never hardcoded, so a deployment can point at its own provider's
 *  selector without a code change. */
export const EMAIL_DKIM_SELECTOR_ENV_VAR = 'EMAIL_DKIM_SELECTOR';

export function getConfiguredDkimSelector(): string | null {
  return process.env[EMAIL_DKIM_SELECTOR_ENV_VAR] || null;
}

export interface EmailAuthCheckResult {
  status: EmailAuthRecordStatus;
  detail: string;
}

export interface EmailAuthClient {
  checkSpf(domain: string): Promise<EmailAuthCheckResult>;
  checkDkim(domain: string): Promise<EmailAuthCheckResult>;
  checkDmarc(domain: string): Promise<EmailAuthCheckResult>;
}

async function resolveTxtFlat(hostname: string): Promise<string[]> {
  const chunks = await resolveTxt(hostname);
  return chunks.map((parts) => parts.join(''));
}

/** The real implementation. Every method is a plain DNS TXT lookup — no account, no API key, no
 *  module-scope network call (DNS is only ever resolved inside these async methods, at call time). */
export class DnsEmailAuthClient implements EmailAuthClient {
  async checkSpf(domain: string): Promise<EmailAuthCheckResult> {
    try {
      const records = await resolveTxtFlat(domain);
      const spf = records.find((r) => r.toLowerCase().startsWith('v=spf1'));
      return spf
        ? { status: 'VERIFIED', detail: spf }
        : { status: 'FAILED', detail: `No "v=spf1" TXT record found on ${domain}.` };
    } catch (err) {
      return { status: 'FAILED', detail: `DNS lookup for ${domain} failed: ${(err as Error).message}` };
    }
  }

  async checkDmarc(domain: string): Promise<EmailAuthCheckResult> {
    const host = `_dmarc.${domain}`;
    try {
      const records = await resolveTxtFlat(host);
      const dmarc = records.find((r) => r.toLowerCase().startsWith('v=dmarc1'));
      return dmarc
        ? { status: 'VERIFIED', detail: dmarc }
        : { status: 'FAILED', detail: `No "v=DMARC1" TXT record found at ${host}.` };
    } catch (err) {
      return { status: 'FAILED', detail: `DNS lookup for ${host} failed: ${(err as Error).message}` };
    }
  }

  async checkDkim(domain: string): Promise<EmailAuthCheckResult> {
    const selector = getConfiguredDkimSelector();
    if (!selector) {
      return {
        status: 'NOT_CONFIGURED',
        detail:
          `No DKIM selector configured (${EMAIL_DKIM_SELECTOR_ENV_VAR} unset) — cannot verify DKIM ` +
          'without knowing which selector the sending provider publishes under.',
      };
    }
    const host = `${selector}._domainkey.${domain}`;
    try {
      const records = await resolveTxtFlat(host);
      const dkim = records.find((r) => /v=dkim1|p=/i.test(r));
      return dkim
        ? { status: 'VERIFIED', detail: dkim }
        : { status: 'FAILED', detail: `No DKIM TXT record found at ${host}.` };
    } catch (err) {
      return { status: 'FAILED', detail: `DNS lookup for ${host} failed: ${(err as Error).message}` };
    }
  }
}

/** Deterministic in-memory client for tests/dev — no DNS, no network. */
export class InMemoryEmailAuthClient implements EmailAuthClient {
  spfByDomain = new Map<string, EmailAuthCheckResult>();
  dkimByDomain = new Map<string, EmailAuthCheckResult>();
  dmarcByDomain = new Map<string, EmailAuthCheckResult>();

  private static readonly DEFAULT: EmailAuthCheckResult = { status: 'NOT_CONFIGURED', detail: 'mock: no record configured' };

  async checkSpf(domain: string): Promise<EmailAuthCheckResult> {
    return this.spfByDomain.get(domain) ?? InMemoryEmailAuthClient.DEFAULT;
  }
  async checkDkim(domain: string): Promise<EmailAuthCheckResult> {
    return this.dkimByDomain.get(domain) ?? InMemoryEmailAuthClient.DEFAULT;
  }
  async checkDmarc(domain: string): Promise<EmailAuthCheckResult> {
    return this.dmarcByDomain.get(domain) ?? InMemoryEmailAuthClient.DEFAULT;
  }

  /** Test helper: mark every check VERIFIED for a domain in one call. */
  verifyAll(domain: string): void {
    this.spfByDomain.set(domain, { status: 'VERIFIED', detail: 'mock v=spf1' });
    this.dkimByDomain.set(domain, { status: 'VERIFIED', detail: 'mock dkim' });
    this.dmarcByDomain.set(domain, { status: 'VERIFIED', detail: 'mock v=DMARC1' });
  }
}
