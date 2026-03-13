import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSidebarLayout } from './useSidebarLayout';
import { useSidebarLayoutStore } from '../stores/sidebarLayoutStore';

const DEFAULTS = useSidebarLayoutStore.getState();

beforeEach(() => {
    useSidebarLayoutStore.setState(DEFAULTS, true);
    localStorage.clear();
});

afterEach(() => {
    // Clean up any event listeners
    document.body.style.cursor = '';
});

describe('useSidebarLayout — initial state', () => {
    it('returns showLeftSidebar from the store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.showLeftSidebar).toBe(false);
    });

    it('returns showRightSidebar from the store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.showRightSidebar).toBe(false);
    });

    it('returns showTopBar from the store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.showTopBar).toBe(false);
    });

    it('returns showBottomBar from the store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.showBottomBar).toBe(false);
    });

    it('returns leftSidebarPercent from the store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.leftSidebarPercent).toBe(20);
    });

    it('resizingSide is null initially', () => {
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.resizingSide).toBeNull();
    });
});

describe('useSidebarLayout — visibility setters', () => {
    it('setShowLeftSidebar updates store and re-renders', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.setShowLeftSidebar(true));
        expect(result.current.showLeftSidebar).toBe(true);
        expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    });

    it('setShowRightSidebar updates store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.setShowRightSidebar(true));
        expect(result.current.showRightSidebar).toBe(true);
    });

    it('setShowTopBar updates store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.setShowTopBar(true));
        expect(result.current.showTopBar).toBe(true);
    });

    it('setShowBottomBar updates store', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.setShowBottomBar(true));
        expect(result.current.showBottomBar).toBe(true);
    });
});

describe('useSidebarLayout — percent values reflect store', () => {
    it('leftSidebarPercent updates when store changes', () => {
        useSidebarLayoutStore.getState().setLeftSidebarPercent(40);
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.leftSidebarPercent).toBe(40);
    });

    it('rightSidebarPercent updates when store changes', () => {
        useSidebarLayoutStore.getState().setRightSidebarPercent(35);
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.rightSidebarPercent).toBe(35);
    });

    it('topBarPercent updates when store changes', () => {
        useSidebarLayoutStore.getState().setTopBarPercent(25);
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.topBarPercent).toBe(25);
    });

    it('bottomBarPercent updates when store changes', () => {
        useSidebarLayoutStore.getState().setBottomBarPercent(30);
        const { result } = renderHook(() => useSidebarLayout());
        expect(result.current.bottomBarPercent).toBe(30);
    });
});

describe('useSidebarLayout — handleResizeStart', () => {
    const makeMouseEvent = (clientX: number, clientY: number) => ({
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX,
        clientY,
    }) as unknown as React.MouseEvent;

    it('sets resizingSide to "left" on left resize start', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(100, 0), 'left'));
        expect(result.current.resizingSide).toBe('left');
    });

    it('sets resizingSide to "right" on right resize start', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(200, 0), 'right'));
        expect(result.current.resizingSide).toBe('right');
    });

    it('sets resizingSide to "top" on top resize start', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(0, 100), 'top'));
        expect(result.current.resizingSide).toBe('top');
    });

    it('sets resizingSide to "bottom" on bottom resize start', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(0, 200), 'bottom'));
        expect(result.current.resizingSide).toBe('bottom');
    });

    it('sets col-resize cursor for left/right', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(100, 0), 'left'));
        expect(document.body.style.cursor).toBe('col-resize');
    });

    it('sets row-resize cursor for top/bottom', () => {
        const { result } = renderHook(() => useSidebarLayout());
        act(() => result.current.handleResizeStart(makeMouseEvent(0, 100), 'top'));
        expect(document.body.style.cursor).toBe('row-resize');
    });
});
