import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './versionUtils';

describe('isNewerVersion', () => {
    it('returns true when major version is newer', () => {
        expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    });

    it('returns true when minor version is newer', () => {
        expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    });

    it('returns true when patch version is newer', () => {
        expect(isNewerVersion('1.0.2', '1.0.1')).toBe(true);
    });

    it('returns false when versions are equal', () => {
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });

    it('returns false when latest is older by major', () => {
        expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false);
    });

    it('returns false when latest is older by minor', () => {
        expect(isNewerVersion('1.1.0', '1.2.0')).toBe(false);
    });

    it('returns false when latest is older by patch', () => {
        expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    });

    it('returns false for pre-release style version equal to current', () => {
        expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });
});
