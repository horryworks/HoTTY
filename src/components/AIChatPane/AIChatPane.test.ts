import { describe, it, expect } from 'vitest';
import { calcGeminiCost } from '../../constants/geminiPricing';

describe('calcGeminiCost', () => {
    it('returns 0 for zero tokens', () => {
        expect(calcGeminiCost(0, 0, 'gemini-1.5-flash')).toBe(0);
    });

    it('calculates cost for gemini-1.5-flash', () => {
        // 1M input at $0.075 + 1M output at $0.30 = $0.375
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-1.5-flash')).toBeCloseTo(0.375);
    });

    it('calculates cost for gemini-1.5-pro', () => {
        // 1M input at $1.25 + 1M output at $5.00 = $6.25
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-1.5-pro')).toBeCloseTo(6.25);
    });

    it('calculates cost for gemini-2.0-flash', () => {
        // 1M input at $0.10 + 1M output at $0.40 = $0.50
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-2.0-flash')).toBeCloseTo(0.50);
    });

    it('returns 0 for free experimental model', () => {
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp')).toBe(0);
    });

    it('matches on model name prefix (e.g. versioned suffix)', () => {
        // gemini-2.0-flash-001 should match gemini-2.0-flash
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-2.0-flash-001')).toBeCloseTo(0.50);
    });

    it('falls back to gemini-1.5-flash rates for unknown model', () => {
        expect(calcGeminiCost(1_000_000, 1_000_000, 'gemini-unknown-model')).toBeCloseTo(0.375);
    });
});
