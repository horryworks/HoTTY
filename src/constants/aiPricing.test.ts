import { describe, it, expect } from 'vitest';
import { calcAICost } from './aiPricing';

describe('calcAICost', () => {
  it('calculates cost for a known Gemini model', () => {
    // gemini-2.0-flash: input=0.10, output=0.40 per 1M tokens
    const cost = calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash');
    expect(cost).toBeCloseTo(0.50, 5);
  });

  it('calculates cost for an OpenAI model', () => {
    // gpt-4o: input=2.50, output=10.00 per 1M tokens
    const cost = calcAICost(500_000, 500_000, 'gpt-4o');
    expect(cost).toBeCloseTo(6.25, 5);
  });

  it('calculates cost for an Anthropic model', () => {
    // claude-sonnet-4: input=3.00, output=15.00 per 1M tokens
    const cost = calcAICost(100_000, 200_000, 'claude-sonnet-4-6');
    expect(cost).toBeCloseTo(3.30, 5);
  });

  it('returns null for unknown models', () => {
    const cost = calcAICost(1000, 1000, 'unknown-model-xyz');
    expect(cost).toBeNull();
  });

  it('uses longest prefix match', () => {
    // "gemini-2.0-flash-exp" should match "gemini-2.0-flash-exp" (free) not "gemini-2.0-flash"
    const cost = calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp');
    expect(cost).toBe(0);
  });

  it('normalizes Vertex AI model paths', () => {
    // Should extract "gemini-2.5-pro-preview" and match "gemini-2.5-pro"
    const cost = calcAICost(1_000_000, 1_000_000, 'publishers/google/models/gemini-2.5-pro-preview');
    expect(cost).toBeCloseTo(11.25, 5);
  });

  it('returns zero cost for zero tokens', () => {
    const cost = calcAICost(0, 0, 'gpt-4o');
    expect(cost).toBe(0);
  });
});
