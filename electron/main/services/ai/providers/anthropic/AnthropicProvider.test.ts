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

import { AnthropicProvider } from './AnthropicProvider';
import { app } from 'electron';

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-anthropic-test-'));
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

describe('AnthropicProvider — initial state', () => {
    it('has correct id, displayName, authType', () => {
        const provider = new AnthropicProvider();
        expect(provider.id).toBe('anthropic');
        expect(provider.displayName).toBe('Anthropic (Claude)');
        expect(provider.authType).toBe('api_key');
    });

    it('getAuthStatus returns unauthenticated by default', () => {
        const provider = new AnthropicProvider();
        expect(provider.getAuthStatus()).toEqual({ authenticated: false });
    });

    it('listModels returns fallback list when not authenticated', async () => {
        const provider = new AnthropicProvider();
        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some(m => m.name.startsWith('claude-'))).toBe(true);
        expect(models[0]).toHaveProperty('name');
        expect(models[0]).toHaveProperty('displayName');
    });

    it('listModels fetches from API when authenticated', async () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6' },
                    { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
                    { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
                ],
            }),
        }));

        const models = await provider.listModels();
        expect(models.length).toBe(3);
        expect(models[0]).toEqual({ name: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' });
        expect(models[1]).toEqual({ name: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' });
    });

    it('listModels falls back to hardcoded list when API fails', async () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-test-key';

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models.some(m => m.name.startsWith('claude-'))).toBe(true);
    });

    it('listModels falls back when API returns non-ok status', async () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

        const models = await provider.listModels();
        expect(models.some(m => m.name === 'claude-sonnet-4-6')).toBe(true);
    });
});

// ── cancelMessage / clearHistory ──────────────────────────────────────────────

describe('AnthropicProvider — cancelMessage / clearHistory', () => {
    it('cancelMessage does not throw for unknown session', () => {
        const provider = new AnthropicProvider();
        expect(() => provider.cancelMessage('unknown')).not.toThrow();
    });

    it('clearHistory does not throw for unknown session', () => {
        const provider = new AnthropicProvider();
        expect(() => provider.clearHistory('unknown')).not.toThrow();
    });
});

// ── authenticate — validation ─────────────────────────────────────────────────

describe('AnthropicProvider — authenticate validation', () => {
    it('rejects empty API key', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: '' }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects API key with spaces', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: 'key with spaces' }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects API key longer than 512 chars', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, { apiKey: 'x'.repeat(513) }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects missing apiKey field', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {}, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── authenticate — API validation call ───────────────────────────────────────

describe('AnthropicProvider — authenticate API call', () => {
    it('returns true and saves config when API key is valid', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-ant-valid-key-123' }, onResult);

        expect(result).toBe(true);
        expect(onResult).toHaveBeenCalledWith({ success: true });
        expect(provider.getAuthStatus().authenticated).toBe(true);

        const configPath = path.join(tempDir, 'anthropic_config.json');
        expect(fs.existsSync(configPath)).toBe(true);
    });

    it('returns false when API returns 401', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-ant-invalid-key' }, onResult);

        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('returns false when fetch throws a network error', async () => {
        const provider = new AnthropicProvider();
        const onResult = vi.fn();

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

        const result = await provider.authenticate(null as any, { apiKey: 'sk-ant-some-key-123' }, onResult);

        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── autoAuth ──────────────────────────────────────────────────────────────────

describe('AnthropicProvider — autoAuth', () => {
    it('returns false when no config file exists', async () => {
        const provider = new AnthropicProvider();
        const result = await provider.autoAuth({});
        expect(result).toBe(false);
    });

    it('returns true and loads API key from saved config', async () => {
        const provider = new AnthropicProvider();
        const configPath = path.join(tempDir, 'anthropic_config.json');
        fs.writeFileSync(configPath, '[DPAPI]sk-ant-saved-key-abc', 'utf8');

        const result = await provider.autoAuth({});

        expect(result).toBe(true);
        expect(provider.getAuthStatus().authenticated).toBe(true);
    });

    it('returns false when decrypted key fails validation', async () => {
        const provider = new AnthropicProvider();
        const configPath = path.join(tempDir, 'anthropic_config.json');
        fs.writeFileSync(configPath, '[DPAPI]key with spaces', 'utf8');

        const result = await provider.autoAuth({});

        expect(result).toBe(false);
    });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('AnthropicProvider — logout', () => {
    it('clears API key on logout', () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-some-key';
        expect(provider.getAuthStatus().authenticated).toBe(true);

        provider.logout();
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('deletes config file on logout', () => {
        const provider = new AnthropicProvider();
        const configPath = path.join(tempDir, 'anthropic_config.json');
        fs.writeFileSync(configPath, '[DPAPI]sk-ant-some-key', 'utf8');

        provider.logout();
        expect(fs.existsSync(configPath)).toBe(false);
    });

    it('does not throw when config file does not exist', () => {
        const provider = new AnthropicProvider();
        expect(() => provider.logout()).not.toThrow();
    });

    it('clears chat histories on logout', () => {
        const provider = new AnthropicProvider();
        (provider as any).chatHistories.set('s1', [{ role: 'user', content: 'hello' }]);
        provider.logout();
        expect((provider as any).chatHistories.size).toBe(0);
    });
});

// ── sendMessage — validation ──────────────────────────────────────────────────

describe('AnthropicProvider — sendMessage validation', () => {
    it('sends error for invalid model name', async () => {
        const provider = new AnthropicProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'invalid model!');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session1',
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('sends not-authenticated error when apiKey is null', async () => {
        const provider = new AnthropicProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'claude-sonnet-4-6');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Not authenticated. Please provide an Anthropic API key.',
        }));
    });
});

// ── sendMessage — streaming ───────────────────────────────────────────────────

describe('AnthropicProvider — sendMessage streaming', () => {
    it('streams chunks and emits done with full response', async () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-test-key';

        const chunks = [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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
        await provider.sendMessage(onResponse, 'sess1', 'hi', 'claude-sonnet-4-6');

        const chunkCalls = onResponse.mock.calls.filter(c => c[0].type === 'chunk');
        expect(chunkCalls.length).toBe(2);
        expect(chunkCalls[0][0].content).toBe('Hello');
        expect(chunkCalls[1][0].content).toBe(' World');

        const doneCalls = onResponse.mock.calls.filter(c => c[0].type === 'done');
        expect(doneCalls.length).toBe(1);
        expect(doneCalls[0][0].content).toBe('Hello World');
        expect(doneCalls[0][0].usageMetadata).toEqual({
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
        });
    });

    it('emits error on API failure', async () => {
        const provider = new AnthropicProvider();
        (provider as any).apiKey = 'sk-ant-test-key';

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded',
        }));

        const onResponse = vi.fn();
        await provider.sendMessage(onResponse, 'sess1', 'hi', 'claude-sonnet-4-6');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
});
