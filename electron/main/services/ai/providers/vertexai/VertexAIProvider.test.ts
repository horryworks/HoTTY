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

    it('listModels returns empty list when not authenticated', async () => {
        const provider = new VertexAIProvider();
        const models = await provider.listModels();
        expect(models).toEqual([]);
    });
});

// ── listModels — dynamic fetch ────────────────────────────────────────────────

describe('VertexAIProvider — listModels', () => {
    it('returns empty list when not authenticated', async () => {
        const provider = new VertexAIProvider();
        const models = await provider.listModels();
        expect(models).toEqual([]);
    });

    it('fetches models from multiple publishers in parallel', async () => {
        const provider = new VertexAIProvider();
        const projectId = 'my-project-123';
        const location = 'asia-northeast1';
        (provider as any).config = { projectId, location, authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        const fetchMock = vi.fn().mockImplementation((url: string) => {
            // Verification requests (countTokens endpoint)
            if (url.includes(':countTokens')) {
                return Promise.resolve({ ok: true });
            }
            // Anthropic verification requests (streamRawPredict)
            if (url.includes(':streamRawPredict')) {
                // Return 400 with validation error (model IS accessible)
                return Promise.resolve({ ok: false, status: 400, text: async () => 'messages: should be non-empty' });
            }
            if (url.includes('/publishers/google/models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        publisherModels: [
                            { name: 'publishers/google/models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedActions: { openGenerationAiStudio: { references: {} } } },
                            { name: 'publishers/google/models/imageclassification-efficientnet', displayName: 'EfficientNet', supportedActions: { openNotebook: { references: {} } } },
                        ],
                    }),
                });
            }
            if (url.includes('/publishers/anthropic/models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        publisherModels: [
                            { name: 'publishers/anthropic/models/claude-3', displayName: 'Claude 3', supportedActions: { openGenerationAiStudio: { references: {} } } },
                        ],
                    }),
                });
            }
            return Promise.resolve({ ok: false, status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const models = await provider.listModels();

        const googleModel = models.find(m => m.name === 'publishers/google/models/gemini-1.5-pro');
        expect(googleModel).toBeDefined();
        expect(googleModel?.displayName).toBe('Gemini 1.5 Pro (Google)');

        const anthropicModel = models.find(m => m.name === 'publishers/anthropic/models/claude-3');
        expect(anthropicModel).toBeDefined();
        expect(anthropicModel?.displayName).toBe('Claude 3 (Anthropic)');

        // Google sorted first
        expect(models[0].name).toContain('publishers/google');

        // Catalog fetched from us-central1, not the configured location
        expect(fetchMock).toHaveBeenCalledWith(
            'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models',
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Goog-User-Project': projectId,
                    'Authorization': 'Bearer token',
                }),
            })
        );
        expect(fetchMock).toHaveBeenCalledWith(
            'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models',
            expect.anything()
        );
        // Verification uses the configured location
        const verificationCalls = fetchMock.mock.calls.filter(
            (c: any[]) => (c[0] as string).includes(':countTokens') || (c[0] as string).includes(':streamRawPredict')
        );
        for (const call of verificationCalls) {
            expect(call[0]).toContain(`${location}-aiplatform.googleapis.com`);
        }
    });

    it('excludes models that are not accessible in the project (verification 404)', async () => {
        const provider = new VertexAIProvider();
        const projectId = 'my-project-123';
        const location = 'us-central1';
        (provider as any).config = { projectId, location, authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) {
                return Promise.resolve({ ok: url.includes('gemini-2.5-flash') });
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/google/models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/gemini-2.0-flash-001', displayName: 'Gemini 2.0 Flash 001', supportedActions: { openGenerationAiStudio: {} } },
                    ],
                }),
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        const models = await provider.listModels();
        expect(models.some(m => m.name.includes('gemini-2.5-flash'))).toBe(true);
        expect(models.some(m => m.name.includes('gemini-2.0-flash-001'))).toBe(false);
    });

    it('verifies Anthropic models via streamRawPredict and includes accessible ones', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            // countTokens always fails (as it does for Anthropic models on Vertex AI)
            if (url.includes(':countTokens')) return Promise.resolve({ ok: false, status: 404 });
            // Anthropic verification: accessible model returns 400 (validation error)
            if (url.includes(':streamRawPredict')) {
                return Promise.resolve({ ok: false, status: 400, text: async () => 'messages: should be non-empty' });
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/anthropic/models/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedActions: { openGenerationAiStudio: {} } },
                    ],
                }),
            });
        }));

        const models = await provider.listModels();
        // Anthropic model passes verification (400 = accessible, just invalid request)
        expect(models.some(m => m.name.includes('claude-sonnet-4-6'))).toBe(true);
        // Google model is excluded because countTokens fails
        expect(models.some(m => m.name.includes('gemini-2.5-flash'))).toBe(false);
    });

    it('excludes Anthropic models not accessible in the current region', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) return Promise.resolve({ ok: true });
            if (url.includes(':streamRawPredict')) {
                if (url.includes('claude-sonnet-4-6')) {
                    // Not servable in this region
                    return Promise.resolve({
                        ok: false,
                        status: 400,
                        text: async () => JSON.stringify({ error: { message: 'Publisher Model is not servable in region us-central1.' } }),
                    });
                }
                if (url.includes('claude-haiku-4-5')) {
                    // Not found / not enabled
                    return Promise.resolve({ ok: false, status: 404, text: async () => 'Not found' });
                }
                // Accessible model
                return Promise.resolve({ ok: false, status: 400, text: async () => 'messages: should be non-empty' });
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/anthropic/models/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/anthropic/models/claude-haiku-4-5', displayName: 'Claude Haiku 4.5', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/anthropic/models/claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedActions: { openGenerationAiStudio: {} } },
                    ],
                }),
            });
        }));

        const models = await provider.listModels();
        // Not servable in region → excluded
        expect(models.some(m => m.name.includes('claude-sonnet-4-6'))).toBe(false);
        // 404 not found → excluded
        expect(models.some(m => m.name.includes('claude-haiku-4-5'))).toBe(false);
        // Accessible (400 validation error) → included
        expect(models.some(m => m.name.includes('claude-sonnet-4-5'))).toBe(true);
        // Google model passes countTokens → included
        expect(models.some(m => m.name.includes('gemini-2.5-flash'))).toBe(true);
    });

    it('marks models with quota limit warning when verification returns 429', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-east5', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) {
                // Google model: gemini-2.5-flash OK, gemini-2.5-pro quota exhausted
                if (url.includes('gemini-2.5-flash')) return Promise.resolve({ ok: true });
                return Promise.resolve({ ok: false, status: 429 });
            }
            if (url.includes(':streamRawPredict')) {
                // Anthropic model: quota exhausted
                return Promise.resolve({ ok: false, status: 429 });
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/google/models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/anthropic/models/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', supportedActions: { openGenerationAiStudio: {} } },
                    ],
                }),
            });
        }));

        const models = await provider.listModels();
        // Normal model
        const flash = models.find(m => m.name.includes('gemini-2.5-flash'));
        expect(flash?.displayName).toBe('Gemini 2.5 Flash (Google)');
        // Quota-limited Google model
        const pro = models.find(m => m.name.includes('gemini-2.5-pro'));
        expect(pro?.displayName).toContain('[Quota limit]');
        // Quota-limited Anthropic model
        const claude = models.find(m => m.name.includes('claude-sonnet-4-6'));
        expect(claude?.displayName).toContain('[Quota limit]');
    });

    it('uses global endpoint URL when location is "global"', async () => {
        const provider = new VertexAIProvider();
        const projectId = 'my-project-123';
        (provider as any).config = { projectId, location: 'global', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) return Promise.resolve({ ok: true });
            if (url.includes(':streamRawPredict')) return Promise.resolve({ ok: false, status: 422 });
            if (url.includes('publishers/google/models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        publisherModels: [
                            { name: 'publishers/google/models/gemini-3-flash-preview', displayName: 'Gemini 3 Flash', supportedActions: { openGenerationAiStudio: {} } },
                        ],
                    }),
                });
            }
            if (url.includes('publishers/anthropic/models')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        publisherModels: [
                            { name: 'publishers/anthropic/models/claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', supportedActions: { openGenerationAiStudio: {} } },
                        ],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ publisherModels: [] }) });
        });
        vi.stubGlobal('fetch', fetchMock);

        const models = await provider.listModels();
        expect(models).toHaveLength(2);

        // Catalog should use us-central1 (regional)
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('us-central1-aiplatform.googleapis.com'),
            expect.anything()
        );

        // Verification should use global endpoint (no region prefix)
        const verifyCalls = fetchMock.mock.calls.filter(
            (c: any[]) => (c[0] as string).includes(':countTokens') || (c[0] as string).includes(':streamRawPredict')
        );
        for (const call of verifyCalls) {
            expect(call[0]).toMatch(/^https:\/\/aiplatform\.googleapis\.com\//);
            expect(call[0]).toContain('locations/global');
        }
    });

    it('excludes models without openGenerationAiStudio from results', async () => {
        const provider = new VertexAIProvider();
        const projectId = 'my-project-123';
        (provider as any).config = { projectId, location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) return Promise.resolve({ ok: true });
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/google/models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedActions: { openGenerationAiStudio: { references: {} } } },
                        { name: 'publishers/google/models/imagen-3', displayName: 'Imagen 3', supportedActions: { openNotebook: { references: {} } } },
                        { name: 'publishers/meta/models/faster-r-cnn', displayName: 'Faster R-CNN', supportedActions: { openNotebook: { references: {} } } },
                    ],
                }),
            });
        }));

        const models = await provider.listModels();
        expect(models.some(m => m.name.includes('gemini-2.0-flash'))).toBe(true);
        expect(models.some(m => m.name.includes('imagen-3'))).toBe(false);
        expect(models.some(m => m.name.includes('faster-r-cnn'))).toBe(false);
    });

    it('excludes video/audio/image models by name keyword', async () => {
        const provider = new VertexAIProvider();
        const projectId = 'my-project-123';
        (provider as any).config = { projectId, location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
            if (url.includes(':countTokens')) return Promise.resolve({ ok: true });
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    publisherModels: [
                        { name: 'publishers/google/models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/imagen-3', displayName: 'Imagen 3', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/veo-2', displayName: 'Veo 2', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/chirp-2', displayName: 'Chirp 2', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/text-to-speech-hd', displayName: 'TTS HD', supportedActions: { openGenerationAiStudio: {} } },
                        { name: 'publishers/google/models/lyria-2', displayName: 'Lyria 2', supportedActions: { openGenerationAiStudio: {} } },
                    ],
                }),
            });
        }));

        const models = await provider.listModels();
        expect(models.some(m => m.name.includes('gemini-2.0-flash'))).toBe(true);
        expect(models.some(m => m.name.includes('imagen-3'))).toBe(false);
        expect(models.some(m => m.name.includes('veo-2'))).toBe(false);
        expect(models.some(m => m.name.includes('chirp-2'))).toBe(false);
        expect(models.some(m => m.name.includes('text-to-speech-hd'))).toBe(false);
        expect(models.some(m => m.name.includes('lyria-2'))).toBe(false);
    });

    it('returns empty list when API returns non-ok status for all publishers', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' }));

        const models = await provider.listModels();
        expect(models).toEqual([]);
    });

    it('returns empty list when API returns no models for any publisher', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ publisherModels: [] }),
        }));

        const models = await provider.listModels();
        expect(models).toEqual([]);
    });

    it('returns empty list on fetch error', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

        const models = await provider.listModels();
        expect(models).toEqual([]);
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

// ── listLocations ────────────────────────────────────────────────────────────

describe('VertexAIProvider — listLocations', () => {
    it('returns location IDs from the API', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                locations: [
                    { locationId: 'us-central1' },
                    { locationId: 'us-east5' },
                    { locationId: 'europe-west4' },
                ],
            }),
        }));

        const locations = await provider.listLocations();
        expect(locations).toEqual(['europe-west4', 'us-central1', 'us-east5']);
    });

    it('returns empty array when not authenticated', async () => {
        const provider = new VertexAIProvider();
        const locations = await provider.listLocations();
        expect(locations).toEqual([]);
    });

    it('returns empty array on API error', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

        const locations = await provider.listLocations();
        expect(locations).toEqual([]);
    });
});

