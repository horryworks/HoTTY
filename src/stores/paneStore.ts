import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LayoutMode } from '../types/appTypes';
import { useSidebarLayoutStore } from './sidebarLayoutStore';

export const LAYOUT_MODES: LayoutMode[] = [
  '1x1',
  '1x2',
  '2x1',
  '2x2',
  '2x3',
  '3x2',
];

export const SIDEBAR_PANE_IDS = [
  'bar-left',
  'bar-right',
  'bar-top',
  'bar-bottom',
] as const;

export type SidebarPaneId = (typeof SIDEBAR_PANE_IDS)[number];

export function isSidebarPaneId(id: string): id is SidebarPaneId {
  return (SIDEBAR_PANE_IDS as readonly string[]).includes(id);
}

export function paneCount(mode: LayoutMode): number {
  const [c, r] = mode.split('x').map((n) => parseInt(n, 10));
  return c * r;
}

export function gridPaneIds(mode: LayoutMode): string[] {
  return Array.from({ length: paneCount(mode) }, (_, i) => String(i));
}

export function allPaneIds(mode: LayoutMode): string[] {
  return [...gridPaneIds(mode), ...SIDEBAR_PANE_IDS];
}

interface PaneState {
  layoutMode: LayoutMode;
  activePaneId: string;
  paneAllocations: Record<string, string | null>;
  sessionOrder: string[];
}

interface PaneActions {
  setLayoutMode: (mode: LayoutMode) => void;
  setActivePaneId: (id: string) => void;
  addSession: (sessionId: string, options?: { preferSidebar?: boolean }) => void;
  removeSession: (sessionId: string) => void;
  reorderSession: (fromIndex: number, toIndex: number) => void;
  moveSessionToPane: (sessionId: string, targetPaneId: string) => void;
  setPaneAllocations: (next: Record<string, string | null>) => void;
}

function findEmptyGridPane(
  allocations: Record<string, string | null>,
  mode: LayoutMode
): string | null {
  for (const id of gridPaneIds(mode)) {
    if (!allocations[id]) return id;
  }
  return null;
}

function visibleSidebarPaneIdsInOrder(): SidebarPaneId[] {
  const s = useSidebarLayoutStore.getState();
  const order: Array<[SidebarPaneId, boolean]> = [
    ['bar-left', s.showLeftSidebar],
    ['bar-right', s.showRightSidebar],
    ['bar-top', s.showTopBar],
    ['bar-bottom', s.showBottomBar],
  ];
  return order.filter(([, v]) => v).map(([id]) => id);
}

function findEmptyPane(
  allocations: Record<string, string | null>,
  mode: LayoutMode
): string | null {
  const grid = findEmptyGridPane(allocations, mode);
  if (grid) return grid;
  for (const id of visibleSidebarPaneIdsInOrder()) {
    if (!allocations[id]) return id;
  }
  return null;
}

function findEmptyPaneSidebarFirst(
  allocations: Record<string, string | null>,
  mode: LayoutMode
): string | null {
  const s = useSidebarLayoutStore.getState();
  if (s.showLeftSidebar && !allocations['bar-left']) return 'bar-left';
  if (s.showRightSidebar && !allocations['bar-right']) return 'bar-right';
  const grid = findEmptyGridPane(allocations, mode);
  if (grid) return grid;
  if (s.showTopBar && !allocations['bar-top']) return 'bar-top';
  if (s.showBottomBar && !allocations['bar-bottom']) return 'bar-bottom';
  return null;
}

export const usePaneStore = create<PaneState & PaneActions>()(
  persist(
    (set) => ({
      layoutMode: '1x1',
      activePaneId: '0',
      paneAllocations: {},
      sessionOrder: [],

      setLayoutMode: (mode) =>
        set((s) => {
          const validGridIds = new Set(gridPaneIds(mode));
          const nextAllocations: Record<string, string | null> = {};
          const orphaned: string[] = [];
          for (const [pid, sid] of Object.entries(s.paneAllocations)) {
            if (!sid) continue;
            if (validGridIds.has(pid) || isSidebarPaneId(pid)) {
              nextAllocations[pid] = sid;
            } else {
              orphaned.push(sid);
            }
          }
          const placed = new Set(Object.values(nextAllocations).filter((x): x is string => !!x));
          const hidden = s.sessionOrder.filter((sid) => !placed.has(sid));
          const queue = [...orphaned, ...hidden];
          for (const sid of queue) {
            const empty = findEmptyPane(nextAllocations, mode);
            if (!empty) break;
            if (Object.values(nextAllocations).includes(sid)) continue;
            nextAllocations[empty] = sid;
          }
          const activeStillValid =
            validGridIds.has(s.activePaneId) || isSidebarPaneId(s.activePaneId);
          return {
            layoutMode: mode,
            paneAllocations: nextAllocations,
            activePaneId: activeStillValid ? s.activePaneId : '0',
          };
        }),

      setActivePaneId: (id) => set({ activePaneId: id }),

      addSession: (sessionId, options) =>
        set((s) => {
          if (s.sessionOrder.includes(sessionId)) return s;
          const sessionOrder = [...s.sessionOrder, sessionId];
          const empty = options?.preferSidebar
            ? findEmptyPaneSidebarFirst(s.paneAllocations, s.layoutMode)
            : findEmptyPane(s.paneAllocations, s.layoutMode);
          if (empty) {
            return {
              sessionOrder,
              paneAllocations: { ...s.paneAllocations, [empty]: sessionId },
              activePaneId: empty,
            };
          }
          return { sessionOrder };
        }),

      removeSession: (sessionId) =>
        set((s) => {
          const sessionOrder = s.sessionOrder.filter((id) => id !== sessionId);
          const paneAllocations = { ...s.paneAllocations };
          for (const [pid, sid] of Object.entries(paneAllocations)) {
            if (sid === sessionId) paneAllocations[pid] = null;
          }
          const unassigned = sessionOrder.filter(
            (sid) => !Object.values(paneAllocations).includes(sid)
          );
          for (const sid of unassigned) {
            const empty = findEmptyPane(paneAllocations, s.layoutMode);
            if (!empty) break;
            paneAllocations[empty] = sid;
          }
          return { sessionOrder, paneAllocations };
        }),

      reorderSession: (fromIndex, toIndex) =>
        set((s) => {
          if (
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= s.sessionOrder.length ||
            toIndex >= s.sessionOrder.length ||
            fromIndex === toIndex
          ) {
            return s;
          }
          const next = [...s.sessionOrder];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { sessionOrder: next };
        }),

      moveSessionToPane: (sessionId, targetPaneId) =>
        set((s) => {
          const paneAllocations = { ...s.paneAllocations };
          let sourcePaneId: string | null = null;
          for (const [pid, sid] of Object.entries(paneAllocations)) {
            if (sid === sessionId) {
              sourcePaneId = pid;
              break;
            }
          }
          const targetSession = paneAllocations[targetPaneId] ?? null;
          if (sourcePaneId === targetPaneId) return s;
          paneAllocations[targetPaneId] = sessionId;
          if (sourcePaneId) {
            paneAllocations[sourcePaneId] = targetSession;
          }
          return { paneAllocations, activePaneId: targetPaneId };
        }),

      setPaneAllocations: (next) => set({ paneAllocations: next }),
    }),
    {
      name: 'hotty-pane-layout',
      version: 2,
      partialize: (state) => ({
        layoutMode: state.layoutMode,
        activePaneId: state.activePaneId,
      }),
    }
  )
);
