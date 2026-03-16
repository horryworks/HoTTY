// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { LogManager } from './LogManager';

let tempDir: string;
let manager: LogManager;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-logmgr-test-'));
    manager = new LogManager();
});

afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait for a write stream to emit 'open' (file created on disk). */
function waitForOpen(stream: fs.WriteStream): Promise<void> {
    return new Promise(resolve => stream.once('open', () => resolve()));
}

/** End both streams and wait for them to finish flushing. */
async function stopAndWait(mgr: LogManager, sessionId: string): Promise<void> {
    const log = (mgr as any).logs.get(sessionId) as { stream: fs.WriteStream; tsStream: fs.WriteStream } | undefined;
    if (!log) { mgr.stopLogging(sessionId); return; }
    const p1 = new Promise<void>(r => log.stream.once('finish', r));
    const p2 = new Promise<void>(r => log.tsStream.once('finish', r));
    mgr.stopLogging(sessionId);
    await Promise.all([p1, p2]);
}

// ── startLogging ──────────────────────────────────────────────────────────────

describe('LogManager — startLogging', () => {
    it('does nothing when loggingEnabled is false', () => {
        manager.startLogging('s1', { loggingEnabled: false, loggingPath: tempDir });
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'))).toHaveLength(0);
    });

    it('does nothing when loggingPath is empty', () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: '' });
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'))).toHaveLength(0);
    });

    it('does nothing when loggingPath does not exist', () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: '/nonexistent/path' });
        // Should not throw
    });

    it('creates a .txt log file with correct naming pattern', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'myhost', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/SSH-myhost\.txt$/);

        await stopAndWait(manager, 's1');
    });

    it('creates a .tslog file alongside the .txt file', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'host', protocol: 'telnet' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const tsLogs = fs.readdirSync(tempDir).filter(f => f.endsWith('.tslog'));
        expect(tsLogs).toHaveLength(1);

        await stopAndWait(manager, 's1');
    });

    it('sanitizes host name in filename (replaces special chars with _)', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'host:22/path', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        expect(files).toHaveLength(1);
        expect(files[0]).not.toContain(':');
        expect(files[0]).not.toContain('/');

        await stopAndWait(manager, 's1');
    });

    it('does not start logging for the same session twice', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        expect(files).toHaveLength(1);

        await stopAndWait(manager, 's1');
    });

    it('uses UNKNOWN_HOST when host is not provided', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        expect(files[0]).toContain('UNKNOWN_HOST');

        await stopAndWait(manager, 's1');
    });

    it('uses UNKNOWN protocol when protocol is not provided', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'myhost' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        expect(files[0]).toContain('UNKNOWN');

        await stopAndWait(manager, 's1');
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('LogManager — write', () => {
    it('does nothing when session is not being logged', () => {
        // Should not throw
        manager.write('nonexistent', 'hello');
    });

    it('strips ANSI escape codes from written data', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        manager.write('s1', '\x1b[32mHello\x1b[0m');
        await stopAndWait(manager, 's1');

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        const content = fs.readFileSync(path.join(tempDir, files[0]), 'utf8');
        expect(content).toBe('Hello');
        expect(content).not.toContain('\x1b');
    });

    it('normalizes CRLF to LF', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        manager.write('s1', 'line1\r\nline2\r\n');
        await stopAndWait(manager, 's1');

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        const content = fs.readFileSync(path.join(tempDir, files[0]), 'utf8');
        expect(content).toBe('line1\nline2\n');
    });

    it('removes standalone CR characters', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        manager.write('s1', 'progress\r100%');
        await stopAndWait(manager, 's1');

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        const content = fs.readFileSync(path.join(tempDir, files[0]), 'utf8');
        expect(content).toBe('progress100%');
    });

    it('writes plain text directly', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        manager.write('s1', 'plain text');
        await stopAndWait(manager, 's1');

        const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.txt'));
        const content = fs.readFileSync(path.join(tempDir, files[0]), 'utf8');
        expect(content).toBe('plain text');
    });

    it('writes timestamps to .tslog for each line', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream; tsStream: fs.WriteStream };
        await waitForOpen(log.stream);

        manager.write('s1', 'line1\nline2\n');
        await stopAndWait(manager, 's1');

        const tsLogs = fs.readdirSync(tempDir).filter(f => f.endsWith('.tslog'));
        const content = fs.readFileSync(path.join(tempDir, tsLogs[0]), 'utf8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it('does not write to tslog when data produces no output lines', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        // ANSI-only data gets stripped to empty → no tslog entries
        manager.write('s1', '\x1b[0m');
        await stopAndWait(manager, 's1');

        const tsLogs = fs.readdirSync(tempDir).filter(f => f.endsWith('.tslog'));
        const content = fs.readFileSync(path.join(tempDir, tsLogs[0]), 'utf8');
        expect(content).toBe('');
    });
});

// ── stopLogging ───────────────────────────────────────────────────────────────

describe('LogManager — stopLogging', () => {
    it('does nothing when session is not being logged', () => {
        // Should not throw
        manager.stopLogging('nonexistent');
    });

    it('closes the stream and removes the session', async () => {
        manager.startLogging('s1', { loggingEnabled: true, loggingPath: tempDir, host: 'h', protocol: 'ssh' });
        const log = (manager as any).logs.get('s1') as { stream: fs.WriteStream };
        await waitForOpen(log.stream);

        await stopAndWait(manager, 's1');
        // Calling write after stop should not throw
        manager.write('s1', 'after stop');
    });
});
