import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AppSidebarTop, AppSidebarBottom } from './AppSidebar';
import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { tauriService } from '../../services/tauriService';

describe('AppSidebarTop', () => {
  beforeEach(() => {
    usePaneStore.setState({ layoutMode: '1x1' });
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
    });
  });

  it('renders a layout button for each layout mode and marks the active one', () => {
    render(<AppSidebarTop />);
    const activeBtns = document.querySelectorAll('.app-sidebar-btn-active');
    expect(activeBtns.length).toBe(1);
    expect(activeBtns[0].getAttribute('title')).toContain('Single');
  });

  it('clicking a layout button updates paneStore.layoutMode', () => {
    render(<AppSidebarTop />);
    fireEvent.click(screen.getByTitle('Grid (2x2)'));
    expect(usePaneStore.getState().layoutMode).toBe('2x2');
  });

  it('clicking an edge button toggles that sidebar flag', () => {
    render(<AppSidebarTop />);
    fireEvent.click(screen.getByTitle('Toggle Left Sidebar'));
    expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    fireEvent.click(screen.getByTitle('Toggle Bottom Bar'));
    expect(useSidebarLayoutStore.getState().showBottomBar).toBe(true);
  });

  it('collapsed, it shows one button per group and opens the choices in a menu', () => {
    render(<AppSidebarTop collapsed />);
    expect(screen.queryByTitle('Grid (2x2)')).toBeNull();

    fireEvent.click(screen.getByTitle('Pane layout'));
    const layouts = screen.getByRole('group', { name: 'Pane layout' });
    fireEvent.click(within(layouts).getByTitle('Grid (2x2)'));
    expect(usePaneStore.getState().layoutMode).toBe('2x2');
    // Picking a layout closes the menu.
    expect(screen.queryByRole('group', { name: 'Pane layout' })).toBeNull();

    fireEvent.click(screen.getByTitle('Toggle bars'));
    const bars = screen.getByRole('group', { name: 'Toggle bars' });
    fireEvent.click(within(bars).getByTitle('Toggle Left Sidebar'));
    fireEvent.click(within(bars).getByTitle('Toggle Top Bar'));
    // Bars can be toggled one after another without reopening.
    expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    expect(useSidebarLayoutStore.getState().showTopBar).toBe(true);
  });
});

describe('AppSidebarBottom', () => {
  beforeEach(() => {
    useSettingsStore.getState().update('lineWrapEnabled', false);
  });

  it('Settings button invokes the onOpenSettings callback', () => {
    const onOpenSettings = vi.fn();
    render(<AppSidebarBottom onOpenSettings={onOpenSettings} onOpenHelp={() => {}} />);
    fireEvent.click(screen.getByTitle('Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('New Window button invokes tauriService.createWindow', () => {
    const spy = vi.spyOn(tauriService, 'createWindow').mockResolvedValue('win-1');
    render(<AppSidebarBottom onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.click(screen.getByTitle('New Window (Ctrl+Shift+N)'));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('Help button invokes the onOpenHelp callback', () => {
    const onOpenHelp = vi.fn();
    render(<AppSidebarBottom onOpenSettings={() => {}} onOpenHelp={onOpenHelp} />);
    fireEvent.click(screen.getByTitle('Help / Documentation'));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it('toggles lineWrapEnabled on line wrap button click', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    render(<AppSidebarBottom onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    fireEvent.click(screen.getByTitle('Disable Line Wrap'));
    expect(useSettingsStore.getState().lineWrapEnabled).toBe(false);
    fireEvent.click(screen.getByTitle('Enable Line Wrap'));
    expect(useSettingsStore.getState().lineWrapEnabled).toBe(true);
  });

  it('shows active state on line wrap button when lineWrapEnabled is true', () => {
    useSettingsStore.getState().update('lineWrapEnabled', true);
    render(<AppSidebarBottom onOpenSettings={() => {}} onOpenHelp={() => {}} />);
    const btn = screen.getByTitle('Disable Line Wrap');
    expect(btn.classList.contains('app-sidebar-btn-active')).toBe(true);
  });
});
