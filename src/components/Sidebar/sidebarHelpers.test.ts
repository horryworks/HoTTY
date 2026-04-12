import { describe, it, expect } from 'vitest';
import { sidebarPaneId } from './sidebarHelpers';

describe('sidebarPaneId', () => {
  it('prefixes the edge with "bar-"', () => {
    expect(sidebarPaneId('left')).toBe('bar-left');
    expect(sidebarPaneId('right')).toBe('bar-right');
    expect(sidebarPaneId('top')).toBe('bar-top');
    expect(sidebarPaneId('bottom')).toBe('bar-bottom');
  });
});
