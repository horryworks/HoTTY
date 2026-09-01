import { useEffect } from 'react';
import { tauriService } from '../services/tauriService';
import { useAiAuthStore } from '../stores/aiAuthStore';
import { useSettingsStore } from '../stores/settingsStore';
import { STORAGE_KEYS } from '../constants/storage';
import { logError } from '../utils/logger';
import i18n from '../i18n';

/**
 * Single owner of the AI auth lifecycle, mounted once per window (in App).
 *
 * The backend holds one global AIService shared by every window; sign-in
 * results arrive as the broadcast `ai-auth-result` event and explicit logouts
 * as `ai-auth-logout`. This hook mirrors those into `useAiAuthStore`, and runs
 * the silent auto re-auth whenever the active provider changes (including
 * startup). AIChatPane and AISettingsTab are pure consumers of the store —
 * they must not talk to the auth backend directly.
 */

// Safety net for a wedged backend only — NOT the real sign-in deadline. The
// backend owns that: Gemini's OAuth loopback waits 300s (matching the "approve
// within 5 minutes" help text) and then emits ai-auth-result{success:false}.
// This fires slightly later so a genuinely hung sign-in can't pin the UI in a
// loading state forever. A fired timeout only shows an error; a success event
// arriving afterwards still wins.
const AUTH_TIMEOUT_MS = 315_000;

// Module-scoped so a pending sign-in survives the Settings modal unmounting —
// the Gemini OAuth consent can complete in the browser minutes later.
let authTimeout: ReturnType<typeof setTimeout> | null = null;

function clearAuthTimeout(): void {
  if (authTimeout) {
    clearTimeout(authTimeout);
    authTimeout = null;
  }
}

function armAuthTimeout(): void {
  clearAuthTimeout();
  authTimeout = setTimeout(() => {
    authTimeout = null;
    useAiAuthStore.setState({ isAuthLoading: false, authError: 'timedOut' });
  }, AUTH_TIMEOUT_MS);
}

// Monotonic guard so a stale auto-auth can't clobber newer auth state. Bumped on
// every provider-change effect run and on every applied auth event; an in-flight
// aiAuthAuto writes the store only if the epoch it captured is still current.
let authEpoch = 0;

/**
 * Load and DPAPI-decrypt the stored Gemini OAuth credentials, or null when none
 * are stored / decryption fails. Shared by the silent auto-auth path and the
 * Settings form pre-fill so both read the persisted format identically.
 */
export async function readStoredGeminiCredentials(): Promise<
  { clientId: string; clientSecret: string } | null
> {
  const encId = localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_ID) || '';
  const encSecret = localStorage.getItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET) || '';
  if (!encId || !encSecret) return null;
  const clientId = await tauriService.dpapiDecrypt(encId);
  const clientSecret = await tauriService.dpapiDecrypt(encSecret);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

type AiLoginRequest =
  | { provider: 'gemini'; clientId: string; clientSecret: string }
  | {
      provider: 'vertexai';
      projectId: string;
      location: string;
      authType: 'adc' | 'service_account';
      keyFilePath?: string;
    }
  | { provider: 'openai'; apiKey: string }
  | { provider: 'anthropic'; apiKey: string };

/**
 * Start an interactive sign-in. The outcome arrives via the global
 * `ai-auth-result` event (handled by the owner), not this promise — Gemini's
 * OAuth flow completes asynchronously in the system browser.
 */
export async function aiAuthLogin(req: AiLoginRequest): Promise<void> {
  // Supersede any in-flight silent auto-auth so its late resolution can't clobber
  // this interactive sign-in's loading/authenticated state (isCurrent() goes false).
  authEpoch++;
  // The user is actively signing in — a stale "explicit logout" suppression flag
  // must not linger to block the next auto re-auth of this provider.
  localStorage.removeItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT);
  useAiAuthStore.setState({ isAuthLoading: true, authError: null });
  armAuthTimeout();
  try {
    if (req.provider === 'vertexai') {
      localStorage.setItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID, req.projectId);
      localStorage.setItem(STORAGE_KEYS.VERTEXAI_LOCATION, req.location);
      localStorage.setItem(STORAGE_KEYS.VERTEXAI_AUTH_TYPE, req.authType);
      localStorage.setItem(STORAGE_KEYS.VERTEXAI_KEY_FILE_PATH, req.keyFilePath ?? '');
      localStorage.setItem(STORAGE_KEYS.VERTEXAI_SELECTED_REGION, req.location);
      await tauriService.aiSetProvider('vertexai');
      await tauriService.aiAuthStart({
        projectId: req.projectId,
        location: req.location,
        authType: req.authType,
        keyFilePath: req.keyFilePath || undefined,
      });
      return;
    }

    if (req.provider === 'gemini') {
      try {
        const encId = await tauriService.dpapiEncrypt(req.clientId);
        const encSecret = await tauriService.dpapiEncrypt(req.clientSecret);
        localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_ID, encId);
        localStorage.setItem(STORAGE_KEYS.GEMINI_CLIENT_SECRET, encSecret);
      } catch (err) {
        logError('AI', i18n.t('notifications.errors.aiCredentialEncrypt'), err);
      }
      await tauriService.aiSetProvider('gemini');
      await tauriService.aiAuthStart({ clientId: req.clientId, clientSecret: req.clientSecret });
      return;
    }

    // OpenAI / Anthropic — plain API key; never persisted client-side (the
    // backend stores it DPAPI-encrypted for auto re-auth).
    await tauriService.aiSetProvider(req.provider);
    await tauriService.aiAuthStart({ apiKey: req.apiKey });
  } catch (err) {
    logError('AI', i18n.t('notifications.errors.aiSignInStart'), err);
    clearAuthTimeout();
    useAiAuthStore.setState({ isAuthLoading: false, authError: 'failed' });
  }
}

