import { describe, it, expect } from 'vitest';
import type { SiteIdFieldChoices } from '../types/appTypes';
import {
    DEFAULT_SITE_ID_BUILT_INS,
    SITE_ID_NONE,
    SITE_ID_OTHER,
    customKeyLooksValid,
    selectionFor,
    siteIdFieldToSend,
    siteIdOptions,
    siteIdOutcome,
} from './netboxSiteIdField';

const choices = (over: Partial<SiteIdFieldChoices> = {}): SiteIdFieldChoices => ({
    customFieldsReadable: true,
    customFields: [],
    builtIns: ['slug', 'facility', 'description'],
    ...over,
});

describe('siteIdOptions', () => {
    it('offers the built-ins before a successful connect', () => {
        // An empty dropdown looks broken; these are known from the code.
        const opts = siteIdOptions(null, SITE_ID_NONE);
        expect(opts.map(o => o.value)).toEqual([
            SITE_ID_NONE,
            ...DEFAULT_SITE_ID_BUILT_INS,
            SITE_ID_OTHER,
        ]);
    });

    it('lists discovered custom fields after the built-ins', () => {
        const c = choices({
            customFields: [{ value: 'cf:site_code', label: 'Site Code' }],
        });
        const opts = siteIdOptions(c, SITE_ID_NONE);
        expect(opts.map(o => o.value)).toEqual([
            SITE_ID_NONE,
            'slug',
            'facility',
            'description',
            'cf:site_code',
            SITE_ID_OTHER,
        ]);
        const custom = opts.find(o => o.value === 'cf:site_code');
        // NetBox's own wording, shown verbatim — not our UI text.
        expect(custom?.label).toBe('Site Code');
        expect(custom?.kind).toBe('custom');
    });

    it('keeps a stored custom field that the listing did not mention', () => {
        // The token lost `extras.view_customfield`, or the field was renamed.
        // A deliberate setting must not silently read as "none".
        const opts = siteIdOptions(choices(), 'cf:site_code');
        const row = opts.find(o => o.value === 'cf:site_code');
        expect(row).toBeDefined();
        expect(row?.label).toBe('site_code');
    });

    it('does not duplicate a stored field that IS in the listing', () => {
        const c = choices({ customFields: [{ value: 'cf:site_code', label: 'Site Code' }] });
        const opts = siteIdOptions(c, 'cf:site_code');
        expect(opts.filter(o => o.value === 'cf:site_code')).toHaveLength(1);
    });

    it('always ends with the type-it-in row', () => {
        // The only way in when the custom-field definitions cannot be read.
        for (const c of [null, choices(), choices({ customFieldsReadable: false })]) {
            const opts = siteIdOptions(c, SITE_ID_NONE);
            expect(opts[opts.length - 1].value).toBe(SITE_ID_OTHER);
        }
    });

    it('prefers the built-ins the backend sent over the local fallback', () => {
        const opts = siteIdOptions(choices({ builtIns: ['slug'] }), SITE_ID_NONE);
        expect(opts.filter(o => o.kind === 'builtin').map(o => o.value)).toEqual(['slug']);
    });
});

describe('selectionFor', () => {
    it('maps an empty setting to "no prefix"', () => {
        expect(selectionFor('', null)).toEqual({ selected: SITE_ID_NONE, customKeyInput: '' });
    });

    it('maps a built-in to itself', () => {
        expect(selectionFor('facility', choices())).toEqual({
            selected: 'facility',
            customKeyInput: '',
        });
    });

    it('selects a custom field and carries its key for the Other box', () => {
        const c = choices({ customFields: [{ value: 'cf:site_code', label: 'Site Code' }] });
        expect(selectionFor('cf:site_code', c)).toEqual({
            selected: 'cf:site_code',
            customKeyInput: 'site_code',
        });
    });

    it('still selects a custom field the listing did not mention', () => {
        expect(selectionFor('cf:site_code', choices())).toEqual({
            selected: 'cf:site_code',
            customKeyInput: 'site_code',
        });
    });
});

describe('siteIdFieldToSend', () => {
    it('passes a plain selection through', () => {
        expect(siteIdFieldToSend('facility', '')).toBe('facility');
        expect(siteIdFieldToSend(SITE_ID_NONE, 'ignored')).toBe(SITE_ID_NONE);
    });

    it('builds cf:<key> from the Other box', () => {
        expect(siteIdFieldToSend(SITE_ID_OTHER, '  site_code ')).toBe('cf:site_code');
    });

    it('sends "no prefix" when Other is chosen with an empty box', () => {
        // Never a bare `cf:`, which the backend would reject — a user must not
        // earn a validation error they did not ask for.
        expect(siteIdFieldToSend(SITE_ID_OTHER, '')).toBe(SITE_ID_NONE);
        expect(siteIdFieldToSend(SITE_ID_OTHER, '   ')).toBe(SITE_ID_NONE);
    });
});

describe('customKeyLooksValid', () => {
    it('accepts what the Rust parser accepts', () => {
        // Mirrors `SiteIdField::parse`; being STRICTER here would refuse a key
        // the backend takes, with no way to override.
        for (const ok of ['site_code', 'SiteCode', 'a', 'x1_2', 'A'.repeat(64)]) {
            expect(customKeyLooksValid(ok)).toBe(true);
        }
    });

    it('rejects what the Rust parser rejects', () => {
        for (const bad of ['', '   ', 'bad-key', 'has space', 'sïte', 'a'.repeat(65)]) {
            expect(customKeyLooksValid(bad)).toBe(false);
        }
    });
});

describe('siteIdOutcome', () => {
    it('says nothing when every site has a code', () => {
        expect(siteIdOutcome(37, 0)).toBeNull();
    });

    it('says nothing when there are no sites at all', () => {
        expect(siteIdOutcome(0, 0)).toBeNull();
    });

    it('distinguishes "some are missing" from "none has one"', () => {
        // The second is the signal that the wrong field was chosen.
        expect(siteIdOutcome(37, 12)).toEqual({ kind: 'partial', sites: 37, without: 12 });
        expect(siteIdOutcome(37, 37)).toEqual({ kind: 'none', sites: 37, without: 37 });
    });
});
