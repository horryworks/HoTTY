import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabRow } from './TabRow';
import type { TabItem } from './tabBarHelpers';

function makeTabItem(id: string, overrides: Partial<TabItem> = {}): TabItem {
  return {
    id,
    displayName: `Session ${id}`,
    kind: 'session',
    status: 'connected',
    protocol: 'ssh',
    detail: 'SSH · sw-01.example.com',
    ...overrides,
  };
}

type RowProps = Partial<ComponentProps<typeof TabRow>>;

function renderRow(props: RowProps = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onContextMenu: vi.fn(),
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
  };
  const item = props.item ?? makeTabItem('s1');
  const utils = render(
    <TabRow item={item} label={item.displayName ?? item.id} paneId="0" paneNumber={1} isActive={false} {...handlers} {...props} />
  );
  const row = utils.container.querySelector<HTMLElement>('.tab[data-session-id]')!;
  return { ...utils, ...handlers, row, item };
}

describe('TabRow', () => {
  it('shows the name and the connection target, both also in the tooltip', () => {
    const { row } = renderRow();
    expect(row.getAttribute('data-session-id')).toBe('s1');
    expect(row.querySelector('.tab-label')?.textContent).toContain('Session s1');
    expect(row.querySelector('.tab-detail')?.textContent).toContain('SSH · sw-01.example.com');
    expect(row.getAttribute('title')).toBe('Session s1\nSSH · sw-01.example.com');
  });

  it('marks an on-screen tab with its pane number, and a hidden one with its protocol icon', () => {
    const { row, unmount } = renderRow({ paneId: '1', paneNumber: 2 });
    expect(row.querySelector('[data-pane-badge="1"]')?.textContent).toContain('2');
    unmount();

    const hidden = renderRow({ paneId: null, paneNumber: null });
    expect(hidden.row.querySelector('.pane-badge')).toBeNull();
    expect(hidden.row.querySelector('.tab-lead svg')).not.toBeNull();
    expect(Array.from(hidden.row.classList)).toEqual(expect.arrayContaining(['hidden-tab']));
  });

  it('selects the tab on click and closes it with ×, without also selecting it', () => {
    const { row, onSelect, onClose } = renderRow();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('s1');

    onSelect.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onClose).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on a middle click, but not on other auxiliary buttons', () => {
    const { row, onClose } = renderRow();
    fireEvent(row, new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent(row, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith('s1');
  });

  it('passes the item with a right-click', () => {
    const { row, onContextMenu, item } = renderRow();
    fireEvent.contextMenu(row);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][1]).toBe(item);
  });

  it('shows how much output arrived while hidden, with the newest line as the second line', () => {
    const { row } = renderRow({ paneId: null, paneNumber: null, activity: { lines: 12, lastLine: 'sw-01# show version' } });
    expect(row.querySelector('.tab-unread-count')?.textContent).toContain('+12');
    expect(row.querySelector('.tab-detail')?.textContent).toContain('sw-01# show version');
    expect(Array.from(row.querySelector('.tab-detail')?.classList ?? [])).toEqual(expect.arrayContaining(['unread']));
    expect(Array.from(row.querySelector('.tab-state-dot')?.classList ?? [])).toEqual(expect.arrayContaining(['unread']));
  });

  it('ignores activity on a tab that is on screen', () => {
    const { row } = renderRow({ paneId: '0', activity: { lines: 5, lastLine: 'noise' } });
    expect(row.querySelector('.tab-unread-count')).toBeNull();
    expect(row.querySelector('.tab-detail')?.textContent).toContain('SSH · sw-01.example.com');
    expect(Array.from(row.querySelector('.tab-state-dot')?.classList ?? [])).toEqual(expect.arrayContaining(['ok']));
  });

  it('shows the error message in place of the target when the connection failed', () => {
    const { row } = renderRow({
      item: makeTabItem('s1', { status: 'error', errorMessage: 'Connection refused' }),
    });
    expect(Array.from(row.classList)).toEqual(expect.arrayContaining(['error']));
    expect(row.querySelector('.tab-detail')?.textContent).toContain('Connection refused');
    expect(Array.from(row.querySelector('.tab-detail')?.classList ?? [])).toEqual(expect.arrayContaining(['bad']));
    expect(Array.from(row.querySelector('.tab-state-dot')?.classList ?? [])).toEqual(expect.arrayContaining(['bad']));
  });

  it('keeps the target but marks it bad once disconnected', () => {
    const { row } = renderRow({ item: makeTabItem('s1', { status: 'disconnected' }) });
    expect(row.querySelector('.tab-detail')?.textContent).toContain('SSH · sw-01.example.com');
    expect(Array.from(row.querySelector('.tab-detail')?.classList ?? [])).toEqual(expect.arrayContaining(['bad']));
  });

  it("says what kind of pane a feature tab named after its content is, and nothing when it isn't", () => {
    const site = makeTabItem('w1', {
      kind: 'feature',
      featureType: 'web-browser',
      displayName: 'example.com',
      status: undefined,
      detail: undefined,
    });
    const { row, unmount } = renderRow({ item: site, label: 'example.com' });
    expect(row.querySelector('.tab-detail')?.textContent).toContain('Web Browser');
    // Feature tabs carry no connection state.
    expect(row.querySelector('.tab-state-dot')).toBeNull();
    unmount();

    const plain = renderRow({ item: { ...site, displayName: 'Web Browser' }, label: 'Web Browser' });
    expect(plain.row.querySelector('.tab-detail')).toBeNull();
  });

  it("offers the AI link button on terminals only, and passes it the item and the watcher's color", () => {
    const onWatchClick = vi.fn();
    const item = makeTabItem('s1', { isWatching: true, watchColorIndex: 1 });
    const { row, onSelect, unmount } = renderRow({ item, onWatchClick });
    expect(Array.from(row.classList)).toEqual(expect.arrayContaining(['gemini-linked-tab']));
    expect(row.style.getPropertyValue('--tab-watch-color')).toBe('var(--pane-color-2)');
    fireEvent.click(screen.getByRole('button', { name: 'Stop AI Watch' }));
    expect(onWatchClick.mock.calls[0][1]).toBe(item);
    expect(onSelect).not.toHaveBeenCalled();
    unmount();

    renderRow({ item: makeTabItem('f1', { kind: 'feature', featureType: 'ping-monitor' }), onWatchClick });
    expect(screen.queryByRole('button', { name: /AI Watch/ })).toBeNull();
  });

  it('has no AI link button when watching is not available', () => {
    renderRow();
    expect(screen.queryByRole('button', { name: /AI Watch/ })).toBeNull();
  });

  it('marks the active tab and where a drag would drop', () => {
    const { row } = renderRow({ isActive: true, dragOver: 'after' });
    expect(Array.from(row.classList)).toEqual(expect.arrayContaining(['active', 'active-pane-tab', 'drag-over-after']));
  });

  it('wires the drag events to the item', () => {
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    const onDragLeave = vi.fn();
    const { row, item, onDragStart, onDragEnd } = renderRow({ onDragOver, onDrop, onDragLeave });
    expect(row.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(row);
    fireEvent.dragOver(row);
    fireEvent.dragLeave(row);
    fireEvent.drop(row);
    fireEvent.dragEnd(row);
    expect(onDragStart.mock.calls[0][1]).toBe(item);
    expect(onDragOver.mock.calls[0][1]).toBe(item);
    expect(onDrop.mock.calls[0][1]).toBe(item);
    expect(onDragLeave).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('forwards its ref to the row element', () => {
    const ref = { current: null as HTMLDivElement | null };
    const { row } = renderRow({ ref });
    expect(ref.current).toBe(row);
  });
});
