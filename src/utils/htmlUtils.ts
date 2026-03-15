/** Sanitizes HTML produced by marked to prevent XSS from malicious AI responses. */
export function sanitizeHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove inherently dangerous elements
    doc.querySelectorAll('script, style, iframe, object, embed, form, input, meta, link[rel="import"]').forEach(el => el.remove());

    // Strip event handlers and dangerous attribute values from all remaining elements
    doc.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        });
        if (el.hasAttribute('href') && /^(javascript|vbscript|data):/i.test(el.getAttribute('href')!)) {
            el.removeAttribute('href');
        }
        if (el.hasAttribute('src') && /^(javascript|data):/i.test(el.getAttribute('src')!)) {
            el.removeAttribute('src');
        }
    });

    return doc.body.innerHTML;
}
