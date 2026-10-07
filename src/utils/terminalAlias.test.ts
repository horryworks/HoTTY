import { describe, it, expect } from 'vitest';
import { slugifyAlias, buildAliasEntries, resolveAlias, assignAlias, watchedTerminalLabels } from './terminalAlias';

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

describe('stored aliases', () => {
    it('assignAlias picks the slug, then -2, -3 past the aliases already taken', () => {
        expect(assignAlias('Core SW', [])).toBe('core-sw');
        expect(assignAlias('Core SW', ['core-sw'])).toBe('core-sw-2');
        expect(assignAlias('Core SW', ['core-sw', 'core-sw-2'])).toBe('core-sw-3');
    });

    it('buildAliasEntries keeps a stored alias even after an earlier link is gone', () => {
        // Two same-named terminals: the second was linked as `core-2`. Unwatching
        // the first must NOT promote it to `core` — the model's history already
        // refers to it as core-2 (and to the other one as core).
        const stored = [
            { sessionId: 'a', displayName: 'core', alias: 'core' },
            { sessionId: 'b', displayName: 'core', alias: 'core-2' },
        ];
        expect(buildAliasEntries(stored).map((e) => e.alias)).toEqual(['core', 'core-2']);
        expect(buildAliasEntries([stored[1]]).map((e) => e.alias)).toEqual(['core-2']);
    });

    it('a link without a stored alias still gets one, avoiding the stored ones', () => {
        const entries = buildAliasEntries([
            { sessionId: 'a', displayName: 'core', alias: 'core' },
            { sessionId: 'b', displayName: 'core' },
        ]);
        expect(entries.map((e) => e.alias)).toEqual(['core', 'core-2']);
    });
});

describe('watchedTerminalLabels', () => {
    it('falls back to the name kept on the link once the session is gone', () => {
        const labels = watchedTerminalLabels(
            [{ sessionId: 'a', name: 'sw-01', alias: 'sw-01' }, { sessionId: 'b' }],
            () => undefined,
        );
        expect(labels.get('a')).toBe('sw-01');
        expect(labels.get('b')).toBe('');
    });

    it('adds the alias when two watched terminals share a name', () => {
        const labels = watchedTerminalLabels(
            [
                { sessionId: 'a', alias: 'sw-01' },
                { sessionId: 'b', alias: 'sw-01-2' },
                { sessionId: 'c', alias: 'ap-01' },
            ],
            (id) => (id === 'c' ? 'ap-01' : 'sw-01'),
        );
        expect(labels.get('a')).toBe('sw-01 (sw-01)');
        expect(labels.get('b')).toBe('sw-01 (sw-01-2)');
        expect(labels.get('c')).toBe('ap-01');
    });
});
