import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { windowScopedKey } from '../constants/storage';
import { WINDOW_LABEL } from '../utils/windowLabel';

export type SidebarEdge = 'left' | 'right' | 'top' | 'bottom';

type SidebarTab = 'hosts' | 'gcp' | 'web';

const SIDEBAR_TABS: readonly SidebarTab[] = ['hosts', 'gcp', 'web'];

interface SidebarLayoutState {
  showLeftSidebar: boolean;
  showRightSidebar: boolean;
  showTopBar: boolean;
  showBottomBar: boolean;
  leftSidebarPercent: number;
  rightSidebarPercent: number;
  topBarPercent: number;
  bottomBarPercent: number;
  activeSidebarTab: SidebarTab;
  toggle: (edge: SidebarEdge) => void;
  setPercent: (edge: SidebarEdge, percent: number) => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
}

const clamp = (n: number) => Math.max(5, Math.min(80, n));

export const useSidebarLayoutStore = create<SidebarLayoutState>()(
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
      activeSidebarTab: 'hosts',
      toggle: (edge) =>
        set((s) => {
          switch (edge) {
            case 'left':
              return { showLeftSidebar: !s.showLeftSidebar };
            case 'right':
              return { showRightSidebar: !s.showRightSidebar };
            case 'top':
              return { showTopBar: !s.showTopBar };
            case 'bottom':
              return { showBottomBar: !s.showBottomBar };
          }
        }),
      setPercent: (edge, percent) =>
        set(() => {
          const v = clamp(percent);
          switch (edge) {
            case 'left':
              return { leftSidebarPercent: v };
            case 'right':
              return { rightSidebarPercent: v };
            case 'top':
              return { topBarPercent: v };
            case 'bottom':
              return { bottomBarPercent: v };
          }
        }),
      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
    }),
    {
      // Per-window: each window keeps its own sidebar visibility/sizing. The
      // initial "main" window keeps the legacy unsuffixed key (back-compat).
      name: windowScopedKey('hotty-sidebar-layout', WINDOW_LABEL),
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<SidebarLayoutState>;
        // Normalize any unknown/corrupt tab value to 'hosts'.
        if (!state.activeSidebarTab || !SIDEBAR_TABS.includes(state.activeSidebarTab)) {
          state.activeSidebarTab = 'hosts';
        }
        return state as SidebarLayoutState;
      },
    }
  )
);
