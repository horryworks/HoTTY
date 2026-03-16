// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: vi.fn(),
}));

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sanitizeProcessEnv: vi.fn(() => ({})),
}));

const mockPtyProcess = {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
};

vi.mock('node-pty', () => ({
    spawn: vi.fn(() => mockPtyProcess),
}));

import { LocalService } from './local';
import * as pty from 'node-pty';
import * as LoggerModule from './Logger';

function makeMockWin(): any {
    return {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn(() => false),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pty.spawn).mockReturnValue(mockPtyProcess as any);
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('LocalService — constructor', () => {
    it('creates an instance without throwing', () => {
        const win = makeMockWin();
        expect(() => new LocalService(win, 'session-1')).not.toThrow();
    });
});

// ── setEncoding ───────────────────────────────────────────────────────────────

describe('LocalService — setEncoding', () => {
    it('sets encoding without throwing', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        expect(() => service.setEncoding('shift_jis')).not.toThrow();
        expect((service as any).encoding).toBe('shift_jis');
    });
});

// ── connect — shell type selection ────────────────────────────────────────────

describe('LocalService — connect shell type', () => {
    it('spawns powershell.exe for shellType "powershell"', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'powershell' });
        expect(pty.spawn).toHaveBeenCalledWith('powershell.exe', [], expect.any(Object));
    });

    it('spawns cmd.exe for shellType "cmd"', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        expect(pty.spawn).toHaveBeenCalledWith('cmd.exe', [], expect.any(Object));
    });

    it('spawns with xterm-256color terminal name', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        expect(pty.spawn).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            expect.objectContaining({ name: 'xterm-256color' })
        );
    });

    it('spawns with default 80x24 dimensions', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        expect(pty.spawn).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            expect.objectContaining({ cols: 80, rows: 24 })
        );
    });

    it('sends session-status connected after spawning', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'powershell' });
        expect(win.webContents.send).toHaveBeenCalledWith('session-status', {
            sessionId: 's1',
            status: 'connected',
        });
    });

    it('uses sanitized process environment', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        expect(LoggerModule.sanitizeProcessEnv).toHaveBeenCalled();
    });
});

// ── connect — PTY spawn error ─────────────────────────────────────────────────

describe('LocalService — connect spawn error handling', () => {
    it('sends session-error when pty.spawn throws', () => {
        vi.mocked(pty.spawn).mockImplementationOnce(() => {
            throw new Error('spawn failed');
        });
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        expect(win.webContents.send).toHaveBeenCalledWith('session-error', expect.objectContaining({
            error: 'Failed to start shell.',
        }));
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('LocalService — write', () => {
    it('does nothing when ptyProcess is null (before connect)', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        expect(() => service.write('hello')).not.toThrow();
        expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });

    it('writes to ptyProcess when connected', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'powershell' });
        service.write('Get-Process');
        expect(mockPtyProcess.write).toHaveBeenCalledWith('Get-Process');
    });
});

// ── resize ────────────────────────────────────────────────────────────────────

describe('LocalService — resize', () => {
    it('does nothing when ptyProcess is null', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        expect(() => service.resize(80, 24)).not.toThrow();
        expect(mockPtyProcess.resize).not.toHaveBeenCalled();
    });

    it('resizes ptyProcess when connected', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'cmd' });
        service.resize(120, 40);
        expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
    });
});

// ── onData ────────────────────────────────────────────────────────────────────

describe('LocalService — onData', () => {
    it('registers a data callback', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        const cb = vi.fn();
        service.onData(cb);
        expect((service as any).dataCallback).toBe(cb);
    });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe('LocalService — disconnect', () => {
    it('does nothing when ptyProcess is null', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        expect(() => service.disconnect()).not.toThrow();
    });

    it('kills the pty process and sets it to null', () => {
        const win = makeMockWin();
        const service = new LocalService(win, 's1');
        service.connect({ shellType: 'powershell' });
        service.disconnect();
        expect(mockPtyProcess.kill).toHaveBeenCalled();
        expect((service as any).ptyProcess).toBeNull();
    });
});
