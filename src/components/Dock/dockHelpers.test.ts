import { describe, it, expect } from 'vitest';
import { dockMenuPlacement } from './dockHelpers';

describe('dockMenuPlacement', () => {
  it('unfolds downward from a dock on the top edge', () => {
    expect(dockMenuPlacement('top', false)).toBe('down');
    expect(dockMenuPlacement('top', true)).toBe('down');
  });

  it('unfolds upward from a dock on the bottom edge', () => {
    expect(dockMenuPlacement('bottom', false)).toBe('up');
    expect(dockMenuPlacement('bottom', true)).toBe('up');
  });

  it('unfolds downward from a full-width side dock', () => {
    expect(dockMenuPlacement('left', false)).toBe('down');
    expect(dockMenuPlacement('right', false)).toBe('down');
  });

  it('unfolds away from the window edge when a side dock is compact', () => {
    expect(dockMenuPlacement('left', true)).toBe('right');
    expect(dockMenuPlacement('right', true)).toBe('left');
  });
});
