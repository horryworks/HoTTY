import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode } from '../components/LayoutSelector/LayoutSelector';

interface PaneStoreState {
    layoutMode: LayoutMode;
}

interface PaneStoreActions {
    setLayoutMode: (mode: LayoutMode) => void;
}

export const usePaneStore = create<PaneStoreState & PaneStoreActions>()(
    persist(
        (set) => ({
            layoutMode: '1x1',
            setLayoutMode: (mode) => set({ layoutMode: mode }),
        }),
        {
            name: 'hotty-pane-layout',
            partialize: (state) => ({ layoutMode: state.layoutMode }),
        }
    )
);
