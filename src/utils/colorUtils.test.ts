import { describe, it, expect } from 'vitest';
import { getTransparentColor } from './colorUtils';

describe('getTransparentColor', () => {
    it('returns the hex color unchanged', () => {
        expect(getTransparentColor('#1e1e1e')).toBe('#1e1e1e');
    });

    it('returns white unchanged', () => {
        expect(getTransparentColor('#ffffff')).toBe('#ffffff');
    });

    it('passes through non-hex values unchanged', () => {
        expect(getTransparentColor('transparent')).toBe('transparent');
    });
});
