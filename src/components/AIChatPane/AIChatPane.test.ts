import { describe, it, expect } from 'vitest';
import { calcGeminiCost } from '../../constants/geminiPricing';
import { sanitizeHtml } from '../../utils/htmlUtils';

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

describe('sanitizeHtml', () => {
    it('removes <script> tags', () => {
        const result = sanitizeHtml('<p>hello</p><script>alert(1)</script>');
        expect(result).not.toContain('<script');
        expect(result).toContain('hello');
    });

    it('removes <style> tags (CSS injection prevention)', () => {
        const result = sanitizeHtml('<p>hi</p><style>@import "javascript:alert(1)"</style>');
        expect(result).not.toContain('<style');
        expect(result).not.toContain('@import');
    });

    it('removes inline event handlers', () => {
        const result = sanitizeHtml('<p onclick="alert(1)">click</p>');
        expect(result).not.toContain('onclick');
    });

    it('removes javascript: href', () => {
        const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>');
        expect(result).not.toContain('javascript:');
    });

    it('removes data: src', () => {
        const result = sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">');
        expect(result).not.toMatch(/src\s*=\s*["']data:/i);
    });

    it('removes <iframe> tags', () => {
        const result = sanitizeHtml('<iframe src="https://evil.com"></iframe>');
        expect(result).not.toContain('<iframe');
    });

    it('preserves safe HTML', () => {
        const result = sanitizeHtml('<p><strong>hello</strong> <a href="https://example.com">link</a></p>');
        expect(result).toContain('<strong>hello</strong>');
        expect(result).toContain('href="https://example.com"');
    });
});
