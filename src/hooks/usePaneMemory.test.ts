import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useState } from 'react';
import { forgetPaneMemory, recallPaneMemory, rememberPaneMemory, useRememberPane } from './usePaneMemory';

describe('usePaneMemory', () => {
  it('gives a remounted pane the value it last had', () => {
    const { unmount } = renderHook(() => {
      const [v] = useState(() => recallPaneMemory('pm-1', 'running', false));
      useRememberPane('pm-1', { running: true });
      return v;
    });
    unmount();
    expect(recallPaneMemory('pm-1', 'running', false)).toBe(true);
  });

  it('forgets a pane when its tab closes, and only that pane', () => {
    rememberPaneMemory('pm-1', 'x', 1);
    rememberPaneMemory('pm-2', 'x', 2);
    forgetPaneMemory('pm-1');
    expect(recallPaneMemory('pm-1', 'x', 0)).toBe(0);
    expect(recallPaneMemory('pm-2', 'x', 0)).toBe(2);
  });
});
