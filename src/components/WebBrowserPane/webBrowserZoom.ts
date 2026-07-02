/**
 * Pure zoom helpers for the Web Browser pane (no React / Tauri deps, unit-tested).
 *
 * Zoom is expressed as an integer percentage. The `−`/`+` stepper walks a fixed
 * ladder of levels (Chrome-like) rather than a fixed increment, so the steps feel
 * natural across the whole 25–500% range. The bounds mirror the backend's
 * `clamp_zoom_percent` (see `services/web_browser.rs`).
 */

/** Discrete zoom levels the `−`/`+` stepper walks through (percent). */
export const ZOOM_STEPS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const;

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Clamp an arbitrary percentage into the supported range. */
export function clampZoom(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(percent)));
}

/** Next larger zoom step (clamped at MAX_ZOOM). Snaps off-ladder values up. */
export function nextZoom(current: number): number {
  const p = clampZoom(current);
  for (const step of ZOOM_STEPS) {
    if (step > p) return step;
  }
  return MAX_ZOOM;
}

/** Next smaller zoom step (clamped at MIN_ZOOM). Snaps off-ladder values down. */
export function prevZoom(current: number): number {
  const p = clampZoom(current);
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < p) return ZOOM_STEPS[i];
  }
  return MIN_ZOOM;
}

/** True when zooming in is still possible from `current`. */
export function canZoomIn(current: number): boolean {
  return clampZoom(current) < MAX_ZOOM;
}

/** True when zooming out is still possible from `current`. */
export function canZoomOut(current: number): boolean {
  return clampZoom(current) > MIN_ZOOM;
}
