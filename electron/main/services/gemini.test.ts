// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

let tempDir: string;

vi.mock('electron', () => ({
    app: { getPath: vi.fn() },
    BrowserWindow: vi.fn(),
    ipcMain: { emit: vi.fn(), once: vi.fn() },
}));

vi.mock('./dpapi', () => ({
    encryptString: vi.fn(async (s: string) => `[DPAPI]${s}`),
    decryptString: vi.fn(async (s: string) => s.replace('[DPAPI]', '')),
}));

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GeminiService } from './gemini';
import { app } from 'electron';

function makeMockWin(): any {
    return {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn(() => false),
        loadURL: vi.fn(),
        on: vi.fn().mockReturnThis(),
        close: vi.fn(),
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-gemini-test-'));
    vi.mocked(app.getPath).mockReturnValue(tempDir);
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockReturnValue(tempDir);
});

afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('GeminiService — initial state', () => {
    it('isAuthenticated returns false by default', () => {
        const service = new GeminiService();
        expect(service.isAuthenticated()).toBe(false);
    });
});

// ── clearHistory ──────────────────────────────────────────────────────────────

describe('GeminiService — clearHistory', () => {
    it('does not throw when clearing non-existent session history', () => {
        const service = new GeminiService();
        expect(() => service.clearHistory('nonexistent-session')).not.toThrow();
    });
});

// ── cancelMessage ─────────────────────────────────────────────────────────────

describe('GeminiService — cancelMessage', () => {
    it('does not throw when cancelling non-existent message', () => {
        const service = new GeminiService();
        expect(() => service.cancelMessage('nonexistent-session')).not.toThrow();
    });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('GeminiService — logout', () => {
    it('sets isAuthenticated to false', () => {
        const service = new GeminiService();
        // Force token data to simulate authenticated state
        (service as any).tokenData = {
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 3600,
            token_type: 'Bearer',
            obtained_at: Date.now(),
        };
        expect(service.isAuthenticated()).toBe(true);

        service.logout();
        expect(service.isAuthenticated()).toBe(false);
    });

    it('clears chat histories on logout', () => {
        const service = new GeminiService();
        (service as any).chatHistories.set('s1', [{ role: 'user', content: 'hello' }]);

        service.logout();

        expect((service as any).chatHistories.size).toBe(0);
    });

    it('deletes the token file on logout', () => {
        const service = new GeminiService();
        const tokenPath = path.join(tempDir, 'gemini_token.json');
        fs.writeFileSync(tokenPath, '[DPAPI]somedata', 'utf8');

        service.logout();

        expect(fs.existsSync(tokenPath)).toBe(false);
    });

    it('does not throw when token file does not exist', () => {
        const service = new GeminiService();
        expect(() => service.logout()).not.toThrow();
    });
});

// ── sendMessage — validation ──────────────────────────────────────────────────

describe('GeminiService — sendMessage validation', () => {
    it('sends error for invalid model name', async () => {
        const service = new GeminiService();
        const onResponse = vi.fn();

        await service.sendMessage(onResponse, 'session1', 'hello', 'invalid model!');

        expect(onResponse).toHaveBeenCalledWith({
            sessionId: 'session1',
            type: 'error',
            content: 'Invalid model name.',
        });
    });

    it('accepts valid model names', async () => {
        const service = new GeminiService();
        const onResponse = vi.fn();

        // Force a null token so it fails with "auth expired" not "invalid model"
        (service as any).tokenData = null;

        await service.sendMessage(onResponse, 'session1', 'hello', 'gemini-1.5-flash');

        const call = onResponse.mock.calls[0][0];
        expect(call.content).not.toBe('Invalid model name.');
    });

    it('sends auth-expired error when not authenticated', async () => {
        const service = new GeminiService();
        const onResponse = vi.fn();

        await service.sendMessage(onResponse, 'session1', 'hello', 'gemini-1.5-flash');

        expect(onResponse).toHaveBeenCalledWith({
            sessionId: 'session1',
            type: 'error',
            content: 'Authentication expired. Please sign in again.',
        });
    });

    it('rejects model names with consecutive separators', async () => {
        const service = new GeminiService();
        const onResponse = vi.fn();

        await service.sendMessage(onResponse, 's1', 'hello', 'gemini--flash');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Invalid model name.',
        }));
    });
});

// ── autoAuth ──────────────────────────────────────────────────────────────────

