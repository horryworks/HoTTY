import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabContextMenu, type TabContextMenuState } from './TabContextMenu';

function makeMenu(overrides: Partial<TabContextMenuState> = {}): TabContextMenuState {
  return {
    tabId: 's1',
    kind: 'session',
    isWebBrowser: false,
    isSshOrTelnet: true,
    isWatching: false,
    fixedSize: false,
    ptyCols: 80,
    x: 120,
    y: 40,
    ...overrides,
  };
}

type MenuProps = Partial<ComponentProps<typeof TabContextMenu>> & { menu?: TabContextMenuState };

function renderMenu({ menu = makeMenu(), onClose = vi.fn(), ...rest }: MenuProps = {}) {
  const utils = render(<TabContextMenu menu={menu} onClose={onClose} {...rest} />);
  return { ...utils, onClose };
}

describe('TabContextMenu', () => {
  it('opens at the pointer position', () => {
    renderMenu({ menu: makeMenu({ x: 200, y: 75 }) });
    const el = screen.getByRole('menu');
    expect(el.style.left).toBe('200px');
    expect(el.style.top).toBe('75px');
  });

  it('offers "AI Watch" on an unwatched terminal and runs it with the tab id, then closes', () => {
    const onToggleWatch = vi.fn();
    const { onClose } = renderMenu({ onToggleWatch });
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI Watch' }));
    expect(onToggleWatch).toHaveBeenCalledWith('s1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers "Stop AI Watch" on a watched terminal', () => {
    renderMenu({ menu: makeMenu({ isWatching: true }), onToggleWatch: vi.fn() });
    expect(screen.getByRole('menuitem', { name: 'Stop AI Watch' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'AI Watch' })).toBeNull();
  });

  it('runs "Watch in the AI Chat window" with the tab id', () => {
    const onWatchInAiWindow = vi.fn();
    renderMenu({ onWatchInAiWindow });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Watch in the AI Chat window' }));
    expect(onWatchInAiWindow).toHaveBeenCalledWith('s1');
  });

  it('offers Save to Host Tree only for SSH / Telnet terminals', () => {
    const onSaveToHostTree = vi.fn();
    const { unmount } = renderMenu({ onSaveToHostTree });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save to Host Tree…' }));
    expect(onSaveToHostTree).toHaveBeenCalledWith('s1');
    unmount();

    renderMenu({ menu: makeMenu({ isSshOrTelnet: false }), onSaveToHostTree });
    expect(screen.queryByRole('menuitem', { name: 'Save to Host Tree…' })).toBeNull();
  });

  it('shows the fixed-width toggle with the pinned column count and its checked state', () => {
    const onToggleFixedSize = vi.fn();
    const { unmount } = renderMenu({ onToggleFixedSize });
    const off = screen.getByRole('menuitemcheckbox');
    expect(off.textContent).toContain('Fixed width (80)');
    expect(off.textContent).not.toContain('✓');
    expect(off.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(off);
    expect(onToggleFixedSize).toHaveBeenCalledWith('s1');
    unmount();

    renderMenu({ menu: makeMenu({ fixedSize: true, ptyCols: 132 }), onToggleFixedSize });
    const on = screen.getByRole('menuitemcheckbox');
    expect(on.textContent).toContain('✓ Fixed width (132)');
    expect(on.getAttribute('aria-checked')).toBe('true');
  });

  it('hides the fixed-width toggle until the pinned width is known', () => {
    renderMenu({ menu: makeMenu({ ptyCols: undefined }), onToggleFixedSize: vi.fn() });
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('shows the fixed-width toggle for a pinned width of 0 cols (only a missing width hides it)', () => {
    renderMenu({ menu: makeMenu({ ptyCols: 0 }), onToggleFixedSize: vi.fn() });
    expect(screen.getByRole('menuitemcheckbox').textContent).toContain('Fixed width (0)');
  });

  it('shows no terminal items on a feature tab, even when their handlers are present', () => {
    renderMenu({
      menu: makeMenu({ kind: 'feature', tabId: 'f1' }),
      onToggleWatch: vi.fn(),
      onWatchInAiWindow: vi.fn(),
      onSaveToHostTree: vi.fn(),
      onToggleFixedSize: vi.fn(),
    });
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('offers Add Bookmark on a Web Browser tab and runs it with the tab id', () => {
    const onBookmark = vi.fn();
    renderMenu({
      menu: makeMenu({ kind: 'feature', tabId: 'web-1', isWebBrowser: true, isSshOrTelnet: false }),
      onBookmark,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Bookmark…' }));
    expect(onBookmark).toHaveBeenCalledWith('web-1');
  });

  it('leaves out items whose handler is not given', () => {
    renderMenu();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('closes on Escape and on a press outside, but not on a press inside', () => {
    const { onClose } = renderMenu({ onToggleWatch: vi.fn() });
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'AI Watch' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
