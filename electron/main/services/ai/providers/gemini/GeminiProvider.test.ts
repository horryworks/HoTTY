// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/tmp/test') },
    BrowserWindow: vi.fn(),
    ipcMain: { emit: vi.fn(), once: vi.fn() },
}));

vi.mock('../../../dpapi', () => ({
    encryptString: vi.fn(async (s: string) => `[DPAPI]${s}`),
    decryptString: vi.fn(async (s: string) => s.replace('[DPAPI]', '')),
}));

vi.mock('../../../Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GeminiProvider } from './GeminiProvider';

describe('GeminiProvider', () => {
    let provider: GeminiProvider;

    beforeEach(() => {
        provider = new GeminiProvider();
    });

    it('has correct id and displayName', () => {
        expect(provider.id).toBe('gemini');
        expect(provider.displayName).toBe('Google AI Studio (Gemini)');
        expect(provider.authType).toBe('oauth2');
    });

    it('getAuthStatus returns unauthenticated by default', () => {
        expect(provider.getAuthStatus()).toEqual({ authenticated: false });
    });

    it('sendMessage delegates to GeminiService', async () => {
        const onResponse = vi.fn();
        await provider.sendMessage(onResponse, 'session1', 'hello', 'gemini-1.5-flash');
        // Should call onResponse with an error (not authenticated)
        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('logout sets getAuthStatus to unauthenticated', () => {
        provider.logout();
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('listModels returns empty array when not authenticated', async () => {
        const models = await provider.listModels();
        expect(models).toEqual([]);
    });

    it('cancelMessage does not throw for unknown session', () => {
        expect(() => provider.cancelMessage('unknown')).not.toThrow();
    });

    it('clearHistory does not throw for unknown session', () => {
        expect(() => provider.clearHistory('unknown')).not.toThrow();
    });
});
