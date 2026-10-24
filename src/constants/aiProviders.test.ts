import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, aiProviderLabelKey, isLocalAiProvider, streamLimitsFor } from './aiProviders';
import { STREAM_HARD_CAP_MS, STREAM_IDLE_TIMEOUT_MS } from '../components/AIChatPane/streamWatchdog';

describe('aiProviders', () => {
  it('lists the five providers in Settings-dropdown order', () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual([
      'vertexai',
      'gemini',
      'anthropic',
      'openai',
      'local',
    ]);
  });

  it('maps each known provider id to its own label key', () => {
    expect(aiProviderLabelKey('vertexai')).toBe('settings.ai.providerVertexAi');
    expect(aiProviderLabelKey('gemini')).toBe('settings.ai.providerGemini');
    expect(aiProviderLabelKey('anthropic')).toBe('settings.ai.providerAnthropic');
    expect(aiProviderLabelKey('openai')).toBe('settings.ai.providerOpenai');
    expect(aiProviderLabelKey('local')).toBe('settings.ai.providerLocal');
  });

  it('is internally consistent — every entry round-trips through aiProviderLabelKey', () => {
    for (const p of AI_PROVIDERS) {
      expect(aiProviderLabelKey(p.id)).toBe(p.labelKey);
    }
  });

  it('falls back to the Gemini label for an unknown or empty id', () => {
    expect(aiProviderLabelKey('does-not-exist')).toBe('settings.ai.providerGemini');
    expect(aiProviderLabelKey('')).toBe('settings.ai.providerGemini');
  });

  it('gives only the local server the long stream limits', () => {
    expect(isLocalAiProvider('local')).toBe(true);
    expect(isLocalAiProvider('openai')).toBe(false);
    expect(streamLimitsFor('openai')).toEqual({ idleMs: STREAM_IDLE_TIMEOUT_MS, hardCapMs: STREAM_HARD_CAP_MS });
    const local = streamLimitsFor('local');
    expect(local.idleMs).toBeGreaterThan(STREAM_IDLE_TIMEOUT_MS);
    // Below the backend backstop of 1860 s so the UI cancels first.
    expect(local.hardCapMs).toBeLessThan(1_860_000);
  });
});
