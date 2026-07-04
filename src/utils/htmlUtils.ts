import DOMPurify from 'dompurify';

/** Sanitizes HTML produced by marked to prevent XSS from malicious AI responses. */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'meta', 'svg', 'iframe', 'object', 'embed', 'script', 'link', 'base'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onanimationstart', 'onanimationend', 'ontransitionend'],
    });
}

/**
 * If a click landed on (or inside) an anchor carrying an http(s) href, return
 * that URL. AI-authored markdown links are untrusted: without interception a
 * click is a same-window top-level navigation that would replace the privileged
 * app UI in place (phishing / UI-redress). The caller preventDefault()s and
 * routes the returned URL through the vetted external-open path instead.
 * Returns null for non-anchor targets or non-http(s) schemes.
 */
export function externalLinkFromClick(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) return null;
    const href = target.closest('a')?.getAttribute('href') ?? '';
    return /^https?:\/\//i.test(href) ? href : null;
}
