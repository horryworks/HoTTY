import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabStrip } from './TabStrip';
import type { ChatTab } from '../../hooks/useAiChat';

function makeTab(id: string, title: string, ordinal: number): ChatTab {
  return { id, title, ordinal };
}

describe('TabStrip', () => {
  const baseTabs: ChatTab[] = [
    makeTab('t1', 'Router1', 1),
    makeTab('t2', 'Tab 2', 2),
  ];

  it('renders all tab titles', () => {
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t1"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    expect(screen.getByText('Router1')).toBeTruthy();
    expect(screen.getByText('Tab 2')).toBeTruthy();
  });

  it('marks the active tab with aria-selected="true"', () => {
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t2"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    const t1 = screen.getByText('Router1').closest('[role="tab"]');
    const t2 = screen.getByText('Tab 2').closest('[role="tab"]');
    expect(t1?.getAttribute('aria-selected')).toBe('false');
    expect(t2?.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onSelect when a tab is clicked', () => {
    const onSelect = vi.fn();
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t1"
        onSelect={onSelect}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Tab 2'));
    expect(onSelect).toHaveBeenCalledWith('t2');
  });

  it('calls onClose when close button clicked, without triggering onSelect', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t1"
        onSelect={onSelect}
        onClose={onClose}
        onAdd={() => {}}
      />
    );
    const closeButtons = screen.getAllByLabelText(/Close/);
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith('t2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides close buttons when only one tab is present', () => {
    render(
      <TabStrip
        tabs={[makeTab('only', 'Only', 1)]}
        activeTabId="only"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    expect(screen.queryAllByLabelText(/Close/)).toHaveLength(0);
  });

  it('calls onAdd when the + button is clicked', () => {
    const onAdd = vi.fn();
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t1"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={onAdd}
      />
    );
    fireEvent.click(screen.getByLabelText('Add tab'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('Enter key on a tab triggers onSelect', () => {
    const onSelect = vi.fn();
    render(
      <TabStrip
        tabs={baseTabs}
        activeTabId="t1"
        onSelect={onSelect}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    const t2 = screen.getByText('Tab 2').closest('[role="tab"]')!;
    fireEvent.keyDown(t2, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('t2');
  });
});
