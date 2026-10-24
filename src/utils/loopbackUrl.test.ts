import { describe, it, expect } from 'vitest';
import { isLoopbackUrl, urlHost } from './loopbackUrl';

describe('isLoopbackUrl', () => {
    it('accepts this PC in every spelling', () => {
        expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
        expect(isLoopbackUrl('http://LOCALHOST:1234')).toBe(true);
        expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true);
        expect(isLoopbackUrl('http://127.1.2.3')).toBe(true);
        expect(isLoopbackUrl('http://[::1]:8080')).toBe(true);
    });

    it('refuses other machines and garbage', () => {
        expect(isLoopbackUrl('http://192.0.2.10:8080')).toBe(false);
        expect(isLoopbackUrl('http://localhost.example.com')).toBe(false);
        expect(isLoopbackUrl('http://[fd00::1]:8080')).toBe(false);
        expect(isLoopbackUrl('not a url')).toBe(false);
        expect(isLoopbackUrl('')).toBe(false);
    });
});

describe('urlHost', () => {
    it('keeps the port and lower-cases', () => {
        expect(urlHost('http://AI-Box.example.com:8080')).toBe('ai-box.example.com:8080');
        expect(urlHost('http://192.0.2.10')).toBe('192.0.2.10');
        expect(urlHost('nope')).toBeNull();
    });
});