/**
 * Explicit logout. Sets the one-shot AI_EXPLICIT_LOGOUT flag (suppresses the
 * next auto re-auth), tells the backend to drop credentials, and resets this
 * window immediately; other windows follow via the `ai-auth-logout` broadcast.
 */
export async function aiAuthLogout(): Promise<void> {
  clearAuthTimeout();
  // Record WHICH provider was logged out, so the suppression is consumed only when
  // that same provider's auto-auth effect runs — switching to a different, still
  // authenticated provider must not be blocked by a stale logout of another one.
  localStorage.setItem(
    STORAGE_KEYS.AI_EXPLICIT_LOGOUT,
    useSettingsStore.getState().activeAiProvider,
  );
  try {
    await tauriService.aiAuthLogout();
  } catch (err) {
    logError('AI', i18n.t('notifications.errors.aiLogout'), err);
  }
  // signalLogout (not resetAuth) so this window's panes clear conversations
  // immediately; the ai-auth-logout broadcast does the same for other windows.
  useAiAuthStore.getState().signalLogout();
}

export function useAiAuthOwner(): void {
  const activeAiProvider = useSettingsStore((s) => s.activeAiProvider);

  // ── Silent auto re-auth on startup / provider change ──
  useEffect(() => {
    let cancelled = false;
    clearAuthTimeout();
    const myEpoch = ++authEpoch;
    useAiAuthStore.getState().resetAuth();

    // Apply an auto-auth outcome only if no newer auth event or provider switch
    // has superseded this run (guards the cross-window auto-auth race).
    const isCurrent = () => !cancelled && authEpoch === myEpoch;

    // One-shot: an explicit logout suppresses exactly one auto re-auth — but only
    // for the provider that was logged out. Consume (remove) the flag only when it
    // matches the now-active provider; a flag for a different provider is left for
    // when that provider is reselected.
    const loggedOutProvider = localStorage.getItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT);
    const skipAutoAuth = !!loggedOutProvider && loggedOutProvider === activeAiProvider;
    if (skipAutoAuth) localStorage.removeItem(STORAGE_KEYS.AI_EXPLICIT_LOGOUT);

    const load = async () => {
      try {
        // Keep the backend's active provider in sync even when auto-auth is
        // skipped or has no stored credentials.
        await tauriService.aiSetProvider(activeAiProvider);
        if (skipAutoAuth) return;

        // The backend AIService is one global instance shared by every window.
        // If another window already authenticated this provider, mirror that
        // instead of repeating the full decrypt + network re-auth.
        const status = await tauriService.aiAuthStatus();
        if (!isCurrent()) return;
        if (status.authenticated) {
          useAiAuthStore.getState().setAuthenticated(true);
          return;
        }

        let credentials: Record<string, unknown>;
        if (activeAiProvider === 'vertexai') {
          const projectId = localStorage.getItem(STORAGE_KEYS.VERTEXAI_PROJECT_ID) || '';
          const location = localStorage.getItem(STORAGE_KEYS.VERTEXAI_LOCATION) || '';
          if (!projectId || !location) return;
          credentials = { projectId, location };
        } else if (activeAiProvider === 'gemini') {
          const creds = await readStoredGeminiCredentials();
          if (!creds) return;
          credentials = creds;
        } else {
          // OpenAI / Anthropic re-auth from the backend's encrypted config.
          credentials = {};
        }

        if (!isCurrent()) return;
        useAiAuthStore.getState().setAuthLoading(true);
        try {
          const success = await tauriService.aiAuthAuto(credentials);
          if (isCurrent()) useAiAuthStore.getState().setAuthenticated(success);
        } finally {
          if (isCurrent()) useAiAuthStore.getState().setAuthLoading(false);
        }
      } catch (err) {
        logError('AI', i18n.t('notifications.errors.aiAutoAuth'), err);
        if (isCurrent()) useAiAuthStore.getState().setAuthLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeAiProvider]);

  // ── Mirror the global auth events into the store ──
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    tauriService.onAiAuthResult((result) => {
      if (cancelled) return;
      // Ignore a late result for a provider the user has since switched away
      // from (e.g. a Gemini OAuth consent approved after selecting OpenAI).
      if (result.provider && result.provider !== useSettingsStore.getState().activeAiProvider) return;
      authEpoch++;
      clearAuthTimeout();
      if (result.success) {
        useAiAuthStore.getState().applyAuthResult(true);
      } else {
        // A FAILED sign-in ATTEMPT doesn't necessarily mean signed-out: the backend
        // may still hold a valid session (e.g. a mistyped re-login while already
        // authenticated, or a failed attempt racing a successful silent auto-auth).
        // Show the error, but reconcile isAuthenticated from the backend rather than
        // force it false.
        useAiAuthStore.setState({ isAuthLoading: false, authError: 'failed' });
        void tauriService.aiAuthStatus()
          .then((status) => { if (!cancelled) useAiAuthStore.setState({ isAuthenticated: status.authenticated }); })
          .catch(() => { if (!cancelled) useAiAuthStore.setState({ isAuthenticated: false }); });
      }
    }).then((fn) => { if (cancelled) fn(); else unlisteners.push(fn); })
      .catch((e) => logError('AI', i18n.t('notifications.errors.aiAuthListener'), e));

    tauriService.onAiAuthLogout(() => {
      if (cancelled) return;
      authEpoch++;
      clearAuthTimeout();
      useAiAuthStore.getState().signalLogout();
    }).then((fn) => { if (cancelled) fn(); else unlisteners.push(fn); })
      .catch((e) => logError('AI', i18n.t('notifications.errors.aiLogoutListener'), e));

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);
}
