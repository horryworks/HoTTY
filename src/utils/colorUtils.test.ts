import { describe, it, expect } from 'vitest';
import { hexToRgba, getTransparentColor } from './colorUtils';

describe('hexToRgba', () => {
    it('converts a standard hex color to rgba', () => {
        expect(hexToRgba('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)');
    });

    it('converts black', () => {
        expect(hexToRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
    });

    it('converts white', () => {
        expect(hexToRgba('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
    });

    it('converts a mixed color with fractional alpha', () => {
        expect(hexToRgba('#1e2a3b', 0.85)).toBe('rgba(30, 42, 59, 0.85)');
    });

    it('returns the original string if not a valid 7-char hex', () => {
        expect(hexToRgba('#abc', 1)).toBe('#abc');
    });

    it('returns the original string for non-hex values', () => {
        expect(hexToRgba('transparent', 1)).toBe('transparent');
    });

    it('returns the original string for empty string', () => {
        expect(hexToRgba('', 1)).toBe('');
    });
});

describe('getTransparentColor', () => {
    it('applies 0.85 alpha to a hex color', () => {
        expect(getTransparentColor('#1e1e1e')).toBe('rgba(30, 30, 30, 0.85)');
    });

    it('passes through non-hex values unchanged', () => {
        expect(getTransparentColor('transparent')).toBe('transparent');
    });
});
