import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { useSidebarLayoutStore } from '../../stores/sidebarLayoutStore';

describe('Sidebar', () => {
  beforeEach(() => {
    useSidebarLayoutStore.setState({
      showLeftSidebar: false,
      showRightSidebar: false,
      showTopBar: false,
      showBottomBar: false,
      leftSidebarPercent: 20,
      rightSidebarPercent: 20,
      topBarPercent: 20,
      bottomBarPercent: 20,
    });
  });

  it('renders nothing when the edge is not visible', () => {
    const { container } = render(<Sidebar edge="left">content</Sidebar>);
    expect(container.firstChild).toBeNull();
  });

  it('renders children when the edge is visible', () => {
    useSidebarLayoutStore.setState({ showLeftSidebar: true });
    render(
      <Sidebar edge="left">
        <span>inside</span>
      </Sidebar>
    );
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('applies width for left/right and height for top/bottom', () => {
    useSidebarLayoutStore.setState({
      showLeftSidebar: true,
      showTopBar: true,
      leftSidebarPercent: 30,
      topBarPercent: 25,
    });
    const { container, rerender } = render(<Sidebar edge="left">x</Sidebar>);
    const leftEl = container.querySelector('.sidebar') as HTMLElement;
    expect(leftEl.style.width).toBe('30%');
    expect(leftEl.style.height).toBe('');

    rerender(<Sidebar edge="top">x</Sidebar>);
    const topEl = container.querySelector('.sidebar') as HTMLElement;
    expect(topEl.style.height).toBe('25%');
    expect(topEl.style.width).toBe('');
  });
});
