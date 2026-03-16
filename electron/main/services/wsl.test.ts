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

import { WslService } from './wsl';
import * as pty from 'node-pty';

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

describe('WslService — constructor', () => {
    it('creates an instance without throwing', () => {
        const win = makeMockWin();
        expect(() => new WslService(win, 'session-1')).not.toThrow();
    });
});

// ── setEncoding ───────────────────────────────────────────────────────────────

describe('WslService — setEncoding', () => {
    it('does not throw (encoding managed internally by node-pty)', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        expect(() => service.setEncoding('utf8')).not.toThrow();
    });
});

// ── connect — distro validation ───────────────────────────────────────────────

describe('WslService — connect distro validation', () => {
    const validDistros = ['Ubuntu', 'Debian', 'Ubuntu-22.04', 'kali-linux', 'openSUSE_Leap'];
    const invalidDistros = ['..', 'Ubuntu/bad', 'distro name!', '../etc'];

    for (const distro of validDistros) {
        it(`accepts valid distro name: ${distro}`, () => {
            const win = makeMockWin();
            const service = new WslService(win, 's1');
            service.connect({ distro });
            expect(win.webContents.send).not.toHaveBeenCalledWith('session-error', expect.anything());
        });
    }

    for (const distro of invalidDistros) {
        it(`rejects invalid distro name: "${distro}"`, () => {
            const win = makeMockWin();
            const service = new WslService(win, 's1');
            service.connect({ distro });
            expect(win.webContents.send).toHaveBeenCalledWith('session-error', expect.objectContaining({
                error: 'Invalid WSL distribution name',
            }));
        });
    }

    it('connects with default distro when distro is not specified', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({});
        expect(pty.spawn).toHaveBeenCalledWith('wsl.exe', [], expect.any(Object));
    });

    it('passes distro as -d argument when specified', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: 'Ubuntu' });
        expect(pty.spawn).toHaveBeenCalledWith('wsl.exe', ['-d', 'Ubuntu'], expect.any(Object));
    });

    it('trims whitespace from distro name before validation', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: '  Ubuntu  ' });
        expect(pty.spawn).toHaveBeenCalledWith('wsl.exe', ['-d', 'Ubuntu'], expect.any(Object));
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('WslService — write', () => {
    it('does nothing when ptyProcess is null (before connect)', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        expect(() => service.write('hello')).not.toThrow();
        expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });

    it('writes to ptyProcess when connected', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: 'Ubuntu' });
        service.write('ls -la');
        expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la');
    });
});

// ── resize ────────────────────────────────────────────────────────────────────

describe('WslService — resize', () => {
    it('does nothing when ptyProcess is null', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        expect(() => service.resize(80, 24)).not.toThrow();
        expect(mockPtyProcess.resize).not.toHaveBeenCalled();
    });

    it('resizes ptyProcess when connected', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: 'Ubuntu' });
        service.resize(120, 40);
        expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
    });
});

// ── onData ────────────────────────────────────────────────────────────────────

describe('WslService — onData', () => {
    it('registers a data callback', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        const cb = vi.fn();
        service.onData(cb);
        expect((service as any).dataCallback).toBe(cb);
    });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe('WslService — disconnect', () => {
    it('does nothing when ptyProcess is null', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        expect(() => service.disconnect()).not.toThrow();
    });

    it('kills the pty process and sets it to null', () => {
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: 'Ubuntu' });
        service.disconnect();
        expect(mockPtyProcess.kill).toHaveBeenCalled();
        expect((service as any).ptyProcess).toBeNull();
    });
});

// ── connect — PTY spawn error ─────────────────────────────────────────────────

describe('WslService — connect spawn error handling', () => {
    it('sends session-error when pty.spawn throws', () => {
        vi.mocked(pty.spawn).mockImplementationOnce(() => {
            throw new Error('WSL not available');
        });
        const win = makeMockWin();
        const service = new WslService(win, 's1');
        service.connect({ distro: 'Ubuntu' });
        expect(win.webContents.send).toHaveBeenCalledWith('session-error', expect.objectContaining({
            error: 'Failed to start WSL.',
        }));
    });
});
