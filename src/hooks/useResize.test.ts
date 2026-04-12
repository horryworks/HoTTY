import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResize } from './useResize';

describe('useResize', () => {
  it('starts with isResizing false', () => {
    const onMove = () => {};
    const { result } = renderHook(() => useResize({ onMove }));
    expect(result.current.isResizing).toBe(false);
  });

  it('returns a startResize function', () => {
    const onMove = () => {};
    const { result } = renderHook(() => useResize({ onMove }));
    expect(typeof result.current.startResize).toBe('function');
  });

  it('sets isResizing true on startResize and false on mouseup', () => {
    const onMove = () => {};
    const { result } = renderHook(() => useResize({ onMove }));

    act(() => {
      result.current.startResize({
        clientX: 100,
        clientY: 100,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.MouseEvent);
    });
    expect(result.current.isResizing).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(result.current.isResizing).toBe(false);
  });
});
