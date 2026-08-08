import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';

const logDebugMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/tauriService', () => ({
  tauriService: { logDebug: (...args: unknown[]) => logDebugMock(...args) },
}));

const activateThrows = { current: false };
const addonInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
const contextLossHandlers: Array<() => void> = [];

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn();
    constructor() {
      if (activateThrows.current) throw new Error('WebGL2 unavailable');
      addonInstances.push(this as unknown as { dispose: ReturnType<typeof vi.fn> });
    }
    onContextLoss(handler: () => void) {
      contextLossHandlers.push(handler);
    }
    activate() {}
  },
}));

import { enableWebglRenderer } from './xtermRenderer';

/** Minimal stand-in for an opened Terminal. */
function fakeTerminal(opened = true) {
  return {
    element: opened ? ({} as HTMLElement) : undefined,
    loadAddon: vi.fn(),
  } as unknown as Terminal & { loadAddon: ReturnType<typeof vi.fn> };
}

describe('enableWebglRenderer', () => {
  beforeEach(() => {
    logDebugMock.mockClear();
    addonInstances.length = 0;
    contextLossHandlers.length = 0;
    activateThrows.current = false;
  });

  it('loads the addon onto an opened terminal', async () => {
    const term = fakeTerminal();
    enableWebglRenderer(term);
    await vi.waitFor(() => expect(term.loadAddon).toHaveBeenCalledTimes(1));
  });

  it('attempts the upgrade only once per terminal, however often it is called', async () => {
    // TerminalXtermHost re-runs its mount effect on every pane re-attach.
    const term = fakeTerminal();
    enableWebglRenderer(term);
    enableWebglRenderer(term);
    enableWebglRenderer(term);
    await vi.waitFor(() => expect(term.loadAddon).toHaveBeenCalledTimes(1));
  });

  it('keeps the DOM renderer, without throwing, when WebGL is unavailable', async () => {
    activateThrows.current = true;
    const term = fakeTerminal();
    expect(() => enableWebglRenderer(term)).not.toThrow();
    await vi.waitFor(() => expect(logDebugMock).toHaveBeenCalled());
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('skips the upgrade when the session closed while the chunk was loading', async () => {
    const term = fakeTerminal(false);
    enableWebglRenderer(term);
    await vi.waitFor(() => expect(addonInstances).toHaveLength(0));
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('disposes the addon on context loss so rendering falls back to the DOM', async () => {
    const term = fakeTerminal();
    enableWebglRenderer(term);
    await vi.waitFor(() => expect(contextLossHandlers).toHaveLength(1));

    contextLossHandlers[0]();
    expect(addonInstances[0].dispose).toHaveBeenCalledTimes(1);
  });
});
