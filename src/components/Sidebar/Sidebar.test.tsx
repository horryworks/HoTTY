import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  describe('drag-to-resize', () => {
    afterEach(() => {
      document.body.style.cursor = '';
      vi.restoreAllMocks();
    });

    const flushRaf = (cbs: FrameRequestCallback[]) => {
      act(() => {
        while (cbs.length) cbs.shift()!(performance.now());
      });
    };

    it('sets body cursor + resizing class on mousedown and clears on mouseup', () => {
      useSidebarLayoutStore.setState({ showLeftSidebar: true });
      const { container } = render(
        <div style={{ width: 1000, height: 500 }}>
          <Sidebar edge="left">x</Sidebar>
        </div>
      );
      const sidebar = container.querySelector('.sidebar') as HTMLElement;
      vi.spyOn(sidebar.parentElement!, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500,
        width: 1000, height: 500, toJSON: () => ({}),
      } as DOMRect);
      const handle = container.querySelector('.sidebar-resize') as HTMLElement;
      fireEvent.mouseDown(handle, { clientX: 200, clientY: 100 });
      expect(document.body.style.cursor).toBe('col-resize');
      expect(handle.className).toContain('resizing');
      fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));
      expect(document.body.style.cursor).toBe('');
    });

    it('updates left sidebar percent from drag deltas and clamps into [5, 80]', () => {
      const rafCb: FrameRequestCallback[] = [];
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rafCb.push(cb);
        return rafCb.length as unknown as number;
      });
      useSidebarLayoutStore.setState({ showLeftSidebar: true, leftSidebarPercent: 20 });
      const { container } = render(
        <div style={{ width: 1000, height: 500 }}>
          <Sidebar edge="left">x</Sidebar>
        </div>
      );
      const sidebar = container.querySelector('.sidebar') as HTMLElement;
      vi.spyOn(sidebar.parentElement!, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500,
        width: 1000, height: 500, toJSON: () => ({}),
      } as DOMRect);
      const handle = container.querySelector('.sidebar-resize') as HTMLElement;

      fireEvent.mouseDown(handle, { clientX: 200, clientY: 100 });
      fireEvent(document, new MouseEvent('mousemove', { clientX: 400, bubbles: true }));
      flushRaf(rafCb);
      expect(useSidebarLayoutStore.getState().leftSidebarPercent).toBe(40);

      // Drag way past 80% → clamp
      fireEvent(document, new MouseEvent('mousemove', { clientX: 990, bubbles: true }));
      flushRaf(rafCb);
      expect(useSidebarLayoutStore.getState().leftSidebarPercent).toBe(80);

      // Drag below 5% → clamp
      fireEvent(document, new MouseEvent('mousemove', { clientX: 10, bubbles: true }));
      flushRaf(rafCb);
      expect(useSidebarLayoutStore.getState().leftSidebarPercent).toBe(5);

      fireEvent(document, new MouseEvent('mouseup', { bubbles: true }));
    });
  });
});
