// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
    app: { getPath: vi.fn(() => '/tmp/test') },
    BrowserWindow: vi.fn(),
}));

vi.mock('./knownHosts', () => ({
    verifyHostKey: vi.fn().mockResolvedValue(true),
}));

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('iconv-lite', () => ({
    decode: vi.fn((buf: Buffer) => buf.toString()),
    encode: vi.fn((str: string) => Buffer.from(str)),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
}));

const mockStream = {
    on: vi.fn().mockReturnThis(),
    write: vi.fn(),
    setWindow: vi.fn(),
};

const mockClient = {
    on: vi.fn().mockReturnThis(),
    connect: vi.fn().mockReturnThis(),
    end: vi.fn(),
    shell: vi.fn(),
};

vi.mock('ssh2', () => ({
    Client: vi.fn(function() { return mockClient; }),
}));

import { SshService } from './ssh';

function makeMockWin(): any {
    return {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn(() => false),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    // Re-bind mocks
    mockClient.on.mockReturnThis();
    mockClient.connect.mockReturnThis();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('SshService — constructor', () => {
    it('creates an instance without throwing', () => {
        const win = makeMockWin();
        expect(() => new SshService(win, 'session-1')).not.toThrow();
    });
});

// ── setEncoding ───────────────────────────────────────────────────────────────

describe('SshService — setEncoding', () => {
    it('sets the encoding without throwing', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        expect(() => service.setEncoding('shift_jis')).not.toThrow();
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('SshService — write', () => {
    it('does nothing when stream is null (before connect)', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        // No stream assigned yet — should not throw
        expect(() => service.write('hello')).not.toThrow();
    });
});

// ── resize ────────────────────────────────────────────────────────────────────

describe('SshService — resize', () => {
    it('caches resize values when no stream is active', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.resize(120, 40);
        // Internal state: lastCols=120, lastRows=40
        expect((service as any).lastCols).toBe(120);
        expect((service as any).lastRows).toBe(40);
    });

    it('calls setWindow on stream when stream is available', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        (service as any).stream = mockStream;
        service.resize(80, 24);
        expect(mockStream.setWindow).toHaveBeenCalledWith(24, 80, 0, 0);
    });
});

// ── onData ────────────────────────────────────────────────────────────────────

describe('SshService — onData', () => {
    it('registers a data callback', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        const cb = vi.fn();
        service.onData(cb);
        expect((service as any).dataCallback).toBe(cb);
    });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe('SshService — disconnect', () => {
    it('calls conn.end()', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.disconnect();
        expect(mockClient.end).toHaveBeenCalled();
    });

    it('clears the data callback on disconnect', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.onData(vi.fn());
        service.disconnect();
        expect((service as any).dataCallback).toBeNull();
    });
});

// ── connect ───────────────────────────────────────────────────────────────────

describe('SshService — connect', () => {
    it('calls conn.connect with provided config', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.connect({ host: 'myhost', port: 22, username: 'user', password: 'pass' });
        expect(mockClient.connect).toHaveBeenCalled();
    });

    it('sets encoding from connect config', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.connect({ host: 'h', port: 22, encoding: 'shift_jis' });
        expect((service as any).encoding).toBe('shift_jis');
    });

    it('defaults encoding to utf8 when not specified', () => {
        const win = makeMockWin();
        const service = new SshService(win, 'session-1');
        service.connect({ host: 'h', port: 22 });
        expect((service as any).encoding).toBe('utf8');
    });
});
