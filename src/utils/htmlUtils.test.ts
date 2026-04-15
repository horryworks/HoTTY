import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './htmlUtils';

describe('sanitizeHtml', () => {
  it('allows safe HTML tags', () => {
    const result = sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(result).toContain('<p>');
    expect(result).toContain('<strong>');
  });

  it('strips forbidden tags', () => {
    expect(sanitizeHtml('<style>body{color:red}</style>')).not.toContain('<style');
    expect(sanitizeHtml('<form action="/x"><input /></form>')).not.toContain('<form');
    expect(sanitizeHtml('<meta charset="utf-8">')).not.toContain('<meta');
  });

  it('strips style attributes', () => {
    const result = sanitizeHtml('<div style="color:red">text</div>');
    expect(result).not.toContain('style=');
    expect(result).toContain('text');
  });

  it('strips script tags', () => {
    const result = sanitizeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('strips svg, iframe, object, embed, link, base tags', () => {
    expect(sanitizeHtml('<svg onload="alert(1)"></svg>')).not.toContain('<svg');
    expect(sanitizeHtml('<iframe src="x"></iframe>')).not.toContain('<iframe');
    expect(sanitizeHtml('<object data="x"></object>')).not.toContain('<object');
    expect(sanitizeHtml('<embed src="x">')).not.toContain('<embed');
    expect(sanitizeHtml('<link rel="stylesheet" href="x">')).not.toContain('<link');
    expect(sanitizeHtml('<base href="x">')).not.toContain('<base');
  });

  it('strips inline event handler attributes', () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)" onload="alert(2)">');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('onload');
  });

  it('strips onclick and other event handlers on safe tags', () => {
    const result = sanitizeHtml('<a href="#" onclick="alert(1)" onmouseover="alert(2)">x</a>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onmouseover');
  });
});
