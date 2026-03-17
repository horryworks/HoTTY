// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

let tempDir: string;

vi.mock('electron', () => ({
    app: { getPath: vi.fn() },
    BrowserWindow: vi.fn(),
}));

vi.mock('../../../dpapi', () => ({
    encryptString: vi.fn(async (s: string) => `[DPAPI]${s}`),
    decryptString: vi.fn(async (s: string) => s.replace('[DPAPI]', '')),
}));

vi.mock('../../../Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { OpenAIProvider } from './OpenAIProvider';
import { app } from 'electron';

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-openai-test-'));
    vi.mocked(app.getPath).mockImplementation((name: string) => {
        if (name === 'userData') return tempDir;
        return tempDir;
    });
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockImplementation((name: string) => {
        if (name === 'userData') return tempDir;
        return tempDir;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('OpenAIProvider — initial state', () => {
    it('has correct id, displayName, authType', () => {
        const provider = new OpenAIProvider();
        expect(provider.id).toBe('openai');
        expect(provider.displayName).toBe('OpenAI');
        expect(provider.authType).toBe('api_key');
    });

    it('getAuthStatus returns unauthenticated by default', () => {
        const provider = new OpenAIProvider();
        expect(provider.getAuthStatus()).toEqual({ authenticated: false });
    });

    it('listModels returns fallback list when not authenticated', async () => {
        const provider = new OpenAIProvider();
        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some(m => m.name.startsWith('gpt-'))).toBe(true);
        expect(models[0]).toHaveProperty('name');
        expect(models[0]).toHaveProperty('displayName');
    });

    it('listModels fetches from API when authenticated', async () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'gpt-4o' },
                    { id: 'gpt-4o-mini' },
                    { id: 'o1-mini' },
                    { id: 'whisper-1' }, // should be filtered out
                ],
            }),
        }));

        const models = await provider.listModels();
        expect(models.some(m => m.name === 'gpt-4o')).toBe(true);
        expect(models.some(m => m.name === 'o1-mini')).toBe(true);
        expect(models.some(m => m.name === 'whisper-1')).toBe(false);
        expect(models[0]).toHaveProperty('displayName');
    });

    it('listModels falls back to hardcoded list when API fails', async () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-test-key';

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some(m => m.name.startsWith('gpt-'))).toBe(true);
    });

    it('listModels falls back when API returns non-ok status', async () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

        const models = await provider.listModels();
        expect(models.some(m => m.name === 'gpt-4o')).toBe(true);
    });
});

// ── cancelMessage / clearHistory ──────────────────────────────────────────────

describe('OpenAIProvider — cancelMessage / clearHistory', () => {
    it('cancelMessage does not throw for unknown session', () => {
        const provider = new OpenAIProvider();
        expect(() => provider.cancelMessage('unknown')).not.toThrow();
    });

    it('clearHistory does not throw for unknown session', () => {
        const provider = new OpenAIProvider();
        expect(() => provider.clearHistory('unknown')).not.toThrow();
    });
});

// ── authenticate — validation ─────────────────────────────────────────────────

