import { describe, it, expect } from 'vitest';
import { slugifyAlias, buildAliasEntries, resolveAlias } from './terminalAlias';

describe('slugifyAlias', () => {
    it('lowercases and collapses non-alphanumerics to single dashes', () => {
        expect(slugifyAlias('Local USG')).toBe('local-usg');
        expect(slugifyAlias('web_01.prod')).toBe('web-01-prod');
        expect(slugifyAlias('  Core  SW  ')).toBe('core-sw');
    });
    it('trims leading/trailing dashes and falls back to "term" when empty', () => {
        expect(slugifyAlias('@@@')).toBe('term');
        expect(slugifyAlias('')).toBe('term');
    });
});

describe('buildAliasEntries', () => {
    it('assigns a slug per terminal in order and marks live-ness', () => {
        const entries = buildAliasEntries([
            { sessionId: 's1', displayName: 'web-01', status: 'connected' },
            { sessionId: 's2', displayName: 'db-02', status: 'disconnected' },
        ]);
        expect(entries.map((e) => e.alias)).toEqual(['web-01', 'db-02']);
        expect(entries[0].live).toBe(true);
        expect(entries[1].live).toBe(false);
    });

    it('deduplicates colliding slugs deterministically (web, web-2, web-3)', () => {
        const entries = buildAliasEntries([
            { sessionId: 's1', displayName: 'web' },
            { sessionId: 's2', displayName: 'WEB' },
            { sessionId: 's3', displayName: 'web!' },
        ]);
        expect(entries.map((e) => e.alias)).toEqual(['web', 'web-2', 'web-3']);
    });

    it('falls back to the session id when a display name is missing', () => {
        const entries = buildAliasEntries([{ sessionId: 'sess-abc', displayName: '' }]);
        expect(entries[0].alias).toBe('sess-abc');
    });
});

describe('resolveAlias', () => {
    const entries = buildAliasEntries([
        { sessionId: 's1', displayName: 'web-01' },
        { sessionId: 's2', displayName: 'db-02' },
    ]);
    it('resolves a known alias (case-insensitively) to its session id', () => {
        expect(resolveAlias(entries, 'db-02')).toBe('s2');
        expect(resolveAlias(entries, 'WEB-01')).toBe('s1');
    });
    it('returns undefined for an unknown / missing alias (hallucinated target)', () => {
        expect(resolveAlias(entries, 'edge-99')).toBeUndefined();
        expect(resolveAlias(entries, undefined)).toBeUndefined();
    });
});
