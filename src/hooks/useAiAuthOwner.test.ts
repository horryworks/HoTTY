import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  onAiAuthResultCb: { current: null as null | ((r: { success: boolean; provider?: string }) => void) },
  onAiAuthLogoutCb: { current: null as null | (() => void) },
  settings: {
    activeAiProvider: 'openai',
    update: vi.fn(),
  },
}));

vi.mock('../services/tauriService', () => ({
  tauriService: {
    logDebug: vi.fn().mockResolvedValue(undefined),
    aiSetProvider: vi.fn().mockResolvedValue(undefined),
    aiAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
    aiAuthAuto: vi.fn().mockResolvedValue(false),
    aiAuthStart: vi.fn().mockResolvedValue(true),
    aiAuthLogout: vi.fn().mockResolvedValue(undefined),
    dpapiEncrypt: vi.fn(async (v: string) => `enc:${v}`),
    dpapiDecrypt: vi.fn(async (v: string) => v.replace(/^enc:/, '')),
    onAiAuthResult: vi.fn((cb: (r: { success: boolean }) => void) => {
      h.onAiAuthResultCb.current = cb;
      return Promise.resolve(() => { h.onAiAuthResultCb.current = null; });
    }),
    onAiAuthLogout: vi.fn((cb: () => void) => {
      h.onAiAuthLogoutCb.current = cb;
      return Promise.resolve(() => { h.onAiAuthLogoutCb.current = null; });
    }),
  },
}));

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(h.settings),
    { getState: () => h.settings },
  ),
}));

