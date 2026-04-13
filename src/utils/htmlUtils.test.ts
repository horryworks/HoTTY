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
});
