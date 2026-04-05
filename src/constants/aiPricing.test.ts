import { describe, it, expect } from 'vitest';
import { calcAICost } from './aiPricing';

describe('calcAICost', () => {
    // ── Model coverage (verifies pricing table entries exist) ────────────────
    it('recognises all expected Gemini models', () => {
        const models = [
            'gemini-3.1-pro', 'gemini-3.1-flash-lite',
            'gemini-3-pro', 'gemini-3-flash',
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
            'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-exp',
            'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
        ];
        for (const m of models) {
            expect(calcAICost(1_000_000, 0, m), `${m} should be recognised`).not.toBeNull();
        }
    });

    it('recognises all expected OpenAI models', () => {
        const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini'];
        for (const m of models) {
            expect(calcAICost(1_000_000, 0, m), `${m} should be recognised`).not.toBeNull();
        }
    });

    it('recognises all expected Anthropic models', () => {
        const models = ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4', 'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'];
        for (const m of models) {
            expect(calcAICost(1_000_000, 0, m), `${m} should be recognised`).not.toBeNull();
        }
    });

    it('gemini-2.0-flash-exp is free tier', () => {
        expect(calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp')).toBe(0);
    });

    // ── Basic cost calculations ──────────────────────────────────────────────
    it('returns 0 for zero tokens', () => {
        expect(calcAICost(0, 0, 'gemini-1.5-flash')).toBe(0);
    });

    it('calculates input-only cost for gemini-1.5-flash', () => {
        expect(calcAICost(1_000_000, 0, 'gemini-1.5-flash')).toBeCloseTo(0.075);
    });

    it('calculates output-only cost for gemini-1.5-flash', () => {
        expect(calcAICost(0, 1_000_000, 'gemini-1.5-flash')).toBeCloseTo(0.30);
    });

    it('calculates combined input+output cost', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-1.5-flash');
        expect(cost).toBeCloseTo(0.075 + 0.30);
    });

    it('uses longest prefix match: gemini-2.0-flash-exp before gemini-2.0-flash', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-2.0-flash-exp');
        expect(cost).toBe(0);
    });

    it('matches gemini-2.0-flash for exact prefix', () => {
        const cost = calcAICost(1_000_000, 0, 'gemini-2.0-flash');
        expect(cost).toBeCloseTo(0.10);
    });

    it('matches gemini-1.5-flash-8b over gemini-1.5-flash', () => {
        const cost = calcAICost(1_000_000, 0, 'gemini-1.5-flash-8b');
        expect(cost).toBeCloseTo(0.0375);
    });

    it('calculates cost for gemini-3.1-pro', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-3.1-pro-preview');
        expect(cost).toBeCloseTo(2.00 + 12.00);
    });

    it('calculates cost for gemini-3.1-flash-lite', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-3.1-flash-lite-preview');
        expect(cost).toBeCloseTo(0.25 + 1.50);
    });

    it('calculates cost for gemini-3-pro', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-3-pro-preview');
        expect(cost).toBeCloseTo(2.00 + 12.00);
    });

    it('calculates cost for gemini-3-flash', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-3-flash-preview');
        expect(cost).toBeCloseTo(0.50 + 3.00);
    });

    it('calculates cost for gemini-2.5-pro', () => {
        const cost = calcAICost(1_000_000, 0, 'gemini-2.5-pro');
        expect(cost).toBeCloseTo(1.25);
    });

    it('calculates cost for gemini-2.5-flash', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-2.5-flash');
        expect(cost).toBeCloseTo(0.30 + 2.50);
    });

    it('calculates cost for gemini-2.5-flash-lite', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gemini-2.5-flash-lite');
        expect(cost).toBeCloseTo(0.10 + 0.40);
    });

    it('matches model with version suffix via prefix', () => {
        const cost = calcAICost(1_000_000, 0, 'gemini-1.5-pro-002');
        expect(cost).toBeCloseTo(1.25);
    });

    it('scales correctly for partial token counts', () => {
        const cost = calcAICost(500_000, 0, 'gemini-2.0-flash');
        expect(cost).toBeCloseTo(0.05);
    });

    // ── OpenAI ──��───────────────────────────────���─────────────────────────────
    it('calculates cost for gpt-4o', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gpt-4o');
        expect(cost).toBeCloseTo(2.50 + 10.00);
    });

    it('matches gpt-4o-mini over gpt-4o', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'gpt-4o-mini');
        expect(cost).toBeCloseTo(0.15 + 0.60);
    });

    it('calculates cost for o3-mini', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'o3-mini');
        expect(cost).toBeCloseTo(1.10 + 4.40);
    });

    it('matches gpt-4o with version suffix', () => {
        const cost = calcAICost(1_000_000, 0, 'gpt-4o-2024-08-06');
        expect(cost).toBeCloseTo(2.50);
    });

    // ── Anthropic ────────────────────────��────────────────────────────────────
    it('calculates cost for claude-sonnet-4', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'claude-sonnet-4-6');
        expect(cost).toBeCloseTo(3.00 + 15.00);
    });

    it('calculates cost for claude-opus-4', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'claude-opus-4-6');
        expect(cost).toBeCloseTo(15.00 + 75.00);
    });

    it('calculates cost for claude-3-haiku', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'claude-3-haiku-20240307');
        expect(cost).toBeCloseTo(0.25 + 1.25);
    });

    // ── Unknown models ──────────────���───────────────────────────────────���─────
    it('returns null for unknown model', () => {
        expect(calcAICost(1_000_000, 0, 'unknown-model-xyz')).toBeNull();
    });

    it('returns null for empty model string', () => {
        expect(calcAICost(0, 1_000_000, '')).toBeNull();
    });

    it('returns null for Vertex AI non-matching model', () => {
        expect(calcAICost(1_000_000, 0, 'publishers/google/models/custom')).toBeNull();
    });

    // ── Vertex AI path format ───────��────────────────────────────────────────
    it('calculates cost for Vertex AI Google model path', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'publishers/google/models/gemini-3.1-pro-preview');
        expect(cost).toBeCloseTo(2.00 + 12.00);
    });

    it('calculates cost for Vertex AI Anthropic model path', () => {
        const cost = calcAICost(1_000_000, 1_000_000, 'publishers/anthropic/models/claude-sonnet-4-6');
        expect(cost).toBeCloseTo(3.00 + 15.00);
    });
});
