// Single source of truth for the AI provider list and their display-name i18n
// keys. Consumed by the Settings → AI provider dropdown and the AI Chat pane's
// not-signed-in message so a provider is never renamed in one place but not the
// other, and an unknown id can't silently fall through to the wrong label.

import { STREAM_HARD_CAP_MS, STREAM_IDLE_TIMEOUT_MS } from '../components/AIChatPane/streamWatchdog';

/** Id of the local / LAN OpenAI-compatible server (ADR-AI-009). */
const LOCAL_AI_PROVIDER = 'local';

/** Provider id → i18n label key, in the order shown in the Settings dropdown. */
export const AI_PROVIDERS = [
  { id: 'vertexai', labelKey: 'settings.ai.providerVertexAi' },
  { id: 'gemini', labelKey: 'settings.ai.providerGemini' },
  { id: 'anthropic', labelKey: 'settings.ai.providerAnthropic' },
  { id: 'openai', labelKey: 'settings.ai.providerOpenai' },
  { id: LOCAL_AI_PROVIDER, labelKey: 'settings.ai.providerLocal' },
] as const;

const LABEL_KEY_BY_ID: Record<string, string> = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p.id, p.labelKey])
);

/** i18n label key for a provider id; falls back to Gemini (the default). */
export function aiProviderLabelKey(id: string): string {
  return LABEL_KEY_BY_ID[id] ?? 'settings.ai.providerGemini';
}

/** True for the provider the user runs themselves — free, and possibly slow. */
export function isLocalAiProvider(id: string): boolean {
  return id === LOCAL_AI_PROVIDER;
}

/**
 * Stream watchdog limits per provider. A local model can take minutes to load
 * before the first token, so its idle limit equals the cloud hard cap, and its
 * hard cap is 30 min. The backend backstop (`stream_deadline_secs`, 1860 s for
 * `local`) sits just above.
 */
export function streamLimitsFor(id: string): { idleMs: number; hardCapMs: number } {
  return isLocalAiProvider(id)
    ? { idleMs: 600_000, hardCapMs: 1_800_000 }
    : { idleMs: STREAM_IDLE_TIMEOUT_MS, hardCapMs: STREAM_HARD_CAP_MS };
}
