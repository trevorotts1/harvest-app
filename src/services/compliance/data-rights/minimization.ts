import { MINIMIZATION_ALLOWLIST, MinimizationSurface } from '../../../types/data-rights';

/**
 * Data minimization (T-11, master-spec §16.3 "Minimization:").
 *
 * "Collect only what onboarding needs; contact data is the user's property, never mined for
 * platform benefit or sold." This module gives every collection surface a hard allowlist and a
 * helper that strips anything outside it before the payload is persisted. It is intentionally a
 * pure, dependency-free utility (no Prisma import) so it can sit in front of any WP's write path
 * — onboarding (WP01), contact import (WP02), agent-log capture (WP04) — without this build unit
 * reaching into those WPs' own files.
 */

export interface MinimizationResult<T extends Record<string, unknown>> {
  minimized: Partial<T>;
  /** Field names present on the input but not on the surface's allowlist — dropped. */
  droppedFields: string[];
}

/**
 * Strip any field not on the given surface's allowlist. Returns both the minimized object and
 * the list of dropped field names, so callers can log/alert on unexpected over-collection instead
 * of silently discarding it.
 */
export function enforceMinimization<T extends Record<string, unknown>>(
  surface: MinimizationSurface,
  payload: T
): MinimizationResult<T> {
  const allowed = new Set<string>(MINIMIZATION_ALLOWLIST[surface]);
  const minimized: Partial<T> = {};
  const droppedFields: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key)) {
      (minimized as Record<string, unknown>)[key] = value;
    } else {
      droppedFields.push(key);
    }
  }

  return { minimized, droppedFields };
}

/** True if every field on `payload` is within the surface's minimization allowlist. */
export function isMinimized(surface: MinimizationSurface, payload: Record<string, unknown>): boolean {
  const allowed = new Set<string>(MINIMIZATION_ALLOWLIST[surface]);
  return Object.keys(payload).every((key) => allowed.has(key));
}

/** The declared allowlist for a surface, for documentation/introspection surfaces (e.g. a privacy-policy generator). */
export function allowlistFor(surface: MinimizationSurface): readonly string[] {
  return MINIMIZATION_ALLOWLIST[surface];
}
