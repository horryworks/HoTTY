import { useCallback, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { tauriService } from '../services/tauriService';
import { isLocalAiProvider } from '../constants/aiProviders';
import { isLoopbackUrl, urlHost } from '../utils/loopbackUrl';

/**
 * AI data-sharing consent gate.
 *
 * The disclosure (AiConsentModal) is shown once before any terminal data is
 * first sent to a third-party AI provider — via chat send, Ask AI, or enabling
 * Watch. Acceptance persists in the settings store (`aiDataConsentAccepted`);
 * thereafter the gate resolves immediately.
 *
 * The local AI server (ADR-AI-009) is gated per host instead: a server on this
 * PC needs no consent, one on another machine is asked about once, naming the
 * host. The address comes from the backend (the one it actually sends to), not
 * from the settings form.
 *
 * `ensureAiConsent()` returns a Promise that resolves `true` to proceed or
 * `false` if the user declined. Multiple concurrent callers awaiting the same
 * modal are all resolved together when the user accepts/cancels once.
 */
export interface UseAiConsentReturn {
  /** Whether the consent modal is currently open (drives AiConsentModal render). */
  aiConsentOpen: boolean;
  /** Host of the local AI server being asked about; null for the cloud notice. */
  aiConsentHost: string | null;
  /** Resolve immediately if already accepted; otherwise open the modal and wait. */
  ensureAiConsent: () => Promise<boolean>;
  /** User accepted: persist consent and resolve all pending waiters with true. */
  handleAiConsentAccept: () => void;
  /** User cancelled: resolve all pending waiters with false (no persistence). */
  handleAiConsentCancel: () => void;
}

export function useAiConsent(): UseAiConsentReturn {
  const [aiConsentOpen, setAiConsentOpen] = useState(false);
  const [aiConsentHost, setAiConsentHost] = useState<string | null>(null);
  const resolversRef = useRef<((ok: boolean) => void)[]>([]);

  const ask = useCallback((host: string | null): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolversRef.current.push(resolve);
      setAiConsentHost(host);
      setAiConsentOpen(true);
    });
  }, []);

  const ensureAiConsent = useCallback((): Promise<boolean> => {
    const s = useSettingsStore.getState();
    if (!isLocalAiProvider(s.activeAiProvider)) {
      if (s.aiDataConsentAccepted) return Promise.resolve(true);
      return ask(null);
    }
    return (async () => {
      let url: string | undefined;
      try {
        url = (await tauriService.aiAuthStatus()).accountInfo;
      } catch {
        url = undefined;
      }
      // Not connected: nothing can be sent, and the send reports why.
      if (!url || isLoopbackUrl(url)) return true;
      const host = urlHost(url);
      if (!host) return true;
      if (useSettingsStore.getState().aiLocalConsentHosts.includes(host)) return true;
      return ask(host);
    })();
  }, [ask]);

  const settleAiConsent = useCallback((ok: boolean) => {
    setAiConsentOpen(false);
    const resolvers = resolversRef.current;
    resolversRef.current = [];
    resolvers.forEach((r) => r(ok));
  }, []);

  const handleAiConsentAccept = useCallback(() => {
    const store = useSettingsStore.getState();
    if (aiConsentHost) {
      if (!store.aiLocalConsentHosts.includes(aiConsentHost)) {
        store.update('aiLocalConsentHosts', [...store.aiLocalConsentHosts, aiConsentHost]);
      }
    } else {
      store.update('aiDataConsentAccepted', true);
    }
    settleAiConsent(true);
  }, [aiConsentHost, settleAiConsent]);

  const handleAiConsentCancel = useCallback(() => settleAiConsent(false), [settleAiConsent]);

  return { aiConsentOpen, aiConsentHost, ensureAiConsent, handleAiConsentAccept, handleAiConsentCancel };
}
