// T-37 — the Twilio messaging SEND client. Proves the fail-safe factory (missing TWILIO_* keys =>
// null, never a throw or a fabricated send) and the deterministic in-memory client. Runs KEY-LESS:
// the suite never sets TWILIO_* except in the one test that explicitly restores them afterward, so
// the default assertion is that a key-less environment yields a null (unconfigured) client.

import {
  createTwilioMessagingClient,
  isTwilioMessagingConfigured,
  InMemoryTwilioMessagingClient,
} from './twilio-messaging-client';
import {
  TWILIO_ACCOUNT_SID_ENV_VAR,
  TWILIO_AUTH_TOKEN_ENV_VAR,
} from '../../deliverability/twilio-client';

describe('createTwilioMessagingClient — fail-safe by name', () => {
  const originalSid = process.env[TWILIO_ACCOUNT_SID_ENV_VAR];
  const originalToken = process.env[TWILIO_AUTH_TOKEN_ENV_VAR];

  afterEach(() => {
    // Restore whatever the ambient env was (key-less in CI) so no test leaks credentials to another.
    if (originalSid === undefined) delete process.env[TWILIO_ACCOUNT_SID_ENV_VAR];
    else process.env[TWILIO_ACCOUNT_SID_ENV_VAR] = originalSid;
    if (originalToken === undefined) delete process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
    else process.env[TWILIO_AUTH_TOKEN_ENV_VAR] = originalToken;
  });

  test('KEY-LESS: both env vars unset => null client, no throw, isConfigured false', () => {
    delete process.env[TWILIO_ACCOUNT_SID_ENV_VAR];
    delete process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
    expect(isTwilioMessagingConfigured()).toBe(false);
    expect(createTwilioMessagingClient()).toBeNull();
  });

  test('only ONE of the two set => still null (both required)', () => {
    process.env[TWILIO_ACCOUNT_SID_ENV_VAR] = 'AC_test_only';
    delete process.env[TWILIO_AUTH_TOKEN_ENV_VAR];
    expect(isTwilioMessagingConfigured()).toBe(false);
    expect(createTwilioMessagingClient()).toBeNull();
  });

  test('both set => a usable client (constructed, never a network call at construction)', () => {
    process.env[TWILIO_ACCOUNT_SID_ENV_VAR] = 'AC_test_only';
    process.env[TWILIO_AUTH_TOKEN_ENV_VAR] = 'token_test_only';
    expect(isTwilioMessagingConfigured()).toBe(true);
    const client = createTwilioMessagingClient();
    expect(client).not.toBeNull();
    expect(typeof client!.sendSms).toBe('function');
  });
});

describe('InMemoryTwilioMessagingClient — deterministic test double', () => {
  test('records the send and returns a provider sid + status', async () => {
    const client = new InMemoryTwilioMessagingClient();
    const result = await client.sendSms({ from: '+15550001111', to: '+15551234567', body: 'Hello' });
    expect(result.sid).toMatch(/^SM_MOCK_/);
    expect(result.status).toBe('queued');
    expect(client.sent).toHaveLength(1);
    expect(client.sent[0]).toEqual({ from: '+15550001111', to: '+15551234567', body: 'Hello' });
  });

  test('failNext throws once (simulating a transient send failure) and does NOT record', async () => {
    const client = new InMemoryTwilioMessagingClient();
    client.failNext = true;
    await expect(client.sendSms({ from: '+15550001111', to: '+15551234567', body: 'x' })).rejects.toThrow();
    expect(client.sent).toHaveLength(0);
    // Recovers on the next call.
    await client.sendSms({ from: '+15550001111', to: '+15551234567', body: 'y' });
    expect(client.sent).toHaveLength(1);
  });
});
