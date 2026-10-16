import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaneHeader } from './PaneHeader';
import { useUiOverlayStore } from '../../stores/uiOverlayStore';

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    effectAllowed: 'none',
    setData: vi.fn((type: string, value: string) => { data[type] = value; }),
    getData: (type: string) => data[type] ?? '',
    data,
  };
}

describe('PaneHeader', () => {
  it('shows the pane mark and the title, and the close button sits at the far right', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PaneHeader paneId="0" paneNumber={1} title="AI Chat" actions={<button className="extra">x</button>} onClose={onClose} />
    );
    expect(container.querySelector('.pane-badge')?.textContent).toBe('1');
    expect(screen.getByText('AI Chat')).toBeTruthy();
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.className);
    expect(buttons).toEqual(['extra', 'pane-term-close']);
    fireEvent.click(container.querySelector('.pane-term-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is not draggable without a tab to carry', () => {
    const { container } = render(<PaneHeader paneId="0" paneNumber={1} title="t" onClose={() => {}} />);
    expect(container.querySelector('.pane-term-header')?.getAttribute('draggable')).toBe('false');
  });

  it('dragging the header carries the tab and hides web views until the drag ends', () => {
    useUiOverlayStore.setState({ sessionDragging: false });
    const { container } = render(
      <PaneHeader paneId="0" paneNumber={1} title="t" onClose={() => {}} dragSessionId="s1" />
    );
    const header = container.querySelector('.pane-term-header')!;
    expect(header.getAttribute('draggable')).toBe('true');
    const dt = makeDataTransfer();
    fireEvent.dragStart(header, { dataTransfer: dt });
    expect(dt.data['application/x-hotty-session']).toBe('s1');
    expect(dt.effectAllowed).toBe('move');
    expect(useUiOverlayStore.getState().sessionDragging).toBe(true);
    fireEvent.dragEnd(header, { dataTransfer: dt });
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
  });

  it('a drag that starts on a button does not move the pane', () => {
    useUiOverlayStore.setState({ sessionDragging: false });
    const { container } = render(
      <PaneHeader paneId="0" paneNumber={1} title="t" onClose={() => {}} dragSessionId="s1" />
    );
    const dt = makeDataTransfer();
    const notCancelled = fireEvent.dragStart(container.querySelector('.pane-term-close')!, { dataTransfer: dt });
    expect(notCancelled).toBe(false);
    expect(dt.setData).not.toHaveBeenCalled();
    expect(useUiOverlayStore.getState().sessionDragging).toBe(false);
  });
});
