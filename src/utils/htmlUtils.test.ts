import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './htmlUtils';

describe('sanitizeHtml', () => {
    it('allows safe HTML through', () => {
        const input = '<p>Hello <strong>world</strong></p>';
        expect(sanitizeHtml(input)).toContain('Hello');
        expect(sanitizeHtml(input)).toContain('<strong>world</strong>');
    });

    it('removes <script> tags', () => {
        const input = '<p>Safe</p><script>alert("xss")</script>';
        expect(sanitizeHtml(input)).not.toContain('<script>');
        expect(sanitizeHtml(input)).not.toContain('alert');
    });

    it('removes inline event handlers', () => {
        const input = '<img src="x" onerror="alert(1)">';
        expect(sanitizeHtml(input)).not.toContain('onerror');
    });

    it('removes javascript: href', () => {
        const input = '<a href="javascript:alert(1)">click</a>';
        expect(sanitizeHtml(input)).not.toContain('javascript:');
    });

    it('removes <iframe> tags', () => {
        const input = '<iframe src="https://evil.com"></iframe>';
        expect(sanitizeHtml(input)).not.toContain('iframe');
    });

    it('removes SVG onload XSS', () => {
        const input = '<svg onload="alert(1)"></svg>';
        expect(sanitizeHtml(input)).not.toContain('onload');
    });

    it('removes data: URI in src attribute', () => {
        const input = '<img src="data:text/html,<script>alert(1)</script>">';
        const result = sanitizeHtml(input);
        expect(result).not.toContain('data:text/html');
    });

    it('removes <style> tags', () => {
        const input = '<style>body { display: none }</style><p>text</p>';
        expect(sanitizeHtml(input)).not.toContain('<style>');
    });
});
