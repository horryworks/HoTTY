import { create } from 'zustand';

/**
 * Window-global AI auth state. NOT persisted — the backend owns the real auth
 * state (a single global AIService shared by all windows); this store only
 * mirrors it for the UI. It is written by the per-window auth owner and the
 * auth actions (both in `hooks/useAiAuthOwner.ts`), and read by
 * AIChatPane / AISettingsTab.
 *
 * `authError` is a code, not display text — translate at render time
 * (`settings.ai.auth.failed` / `settings.ai.auth.timedOut`).
 */
type AiAuthError = 'failed' | 'timedOut' | null;

interface AiAuthState {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  authError: AiAuthError;
  /** Bumped only by an explicit logout (the `ai-auth-logout` broadcast). Panes
   *  watch this to clear conversations, so a transient authenticated→false flip
   *  (failed sign-in, provider switch, auto-auth race) never wipes chat history. */
  logoutNonce: number;
  setAuthenticated: (v: boolean) => void;
  setAuthLoading: (v: boolean) => void;
  /** Apply a sign-in outcome: stops loading and records failure as an error. */
  applyAuthResult: (success: boolean) => void;
  /** Reset to the signed-out idle state (provider switch, stale auto-auth). */
  resetAuth: () => void;
  /** Explicit logout: reset AND bump `logoutNonce` so panes clear conversations. */
  signalLogout: () => void;
}

export const useAiAuthStore = create<AiAuthState>((set) => ({
  isAuthenticated: false,
  isAuthLoading: false,
  authError: null,
  logoutNonce: 0,
  setAuthenticated: (v) => set({ isAuthenticated: v }),
  setAuthLoading: (v) => set({ isAuthLoading: v }),
  applyAuthResult: (success) => set({
    isAuthenticated: success,
    isAuthLoading: false,
    authError: success ? null : 'failed',
  }),
  resetAuth: () => set({ isAuthenticated: false, isAuthLoading: false, authError: null }),
  signalLogout: () => set((s) => ({
    isAuthenticated: false,
    isAuthLoading: false,
    authError: null,
    logoutNonce: s.logoutNonce + 1,
  })),
}));
