import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppSidebar } from './AppSidebar';
import { usePaneStore } from '../../stores/paneStore';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';
import { useSettingsStore } from '../../stores/settingsStore';

describe('AppSidebar', () => {
  beforeEach(() => {
    usePaneStore.setState({ layoutMode: '1x1' });
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
    });
    useSettingsStore.getState().update('sidebarPosition', 'left');
  });

  it('renders a layout button for each layout mode and marks the active one', () => {
    render(<AppSidebar onOpenSettings={() => {}} />);
    const activeBtns = document.querySelectorAll('.app-sidebar-btn-active');
    expect(activeBtns.length).toBe(1);
    expect(activeBtns[0].getAttribute('title')).toContain('Single');
  });

  it('clicking a layout button updates paneStore.layoutMode', () => {
    render(<AppSidebar onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByTitle('Grid (2x2)'));
    expect(usePaneStore.getState().layoutMode).toBe('2x2');
  });

  it('clicking an edge button toggles that sidebar flag', () => {
    render(<AppSidebar onOpenSettings={() => {}} />);
    fireEvent.click(screen.getByTitle('Toggle Left Sidebar'));
    expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    fireEvent.click(screen.getByTitle('Toggle Bottom Bar'));
    expect(useSidebarLayoutStore.getState().showBottomBar).toBe(true);
  });

  it('Settings button invokes the onOpenSettings callback', () => {
    const onOpenSettings = vi.fn();
    render(<AppSidebar onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByTitle('Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('applies the right-side class when sidebarPosition is "right"', () => {
    useSettingsStore.getState().update('sidebarPosition', 'right');
    const { container } = render(<AppSidebar onOpenSettings={() => {}} />);
    expect(container.querySelector('.app-sidebar-right')).not.toBeNull();
  });
});
