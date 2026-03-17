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

import { VertexAIProvider } from './VertexAIProvider';
import { app } from 'electron';

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-vertexai-test-'));
    vi.mocked(app.getPath).mockImplementation((name: string) => {
        if (name === 'userData') return tempDir;
        if (name === 'home') return tempDir;
        return tempDir;
    });
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockImplementation((name: string) => {
        if (name === 'userData') return tempDir;
        if (name === 'home') return tempDir;
        return tempDir;
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('VertexAIProvider — initial state', () => {
    it('has correct id, displayName, authType', () => {
        const provider = new VertexAIProvider();
        expect(provider.id).toBe('vertexai');
        expect(provider.displayName).toBe('Google Cloud Vertex AI');
        expect(provider.authType).toBe('adc');
    });

    it('getAuthStatus returns unauthenticated by default', () => {
        const provider = new VertexAIProvider();
        expect(provider.getAuthStatus()).toEqual({ authenticated: false });
    });

    it('listModels returns a non-empty list', async () => {
        const provider = new VertexAIProvider();
        const models = await provider.listModels();
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('name');
        expect(models[0]).toHaveProperty('displayName');
    });
});

// ── cancelMessage / clearHistory ──────────────────────────────────────────────

describe('VertexAIProvider — cancelMessage / clearHistory', () => {
    it('cancelMessage does not throw for unknown session', () => {
        const provider = new VertexAIProvider();
        expect(() => provider.cancelMessage('unknown')).not.toThrow();
    });

    it('clearHistory does not throw for unknown session', () => {
        const provider = new VertexAIProvider();
        expect(() => provider.clearHistory('unknown')).not.toThrow();
    });
});

// ── authenticate — input validation ──────────────────────────────────────────

describe('VertexAIProvider — authenticate validation', () => {
    it('rejects invalid projectId (uppercase)', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: 'INVALID-PROJECT',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects invalid projectId (too short)', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: 'ab',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects invalid location (uppercase)', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'US-CENTRAL1',
            authType: 'adc',
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('rejects empty projectId', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: '',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── authenticate — ADC not found ──────────────────────────────────────────────

describe('VertexAIProvider — authenticate ADC file not found', () => {
    it('returns false when ADC file does not exist', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const origAppData = process.env.APPDATA;
        process.env.APPDATA = tempDir;

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);

        process.env.APPDATA = origAppData;
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('returns false when ADC type is unsupported', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const origAppData = process.env.APPDATA;
        process.env.APPDATA = tempDir;

        const adcDir = path.join(tempDir, 'gcloud');
        fs.mkdirSync(adcDir, { recursive: true });
        fs.writeFileSync(
            path.join(adcDir, 'application_default_credentials.json'),
            JSON.stringify({ type: 'external_account' }),
        );

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);

        process.env.APPDATA = origAppData;
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── authenticate — ADC authorized_user ───────────────────────────────────────

describe('VertexAIProvider — authenticate ADC authorized_user', () => {
    it('authenticates successfully with valid ADC and successful token refresh', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const origAppData = process.env.APPDATA;
        process.env.APPDATA = tempDir;

        const adcDir = path.join(tempDir, 'gcloud');
        fs.mkdirSync(adcDir, { recursive: true });
        fs.writeFileSync(
            path.join(adcDir, 'application_default_credentials.json'),
            JSON.stringify({
                type: 'authorized_user',
                client_id: 'client_id',
                client_secret: 'client_secret',
                refresh_token: 'refresh_token',
            }),
        );

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'access_token', expires_in: 3600 }),
        }));

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);

        process.env.APPDATA = origAppData;
        expect(result).toBe(true);
        expect(onResult).toHaveBeenCalledWith({ success: true });
        expect(provider.getAuthStatus().authenticated).toBe(true);
    });

    it('returns false when authorized_user ADC missing required fields', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const origAppData = process.env.APPDATA;
        process.env.APPDATA = tempDir;

        const adcDir = path.join(tempDir, 'gcloud');
        fs.mkdirSync(adcDir, { recursive: true });
        fs.writeFileSync(
            path.join(adcDir, 'application_default_credentials.json'),
            JSON.stringify({ type: 'authorized_user' }), // missing fields
        );

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);

        process.env.APPDATA = origAppData;
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('returns false when token refresh fails', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const origAppData = process.env.APPDATA;
        process.env.APPDATA = tempDir;

        const adcDir = path.join(tempDir, 'gcloud');
        fs.mkdirSync(adcDir, { recursive: true });
        fs.writeFileSync(
            path.join(adcDir, 'application_default_credentials.json'),
            JSON.stringify({
                type: 'authorized_user',
                client_id: 'client_id',
                client_secret: 'client_secret',
                refresh_token: 'refresh_token',
            }),
        );

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
        }));

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'adc',
        }, onResult);

        process.env.APPDATA = origAppData;
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── authenticate — service_account key file ───────────────────────────────────

