import { describe, it, expect } from 'vitest';
import { getContextWindow } from './aiContextWindow';

describe('getContextWindow', () => {
    it('matches the longest prefix', () => {
        expect(getContextWindow('gpt-4o-mini-2024-07-18')).toBe(128_000);
        expect(getContextWindow('gpt-4.1-mini')).toBe(1_047_576);
        expect(getContextWindow('o1-mini')).toBe(128_000);
        expect(getContextWindow('o1-preview')).toBe(200_000);
        expect(getContextWindow('gemini-1.5-pro-002')).toBe(2_097_152);
        expect(getContextWindow('claude-sonnet-4-5')).toBe(200_000);
    });

    it('strips a Vertex AI model path', () => {
        expect(getContextWindow('publishers/google/models/gemini-3.1-pro-preview')).toBe(1_048_576);
    });

    it('returns null for an unknown model', () => {
        expect(getContextWindow('gemini-pro')).toBeNull();
        expect(getContextWindow('llama-3-8b')).toBeNull();
    });
});
