import { describe, it, expect } from 'vitest';
import { fitWatchSections, MAX_WATCH_PREFIX_BYTES } from './aiWatchPrefix';

describe('fitWatchSections', () => {
    it('leaves sections that fit untouched', () => {
        const out = fitWatchSections([{ name: 'a', text: 'hello' }, { name: 'b', text: 'world' }], 100);
        expect(out).toEqual([
            { name: 'a', text: 'hello', omittedBytes: 0 },
            { name: 'b', text: 'world', omittedBytes: 0 },
        ]);
    });

    it('keeps the tail of each section when the total is over budget', () => {
        const a = 'A'.repeat(60);
        const b = 'B'.repeat(60);
        const out = fitWatchSections([{ name: 'a', text: a }, { name: 'b', text: b }], 40);
        expect(out[0].text).toBe('A'.repeat(20));
        expect(out[0].omittedBytes).toBe(40);
        expect(out[1].text).toBe('B'.repeat(20));
        expect(out[1].omittedBytes).toBe(40);
    });

    it('does not lend a small section’s slack, and leaves it whole', () => {
        const out = fitWatchSections([{ name: 'a', text: 'x'.repeat(100) }, { name: 'b', text: 'short' }], 50);
        expect(out[0].text).toBe('x'.repeat(25));
        expect(out[1]).toEqual({ name: 'b', text: 'short', omittedBytes: 0 });
    });

    it('cuts on a character boundary, never inside a multi-byte character', () => {
        // Each 'あ' is 3 bytes; a 7-byte budget can hold two whole characters.
        const text = 'あ'.repeat(5);
        const [s] = fitWatchSections([{ name: 'jp', text }], 7);
        expect(s.text).toBe('ああ');
        expect(s.omittedBytes).toBe(9);
        expect(s.text).not.toContain('�');
    });

    it('measures the budget in bytes, so multi-byte scrollback is trimmed by size', () => {
        // 400,000 three-byte characters = 1.2 MB: over the default budget even
        // though the JS string length (400,000) is well under it.
        const text = 'あ'.repeat(400_000);
        const [s] = fitWatchSections([{ name: 'jp', text }]);
        expect(new TextEncoder().encode(s.text).length).toBeLessThanOrEqual(MAX_WATCH_PREFIX_BYTES);
        expect(s.omittedBytes).toBeGreaterThan(0);
    });
});