// ── setLocation ──────────────────────────────────────────────────────────────

describe('VertexAIProvider — setLocation', () => {
    it('updates the location used by API calls', async () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        provider.setLocation('us-east5');
        expect((provider as any).config.location).toBe('us-east5');

        const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) } });
        vi.stubGlobal('fetch', fetchMock);

        await provider.sendMessage(vi.fn(), 'session1', 'hi', 'publishers/anthropic/models/claude-sonnet-4-6');
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('us-east5-aiplatform.googleapis.com'),
            expect.anything(),
        );
    });

    it('ignores invalid location strings', () => {
        const provider = new VertexAIProvider();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };

        provider.setLocation('INVALID!');
        expect((provider as any).config.location).toBe('us-central1');
    });

    it('does nothing when not authenticated', () => {
        const provider = new VertexAIProvider();
        expect(() => provider.setLocation('us-east5')).not.toThrow();
    });
});

// ── sendMessage — validation ──────────────────────────────────────────────────

describe('VertexAIProvider — sendMessage validation', () => {
    it('accepts model name with slash', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();
        (provider as any).config = { projectId: 'p', location: 'l', authType: 'adc' };
        (provider as any).tokenData = { access_token: 't', expires_at: Date.now() + 3600 };
        
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) } }));

        await provider.sendMessage(onResponse, 'session1', 'hello', 'publishers/anthropic/models/claude-3');
        
        expect(onResponse).not.toHaveBeenCalledWith(expect.objectContaining({
            type: 'error',
            content: 'Invalid model name.',
        }));
    });

    it('uses v1beta1 in the API URL', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-central1', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: () => Promise.resolve({ done: true }),
                }),
            },
        });
        vi.stubGlobal('fetch', fetchMock);

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gemini-1.5-flash');

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/v1beta1/projects/my-project-123/locations/us-central1/publishers/google/models/gemini-1.5-flash:streamGenerateContent'),
            expect.anything()
        );
    });

    it('uses v1 and streamRawPredict for Anthropic models', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();
        (provider as any).config = { projectId: 'my-project-123', location: 'us-east5', authType: 'adc' };
        (provider as any).tokenData = { access_token: 'token', expires_at: Date.now() + 3600000 };

        const sseChunk = [
            'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
            'data: {"type":"message_delta","usage":{"output_tokens":5}}',
            'data: {"type":"message_stop"}',
        ].join('\n') + '\n';
        const encoder = new TextEncoder();
        let callCount = 0;
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            body: {
                getReader: () => ({
                    read: () => {
                        if (callCount++ === 0) return Promise.resolve({ done: false, value: encoder.encode(sseChunk) });
                        return Promise.resolve({ done: true });
                    },
                }),
            },
        });
        vi.stubGlobal('fetch', fetchMock);

        await provider.sendMessage(onResponse, 'session1', 'hi', 'publishers/anthropic/models/claude-sonnet-4-6');

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/v1/projects/my-project-123/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-6:streamRawPredict'),
            expect.anything(),
        );
        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'chunk', content: 'Hello' }));
        expect(onResponse).toHaveBeenCalledWith(expect.objectContaining({
            type: 'done',
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }));
    });

    it('rejects model names with true invalid characters', async () => {
        const provider = new VertexAIProvider();
        const onResponse = vi.fn();

        await provider.sendMessage(onResponse, 'session1', 'hello', 'gemini!@#');

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

// ── formatUserErrorMessage ────────────────────────────────────────────────────

describe('VertexAIProvider — formatUserErrorMessage', () => {
    it('returns region-specific message for "not servable in region" errors', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'API error 400: [{"error":{"message":"Publisher Model is not servable in region us-central1."}}]',
            'publishers/anthropic/models/claude-sonnet-4-6',
        );
        expect(msg).toContain('claude-sonnet-4-6');
        expect(msg).toContain('us-central1');
        expect(msg).toContain('not available in region');
    });

    it('returns model-not-enabled message for "not found" errors', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'API error 404: [{"error":{"message":"Publisher Model was not found or your project does not have access to it."}}]',
            'publishers/anthropic/models/claude-haiku-4-5',
        );
        expect(msg).toContain('claude-haiku-4-5');
        expect(msg).toContain('not enabled');
    });

    it('returns permission-denied message for 403 errors', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'API error 403: Permission denied',
            'publishers/google/models/gemini-2.5-pro',
        );
        expect(msg).toContain('gemini-2.5-pro');
        expect(msg).toContain('Permission denied');
    });

    it('returns quota message for rate-limit errors', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'API error 429: Resource exhausted',
            'publishers/google/models/gemini-2.5-pro',
        );
        expect(msg).toContain('gemini-2.5-pro');
        expect(msg).toContain('Quota exceeded');
        expect(msg).toContain('quota increase');
    });

    it('returns generic message with status code for unknown errors', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'API error 500: Internal server error',
            'publishers/google/models/gemini-2.5-pro',
        );
        expect(msg).toContain('gemini-2.5-pro');
        expect(msg).toContain('error 500');
    });

    it('returns fallback message for unrecognized error format', () => {
        const provider = new VertexAIProvider();
        const msg = (provider as any).formatUserErrorMessage(
            'something went wrong',
            'gemini-2.5-pro',
        );
        expect(msg).toBe('An error occurred while communicating with Vertex AI. Please try again.');
    });
});
