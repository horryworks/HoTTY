// Single source of truth for the AI provider list and their display-name i18n
// keys. Consumed by the Settings → AI provider dropdown and the AI Chat pane's
// not-signed-in message so a provider is never renamed in one place but not the
// other, and an unknown id can't silently fall through to the wrong label.

/** Provider id → i18n label key, in the order shown in the Settings dropdown. */
export const AI_PROVIDERS = [
  { id: 'vertexai', labelKey: 'settings.ai.providerVertexAi' },
  { id: 'gemini', labelKey: 'settings.ai.providerGemini' },
  { id: 'anthropic', labelKey: 'settings.ai.providerAnthropic' },
  { id: 'openai', labelKey: 'settings.ai.providerOpenai' },
] as const;

const LABEL_KEY_BY_ID: Record<string, string> = Object.fromEntries(
  AI_PROVIDERS.map((p) => [p.id, p.labelKey])
);

/** i18n label key for a provider id; falls back to Gemini (the default). */
export function aiProviderLabelKey(id: string): string {
  return LABEL_KEY_BY_ID[id] ?? 'settings.ai.providerGemini';
}
