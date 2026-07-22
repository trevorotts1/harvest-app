// T-58 (§7.1 "iOS native (CNContactStore) / Android native (Contacts Provider)"; §17.3 mobile
// shell). This is the ONE seam that touches the real `@capacitor/core` bridge + the
// `@capacitor-community/contacts` plugin (docs/mobile-shell.md's own T-58a note names this exact
// pairing as the deferred later unit) — every other module in this build (the pure mapping/dedupe in
// native-contacts-adapter.ts, the orchestration in native-import-flow.ts) is plugin-agnostic and
// takes a plugin/platform-check as an injected argument instead, specifically so those modules stay
// unit-testable with a fake plugin rather than needing a real native runtime.
//
// `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()` are the SAME two APIs
// `capacitor.config.ts`'s own file header already names as "the platform-detection pattern a later
// unit will use" (`window.Capacitor.Plugins.*` works once the WebView loads this live app) —
// documented in `@capacitor/core`'s own shipped types (`node_modules/@capacitor/core/types/
// definitions.d.ts`): `isNativePlatform(): boolean` ("true if the platform is native — android/ios;
// false otherwise, e.g. running in a browser") and `getPlatform(): string` (`'ios' | 'android' |
// 'web'`). On a plain web/PWA load (no native shell), `isNativePlatform()` is `false` and the
// `@capacitor-community/contacts` plugin's own web fallback (`ContactsWeb`, dist/esm/web.js) throws
// `unimplemented('Not implemented on web.')` for every method — this module's job is to make sure
// nothing downstream ever calls into that plugin at all on web, rather than relying on catching that
// throw (fail-CLOSED by never asking, not by catching a thrown "no").
import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';

import { ContactSource, type ClientPlatform } from '@/types/warm-market';

/** True only inside the native iOS/Android app shell — never true on web/PWA, per
 *  `Capacitor.isNativePlatform()`'s own documented contract (see file header). */
export function isNativeContactsPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** The caller's real runtime platform, narrowed to this codebase's `ClientPlatform` union — the SAME
 *  value `VaultService.assertModalityAllowed` (vault.service.ts) requires match the declared
 *  `IOS_NATIVE`/`ANDROID_NATIVE` source before it allows the import (§7.1 native-shell-only gate).
 *  `Capacitor.getPlatform()` can only ever return `'ios' | 'android' | 'web'` per its own shipped
 *  return type; the `'web'` fallback below is unreachable in practice but keeps this total rather
 *  than throwing on a hypothetical future platform string. */
export function nativeClientPlatform(): ClientPlatform {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}

/** The `ContactSource` a real native import on THIS device must be recorded under — `null` on web,
 *  where native contact import is never offered (§7.1 "Web gets CSV + Google Contacts (native import
 *  is native-only)"). */
export function nativeContactSourceForPlatform(platform: ClientPlatform): ContactSource | null {
  if (platform === 'ios') return ContactSource.IOS_NATIVE;
  if (platform === 'android') return ContactSource.ANDROID_NATIVE;
  return null;
}

/** The real plugin instance — `@capacitor-community/contacts`'s `Contacts` export (registered via
 *  `@capacitor/core`'s `registerPlugin('Contacts', ...)`, see the package's own `dist/esm/index.js`).
 *  Re-exported (not called directly) so call sites depend on this module's seam, not the package
 *  path, and so a test can `jest.mock('@/lib/native/capacitor-contacts')` in one place. */
export { Contacts as nativeContactsPlugin };
