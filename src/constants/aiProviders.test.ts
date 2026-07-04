import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS, aiProviderLabelKey } from './aiProviders';

describe('aiProviders', () => {
  it('lists the four providers in Settings-dropdown order', () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual([
      'vertexai',
      'gemini',
      'anthropic',
      'openai',
    ]);
  });

  it('maps each known provider id to its own label key', () => {
    expect(aiProviderLabelKey('vertexai')).toBe('settings.ai.providerVertexAi');
    expect(aiProviderLabelKey('gemini')).toBe('settings.ai.providerGemini');
    expect(aiProviderLabelKey('anthropic')).toBe('settings.ai.providerAnthropic');
    expect(aiProviderLabelKey('openai')).toBe('settings.ai.providerOpenai');
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
});
