import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

/** Text as the user would see it once `html` is on screen. */
function visibleText(html: string): string {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent ?? '';
}

describe('renderMarkdown', () => {
    it('turns the structures an AI reply uses into markup', () => {
        const html = renderMarkdown(
            'Here is the **version**.\n\n' +
                '| Field | Value |\n| --- | --- |\n| IOS | 15.2 |\n\n' +
                '- bullet one\n- bullet two\n',
        );
        expect(html).toContain('<strong>version</strong>');
        expect(html).toContain('<table>');
        expect(html).toContain('<li>bullet one</li>');
    });

    it('renders a fenced block as a code block', () => {
        const html = renderMarkdown('```text\nshow version\n```\n');
        expect(html).toContain('<pre>');
        expect(html).toContain('show version');
    });

    it('treats a single newline as a space, not a line break', () => {
        // `breaks: false` is a deliberate default: the AI Chat pane and the Log
        // Viewer must parse the same reply identically, so neither may opt into
        // a different `marked` configuration.
        expect(renderMarkdown('one\ntwo\n')).not.toContain('<br>');
    });

    it('escapes HTML that came in as literal text', () => {
        const html = renderMarkdown('Use `<div>` for a block.');
        expect(html).toContain('&lt;div&gt;');
    });
});

describe('renderMarkdown sanitization', () => {
    // There is no way to obtain unsanitized HTML from this module — the sanitize
    // step is folded in, because both callers hand the result straight to
    // `dangerouslySetInnerHTML`. A reply is written by an AI, or by whatever
    // dropped a .md into the user's log folder; neither is trusted.

    it('strips script tags', () => {
        const html = renderMarkdown('before\n\n<script>alert(1)</script>\n\nafter');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('alert(1)');
    });

    it('strips inline event handlers', () => {
        const html = renderMarkdown('<img src="x" onerror="alert(1)">');
        expect(html).not.toContain('onerror');
    });

    it('strips the tags that could reach out of the app', () => {
        const html = renderMarkdown(
            '<iframe src="https://example.com"></iframe>\n\n' +
                '<object data="x"></object>\n\n' +
                '<embed src="x">\n\n' +
                '<link rel="stylesheet" href="https://example.com/x.css">\n\n' +
                '<base href="https://example.com/">',
        );
        for (const tag of ['<iframe', '<object', '<embed', '<link', '<base']) {
            expect(html).not.toContain(tag);
        }
    });

    it('strips style tags and style attributes', () => {
        const html = renderMarkdown(
            '<style>body{display:none}</style>\n\n<p style="position:fixed">x</p>',
        );
        expect(html).not.toContain('<style');
        expect(html).not.toContain('style=');
    });

    it('drops a javascript: link but keeps its text', () => {
        const html = renderMarkdown('[click me](javascript:alert(1))');
        expect(html).not.toContain('javascript:');
        expect(visibleText(html)).toContain('click me');
    });

    it('keeps an ordinary http(s) link intact', () => {
        // MarkdownContent intercepts the click; the href itself must survive so
        // there is something to hand to the vetted opener.
        const html = renderMarkdown('[docs](https://example.com/guide)');
        expect(html).toContain('href="https://example.com/guide"');
    });
});
