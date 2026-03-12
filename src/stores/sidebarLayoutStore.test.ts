import { describe, it, expect, beforeEach } from 'vitest';
import { useSidebarLayoutStore } from './sidebarLayoutStore';

const DEFAULTS = useSidebarLayoutStore.getState();

beforeEach(() => {
    useSidebarLayoutStore.setState(DEFAULTS, true);
    localStorage.clear();
});

describe('sidebarLayoutStore — default state', () => {
    it('all sidebars are hidden by default', () => {
        const s = useSidebarLayoutStore.getState();
        expect(s.showLeftSidebar).toBe(false);
        expect(s.showRightSidebar).toBe(false);
        expect(s.showTopBar).toBe(false);
        expect(s.showBottomBar).toBe(false);
    });

    it('all percent values default to 20', () => {
        const s = useSidebarLayoutStore.getState();
        expect(s.leftSidebarPercent).toBe(20);
        expect(s.rightSidebarPercent).toBe(20);
        expect(s.topBarPercent).toBe(20);
        expect(s.bottomBarPercent).toBe(20);
    });
});

describe('sidebarLayoutStore — visibility setters', () => {
    it('setShowLeftSidebar', () => {
        useSidebarLayoutStore.getState().setShowLeftSidebar(true);
        expect(useSidebarLayoutStore.getState().showLeftSidebar).toBe(true);
    });

    it('setShowRightSidebar', () => {
        useSidebarLayoutStore.getState().setShowRightSidebar(true);
        expect(useSidebarLayoutStore.getState().showRightSidebar).toBe(true);
    });

    it('setShowTopBar', () => {
        useSidebarLayoutStore.getState().setShowTopBar(true);
        expect(useSidebarLayoutStore.getState().showTopBar).toBe(true);
    });

    it('setShowBottomBar', () => {
        useSidebarLayoutStore.getState().setShowBottomBar(true);
        expect(useSidebarLayoutStore.getState().showBottomBar).toBe(true);
    });

    it('toggling one sidebar does not affect others', () => {
        useSidebarLayoutStore.getState().setShowLeftSidebar(true);
        const s = useSidebarLayoutStore.getState();
        expect(s.showRightSidebar).toBe(false);
        expect(s.showTopBar).toBe(false);
        expect(s.showBottomBar).toBe(false);
    });
});

describe('sidebarLayoutStore — percent setters', () => {
    it('setLeftSidebarPercent', () => {
        useSidebarLayoutStore.getState().setLeftSidebarPercent(35);
        expect(useSidebarLayoutStore.getState().leftSidebarPercent).toBe(35);
    });

    it('setRightSidebarPercent', () => {
        useSidebarLayoutStore.getState().setRightSidebarPercent(25);
        expect(useSidebarLayoutStore.getState().rightSidebarPercent).toBe(25);
    });

    it('setTopBarPercent', () => {
        useSidebarLayoutStore.getState().setTopBarPercent(15);
        expect(useSidebarLayoutStore.getState().topBarPercent).toBe(15);
    });

    it('setBottomBarPercent', () => {
        useSidebarLayoutStore.getState().setBottomBarPercent(30);
        expect(useSidebarLayoutStore.getState().bottomBarPercent).toBe(30);
    });

    it('changing one percent does not affect others', () => {
        useSidebarLayoutStore.getState().setLeftSidebarPercent(40);
        const s = useSidebarLayoutStore.getState();
        expect(s.rightSidebarPercent).toBe(20);
        expect(s.topBarPercent).toBe(20);
        expect(s.bottomBarPercent).toBe(20);
    });
});

describe('sidebarLayoutStore — persist to localStorage', () => {
    it('writes to localStorage under hotty-sidebar-layout key', () => {
        useSidebarLayoutStore.getState().setShowLeftSidebar(true);
        useSidebarLayoutStore.getState().setLeftSidebarPercent(30);
        const stored = JSON.parse(localStorage.getItem('hotty-sidebar-layout') ?? '{}');
        expect(stored.state.showLeftSidebar).toBe(true);
        expect(stored.state.leftSidebarPercent).toBe(30);
    });
});
