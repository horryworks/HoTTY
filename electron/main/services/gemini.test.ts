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
        const win = makeMockWin();

        await service.sendMessage(win, 'session1', 'hello', 'invalid model!');

        expect(win.webContents.send).toHaveBeenCalledWith('gemini-chat-response', {
            sessionId: 'session1',
            type: 'error',
            content: 'Invalid model name.',
        });
    });

    it('accepts valid model names', async () => {
        const service = new GeminiService();
        const win = makeMockWin();

        // Force a null token so it fails with "auth expired" not "invalid model"
        (service as any).tokenData = null;

        await service.sendMessage(win, 'session1', 'hello', 'gemini-1.5-flash');

        const call = win.webContents.send.mock.calls[0];
        expect(call[1].content).not.toBe('Invalid model name.');
    });

    it('sends auth-expired error when not authenticated', async () => {
        const service = new GeminiService();
        const win = makeMockWin();

        await service.sendMessage(win, 'session1', 'hello', 'gemini-1.5-flash');

        expect(win.webContents.send).toHaveBeenCalledWith('gemini-chat-response', {
            sessionId: 'session1',
            type: 'error',
            content: 'Authentication expired. Please sign in again.',
        });
    });

    it('rejects model names with consecutive separators', async () => {
        const service = new GeminiService();
        const win = makeMockWin();

        await service.sendMessage(win, 's1', 'hello', 'gemini--flash');

        expect(win.webContents.send).toHaveBeenCalledWith('gemini-chat-response', expect.objectContaining({
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

        const result = await service.startAuth(win, '', 'secret');
        expect(result).toBe(false);
    });

    it('rejects clientId longer than 512 chars', async () => {
        const service = new GeminiService();
        const win = makeMockWin();

        const result = await service.startAuth(win, 'x'.repeat(513), 'secret');
        expect(result).toBe(false);
    });

    it('rejects credentials with non-printable ASCII', async () => {
        const service = new GeminiService();
        const win = makeMockWin();

        const result = await service.startAuth(win, 'valid-id', 'secret with spaces');
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
});
