import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SESSION_DRAG_TYPE, beginSessionDrag, endSessionDrag } from './sessionDrag';
import { useUiOverlayStore } from '../stores/uiOverlayStore';

function makeDataTransfer() {
  return { effectAllowed: 'none', setData: vi.fn() } as unknown as DataTransfer;
}

describe('sessionDrag', () => {
  beforeEach(() => {
    useUiOverlayStore.setState({ sessionDragging: false });
  });

  it('puts the tab id on the drag under the session type and as plain text', () => {
    const dt = makeDataTransfer();
    beginSessionDrag(dt, 'tab-1');
    expect(dt.effectAllowed).toBe('move');
    expect(dt.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 'tab-1');
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 'tab-1');
  });

  it('hides web views while the drag runs and shows them again when it ends', () => {
    beginSessionDrag(makeDataTransfer(), 'tab-1');
    expect(useUiOverlayStore.getState().sessionDragging).toBe(true);
    endSessionDrag();
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
  });
});
