import { describe, it, expect } from 'vitest';
import { MAX_MARKDOWN_BYTES, highlightHtml, isMarkdownFile } from './logMarkdown';
import { buildSearchRegex } from './logSearch';
import { renderMarkdown } from '../../utils/markdown';

/** The find bar's regex, built the same way the pane builds it. */
function re(query: string, opts = { caseSensitive: false, useRegex: false }): RegExp {
  const r = buildSearchRegex(query, opts);
  if (!r) throw new Error(`query did not compile: ${query}`);
  return r;
}

/** Text as the user would see it after `html` is put on screen. */
function visibleText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent ?? '';
}

describe('isMarkdownFile', () => {
  it('accepts .md, case-insensitively', () => {
    expect(isMarkdownFile('20260727091402-AICHAT-router-a.md')).toBe(true);
    expect(isMarkdownFile('NOTES.MD')).toBe(true);
  });

  it('rejects every other log extension', () => {
    expect(isMarkdownFile('20260727091402-SSH-router-a.txt')).toBe(false);
    expect(isMarkdownFile('20260820120000-PING-MONITOR.csv')).toBe(false);
    expect(isMarkdownFile('session.tslog')).toBe(false);
    expect(isMarkdownFile('mdfile')).toBe(false);
    // Not a suffix match on the stem.
    expect(isMarkdownFile('readme.md.txt')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('formats the structures an AI chat transcript uses', () => {
    const html = renderMarkdown(
      '# AI Chat — router-a\n\n' +
        '## [2026-07-27 09:14:15.660] Assistant\n\n' +
        'Here is the **version**.\n\n' +
        '| Field | Value |\n| --- | --- |\n| IOS | 15.2 |\n\n' +
        '- bullet one\n- bullet two\n',
    );
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>version</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('<li>bullet one</li>');
  });

  it('renders a fenced user turn as a code block', () => {
    const html = renderMarkdown('```text\nshow version\n```\n');
    expect(html).toContain('<pre>');
    expect(html).toContain('show version');
  });

  it('strips script tags and event handlers', () => {
    // The log folder is a user folder — a .md there may have been written by
    // anything, not only by this app.
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });
});

describe('highlightHtml', () => {
  it('wraps matches in an ordinal-tagged <mark>', () => {
    const { html, total, truncated } = highlightHtml('<p>alpha beta alpha</p>', re('alpha'));
    expect(total).toBe(2);
    expect(truncated).toBe(false);
    expect(html).toContain('<mark class="log-viewer-mark" data-match-index="0">alpha</mark>');
    expect(html).toContain('<mark class="log-viewer-mark" data-match-index="1">alpha</mark>');
  });

  it('numbers matches continuously across elements', () => {
    const { html, total } = highlightHtml('<h1>hit</h1><p>hit</p><pre><code>hit</code></pre>', re('hit'));
    expect(total).toBe(3);
    expect(html).toContain('data-match-index="0"');
    expect(html).toContain('data-match-index="1"');
    expect(html).toContain('data-match-index="2"');
    // Structure survives — highlighting must not flatten the document.
    expect(html).toContain('<h1>');
    expect(html).toContain('<code>');
  });

  it('never alters the text the user sees', () => {
    const source = renderMarkdown('# Title\n\nsome **bold** text and a `code` span\n');
    const { html } = highlightHtml(source, re('o'));
    expect(visibleText(html)).toBe(visibleText(source));
  });

  it('leaves html untouched when nothing matches', () => {
    const source = '<p>alpha</p>';
    const { html, total } = highlightHtml(source, re('zulu'));
    expect(html).toBe(source);
    expect(total).toBe(0);
  });

  it('does not match markdown syntax that formatting consumed', () => {
    // The raw view would find this `#`; the formatted view genuinely has none.
    const { total } = highlightHtml(renderMarkdown('# Title\n'), re('#'));
    expect(total).toBe(0);
  });

  it('cannot match across an element boundary', () => {
    // `**bo**ld` becomes <strong>bo</strong>ld — a documented limit of
    // searching rendered output rather than source.
    const { total } = highlightHtml(renderMarkdown('**bo**ld\n'), re('bold'));
    expect(total).toBe(0);
  });

  it('reports truncation once the cap is reached', () => {
    const { total, truncated } = highlightHtml('<p>aaaa</p>', re('a'), 2);
    expect(total).toBe(2);
    expect(truncated).toBe(true);
  });

  it('caps across elements, not per element', () => {
    const { total, truncated } = highlightHtml('<p>a</p><p>a</p><p>a</p>', re('a'), 2);
    expect(total).toBe(2);
    expect(truncated).toBe(true);
  });

  it('does not treat matched text as markup', () => {
    // A literal `<b>` in the log is text; highlighting it must not make it a tag.
    const source = renderMarkdown('a <b>literal</b> tag\n');
    const { html } = highlightHtml(source, re('literal'));
    expect(html).toContain('data-match-index="0"');
    expect(visibleText(html)).toBe(visibleText(source));
  });

  it('honours case sensitivity and regex mode from the find bar', () => {
    expect(highlightHtml('<p>Alpha alpha</p>', re('alpha')).total).toBe(2);
    expect(
      highlightHtml('<p>Alpha alpha</p>', re('alpha', { caseSensitive: true, useRegex: false })).total,
    ).toBe(1);
    expect(
      highlightHtml('<p>a1 b2</p>', re('[a-z][0-9]', { caseSensitive: false, useRegex: true })).total,
    ).toBe(2);
  });

  it('caps the formatted view well below the backend read limit', () => {
    // Formatting is synchronous; the guard is what keeps a huge file from
    // freezing the pane.
    expect(MAX_MARKDOWN_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});