describe('VertexAIProvider — authenticate service_account key file', () => {
    it('returns false when no keyFilePath provided', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'service_account',
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('returns false when key file does not exist', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'service_account',
            keyFilePath: path.join(tempDir, 'nonexistent.json'),
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });

    it('returns false when key file is missing required fields', async () => {
        const provider = new VertexAIProvider();
        const onResult = vi.fn();
        const keyPath = path.join(tempDir, 'sa_key.json');
        fs.writeFileSync(keyPath, JSON.stringify({ type: 'service_account' })); // no client_email / private_key

        const result = await provider.authenticate(null as any, {
            projectId: 'my-project-123',
            location: 'us-central1',
            authType: 'service_account',
            keyFilePath: keyPath,
        }, onResult);
        expect(result).toBe(false);
        expect(onResult).toHaveBeenCalledWith({ success: false });
    });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('VertexAIProvider — logout', () => {
    it('clears auth state on logout', () => {
        const provider = new VertexAIProvider();
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };
        expect(provider.getAuthStatus().authenticated).toBe(true);

        provider.logout();
        expect(provider.getAuthStatus().authenticated).toBe(false);
    });

    it('deletes config file on logout', () => {
        const provider = new VertexAIProvider();
        const configPath = path.join(tempDir, 'vertexai_config.json');
        fs.writeFileSync(configPath, '[DPAPI]somedata', 'utf8');

        provider.logout();
        expect(fs.existsSync(configPath)).toBe(false);
    });

    it('does not throw when config file does not exist', () => {
        const provider = new VertexAIProvider();
        expect(() => provider.logout()).not.toThrow();
    });

    it('clears chat histories on logout', () => {
        const provider = new VertexAIProvider();
        (provider as any).chatHistories.set('s1', [{ role: 'user', content: 'hello' }]);
        provider.logout();
        expect((provider as any).chatHistories.size).toBe(0);
    });
});

// ── sendMessage — validation ──────────────────────────────────────────────────

describe('VertexAIProvider — sendMessage validation', () => {
    it('sends error for invalid model name', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'invalid model!');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session1',
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('rejects model names with consecutive separators', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gemini--flash');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('sends not-authenticated error when config is null', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gemini-2.0-flash-001');

        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
        }));
    });
});

// ── autoAuth ──────────────────────────────────────────────────────────────────

describe('VertexAIProvider — autoAuth', () => {
    it('returns false when no config file exists', async () => {
        const provider = new VertexAIProvider();
        const result = await provider.autoAuth({ projectId: 'my-project-123', location: 'us-central1' });
        expect(result).toBe(false);
    });

    it('returns false when projectId does not match saved config', async () => {
        const provider = new VertexAIProvider();
        const configPath = path.join(tempDir, 'vertexai_config.json');
        const savedData = JSON.stringify({
            config: { projectId: 'other-project-abc', location: 'us-central1', authType: 'adc' },
            refreshData: { type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'token' },
        });
        fs.writeFileSync(configPath, `[DPAPI]${savedData}`, 'utf8');

        const result = await provider.autoAuth({ projectId: 'my-project-123', location: 'us-central1' });
        expect(result).toBe(false);
    });

    it('returns false when location does not match saved config', async () => {
        const provider = new VertexAIProvider();
        const configPath = path.join(tempDir, 'vertexai_config.json');
        const savedData = JSON.stringify({
            config: { projectId: 'my-project-123', location: 'europe-west1', authType: 'adc' },
            refreshData: { type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'token' },
        });
        fs.writeFileSync(configPath, `[DPAPI]${savedData}`, 'utf8');

        const result = await provider.autoAuth({ projectId: 'my-project-123', location: 'us-central1' });
        expect(result).toBe(false);
    });

    it('succeeds when config matches and token refresh succeeds', async () => {
        const provider = new VertexAIProvider();
        const configPath = path.join(tempDir, 'vertexai_config.json');
        const savedData = JSON.stringify({
            config: { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' },
            refreshData: { type: 'authorized_user', client_id: 'id', client_secret: 'secret', refresh_token: 'token' },
        });
        fs.writeFileSync(configPath, `[DPAPI]${savedData}`, 'utf8');

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'access_token', expires_in: 3600 }),
        }));

        const result = await provider.autoAuth({ projectId: 'my-project-123', location: 'us-central1' });
        expect(result).toBe(true);
        expect(provider.getAuthStatus().authenticated).toBe(true);
    });
});
