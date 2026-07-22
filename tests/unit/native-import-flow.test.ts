// T-58 — proves `runNativeContactsDiscovery` (native-import-flow.ts), the real permission-gated
// orchestration replacing OnboardingFlow.tsx's old fake `onRequestPermission` (`setContactCount(24)`
// with no permission ever asked, no device contact ever read). Three TEETH assertions the charter
// calls for:
//   (1) WEB/non-native → 'unsupported', and the plugin is NEVER even called (proves the fail-closed
//       "never ask on web" contract, not just "the plugin would fail if asked").
//   (2) permission DENIED → 'denied', and `getContacts` is NEVER called — no contact is read, let
//       alone created. This is the exact fail-closed proof the build charter requires: no partial
//       data, no fake success.
//   (3) an unexpected plugin failure → a DISTINCT 'error' outcome, never silently swallowed into a
//       fake 'ready' or a misleading 'denied' (the rep didn't refuse anything).
// The fake plugin used here satisfies `NativeContactsPluginLike`, a structural `Pick` of the REAL
// `@capacitor-community/contacts` `ContactsPlugin` type — so a shape drift in the real plugin's
// types would fail this file to compile, not just silently pass a stale mock.

import {
  runNativeContactsDiscovery,
  type NativeContactsPluginLike,
} from '../../src/services/warm-market/vault/native-import-flow';
import type { NativeContactPayload } from '../../src/services/warm-market/vault/native-contacts-adapter';

function fakePlugin(overrides: Partial<NativeContactsPluginLike> = {}): NativeContactsPluginLike {
  return {
    checkPermissions: jest.fn().mockResolvedValue({ contacts: 'prompt' }),
    requestPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
    getContacts: jest.fn().mockResolvedValue({ contacts: [] as NativeContactPayload[] }),
    ...overrides,
  } as unknown as NativeContactsPluginLike;
}

describe('runNativeContactsDiscovery — WEB/non-native fail-closed path', () => {
  test('isNativePlatform=false → { kind: "unsupported" }, and the plugin is NEVER called at all', async () => {
    const plugin = fakePlugin();
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: false, plugin });
    expect(outcome).toEqual({ kind: 'unsupported' });
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(plugin.getContacts).not.toHaveBeenCalled();
  });
});

describe('runNativeContactsDiscovery — permission DENIED fail-closed path (TEETH: no contact read/created)', () => {
  test('checkPermissions already denied, requestPermissions still denied → { kind: "denied" }, getContacts NEVER called', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockResolvedValue({ contacts: 'denied' }),
      requestPermissions: jest.fn().mockResolvedValue({ contacts: 'denied' }),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome).toEqual({ kind: 'denied' });
    expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    // TEETH: the fail-closed proof — no device contact is ever read once permission is refused.
    expect(plugin.getContacts).not.toHaveBeenCalled();
  });

  test('checkPermissions already "prompt" and the rep denies the OS dialog → denied, no read', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockResolvedValue({ contacts: 'prompt' }),
      requestPermissions: jest.fn().mockResolvedValue({ contacts: 'denied' }),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome).toEqual({ kind: 'denied' });
    expect(plugin.getContacts).not.toHaveBeenCalled();
  });

  test('already-granted permission (checkPermissions) skips requestPermissions entirely and proceeds to a real read', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
      getContacts: jest.fn().mockResolvedValue({
        contacts: [{ contactId: 'c-1', name: { display: 'Already Granted', given: null, middle: null, family: null } }],
      }),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('ready');
  });

  test('iOS "limited" partial-access grant is treated as granted — proceeds to a real read, not denied', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockResolvedValue({ contacts: 'limited' }),
      getContacts: jest.fn().mockResolvedValue({ contacts: [] }),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome.kind).toBe('ready');
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });
});

describe('runNativeContactsDiscovery — granted path: real read, mapped + deduped, never persisted here', () => {
  test('returns mapped+deduped candidates from the real getContacts payload', async () => {
    const plugin = fakePlugin({
      getContacts: jest.fn().mockResolvedValue({
        contacts: [
          { contactId: 'c-1', name: { display: 'Jane Doe', given: null, middle: null, family: null }, phones: [{ number: '312-555-0100' }] },
          { contactId: 'c-2', name: { display: null, given: null, middle: null, family: null } }, // un-nameable, dropped
        ],
      }),
    });
    const outcome = await runNativeContactsDiscovery({
      isNativePlatform: true,
      plugin,
      existing: [{ phone: '3125550100', email: null }],
    });
    expect(outcome.kind).toBe('ready');
    if (outcome.kind !== 'ready') throw new Error('unreachable');
    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0].contactId).toBe('c-1');
    expect(outcome.candidates[0].isDuplicate).toBe(true); // matched the injected "existing" phone
  });

  test('an empty device address book → ready with an empty candidate list (honest empty state, not an error)', async () => {
    const plugin = fakePlugin({ getContacts: jest.fn().mockResolvedValue({ contacts: [] }) });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome).toEqual({ kind: 'ready', candidates: [] });
  });
});

describe('runNativeContactsDiscovery — unexpected plugin failure is a DISTINCT, honest outcome (never silently swallowed)', () => {
  test('checkPermissions itself throws → { kind: "error", detail }, never a fake "ready" or misleading "denied"', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockRejectedValue(new Error('native bridge unavailable')),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') throw new Error('unreachable');
    expect(outcome.detail).toMatch(/native bridge unavailable/);
  });

  test('getContacts throws AFTER a real grant → { kind: "error" }, not a fabricated empty/partial success', async () => {
    const plugin = fakePlugin({
      checkPermissions: jest.fn().mockResolvedValue({ contacts: 'granted' }),
      getContacts: jest.fn().mockRejectedValue(new Error('OS read failed')),
    });
    const outcome = await runNativeContactsDiscovery({ isNativePlatform: true, plugin });
    expect(outcome).toEqual({ kind: 'error', detail: 'OS read failed' });
  });
});
