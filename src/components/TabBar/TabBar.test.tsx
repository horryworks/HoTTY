import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBar } from './TabBar';
import type { SessionRecord } from '../../hooks/useSessionManager';

function makeSession(id: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id,
    displayName: `Session ${id}`,
    protocol: 'ssh',
    status: 'connected',
    errorMessage: undefined,
    term: {} as SessionRecord['term'],
    fitAddon: {} as SessionRecord['fitAddon'],
    ...overrides,
  };
}

describe('TabBar', () => {
  it('renders one tab per session and marks the active one', () => {
    const sessions = [makeSession('a'), makeSession('b')];
    const { container } = render(
      <TabBar
        sessions={sessions}
        activeSessionId="b"
        visibleSessionIds={['a', 'b']}
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
        onReorder={() => {}}
      />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs.length).toBe(2);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[0].classList.contains('active')).toBe(false);
  });

  it('adds hidden-tab class for sessions not in visibleSessionIds', () => {
    const { container } = render(
      <TabBar
        sessions={[makeSession('a'), makeSession('b')]}
        activeSessionId={null}
        visibleSessionIds={['a']}
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
        onReorder={() => {}}
      />
    );
    const tabs = container.querySelectorAll('.tab');
    expect(tabs[0].classList.contains('hidden-tab')).toBe(false);
    expect(tabs[1].classList.contains('hidden-tab')).toBe(true);
  });

  it('clicking a tab selects it, and the close button stops propagation', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <TabBar
        sessions={[makeSession('a')]}
        activeSessionId={null}
        visibleSessionIds={['a']}
        onSelect={onSelect}
        onClose={onClose}
        onNew={() => {}}
        onReorder={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Session a'));
    expect(onSelect).toHaveBeenCalledWith('a');

    fireEvent.click(screen.getByLabelText('Close session'));
    expect(onClose).toHaveBeenCalledWith('a');
    // onSelect should not have fired a second time because stopPropagation was called
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('new-tab button invokes onNew', () => {
    const onNew = vi.fn();
    render(
      <TabBar
        sessions={[]}
        activeSessionId={null}
        visibleSessionIds={[]}
        onSelect={() => {}}
        onClose={() => {}}
        onNew={onNew}
        onReorder={() => {}}
      />
    );
    fireEvent.click(screen.getByTitle('New Session'));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