describe('GeminiService — autoAuth', () => {
    it('returns false when no token file exists', async () => {
        const service = new GeminiService();
        const result = await service.autoAuth('client-id', 'client-secret');
        expect(result).toBe(false);
    });
});

// ── startAuth — credential validation ────────────────────────────────────────

describe('GeminiService — startAuth credential validation', () => {
    it('rejects empty clientId', async () => {
        const service = new GeminiService();
        const win = makeMockWin();
        const onAuthResult = vi.fn();

        const result = await service.startAuth(win, '', 'secret', onAuthResult);
        expect(result).toBe(false);
    });

    it('rejects clientId longer than 512 chars', async () => {
        const service = new GeminiService();
        const win = makeMockWin();
        const onAuthResult = vi.fn();

        const result = await service.startAuth(win, 'x'.repeat(513), 'secret', onAuthResult);
        expect(result).toBe(false);
    });

    it('rejects credentials with non-printable ASCII', async () => {
        const service = new GeminiService();
        const win = makeMockWin();
        const onAuthResult = vi.fn();

        const result = await service.startAuth(win, 'valid-id', 'secret with spaces', onAuthResult);
        expect(result).toBe(false);
    });
});

// ── listModels ────────────────────────────────────────────────────────────────

describe('GeminiService — listModels', () => {
    it('returns empty array when not authenticated', async () => {
        const service = new GeminiService();
        const result = await service.listModels();
        expect(result).toEqual([]);
    });

    it('includes text generation models and excludes non-text models', async () => {
        const mockFetch = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        models: [
                            // Text models — should be included
                            { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens', 'batchGenerateContent'] },
                            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent', 'countTokens', 'createCachedContent', 'batchGenerateContent'] },
                            { name: 'models/gemma-3-27b-it', displayName: 'Gemma 3 27B', supportedGenerationMethods: ['generateContent', 'countTokens'] },
                            // TTS — should be excluded (keyword: tts)
                            { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'Gemini 2.5 Flash Preview TTS', supportedGenerationMethods: ['countTokens', 'generateContent'] },
                            // Image generation — should be excluded (keyword: image)
                            { name: 'models/gemini-2.5-flash-image', displayName: 'Gemini 2.5 Flash Image', supportedGenerationMethods: ['generateContent', 'countTokens', 'batchGenerateContent'] },
                            // Image generation with internal codename — should be excluded (keyword: nano-banana)
                            { name: 'models/nano-banana-pro-preview', displayName: 'Nano Banana Pro', supportedGenerationMethods: ['generateContent', 'countTokens', 'batchGenerateContent'] },
                            // Robotics — should be excluded (keyword: robotics)
                            { name: 'models/gemini-robotics-er-1.5-preview', displayName: 'Gemini Robotics-ER', supportedGenerationMethods: ['generateContent', 'countTokens'] },
                            // Embedding — should be excluded (no generateContent)
                            { name: 'models/gemini-embedding-001', displayName: 'Gemini Embedding 001', supportedGenerationMethods: ['embedContent', 'countTextTokens'] },
                            // AQA — should be excluded (no generateContent)
                            { name: 'models/aqa', displayName: 'AQA', supportedGenerationMethods: ['generateAnswer'] },
                            // Video — should be excluded (no generateContent)
                            { name: 'models/veo-2.0-generate-001', displayName: 'Veo 2', supportedGenerationMethods: ['predictLongRunning'] },
                        ],
                    }),
                });
            }
            return Promise.resolve({ ok: false });
        });

        const service = new GeminiService();
        (service as any).tokenData = {
            access_token: 'test-token',
            expires_in: 3600,
            token_type: 'Bearer',
            obtained_at: Date.now(),
        };
        const originalFetch = global.fetch;
        global.fetch = mockFetch as any;
        try {
            const models = await service.listModels();
            expect(models).toHaveLength(3);
            expect(models.map(m => m.name)).toEqual(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemma-3-27b-it']);
            // Verify excluded models are absent
            const names = models.map(m => m.name);
            expect(names.some(n => n.includes('tts'))).toBe(false);
            expect(names.some(n => n.includes('image'))).toBe(false);
            expect(names.some(n => n.includes('nano-banana'))).toBe(false);
            expect(names.some(n => n.includes('robotics'))).toBe(false);
            expect(names.some(n => n.includes('embedding'))).toBe(false);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
