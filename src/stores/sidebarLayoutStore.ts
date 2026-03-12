import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarLayoutState {
    showLeftSidebar: boolean;
    showRightSidebar: boolean;
    showTopBar: boolean;
    showBottomBar: boolean;
    leftSidebarPercent: number;
    rightSidebarPercent: number;
    topBarPercent: number;
    bottomBarPercent: number;
}

interface SidebarLayoutActions {
    setShowLeftSidebar: (v: boolean) => void;
    setShowRightSidebar: (v: boolean) => void;
    setShowTopBar: (v: boolean) => void;
    setShowBottomBar: (v: boolean) => void;
    setLeftSidebarPercent: (v: number) => void;
    setRightSidebarPercent: (v: number) => void;
    setTopBarPercent: (v: number) => void;
    setBottomBarPercent: (v: number) => void;
}

export const useSidebarLayoutStore = create<SidebarLayoutState & SidebarLayoutActions>()(
    persist(
        (set) => ({
            showLeftSidebar: false,
            showRightSidebar: false,
            showTopBar: false,
            showBottomBar: false,
            leftSidebarPercent: 20,
            rightSidebarPercent: 20,
            topBarPercent: 20,
            bottomBarPercent: 20,
            setShowLeftSidebar: (v) => set({ showLeftSidebar: v }),
            setShowRightSidebar: (v) => set({ showRightSidebar: v }),
            setShowTopBar: (v) => set({ showTopBar: v }),
            setShowBottomBar: (v) => set({ showBottomBar: v }),
            setLeftSidebarPercent: (v) => set({ leftSidebarPercent: v }),
            setRightSidebarPercent: (v) => set({ rightSidebarPercent: v }),
            setTopBarPercent: (v) => set({ topBarPercent: v }),
            setBottomBarPercent: (v) => set({ bottomBarPercent: v }),
        }),
        {
            name: 'hotty-sidebar-layout',
            partialize: (state) =>
                Object.fromEntries(
                    Object.entries(state).filter(([, v]) => typeof v !== 'function')
                ) as SidebarLayoutState,
        }
    )
);
