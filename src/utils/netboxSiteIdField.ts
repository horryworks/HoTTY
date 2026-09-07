import type { SiteIdFieldChoices } from '../types/appTypes';

/**
 * Building the "Site ID field" picker.
 *
 * Pure, so the rules that matter — the picker is never empty, a stored setting
 * never disappears from it, and "type it in yourself" is always reachable — can
 * be tested without rendering the tab.
 */

/** No prefix: the folder is named exactly as NetBox names the site. */
export const SITE_ID_NONE = '';
/** Not a stored value: the row that reveals the free-text box. */
export const SITE_ID_OTHER = '__other__';

const CUSTOM_PREFIX = 'cf:';

/**
 * Fallback for the built-in choices before a successful connect. Mirrors
 * `SiteIdField::BUILT_INS` in `src-tauri/src/services/netbox/site_id.rs`; the
 * backend sends the authoritative list once connected, and this only keeps the
 * dropdown from being empty until then.
 */
export const DEFAULT_SITE_ID_BUILT_INS = ['slug', 'facility', 'description'];

export interface SiteIdOption {
    /** What gets stored when this row is chosen (or the `other` sentinel). */
    value: string;
    kind: 'none' | 'builtin' | 'custom' | 'other';
    /**
     * For `builtin`, NetBox's field name; for `custom`, NetBox's own label for
     * the field. Both are this deployment's data, so they are shown verbatim
     * and **not** translated. Empty for `none`/`other`, whose wording is UI
     * text and comes from i18n.
     */
    label: string;
}

/**
 * The rows of the picker, in order: no prefix, the built-ins, whatever custom
 * fields were discovered, then "Other".
 *
 * `choices` is `null` before a successful connect — the built-ins are still
 * offered, because they are known from the code and an empty dropdown looks
 * broken.
 */
export function siteIdOptions(
    choices: SiteIdFieldChoices | null,
    current: string,
): SiteIdOption[] {
    const out: SiteIdOption[] = [{ value: SITE_ID_NONE, kind: 'none', label: '' }];

    const builtIns = choices?.builtIns?.length ? choices.builtIns : DEFAULT_SITE_ID_BUILT_INS;
    for (const name of builtIns) {
        out.push({ value: name, kind: 'builtin', label: name });
    }

    const customs = choices?.customFields ?? [];
    for (const field of customs) {
        out.push({ value: field.value, kind: 'custom', label: field.label });
    }

    // A stored custom field the listing did not account for — the token lost
    // `extras.view_customfield`, or the definition was renamed — must still
    // appear, or a deliberate setting would look like "none" and be lost on the
    // next save.
    const stored = current.trim();
    if (stored.startsWith(CUSTOM_PREFIX) && !customs.some(f => f.value === stored)) {
        out.push({ value: stored, kind: 'custom', label: stored.slice(CUSTOM_PREFIX.length) });
    }

    // Always reachable: it is the only way in when the definitions cannot be read.
    out.push({ value: SITE_ID_OTHER, kind: 'other', label: '' });
    return out;
}

/** Restore the form state from a stored setting. */
export function selectionFor(
    stored: string,
    choices: SiteIdFieldChoices | null,
): { selected: string; customKeyInput: string } {
    const value = stored.trim();
    if (!value) return { selected: SITE_ID_NONE, customKeyInput: '' };
    const key = value.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : '';
    // `siteIdOptions` guarantees a row exists for any stored value, so the
    // select can always show it; the key is carried so switching to "Other"
    // starts from what is configured rather than from an empty box.
    const known = siteIdOptions(choices, value).some(o => o.value === value);
    return known ? { selected: value, customKeyInput: key } : { selected: SITE_ID_OTHER, customKeyInput: key };
}

/** What to store for the current form state. */
export function siteIdFieldToSend(selected: string, customKeyInput: string): string {
    if (selected !== SITE_ID_OTHER) return selected;
    const key = customKeyInput.trim();
    // An empty box means "no prefix", not `cf:` — a user must not be able to
    // earn a validation error they did not ask for.
    return key ? `${CUSTOM_PREFIX}${key}` : SITE_ID_NONE;
}

/**
 * Whether a typed custom-field key looks usable.
 *
 * Deliberately **no stricter** than the Rust parser: it only warns before
 * saving, and being stricter would refuse a key the backend accepts with no way
 * to override.
 */
export function customKeyLooksValid(key: string): boolean {
    const k = key.trim();
    return k.length > 0 && k.length <= 64 && /^[A-Za-z0-9_]+$/.test(k);
}

/**
 * How the last sync's Site ID coverage should be reported, or `null` when there
 * is nothing to say.
 *
 * Choosing the wrong field produces no error, no failed sync and no changed
 * name. This number is the only thing that separates "the feature is broken"
 * from "that field is empty on every site".
 */
export function siteIdOutcome(
    sites: number,
    without: number,
): { kind: 'none' | 'partial'; sites: number; without: number } | null {
    if (sites <= 0 || without <= 0) return null;
    return { kind: without >= sites ? 'none' : 'partial', sites, without };
}
