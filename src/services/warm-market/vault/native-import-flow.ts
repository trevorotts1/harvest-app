// T-58 — the pure, plugin-injected orchestration behind the real "Import from Phone" flow (replacing
// OnboardingFlow.tsx's old fake `onRequestPermission={() => { setContactCount(24); advance(); }}`,
// which never asked permission, never read a device contact, and never called the Vault). This
// module owns the three-way branch the master spec's fail-closed contract requires:
//
//   (1) WEB/non-native (`isNativePlatform: false`) → `{ kind: 'unsupported' }`, WITHOUT ever calling
//       into the plugin — `@capacitor-community/contacts`'s own web fallback throws `unimplemented`
//       for every method (see capacitor-contacts.ts's header), so this checks BEFORE asking rather
//       than relying on catching that throw.
//   (2) Permission denied (OS `checkPermissions`/`requestPermissions` never resolves `granted` or
//       `limited` — the plugin's own `PermissionStatus.contacts` union, definitions.d.ts) →
//       `{ kind: 'denied' }`. `getContacts` is NEVER called on this path — no contact is ever read,
//       let alone created (proved in tests/unit/native-import-flow.test.ts by asserting the fake
//       plugin's `getContacts` spy has zero calls).
//   (3) Granted → real `getContacts()` read, mapped + deduped via native-contacts-adapter.ts,
//       returned as a selectable list (`{ kind: 'ready', candidates }`) — the rep chooses which to
//       import; nothing is persisted by this module (that's the caller's POST to
//       /api/onboarding/contacts-import, which drives the real VaultService pipeline).
//   Any unexpected plugin failure (native OS error, etc.) → `{ kind: 'error', message }` — a distinct,
//   honestly-labeled outcome from `denied` (the rep didn't refuse anything; something broke), never a
//   silently-faked success.
//
// `plugin`/`isNativePlatform` are both caller-injected (never imported from
// `@/lib/native/capacitor-contacts` directly) specifically so this file needs no real Capacitor
// runtime to unit test — a fake plugin object matching `NativeContactsPluginLike` is enough.

import type { ContactsPlugin } from '@capacitor-community/contacts';

import {
  buildNativeContactCandidates,
  type ExistingContactKeys,
  type NativeContactCandidate,
} from './native-contacts-adapter';

/** The exact subset of the real plugin's documented surface this flow calls — a structural `Pick`
 *  of the package's OWN `ContactsPlugin` interface (definitions.d.ts), never a hand-copied shadow
 *  type that could silently drift from what the plugin actually ships. */
export type NativeContactsPluginLike = Pick<ContactsPlugin, 'checkPermissions' | 'requestPermissions' | 'getContacts'>;

export type NativeImportOutcome =
  | { kind: 'unsupported' }
  | { kind: 'denied' }
  // `detail` is a DIAGNOSTIC-only field (the underlying JS Error's own message, whatever engine/OS
  // text that happens to be) — deliberately NOT named `message`/`*Note`/`*Text` (guard:server-i18n-
  // leak's rep-facing-sink naming heuristic, T-57 RG7 dimension B): this string is never rendered to
  // a rep. The caller (OnboardingFlow.tsx's `handleRequestNativeContacts`) always resolves a real,
  // localized `onboarding.contactImport.denied.nativeImportFailedGeneric` catalog string for display
  // and ignores this value entirely — it exists only for logs/debugging.
  | { kind: 'error'; detail: string }
  | { kind: 'ready'; candidates: NativeContactCandidate[] };

// Requests exactly the projection fields native-contacts-adapter.ts's `mapNativeContactToRow` reads
// (name/phones/emails/birthday/note) — the plugin's own `Projection` type defaults every field to
// `false`, so a field left out here is never fetched, keeping this request minimal (no organization/
// urls/postalAddresses/image round-trip for data this row shape never uses).
const CONTACTS_PROJECTION = { name: true, phones: true, emails: true, birthday: true, note: true } as const;

function isGrantedOrLimited(state: string): boolean {
  // `PermissionStatus.contacts` (definitions.d.ts): `PermissionState | 'limited'` — iOS's own
  // "limited" partial-access grant (a real OS state, not a plugin invention) is treated the same as
  // a full grant: the rep still gets to pick from whatever contacts iOS did share.
  return state === 'granted' || state === 'limited';
}

export interface RunNativeContactsDiscoveryOptions {
  /** `Capacitor.isNativePlatform()` — caller-supplied so this stays plugin/runtime-agnostic. */
  isNativePlatform: boolean;
  plugin: NativeContactsPluginLike;
  /** The rep's existing Vault contacts' normalized phone/email (see the onboarding contacts-import
   *  route's GET handler) — used only for the rep-facing duplicate label, never to block a selection
   *  (the server's own merge-on-duplicate, VaultService.upsertRow, is always the authority). */
  existing?: ExistingContactKeys[];
}

/**
 * Runs the real permission-gated device-contacts discovery. Never persists anything — returns a
 * selectable candidate list (or an honest non-`ready` outcome) for the caller to render and, only on
 * the rep's own explicit confirmation, POST to the real ingestion route.
 */
export async function runNativeContactsDiscovery(
  opts: RunNativeContactsDiscoveryOptions
): Promise<NativeImportOutcome> {
  if (!opts.isNativePlatform) return { kind: 'unsupported' };

  try {
    let status = await opts.plugin.checkPermissions();
    if (!isGrantedOrLimited(status.contacts)) {
      status = await opts.plugin.requestPermissions();
    }
    if (!isGrantedOrLimited(status.contacts)) {
      return { kind: 'denied' };
    }

    const { contacts } = await opts.plugin.getContacts({ projection: CONTACTS_PROJECTION });
    const candidates = buildNativeContactCandidates(contacts, opts.existing ?? []);
    return { kind: 'ready', candidates };
  } catch (err) {
    return {
      kind: 'error',
      detail: err instanceof Error ? err.message : 'unknown-native-contacts-error',
    };
  }
}
