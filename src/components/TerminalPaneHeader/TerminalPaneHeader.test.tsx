import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalPaneHeader } from './TerminalPaneHeader';

const session = {
  id: 's-1',
  displayName: 'sw-01',
  protocol: 'ssh' as const,
  connectionConfig: { host: '192.0.2.10' } as never,
};

describe('TerminalPaneHeader', () => {
  it('shows the pane mark, the name and the target in one row, with no state dot', () => {
    const { container } = render(<TerminalPaneHeader paneId="1" session={session} onClose={() => {}} />);
    expect(container.querySelector('.pane-term-header .pane-badge')?.textContent).toBe('2');
    expect(screen.getByText('sw-01')).toBeTruthy();
    expect(screen.getByText('SSH · 192.0.2.10')).toBeTruthy();
    expect(container.querySelector('.pane-term-dot')).toBeNull();
  });

  it('has the AI link button, then the close button at the far right', () => {
    const onClose = vi.fn();
    const onToggleWatch = vi.fn();
    const { container } = render(
      <TerminalPaneHeader paneId="0" session={session} onClose={onClose} onToggleWatch={onToggleWatch} />
    );
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.className);
    expect(buttons).toEqual(['tab-watch-btn', 'pane-term-close']);
    fireEvent.click(container.querySelector('.pane-term-close')!);
    expect(onClose).toHaveBeenCalledWith('s-1');
    fireEvent.click(container.querySelector('.tab-watch-btn')!);
    expect(onToggleWatch).toHaveBeenCalledWith('s-1');
  });

  it('with two conversations the AI link button asks which one', () => {
    const onToggleWatch = vi.fn();
    const onWatchInConversation = vi.fn();
    const { container } = render(
      <TerminalPaneHeader
        paneId="0"
        session={session}
        onClose={() => {}}
        onToggleWatch={onToggleWatch}
        conversations={[
          { id: 'c1', title: 'Chat A', colorIndex: 0 },
          { id: 'c2', title: 'Chat B', colorIndex: 1 },
        ]}
        onWatchInConversation={onWatchInConversation}
      />
    );
    fireEvent.click(container.querySelector('.tab-watch-btn')!);
    expect(onToggleWatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Chat B'));
    expect(onWatchInConversation).toHaveBeenCalledWith('s-1', 'c2');
  });

  it('without AI Chat there is no AI link button', () => {
    const { container } = render(<TerminalPaneHeader paneId="0" session={session} onClose={() => {}} />);
    expect(container.querySelector('.tab-watch-btn')).toBeNull();
  });
});