const { useAiAuthOwner, aiAuthLogin, aiAuthLogout } = await import('./useAiAuthOwner');
const { useAiAuthStore } = await import('../stores/aiAuthStore');
const { tauriService } = await import('../services/tauriService');
const { STORAGE_KEYS } = await import('../constants/storage');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.onAiAuthResultCb.current = null;
  h.onAiAuthLogoutCb.current = null;
  h.settings.activeAiProvider = 'openai';
  act(() => {
    useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAiAuthOwner — auto re-auth', () => {
  it('sets the backend provider and auto-auths OpenAI/Anthropic from backend config', async () => {
    vi.mocked(tauriService.aiAuthAuto).mockResolvedValue(true);
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => {
      expect(tauriService.aiSetProvider).toHaveBeenCalledWith('openai');
      expect(tauriService.aiAuthAuto).toHaveBeenCalledWith({});
      expect(useAiAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  it('consumes the one-shot AI_EXPLICIT_LOGOUT flag and skips auto-auth once', async () => {
    localStorage.setItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT, '1');
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => {
      // The backend provider is still switched…
      expect(tauriService.aiSetProvider).toHaveBeenCalledWith('openai');
    });
    // …but no silent re-auth runs, and the flag is consumed.
    expect(tauriService.aiAuthAuto).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT)).toBeNull();
  });

  it('auto-auths Gemini with DPAPI-decrypted stored credentials', async () => {
    h.settings.activeAiProvider = 'gemini';
    localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_ID, 'enc:my-id');
    localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET, 'enc:my-secret');
    vi.mocked(tauriService.aiAuthAuto).mockResolvedValue(true);
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => {
      expect(tauriService.aiAuthAuto).toHaveBeenCalledWith({ clientId: 'my-id', clientSecret: 'my-secret' });
      expect(useAiAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  it('skips Vertex AI auto-auth when no project/location is stored', async () => {
    h.settings.activeAiProvider = 'vertexai';
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => {
      expect(tauriService.aiSetProvider).toHaveBeenCalledWith('vertexai');
    });
    expect(tauriService.aiAuthAuto).not.toHaveBeenCalled();
    expect(useAiAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('mirrors the shared backend status without re-running auto-auth', async () => {
    // Another window already authenticated this provider on the shared backend.
    vi.mocked(tauriService.aiAuthStatus).mockResolvedValue({ authenticated: true });
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => {
      expect(useAiAuthStore.getState().isAuthenticated).toBe(true);
    });
    expect(tauriService.aiAuthAuto).not.toHaveBeenCalled();
  });
});

describe('useAiAuthOwner — event mirroring', () => {
  it('applies ai-auth-result events to the store', async () => {
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => expect(h.onAiAuthResultCb.current).toBeTruthy());

    act(() => { h.onAiAuthResultCb.current?.({ success: true }); });
    expect(useAiAuthStore.getState().isAuthenticated).toBe(true);

    act(() => { h.onAiAuthResultCb.current?.({ success: false }); });
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.authError).toBe('failed');
  });

  it('ignores an ai-auth-result for a provider the user switched away from', async () => {
    // Active provider is 'openai'; a late Gemini OAuth result must not apply.
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => expect(h.onAiAuthResultCb.current).toBeTruthy());

    act(() => { h.onAiAuthResultCb.current?.({ success: true, provider: 'gemini' }); });
    expect(useAiAuthStore.getState().isAuthenticated).toBe(false);

    // A result for the active provider still applies.
    act(() => { h.onAiAuthResultCb.current?.({ success: true, provider: 'openai' }); });
    expect(useAiAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('clears auth and bumps logoutNonce on the ai-auth-logout broadcast', async () => {
    renderHook(() => useAiAuthOwner());
    await vi.waitFor(() => expect(h.onAiAuthLogoutCb.current).toBeTruthy());

    act(() => { useAiAuthStore.setState({ isAuthenticated: true }); });
    const nonceBefore = useAiAuthStore.getState().logoutNonce;
    act(() => { h.onAiAuthLogoutCb.current?.(); });
    expect(useAiAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAiAuthStore.getState().logoutNonce).toBe(nonceBefore + 1);
  });
});

describe('aiAuthLogin', () => {
  it('encrypts and persists Gemini credentials, then starts the OAuth sign-in', async () => {
    await aiAuthLogin({ provider: 'gemini', clientId: 'my-id', clientSecret: 'my-secret' });
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_ID)).toBe('enc:my-id');
    expect(localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET)).toBe('enc:my-secret');
    expect(tauriService.aiSetProvider).toHaveBeenCalledWith('gemini');
    expect(tauriService.aiAuthStart).toHaveBeenCalledWith({ clientId: 'my-id', clientSecret: 'my-secret' });
    expect(useAiAuthStore.getState().isAuthLoading).toBe(true);
  });

  it('persists Vertex AI settings incl. the selected region', async () => {
    await aiAuthLogin({
      provider: 'vertexai',
      projectId: 'proj-1',
      location: 'asia-northeast1',
      authType: 'adc',
    });
    expect(localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID)).toBe('proj-1');
    expect(localStorage.getItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION)).toBe('asia-northeast1');
    expect(tauriService.aiAuthStart).toHaveBeenCalledWith({
      projectId: 'proj-1',
      location: 'asia-northeast1',
      authType: 'adc',
      keyFilePath: undefined,
    });
  });

  it('never persists OpenAI/Anthropic API keys client-side', async () => {
    await aiAuthLogin({ provider: 'openai', apiKey: 'sk-test' });
    expect(tauriService.aiAuthStart).toHaveBeenCalledWith({ apiKey: 'sk-test' });
    expect(Object.keys(localStorage).some((k) => localStorage.getItem(k)?.includes('sk-test'))).toBe(false);
  });

  it('marks the sign-in as failed when the start call rejects', async () => {
    vi.mocked(tauriService.aiAuthStart).mockRejectedValueOnce('key file not approved');
    await aiAuthLogin({ provider: 'anthropic', apiKey: 'sk-ant-test' });
    const s = useAiAuthStore.getState();
    expect(s.isAuthLoading).toBe(false);
    expect(s.authError).toBe('failed');
  });

  it('times out only after the backend-hang safety window, but a late success event still wins', async () => {
    vi.useFakeTimers();
    renderHook(() => useAiAuthOwner());
    // Flush the listener setup promises under fake timers.
    await act(async () => { await Promise.resolve(); });
    expect(h.onAiAuthResultCb.current).toBeTruthy();

    await aiAuthLogin({ provider: 'openai', apiKey: 'sk-test' });
    expect(useAiAuthStore.getState().isAuthLoading).toBe(true);

    // Well within the backend's own 300 s deadline — the frontend net must NOT fire.
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(useAiAuthStore.getState().authError).toBeNull();
    expect(useAiAuthStore.getState().isAuthLoading).toBe(true);

    // Past the safety window (315 s) with no backend result — surface the timeout.
    act(() => { vi.advanceTimersByTime(285_001); });
    expect(useAiAuthStore.getState().authError).toBe('timedOut');
    expect(useAiAuthStore.getState().isAuthLoading).toBe(false);

    // The Gemini browser consent can finish minutes later — the event wins.
    act(() => { h.onAiAuthResultCb.current?.({ success: true }); });
    const s = useAiAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.authError).toBeNull();
  });
});

describe('aiAuthLogout', () => {
  it('sets the one-shot flag, logs out on the backend, and resets the store', async () => {
    act(() => { useAiAuthStore.setState({ isAuthenticated: true }); });
    await aiAuthLogout();
    expect(localStorage.getItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT)).toBe('1');
    expect(tauriService.aiAuthLogout).toHaveBeenCalledTimes(1);
    expect(useAiAuthStore.getState().isAuthenticated).toBe(false);
  });
});
