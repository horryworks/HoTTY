import { useCallback, useRef, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * AI data-sharing consent gate.
 *
 * The disclosure (AiConsentModal) is shown once before any terminal data is
 * first sent to a third-party AI provider — via chat send, Ask AI, or enabling
 * Watch. Acceptance persists in the settings store (`aiDataConsentAccepted`);
 * thereafter the gate resolves immediately.
 *
 * `ensureAiConsent()` returns a Promise that resolves `true` to proceed or
 * `false` if the user declined. Multiple concurrent callers awaiting the same
 * modal are all resolved together when the user accepts/cancels once.
 */
export interface UseAiConsentReturn {
  /** Whether the consent modal is currently open (drives AiConsentModal render). */
  aiConsentOpen: boolean;
  /** Resolve immediately if already accepted; otherwise open the modal and wait. */
  ensureAiConsent: () => Promise<boolean>;
  /** User accepted: persist consent and resolve all pending waiters with true. */
  handleAiConsentAccept: () => void;
  /** User cancelled: resolve all pending waiters with false (no persistence). */
  handleAiConsentCancel: () => void;
}

export function useAiConsent(): UseAiConsentReturn {
  const [aiConsentOpen, setAiConsentOpen] = useState(false);
  const resolversRef = useRef<((ok: boolean) => void)[]>([]);

  const ensureAiConsent = useCallback((): Promise<boolean> => {
    if (useSettingsStore.getState().aiDataConsentAccepted) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      resolversRef.current.push(resolve);
      setAiConsentOpen(true);
    });
  }, []);

  const settleAiConsent = useCallback((ok: boolean) => {
    setAiConsentOpen(false);
    const resolvers = resolversRef.current;
    resolversRef.current = [];
    resolvers.forEach((r) => r(ok));
  }, []);

  const handleAiConsentAccept = useCallback(() => {
    useSettingsStore.getState().update('aiDataConsentAccepted', true);
    settleAiConsent(true);
  }, [settleAiConsent]);

  const handleAiConsentCancel = useCallback(() => settleAiConsent(false), [settleAiConsent]);

  return { aiConsentOpen, ensureAiConsent, handleAiConsentAccept, handleAiConsentCancel };
}
