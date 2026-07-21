// T-58a — smoke test for the Web App Manifest file convention (src/app/manifest.ts). Master spec
// §2.1/§17.3 (PWA + thin native shell) and uiux spec §1 (start_url = Today, always) /
// §6.3 (PWA + native-shell parity table) inform the assertions below.
import { existsSync } from 'node:fs';
import path from 'node:path';
import manifest from '@/app/manifest';

describe('src/app/manifest.ts — PWA web app manifest', () => {
  it('names the app consistently with the in-app brand ("The Harvest")', () => {
    const m = manifest();
    expect(m.name).toMatch(/The Harvest/);
    expect(m.short_name).toBe('Harvest');
  });

  it('lands every PWA launch on /today, per uiux spec §1 ("Today is the default landing surface, always")', () => {
    const m = manifest();
    expect(m.start_url).toBe('/today');
    expect(m.scope).toBe('/');
  });

  it('requests standalone (installed-app) display chrome', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
  });

  it('uses the real design-token colors, not invented ones (tokens.css --color-action / --surface-canvas)', () => {
    const m = manifest();
    expect(m.theme_color).toBe('#2f6b4f'); // --leaf-600 / --color-action
    expect(m.background_color).toBe('#f7f3ea'); // --soil-100 / light --surface-canvas
  });

  it('declares at least one "any" and one "maskable" icon, both referencing real files under public/icons', () => {
    const m = manifest();
    expect(m.icons?.length).toBeGreaterThan(0);

    const purposes = m.icons?.map((icon) => icon.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');

    for (const icon of m.icons ?? []) {
      expect(icon.src.startsWith('/icons/')).toBe(true);
      expect(icon.type).toBe('image/png');
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
    }
  });

  it('every icon file the manifest references actually exists on disk', () => {
    const m = manifest();

    for (const icon of m.icons ?? []) {
      const onDisk = path.join(__dirname, '..', '..', 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(onDisk)).toBe(true);
    }
  });
});
