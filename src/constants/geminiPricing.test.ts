import { describe, it, expect } from 'vitest';
import { calcGeminiCost, GEMINI_PRICING, GEMINI_PRICING_FALLBACK } from './geminiPricing';

describe('GEMINI_PRICING', () => {
    it('contains expected model keys', () => {
        expect('gemini-2.5-pro' in GEMINI_PRICING).toBe(true);
        expect('gemini-2.0-flash' in GEMINI_PRICING).toBe(true);
        expect('gemini-1.5-flash' in GEMINI_PRICING).toBe(true);
    });

    it('gemini-2.0-flash-exp is free tier', () => {
        expect(GEMINI_PRICING['gemini-2.0-flash-exp'].input).toBe(0);
        expect(GEMINI_PRICING['gemini-2.0-flash-exp'].output).toBe(0);
    });
});

describe('calcGeminiCost', () => {
    it('returns 0 for zero tokens', () => {
        expect(calcGeminiCost(0, 0, 'gemini-1.5-flash')).toBe(0);
    });

    it('calculates input-only cost for gemini-1.5-flash', () => {
        // $0.075 per 1M input tokens
        expect(calcGeminiCost(1_000_000, 0, 'gemini-1.5-flash')).toBeCloseTo(0.075);
    });

    it('calculates output-only cost for gemini-1.5-flash', () => {
        // $0.30 per 1M output tokens
        expect(calcGeminiCost(0, 1_000_000, 'gemini-1.5-flash')).toBeCloseTo(0.30);
    });

    it('calculates combined input+output cost', () => {
        const cost = calcGeminiCost(1_000_000, 1_000_000, 'gemini-1.5-flash');
        expect(cost).toBeCloseTo(0.075 + 0.30);
    });

    it('uses longest prefix match: gemini-2.0-flash-exp before gemini-2.0-flash', () => {
        // gemini-2.0-flash-exp is free; gemini-2.0-flash is not
        const cost = calcGeminiCost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp');
        expect(cost).toBe(0);
    });

    it('matches gemini-2.0-flash for exact prefix', () => {
        const cost = calcGeminiCost(1_000_000, 0, 'gemini-2.0-flash');
        expect(cost).toBeCloseTo(GEMINI_PRICING['gemini-2.0-flash'].input);
    });

    it('matches gemini-1.5-flash-8b over gemini-1.5-flash', () => {
        const cost = calcGeminiCost(1_000_000, 0, 'gemini-1.5-flash-8b');
        expect(cost).toBeCloseTo(GEMINI_PRICING['gemini-1.5-flash-8b'].input);
    });

    it('uses fallback for unknown model', () => {
        const cost = calcGeminiCost(1_000_000, 0, 'unknown-model-xyz');
        expect(cost).toBeCloseTo(GEMINI_PRICING_FALLBACK.input);
    });

    it('uses fallback for empty model string', () => {
        const cost = calcGeminiCost(0, 1_000_000, '');
        expect(cost).toBeCloseTo(GEMINI_PRICING_FALLBACK.output);
    });

    it('scales correctly for partial token counts', () => {
        // 500k tokens at $0.10/M = $0.05
        const cost = calcGeminiCost(500_000, 0, 'gemini-2.0-flash');
        expect(cost).toBeCloseTo(0.05);
    });

    it('calculates cost for gemini-2.5-pro', () => {
        const cost = calcGeminiCost(1_000_000, 0, 'gemini-2.5-pro');
        expect(cost).toBeCloseTo(1.25);
    });

    it('matches model with version suffix via prefix', () => {
        // 'gemini-1.5-pro-002' should match 'gemini-1.5-pro'
        const cost = calcGeminiCost(1_000_000, 0, 'gemini-1.5-pro-002');
        expect(cost).toBeCloseTo(GEMINI_PRICING['gemini-1.5-pro'].input);
    });
});
