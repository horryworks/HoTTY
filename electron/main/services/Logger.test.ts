// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ── sanitizeProcessEnv ────────────────────────────────────────────────────────

describe('sanitizeProcessEnv', () => {
    it('removes keys matching API_KEY pattern', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, MY_API_KEY: 'secret', SAFE_VAR: 'ok' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect('MY_API_KEY' in result).toBe(false);
        expect(result.SAFE_VAR).toBe('ok');
        process.env = originalEnv;
    });

    it('removes SECRET keys', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, DB_SECRET: 'topsecret', SAFE_VAR: 'hello' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect('DB_SECRET' in result).toBe(false);
        expect(result.SAFE_VAR).toBe('hello');
        process.env = originalEnv;
    });

    it('removes TOKEN keys', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, ACCESS_TOKEN: 'abc123', PATH: '/usr/bin' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect('ACCESS_TOKEN' in result).toBe(false);
        expect(result.PATH).toBe('/usr/bin');
        process.env = originalEnv;
    });

    it('removes PASSWORD keys', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, DB_PASSWORD: 'pass123', USER: 'alice' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect('DB_PASSWORD' in result).toBe(false);
        expect(result.USER).toBe('alice');
        process.env = originalEnv;
    });

    it('removes PRIVATE_KEY keys (case-insensitive)', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, SSH_PRIVATE_KEY: 'keydata' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect('SSH_PRIVATE_KEY' in result).toBe(false);
        process.env = originalEnv;
    });

    it('keeps non-sensitive environment variables', async () => {
        const originalEnv = process.env;
        process.env = { ...originalEnv, HOME: '/home/user', TERM: 'xterm' };
        const { sanitizeProcessEnv } = await import('./Logger');
        const result = sanitizeProcessEnv();
        expect(result.HOME).toBe('/home/user');
        expect(result.TERM).toBe('xterm');
        process.env = originalEnv;
    });
});

// ── Logger — console output ───────────────────────────────────────────────────

describe('Logger — console output (uninitialized)', () => {
    let consoleSpy: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; log: ReturnType<typeof vi.spyOn> };

    beforeEach(() => {
        consoleSpy = {
            error: vi.spyOn(console, 'error').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('calls console.error for ERROR level', async () => {
        const { logger } = await import('./Logger');
        logger.error('test', 'error message');
        expect(consoleSpy.error).toHaveBeenCalled();
        const call = consoleSpy.error.mock.calls[0][0] as string;
        expect(call).toContain('[ERROR]');
        expect(call).toContain('[test');
        expect(call).toContain('error message');
    });

    it('calls console.warn for WARN level', async () => {
        const { logger } = await import('./Logger');
        logger.warn('test', 'warn message');
        expect(consoleSpy.warn).toHaveBeenCalled();
        const call = consoleSpy.warn.mock.calls[0][0] as string;
        expect(call).toContain('[WARN');
        expect(call).toContain('warn message');
    });

    it('calls console.log for INFO level', async () => {
        const { logger } = await import('./Logger');
        logger.info('test', 'info message');
        expect(consoleSpy.log).toHaveBeenCalled();
        const call = consoleSpy.log.mock.calls[0][0] as string;
        expect(call).toContain('[INFO');
        expect(call).toContain('info message');
    });

    it('calls console.log for DEBUG level', async () => {
        const { logger } = await import('./Logger');
        logger.debug('test', 'debug message');
        expect(consoleSpy.log).toHaveBeenCalled();
        const call = consoleSpy.log.mock.calls[0][0] as string;
        expect(call).toContain('[DEBUG]');
        expect(call).toContain('debug message');
    });

    it('includes fields in log line', async () => {
        const { logger } = await import('./Logger');
        logger.info('test', 'with fields', { key: 'value', count: 42 });
        expect(consoleSpy.log).toHaveBeenCalled();
        const call = consoleSpy.log.mock.calls[0][0] as string;
        expect(call).toContain('key="value"');
        expect(call).toContain('count=42');
    });

    it('does not include field separator when no fields', async () => {
        const { logger } = await import('./Logger');
        logger.info('test', 'no fields');
        expect(consoleSpy.log).toHaveBeenCalled();
        const call = consoleSpy.log.mock.calls[0][0] as string;
        expect(call).not.toContain(' | ');
    });
});

// ── Logger — file writing ─────────────────────────────────────────────────────

describe('Logger — file writing after initialization', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-logger-test-'));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('creates a log file in the logs subdirectory', async () => {
        const { logger } = await import('./Logger');
        // Reset singleton state so we can initialize
        const loggerAny = logger as any;
        loggerAny.initialized = false;
        loggerAny.stream?.end();
        loggerAny.stream = null;
        loggerAny.logDir = '';

        logger.initialize(tempDir);
        expect(fs.existsSync(path.join(tempDir, 'logs'))).toBe(true);

        // Cleanup
        loggerAny.initialized = false;
        loggerAny.stream?.end();
        loggerAny.stream = null;
    });

    it('getLogDir returns the logs directory path after init', async () => {
        const { logger } = await import('./Logger');
        const loggerAny = logger as any;
        loggerAny.initialized = false;
        loggerAny.stream?.end();
        loggerAny.stream = null;
        loggerAny.logDir = '';

        logger.initialize(tempDir);
        expect(logger.getLogDir()).toBe(path.join(tempDir, 'logs'));

        loggerAny.initialized = false;
        loggerAny.stream?.end();
        loggerAny.stream = null;
    });
});
