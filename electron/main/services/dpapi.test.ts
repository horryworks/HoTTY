// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { isDpapiEncrypted, encryptString, decryptString, verifyWindowsUser } from './dpapi';

describe('isDpapiEncrypted', () => {
    it('returns true for strings with [DPAPI] prefix', () => {
        expect(isDpapiEncrypted('[DPAPI]abc123')).toBe(true);
    });

    it('returns false for plain strings', () => {
        expect(isDpapiEncrypted('plaintext')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isDpapiEncrypted('')).toBe(false);
    });

    it('returns false for partial prefix', () => {
        expect(isDpapiEncrypted('[DPAP]abc')).toBe(false);
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
