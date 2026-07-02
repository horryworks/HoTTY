import { describe, it, expect } from 'vitest';
import {
  ZOOM_STEPS,
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  nextZoom,
  prevZoom,
  canZoomIn,
  canZoomOut,
} from './webBrowserZoom';

describe('clampZoom', () => {
  it('clamps into [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(9999)).toBe(MAX_ZOOM);
  });

  it('rounds fractional input and defaults NaN to 100', () => {
    expect(clampZoom(133.4)).toBe(133);
    expect(clampZoom(Number.NaN)).toBe(100);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe('nextZoom / prevZoom', () => {
  it('walks the ladder one step at a time', () => {
    expect(nextZoom(100)).toBe(110);
    expect(prevZoom(100)).toBe(90);
    expect(nextZoom(90)).toBe(100);
    expect(prevZoom(110)).toBe(100);
  });

  it('clamps at the ends', () => {
    expect(nextZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(prevZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(nextZoom(9999)).toBe(MAX_ZOOM);
    expect(prevZoom(0)).toBe(MIN_ZOOM);
  });

  it('snaps an off-ladder value to the next step in each direction', () => {
    // 105 is between 100 and 110 (both on the ladder).
    expect(nextZoom(105)).toBe(110);
    expect(prevZoom(105)).toBe(100);
    // 100 IS on the ladder → strictly next/prev distinct steps.
    expect(nextZoom(100)).not.toBe(100);
    expect(prevZoom(100)).not.toBe(100);
  });

  it('every produced value is a member of ZOOM_STEPS', () => {
    for (const start of [12, 25, 63, 100, 260, 480, 700]) {
      expect(ZOOM_STEPS).toContain(nextZoom(start));
      expect(ZOOM_STEPS).toContain(prevZoom(start));
    }
  });
});

describe('canZoomIn / canZoomOut', () => {
  it('is false only at the respective bound', () => {
    expect(canZoomIn(MAX_ZOOM)).toBe(false);
    expect(canZoomIn(MAX_ZOOM - 1)).toBe(true);
    expect(canZoomOut(MIN_ZOOM)).toBe(false);
    expect(canZoomOut(MIN_ZOOM + 1)).toBe(true);
    expect(canZoomIn(100)).toBe(true);
    expect(canZoomOut(100)).toBe(true);
  });
});
