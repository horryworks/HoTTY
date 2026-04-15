import DOMPurify from 'dompurify';

/** Sanitizes HTML produced by marked to prevent XSS from malicious AI responses. */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'meta', 'svg', 'iframe', 'object', 'embed', 'script', 'link', 'base'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onanimationstart', 'onanimationend', 'ontransitionend'],
    });
}
