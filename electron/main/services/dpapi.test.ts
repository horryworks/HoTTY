// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { encryptString, decryptString, verifyWindowsUser } from './dpapi';

describe('DPAPI prefix detection (via decryptString)', () => {
    it('treats non-prefixed string as legacy plaintext and returns as-is', async () => {
        expect(await decryptString('plaintext')).toBe('plaintext');
    });

    it('returns empty string unchanged', async () => {
        expect(await decryptString('')).toBe('');
    });

    it('treats partial prefix as legacy plaintext', async () => {
        expect(await decryptString('[DPAP]abc')).toBe('[DPAP]abc');
    });
});

describe('encryptString', () => {
    it('returns empty string unchanged', async () => {
        const result = await encryptString('');
        expect(result).toBe('');
    });

    it('throws on non-Windows platform', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(encryptString('secret')).rejects.toThrow('Windows');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('throws when input exceeds 1 MB', async () => {
        const bigInput = 'x'.repeat(1 * 1024 * 1024 + 1);
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        await expect(encryptString(bigInput)).rejects.toThrow('maximum size');

        Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
    });
});

describe('decryptString', () => {
    it('returns empty string unchanged', async () => {
        const result = await decryptString('');
        expect(result).toBe('');
    });

    it('returns non-DPAPI strings as-is (legacy plaintext passthrough)', async () => {
        const result = await decryptString('legacy-plaintext');
        expect(result).toBe('legacy-plaintext');
    });

    it('returns non-DPAPI strings with spaces as-is', async () => {
        const result = await decryptString('my password 123');
        expect(result).toBe('my password 123');
    });

    it('throws on non-Windows platform when value is DPAPI-encrypted', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(decryptString('[DPAPI]encrypteddata')).rejects.toThrow('Windows');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
});

describe('verifyWindowsUser', () => {
    it('returns false for empty password', async () => {
        const result = await verifyWindowsUser('');
        expect(result).toBe(false);
    });

    it('throws on non-Windows platform', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(verifyWindowsUser('password')).rejects.toThrow('Windows');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
});
