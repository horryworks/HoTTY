import { describe, it, expect, vi, beforeEach } from 'vitest';

// aiWindowPane.ts installs the AI window's pane at MODULE LOAD (deliberately —
// see its header). So each scenario sets the window-kind mock, resets the module
// registry, and re-imports both modules fresh to observe what the load did.

const h = vi.hoisted(() => ({ isAiWindow: false }));

vi.mock('./windowLabel', () => ({
  get IS_AI_CHAT_WINDOW() {
    return h.isAiWindow;
  },
  IS_TAURI: false,
  WINDOW_LABEL: 'main',
  AI_WINDOW_PREFIX: 'win-ai-',
}));

async function loadFresh() {
  vi.resetModules();
  const paneStore = await import('../stores/paneStore');
  // Start from a clean layout so an earlier scenario cannot bleed in.
  paneStore.usePaneStore.setState({
    layoutMode: '2x2',
    activePaneId: '0',
    paneAllocations: {},
    sessionOrder: [],
  });
  const mod = await import('./aiWindowPane');
  return { ...mod, usePaneStore: paneStore.usePaneStore };
}

describe('aiWindowPane', () => {
  beforeEach(() => {
    h.isAiWindow = false;
  });

  it('makeAiWindowPane builds an ai-chat pane with a fresh id', async () => {
    const { makeAiWindowPane } = await loadFresh();
    const a = makeAiWindowPane();
    const b = makeAiWindowPane();
    expect(a.type).toBe('ai-chat');
    expect(a.displayName).toBe('AI Chat');
    expect(a.id.startsWith('ai-')).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it('installs nothing in an ordinary window', async () => {
    const { AI_WINDOW_INITIAL_PANE, usePaneStore } = await loadFresh();
    expect(AI_WINDOW_INITIAL_PANE).toBeNull();
    expect(usePaneStore.getState().sessionOrder).toEqual([]);
    // The layout the user chose must not be touched.
    expect(usePaneStore.getState().layoutMode).toBe('2x2');
  });

  it('an AI Chat window opens holding exactly one AI Chat pane', async () => {
    h.isAiWindow = true;
    const { AI_WINDOW_INITIAL_PANE, usePaneStore } = await loadFresh();

    expect(AI_WINDOW_INITIAL_PANE).not.toBeNull();
    const pane = AI_WINDOW_INITIAL_PANE!;
    expect(pane.type).toBe('ai-chat');

    const state = usePaneStore.getState();
    expect(state.sessionOrder).toEqual([pane.id]);
    // It must be in a rendered slot, not left as a hidden tab.
    expect(Object.values(state.paneAllocations)).toContain(pane.id);
  });

  it('pins an AI Chat window to a 1x1 layout', async () => {
    h.isAiWindow = true;
    const { usePaneStore } = await loadFresh();
    // No grid controls are rendered there, so no other mode is reachable —
    // leaving 2x2 would strand the chat in a quarter of the window.
    expect(usePaneStore.getState().layoutMode).toBe('1x1');
  });

  it('the installed pane id is the one exposed to the renderer', async () => {
    h.isAiWindow = true;
    const { AI_WINDOW_INITIAL_PANE, usePaneStore } = await loadFresh();
    const { AI_WINDOW_PANE_ID } = await import('../stores/paneStore');
    // App renders `renderPane(AI_WINDOW_PANE_ID)`; that slot must hold the pane
    // the module installed, or the window comes up blank.
    expect(usePaneStore.getState().paneAllocations[AI_WINDOW_PANE_ID]).toBe(
      AI_WINDOW_INITIAL_PANE!.id,
    );
  });
});
