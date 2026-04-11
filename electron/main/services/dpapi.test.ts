// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((plaintext: string) => Buffer.from(`enc:${plaintext}`)),
        decryptString: vi.fn((buf: Buffer) => {
            const str = buf.toString();
            if (!str.startsWith('enc:')) throw new Error('Invalid encrypted data');
            return str.slice(4);
        }),
    },
}));

import { safeStorage } from 'electron';
import { encryptString, decryptString, encryptBatch, decryptBatch, isAnyEncrypted, verifyWindowsUser } from './dpapi';

const mockSafeStorage = vi.mocked(safeStorage);

beforeEach(() => {
    vi.clearAllMocks();
    mockSafeStorage.isEncryptionAvailable.mockReturnValue(true);
    mockSafeStorage.encryptString.mockImplementation((plaintext: string) => Buffer.from(`enc:${plaintext}`));
    mockSafeStorage.decryptString.mockImplementation((buf: Buffer) => {
        const str = buf.toString();
        if (!str.startsWith('enc:')) throw new Error('Invalid encrypted data');
        return str.slice(4);
    });
});

describe('isAnyEncrypted', () => {
    it('detects [DPAPI] prefix', () => {
        expect(isAnyEncrypted('[DPAPI]abc')).toBe(true);
    });

    it('detects [SAFE] prefix', () => {
        expect(isAnyEncrypted('[SAFE]abc')).toBe(true);
    });

    it('returns false for plaintext', () => {
        expect(isAnyEncrypted('plaintext')).toBe(false);
    });

    it('returns false for partial prefix', () => {
        expect(isAnyEncrypted('[DPAP]abc')).toBe(false);
        expect(isAnyEncrypted('[SAF]abc')).toBe(false);
    });
});

describe('encryptString', () => {
    it('returns empty string unchanged', async () => {
        expect(await encryptString('')).toBe('');
    });

    it('produces [SAFE] prefixed output', async () => {
        const result = await encryptString('secret');
        expect(result.startsWith('[SAFE]')).toBe(true);
        expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('secret');
    });

    it('throws when safeStorage is unavailable', async () => {
        mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
        await expect(encryptString('secret')).rejects.toThrow('not available');
    });

    it('base64 encodes the encrypted buffer', async () => {
        const result = await encryptString('hello');
        const base64Part = result.slice('[SAFE]'.length);
        const decoded = Buffer.from(base64Part, 'base64').toString();
        expect(decoded).toBe('enc:hello');
    });
});

describe('decryptString', () => {
    it('returns empty string unchanged', async () => {
        expect(await decryptString('')).toBe('');
    });

    it('returns non-encrypted strings as-is (legacy plaintext passthrough)', async () => {
        expect(await decryptString('legacy-plaintext')).toBe('legacy-plaintext');
    });

    it('returns non-encrypted strings with spaces as-is', async () => {
        expect(await decryptString('my password 123')).toBe('my password 123');
    });

    it('treats partial prefix as legacy plaintext', async () => {
        expect(await decryptString('[DPAP]abc')).toBe('[DPAP]abc');
    });

    it('decrypts [SAFE] prefixed values using safeStorage', async () => {
        const encrypted = Buffer.from('enc:mysecret').toString('base64');
        const result = await decryptString(`[SAFE]${encrypted}`);
        expect(result).toBe('mysecret');
        expect(mockSafeStorage.decryptString).toHaveBeenCalled();
    });

    it('throws on non-Windows platform when value is [DPAPI]-encrypted', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(decryptString('[DPAPI]encrypteddata')).rejects.toThrow('Windows');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
});

describe('encryptBatch', () => {
    it('returns empty array for empty input', async () => {
        expect(await encryptBatch([])).toEqual([]);
    });

    it('encrypts multiple values with [SAFE] prefix', async () => {
        const results = await encryptBatch(['user1', 'pass1']);
        expect(results).toHaveLength(2);
        expect(results[0]!.startsWith('[SAFE]')).toBe(true);
        expect(results[1]!.startsWith('[SAFE]')).toBe(true);
    });

    it('passes through undefined values', async () => {
        const results = await encryptBatch([undefined, 'secret', undefined]);
        expect(results[0]).toBeUndefined();
        expect(results[1]!.startsWith('[SAFE]')).toBe(true);
        expect(results[2]).toBeUndefined();
    });

    it('skips already encrypted values', async () => {
        const results = await encryptBatch(['[SAFE]existing', '[DPAPI]legacy', 'plain']);
        expect(results[0]).toBe('[SAFE]existing');
        expect(results[1]).toBe('[DPAPI]legacy');
        expect(results[2]!.startsWith('[SAFE]')).toBe(true);
        expect(mockSafeStorage.encryptString).toHaveBeenCalledTimes(1);
    });

    it('throws when safeStorage is unavailable', async () => {
        mockSafeStorage.isEncryptionAvailable.mockReturnValue(false);
        await expect(encryptBatch(['secret'])).rejects.toThrow('not available');
    });
});

describe('decryptBatch', () => {
    it('returns empty array for empty input', async () => {
        expect(await decryptBatch([])).toEqual([]);
    });

    it('decrypts [SAFE] values synchronously', async () => {
        const encrypted1 = Buffer.from('enc:user1').toString('base64');
        const encrypted2 = Buffer.from('enc:pass1').toString('base64');
        const results = await decryptBatch([`[SAFE]${encrypted1}`, `[SAFE]${encrypted2}`]);
        expect(results).toEqual(['user1', 'pass1']);
    });

    it('passes through undefined and plaintext values', async () => {
        const encrypted = Buffer.from('enc:secret').toString('base64');
        const results = await decryptBatch([undefined, 'plaintext', `[SAFE]${encrypted}`]);
        expect(results[0]).toBeUndefined();
        expect(results[1]).toBe('plaintext');
        expect(results[2]).toBe('secret');
    });
});

describe('verifyWindowsUser', () => {
    it('returns false for empty password', async () => {
        expect(await verifyWindowsUser('')).toBe(false);
    });

    it('throws on non-Windows platform', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

        await expect(verifyWindowsUser('password')).rejects.toThrow('Windows');

        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
});
