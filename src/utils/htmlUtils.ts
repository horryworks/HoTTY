import DOMPurify from 'dompurify';

/** Sanitizes HTML produced by marked to prevent XSS from malicious AI responses. */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'meta', 'svg', 'iframe', 'object', 'embed', 'script', 'link', 'base'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onanimationstart', 'onanimationend', 'ontransitionend'],
    });
}

/**
 * If a click landed on (or inside) an anchor pointing at an off-origin http(s)
 * destination, return that URL. AI-authored markdown links are untrusted:
 * without interception a click is a same-window top-level navigation that would
 * replace the privileged app UI in place (phishing / UI-redress). The caller
 * preventDefault()s every anchor click and routes the returned URL through the
 * vetted external-open path instead.
 *
 * The href is resolved against the document base BEFORE the scheme is checked,
 * because the browser navigates to the resolved URL, not to the raw attribute.
 * Pattern-matching the raw string let two shapes through that DOMPurify permits:
 * protocol-relative `//host/x` (its ALLOWED_URI_REGEXP accepts a leading `/`),
 * and hrefs carrying \n / \r / \t inside the scheme (`ht\ntps://host/x`), which
 * getAttribute() returns verbatim but the URL parser strips at navigation time.
 * Both resolved to an attacker origin while failing a `^https?://` test, so the
 * caller never cancelled the click.
 *
 * Returns null for non-anchor targets, unparseable hrefs, same-origin links
 * (in-page `#fragment` navigation must not be handed to the external opener),
 * and any scheme other than http/https.
 */
export function externalLinkFromClick(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) return null;
    const anchor = target.closest('a');
    if (!anchor) return null;
    let url: URL;
    try {
        url = new URL(anchor.getAttribute('href') ?? '', document.baseURI);
    } catch {
        return null;
    }
    if (url.origin === window.location.origin) return null;
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}
