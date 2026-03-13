import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaneManager } from './usePaneManager';
import { usePaneStore } from '../stores/paneStore';

const PANE_DEFAULTS = usePaneStore.getState();

beforeEach(() => {
    usePaneStore.setState(PANE_DEFAULTS, true);
    localStorage.clear();
});

describe('usePaneManager — initial state', () => {
    it('defaults to 1x1 layout', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.layoutMode).toBe('1x1');
    });

    it('initial paneAllocations has only pane "0" set to null', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.paneAllocations).toEqual({ '0': null });
    });

    it('activePaneId defaults to "0"', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.activePaneId).toBe('0');
    });

    it('activeSessionId is null when no session assigned', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.activeSessionId).toBeNull();
    });

    it('currentDims is 1x1 for default layout', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.currentDims).toEqual({ rows: 1, cols: 1 });
    });
});

describe('usePaneManager — layout change', () => {
    it('setLayoutMode updates layoutMode', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('2x2'));
        expect(result.current.layoutMode).toBe('2x2');
    });

    it.each([
        ['1x2', { rows: 1, cols: 2 }],
        ['2x1', { rows: 2, cols: 1 }],
        ['2x2', { rows: 2, cols: 2 }],
        ['2x3', { rows: 2, cols: 3 }],
        ['3x2', { rows: 3, cols: 2 }],
    ] as const)('currentDims for %s', (mode, expected) => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode(mode));
        expect(result.current.currentDims).toEqual(expected);
    });

    it('switching to 2x2 creates 4 pane slots', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('2x2'));
        const keys = Object.keys(result.current.paneAllocations).filter(k => !isNaN(parseInt(k)));
        expect(keys.length).toBe(4);
    });

    it('removing panes preserves active sessions via head-filling', () => {
        const { result } = renderHook(() => usePaneManager());
        // Set up 2x2 with sessions in panes 0, 1, 2, 3
        act(() => result.current.setLayoutMode('2x2'));
        act(() => result.current.setPaneAllocations({ '0': 'sess-a', '1': 'sess-b', '2': 'sess-c', '3': 'sess-d' }));
        // Switch to 1x1 (only 1 pane) — should compact to pane 0
        act(() => result.current.setLayoutMode('1x1'));
        expect(Object.keys(result.current.paneAllocations).filter(k => !isNaN(parseInt(k))).length).toBe(1);
        expect(result.current.paneAllocations['0']).toBe('sess-a');
    });

    it('activePaneId resets to "0" when active pane is removed', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('2x2'));
        act(() => result.current.setActivePaneId('3'));
        act(() => result.current.setLayoutMode('1x1'));
        expect(result.current.activePaneId).toBe('0');
    });
});

describe('usePaneManager — handleDropSession', () => {
    it('assigns a session to a pane', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.handleDropSession('sess-1', '0'));
        expect(result.current.paneAllocations['0']).toBe('sess-1');
    });

    it('sets activePaneId to the drop target', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('1x2'));
        act(() => result.current.handleDropSession('sess-1', '1'));
        expect(result.current.activePaneId).toBe('1');
    });

    it('swaps sessions when dropped onto an occupied pane', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('1x2'));
        act(() => result.current.setPaneAllocations({ '0': 'sess-a', '1': 'sess-b' }));
        // Drag sess-a from pane 0 to pane 1
        act(() => result.current.handleDropSession('sess-a', '1'));
        expect(result.current.paneAllocations['1']).toBe('sess-a');
        expect(result.current.paneAllocations['0']).toBe('sess-b');
    });

    it('moves session from pane to empty pane (old pane becomes null)', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('1x2'));
        act(() => result.current.setPaneAllocations({ '0': 'sess-x', '1': null }));
        act(() => result.current.handleDropSession('sess-x', '1'));
        expect(result.current.paneAllocations['0']).toBeNull();
        expect(result.current.paneAllocations['1']).toBe('sess-x');
    });
});

describe('usePaneManager — handleTabClick', () => {
    it('activates the pane containing the session', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setLayoutMode('1x2'));
        act(() => result.current.setPaneAllocations({ '0': null, '1': 'sess-z' }));
        act(() => result.current.handleTabClick('sess-z'));
        expect(result.current.activePaneId).toBe('1');
    });

    it('does not change activePaneId if session is not in any visible pane', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.setActivePaneId('0'));
        act(() => result.current.handleTabClick('non-existent-session'));
        expect(result.current.activePaneId).toBe('0');
    });
});

describe('usePaneManager — activeSessionId', () => {
    it('returns the session in the active pane', () => {
        const { result } = renderHook(() => usePaneManager());
        act(() => result.current.handleDropSession('sess-active', '0'));
        expect(result.current.activeSessionId).toBe('sess-active');
    });

    it('returns null if active pane is empty', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.activeSessionId).toBeNull();
    });
});

describe('usePaneManager — visibleSessionIds', () => {
    it('returns session IDs in visible panes', () => {
        const { result } = renderHook(() => usePaneManager({
            showLeftSidebar: false,
            showRightSidebar: false,
            showTopBar: false,
            showBottomBar: false,
        }));
        act(() => result.current.handleDropSession('sess-v', '0'));
        expect(result.current.visibleSessionIds).toContain('sess-v');
    });

    it('excludes null pane allocations', () => {
        const { result } = renderHook(() => usePaneManager());
        expect(result.current.visibleSessionIds).toEqual([]);
    });

    it('includes sidebar sessions when sidebar is visible', () => {
        const { result } = renderHook(() => usePaneManager({
            showLeftSidebar: true,
            showRightSidebar: false,
            showTopBar: false,
            showBottomBar: false,
        }));
        act(() => result.current.setPaneAllocations({ '0': null, 'sidebar-left': 'sess-sidebar' }));
        expect(result.current.visibleSessionIds).toContain('sess-sidebar');
    });

    it('excludes sidebar sessions when sidebar is hidden', () => {
        const { result } = renderHook(() => usePaneManager({
            showLeftSidebar: false,
            showRightSidebar: false,
            showTopBar: false,
            showBottomBar: false,
        }));
        act(() => result.current.setPaneAllocations({ '0': null, 'sidebar-left': 'sess-sidebar' }));
        expect(result.current.visibleSessionIds).not.toContain('sess-sidebar');
    });
});