describe('OpenAIProvider — authenticate validation', () => {
    it('rejects empty API key', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: '' }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects API key with spaces', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: 'key with spaces' }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects API key longer than 512 chars', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: 'x'.repeat(513) }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects missing apiKey field', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {}, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── authenticate — API validation call ───────────────────────────────────────

describe('OpenAIProvider — authenticate API call', () => {
    it('returns true and saves config when API key is valid', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-valid-key-123' }, onResult);

        expect(result).toBe(true);
        expect(onResult).toHaveBeenCalledWith({ success: true });
        expect(provider.getAuthStatus().authenticated).toBe(true);

        const configPath = path.join(tempDir, 'openai_config.json');
        expect(fs.existsSync(configPath)).toBe(true);
    });

    it('returns false when API returns 401', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-invalid-key' }, onResult);

        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('returns false when fetch throws a network error', async () => {
        const provider = new OpenAIProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-some-key-123' }, onResult);

        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── autoAuth ──────────────────────────────────────────────────────────────────

describe('OpenAIProvider — autoAuth', () => {
    it('returns false when no config file exists', async () => {
        const provider = new OpenAIProvider();
        const result = await provider.autoAuth({});
        expect(result).toBe(false);
    });

    it('returns true and loads API key from saved config', async () => {
        const provider = new OpenAIProvider();
        const configPath = path.join(tempDir, 'openai_config.json');
        fs.writeFileSync(configPath, '[DPAPI]sk-saved-key-abc', 'utf8');

        const result = await provider.autoAuth({});

        expect(result).toBe(true);
        expect(provider.getAuthStatus().authenticated).toBe(true);
    });

    it('returns false when decrypted key fails validation', async () => {
        const provider = new OpenAIProvider();
        const configPath = path.join(tempDir, 'openai_config.json');
        // Write a key with spaces (invalid)
        fs.writeFileSync(configPath, '[DPAPI]key with spaces', 'utf8');

        const result = await provider.autoAuth({});

        expect(result).toBe(false);
    });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('OpenAIProvider — logout', () => {
    it('clears API key on logout', () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-some-key';
        expect(provider.getAuthStatus().authenticated).toBe(true);

        provider.logout();
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('deletes config file on logout', () => {
        const provider = new OpenAIProvider();
        const configPath = path.join(tempDir, 'openai_config.json');
        fs.writeFileSync(configPath, '[DPAPI]sk-some-key', 'utf8');

        provider.logout();
        expect(fs.existsSync(configPath)).toBe(false);
    });

    it('does not throw when config file does not exist', () => {
        const provider = new OpenAIProvider();
        expect(() => provider.logout()).not.toThrow();
    });

    it('clears chat histories on logout', () => {
        const provider = new OpenAIProvider();
        (provider as any).chatHistories.set('s1', [{ role: 'user', content: 'hello' }]);
        provider.logout();
        expect((provider as any).chatHistories.size).toBe(0);
    });
});

// ── sendMessage — validation ──────────────────────────────────────────────────

describe('OpenAIProvider — sendMessage validation', () => {
    it('sends error for invalid model name', async () => {
        const provider = new OpenAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'invalid model!');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session1',
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('rejects model names with consecutive separators', async () => {
        const provider = new OpenAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gpt--4');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('sends not-authenticated error when apiKey is null', async () => {
        const provider = new OpenAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gpt-4o-mini');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Not authenticated. Please provide an OpenAI API key.',
        }));
    });
});

// ── sendMessage — streaming ───────────────────────────────────────────────────

describe('OpenAIProvider — sendMessage streaming', () => {
    it('streams chunks and emits done with full response', async () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-test-key';

        const chunks = [
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
            'data: {"choices":[{"delta":{"content":" World"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n',
            'data: [DONE]\n',
        ];

        const encoder = new TextEncoder();
        let chunkIndex = 0;
        const readable = new ReadableStream({
            pull(controller) {
                if (chunkIndex < chunks.length) {
                    controller.enqueue(encoder.encode(chunks[chunkIndex++]));
                } else {
                    controller.close();
                }
            },
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            body: readable,
        }));

        const onResponse = vi.fn();
        await provider.sendMessage(onResponse, 'sess1', 'hi', 'gpt-4o-mini');

        const chunkCalls = onResponse.mock.calls.filter(c => c[0].type === 'chunk');
        expect(chunkCalls.length).toBe(2);
        expect(chunkCalls[0][0].content).toBe('Hello');
        expect(chunkCalls[1][0].content).toBe(' World');

        const doneCalls = onResponse.mock.calls.filter(c => c[0].type === 'done');
        expect(doneCalls.length).toBe(1);
        expect(doneCalls[0][0].content).toBe('Hello World');
        expect(doneCalls[0][0].usageMetadata).toEqual({
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
        });
    });

    it('emits error on API failure', async () => {
        const provider = new OpenAIProvider();
        (provider as any).apiKey = 'sk-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
        }));

        const onResponse = vi.fn();
        await provider.sendMessage(onResponse, 'sess1', 'hi', 'gpt-4o-mini');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
});
