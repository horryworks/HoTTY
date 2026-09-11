import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// windowLabel.ts computes WINDOW_LABEL and IS_TAURI once, at module load. So each
// scenario configures the mock + window globals, resets the module registry, then
// re-imports the module fresh to observe the resolved constants.

const h = vi.hoisted(() => ({
  label: 'main' as string,
  throws: false,
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => {
    if (h.throws) throw new Error('not running inside a Tauri webview');
    return { label: h.label };
  },
}));

type WindowWithTauri = Window & { __TAURI_INTERNALS__?: unknown };

describe('windowLabel', () => {
  const w = window as WindowWithTauri;
  const hadInternals = '__TAURI_INTERNALS__' in w;
  const originalInternals = w.__TAURI_INTERNALS__;

  beforeEach(() => {
    h.label = 'main';
    h.throws = false;
    vi.resetModules();
  });

  afterEach(() => {
    if (hadInternals) {
      w.__TAURI_INTERNALS__ = originalInternals;
    } else {
      delete w.__TAURI_INTERNALS__;
    }
  });

  it('WINDOW_LABEL is the current webview label when Tauri resolves it', async () => {
    h.label = 'window-2';
    const { WINDOW_LABEL } = await import('./windowLabel');
    expect(WINDOW_LABEL).toBe('window-2');
  });

  it("WINDOW_LABEL falls back to 'main' when the webview label is empty", async () => {
    h.label = '';
    const { WINDOW_LABEL } = await import('./windowLabel');
    expect(WINDOW_LABEL).toBe('main');
  });

  it("WINDOW_LABEL falls back to 'main' outside Tauri (the resolver throws)", async () => {
    h.throws = true;
    const { WINDOW_LABEL } = await import('./windowLabel');
    expect(WINDOW_LABEL).toBe('main');
  });

  it('IS_TAURI is true when __TAURI_INTERNALS__ is present on window', async () => {
    w.__TAURI_INTERNALS__ = {};
    const { IS_TAURI } = await import('./windowLabel');
    expect(IS_TAURI).toBe(true);
  });

  it('IS_TAURI is false when __TAURI_INTERNALS__ is absent', async () => {
    delete w.__TAURI_INTERNALS__;
    const { IS_TAURI } = await import('./windowLabel');
    expect(IS_TAURI).toBe(false);
  });

  it('IS_AI_CHAT_WINDOW is true for a win-ai-* label', async () => {
    h.label = 'win-ai-3';
    const { IS_AI_CHAT_WINDOW } = await import('./windowLabel');
    expect(IS_AI_CHAT_WINDOW).toBe(true);
  });

  it('IS_AI_CHAT_WINDOW is false for main and for a plain secondary window', async () => {
    h.label = 'main';
    expect((await import('./windowLabel')).IS_AI_CHAT_WINDOW).toBe(false);

    vi.resetModules();
    h.label = 'win-2';
    expect((await import('./windowLabel')).IS_AI_CHAT_WINDOW).toBe(false);
  });

  it('the AI window prefix stays inside the win-* capability glob', async () => {
    // capabilities/default.json scopes permissions to ["main", "win-*"]; a label
    // outside that glob gets none of them and fails silently at runtime.
    const { AI_WINDOW_PREFIX } = await import('./windowLabel');
    expect(AI_WINDOW_PREFIX.startsWith('win-')).toBe(true);
  });
});
