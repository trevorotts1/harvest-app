#!/usr/bin/env node
/**
 * T-58a — one-off generator for placeholder PWA / native-shell icon rasters.
 *
 * WHY THIS EXISTS: no brand icon assets exist anywhere in this repo (confirmed by a repo-wide
 * search before this build unit started — no `public/`, no `*icon*` file, no manifest). The web
 * manifest (src/app/manifest.ts) and the App-Router `apple-icon.png` file convention both need
 * real PNG files to point at, and this infra unit is explicitly scoped to NOT block on final
 * brand art ("generate simple maskable placeholder icon(s) ... AND clearly flag operator must
 * supply final brand icons — do not block on assets"). Rather than inventing a new, arbitrary
 * design, this rasterizes the ALREADY-EXISTING `.brand-mark` treatment (src/app/globals.css: a
 * rounded square, `linear-gradient(135deg, var(--leaf), var(--harvest))`, a bold "H") that already
 * renders live on `/`, `/auth`, and every `/team/*` page (src/app/page.tsx, src/app/auth/page.tsx,
 * src/app/team/layout.tsx) — so the placeholder icon is at least visually consistent with the
 * in-app brand mark rather than a new invented mark.
 *
 * THESE ARE PLACEHOLDERS, NOT FINAL BRAND ART. An operator/designer must supply real app-store-
 * grade icon assets (proper vector source, all required platform sizes, deliberately composed
 * maskable safe-zone art) before any App Store / Play Store submission — see docs/mobile-shell.md.
 *
 * NOT wired into any npm script or postbuild guard — this is a one-off dev utility. Re-run after
 * editing this file to regenerate:
 *   node scripts/generate-pwa-icons.mjs
 *
 * Uses `pngjs` (already a devDependency — scripts/verify-rendered-contrast.mjs already depends on
 * it to READ a screenshot PNG; this script uses the same library's sync WRITE path, so no new
 * dependency is introduced for this build unit).
 */
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Mirrors src/app/tokens.css's `--leaf-600` (seeds `--leaf`) / `--harvest-500` (seeds `--harvest`)
// — the exact two colors globals.css's `.brand-mark` gradient uses. Kept in sync by eye; if those
// token values ever change, update these two lines to match.
const LEAF = [0x2f, 0x6b, 0x4f]; // #2f6b4f
const HARVEST = [0xc8, 0x85, 0x2c]; // #c8852c
const WHITE = [0xff, 0xff, 0xff];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

// Approximates CSS `linear-gradient(135deg, ...)` (a top-left -> bottom-right diagonal) closely
// enough for a placeholder raster — exact CSS gradient-angle trig isn't warranted here.
function gradientColor(px, py, size) {
  const t = Math.min(1, Math.max(0, (px + py) / (2 * (size - 1))));
  return [
    lerp(LEAF[0], HARVEST[0], t),
    lerp(LEAF[1], HARVEST[1], t),
    lerp(LEAF[2], HARVEST[2], t),
  ];
}

// Standard rounded-rect point-in-shape test: true everywhere except the four corner boxes, where
// it falls back to a distance-to-corner-center check against radius `r`.
function insideRoundedRect(px, py, size, r) {
  if (r <= 0) return true;
  const inCornerX = px < r || px >= size - r;
  const inCornerY = py < r || py >= size - r;
  if (!inCornerX || !inCornerY) return true;
  const ccx = px < r ? r : size - r - 1;
  const ccy = py < r ? r : size - r - 1;
  const dx = px - ccx;
  const dy = py - ccy;
  return dx * dx + dy * dy <= r * r;
}

// The "H" glyph, as a fraction of icon size — mirrors the proportions of the hand-authored
// src/app/icon.svg 64x64 viewBox (leftBar x18 w7 y16 h32 / rightBar x39 w7 / crossBar y29 h7).
// Farthest glyph corner from icon-center is ~0.33 of the icon's half-size, comfortably inside the
// maskable-icon spec's 80% ("0.4 of half-size") safe zone — no extra shrink needed for the
// maskable variant.
const GLYPH = {
  barWidth: 7 / 64,
  leftX: 18 / 64,
  rightX: 39 / 64,
  top: 16 / 64,
  height: 32 / 64,
  crossY: 29 / 64,
  crossHeight: 7 / 64,
};

function insideGlyph(px, py, size) {
  const bw = GLYPH.barWidth * size;
  const leftX = GLYPH.leftX * size;
  const rightX = GLYPH.rightX * size;
  const top = GLYPH.top * size;
  const bottom = top + GLYPH.height * size;
  const crossTop = GLYPH.crossY * size;
  const crossBottom = crossTop + GLYPH.crossHeight * size;

  const inLeftBar = px >= leftX && px < leftX + bw && py >= top && py < bottom;
  const inRightBar = px >= rightX && px < rightX + bw && py >= top && py < bottom;
  const inCrossBar = px >= leftX && px < rightX + bw && py >= crossTop && py < crossBottom;
  return inLeftBar || inRightBar || inCrossBar;
}

/**
 * @param {{ size: number, cornerRadiusRatio: number, fullBleed?: boolean, outPath: string }} opts
 */
function renderIcon({ size, cornerRadiusRatio, fullBleed = false, outPath }) {
  const png = new PNG({ width: size, height: size });
  const r = Math.round(size * cornerRadiusRatio);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const inShape = fullBleed || insideRoundedRect(x, y, size, r);

      if (!inShape) {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
        continue;
      }

      const isGlyph = insideGlyph(x, y, size);
      const [cr, cg, cb] = isGlyph ? WHITE : gradientColor(x, y, size);
      png.data[idx] = cr;
      png.data[idx + 1] = cg;
      png.data[idx + 2] = cb;
      png.data[idx + 3] = 255;
    }
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, PNG.sync.write(png));
  console.log(`wrote ${path.relative(ROOT, outPath)} (${size}x${size})`);
}

// "any" purpose icons — rounded square, same corner ratio as the live .brand-mark (14/42).
renderIcon({
  size: 192,
  cornerRadiusRatio: 14 / 42,
  outPath: path.join(ROOT, 'public/icons/icon-192.png'),
});
renderIcon({
  size: 512,
  cornerRadiusRatio: 14 / 42,
  outPath: path.join(ROOT, 'public/icons/icon-512.png'),
});
// "maskable" purpose icon — full-bleed square, no baked-in rounding/transparency (the OS applies
// its own mask shape at install time); same glyph, already inside the safe zone (see GLYPH above).
renderIcon({
  size: 512,
  cornerRadiusRatio: 0,
  fullBleed: true,
  outPath: path.join(ROOT, 'public/icons/icon-512-maskable.png'),
});
// Apple touch icon — plain full-bleed square (no baked-in rounding: iOS applies its own corner
// mask/shadow, and a pre-rounded source would double-round under that mask).
renderIcon({
  size: 180,
  cornerRadiusRatio: 0,
  fullBleed: true,
  outPath: path.join(ROOT, 'src/app/apple-icon.png'),
});
