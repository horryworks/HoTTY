// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: vi.fn(),
}));

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('iconv-lite', () => ({
    decode: vi.fn((buf: Buffer) => buf.toString()),
    encode: vi.fn((str: string) => Buffer.from(str)),
}));

const mockSocket = {
    write: vi.fn(),
    setKeepAlive: vi.fn(),
};

const mockConn = {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    end: vi.fn(),
    send: vi.fn().mockResolvedValue(undefined),
    socket: mockSocket,
    opts: {} as { terminalWidth?: number; terminalHeight?: number },
};

vi.mock('telnet-client', () => ({
    Telnet: vi.fn(function() { return mockConn; }),
}));

import { TelnetService } from './telnet';

function makeMockWin(): any {
    return {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn(() => false),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockConn.connect.mockResolvedValue(undefined);
    mockConn.on.mockReturnThis();
    mockSocket.write.mockClear();
    mockSocket.setKeepAlive.mockClear();
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('TelnetService — constructor', () => {
    it('creates an instance without throwing', () => {
        const win = makeMockWin();
        expect(() => new TelnetService(win, 'session-1')).not.toThrow();
    });
});

// ── setEncoding ───────────────────────────────────────────────────────────────

describe('TelnetService — setEncoding', () => {
    it('sets encoding without throwing', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 'session-1');
        expect(() => service.setEncoding('shift_jis')).not.toThrow();
        expect((service as any).encoding).toBe('shift_jis');
    });
});

// ── stripTelnetIAC ────────────────────────────────────────────────────────────

describe('TelnetService — stripTelnetIAC (private)', () => {
    let service: TelnetService;

    beforeEach(() => {
        service = new TelnetService(makeMockWin(), 's1');
    });

    function strip(bytes: number[]): number[] {
        const result: Buffer = (service as any).stripTelnetIAC(Buffer.from(bytes));
        return Array.from(result);
    }

    it('passes through regular data unchanged', () => {
        expect(strip([72, 101, 108, 108, 111])).toEqual([72, 101, 108, 108, 111]); // "Hello"
    });

    it('strips IAC WILL [option] (3 bytes)', () => {
        // IAC=255, WILL=251, ECHO=1
        expect(strip([255, 251, 1, 65])).toEqual([65]); // 'A'
    });

    it('strips IAC DO [option] (3 bytes)', () => {
        // IAC=255, DO=253, ECHO=1
        expect(strip([255, 253, 1, 66])).toEqual([66]); // 'B'
    });

    it('strips IAC DONT [option] (3 bytes)', () => {
        // IAC=255, DONT=254, ECHO=1
        expect(strip([255, 254, 1, 67])).toEqual([67]); // 'C'
    });

    it('strips IAC WONT [option] (3 bytes)', () => {
        // IAC=255, WONT=252, ECHO=1
        expect(strip([255, 252, 1, 68])).toEqual([68]); // 'D'
    });

    it('strips IAC sub-negotiation (IAC SB ... IAC SE)', () => {
        // IAC=255, SB=250, ..., IAC=255, SE=240
        const input = [255, 250, 31, 0, 80, 0, 24, 255, 240, 65]; // NAWS then 'A'
        expect(strip(input)).toEqual([65]);
    });

    it('handles escaped IAC (255 255) → 255', () => {
        expect(strip([255, 255, 65])).toEqual([255, 65]);
    });

    it('handles other IAC commands (2-byte sequences)', () => {
        // IAC=255, NOP=241
        expect(strip([255, 241, 65])).toEqual([65]);
    });

    it('handles incomplete IAC at end of buffer gracefully', () => {
        // IAC at very end — drop it
        expect(strip([65, 255])).toEqual([65]);
    });

    it('handles mixed regular data and IAC sequences', () => {
        // "He" + IAC WILL ECHO + "llo"
        const input = [72, 101, 255, 251, 1, 108, 108, 111];
        expect(strip(input)).toEqual([72, 101, 108, 108, 111]); // "Hello"
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('TelnetService — write', () => {
    it('does not throw when conn is available', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        // conn is the mockConn, socket.write is available
        expect(() => service.write('hello')).not.toThrow();
        expect(mockSocket.write).toHaveBeenCalled();
    });
});

// ── resize ────────────────────────────────────────────────────────────────────

describe('TelnetService — resize', () => {
    it('caches resize values', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        service.resize(100, 30);
        expect((service as any).lastCols).toBe(100);
        expect((service as any).lastRows).toBe(30);
    });

    it('updates conn.opts when available', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        service.resize(100, 30);
        expect(mockConn.opts.terminalWidth).toBe(100);
        expect(mockConn.opts.terminalHeight).toBe(30);
    });

    it('sends NAWS packet via socket', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        service.resize(80, 24);
        expect(mockSocket.write).toHaveBeenCalled();
        const nawsBuffer: Buffer = mockSocket.write.mock.calls[0][0];
        // IAC SB NAWS (255 250 31) + width + height + IAC SE (255 240)
        expect(nawsBuffer[0]).toBe(255); // IAC
        expect(nawsBuffer[1]).toBe(250); // SB
        expect(nawsBuffer[2]).toBe(31);  // NAWS
        expect(nawsBuffer[7]).toBe(255); // IAC
        expect(nawsBuffer[8]).toBe(240); // SE
    });
});

// ── onData ────────────────────────────────────────────────────────────────────

describe('TelnetService — onData', () => {
    it('registers a callback', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        const cb = vi.fn();
        service.onData(cb);
        expect((service as any).dataCallback).toBe(cb);
    });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe('TelnetService — disconnect', () => {
    it('calls conn.end() and clears callback', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        service.onData(vi.fn());
        service.disconnect();
        expect(mockConn.end).toHaveBeenCalled();
        expect((service as any).dataCallback).toBeNull();
    });

    it('does not throw even if conn.end() throws', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        mockConn.end.mockImplementationOnce(() => { throw new Error('already closed'); });
        expect(() => service.disconnect()).not.toThrow();
    });

    it('clears login state on disconnect', () => {
        const win = makeMockWin();
        const service = new TelnetService(win, 's1');
        (service as any).loginState = 'waitingForUsername';
        (service as any).loginCredentials = { username: 'u', password: 'p' };
        (service as any).loginBuffer = 'some data';
        service.disconnect();
        expect((service as any).loginState).toBe('done');
        expect((service as any).loginCredentials).toBeNull();
        expect((service as any).loginBuffer).toBe('');
    });
});

// ── auto-login ───────────────────────────────────────────────────────────────

describe('TelnetService — auto-login', () => {
    let service: TelnetService;

    beforeEach(() => {
        service = new TelnetService(makeMockWin(), 's1');
    });

    function initLogin(username = 'admin', password = 'secret') {
        (service as any).loginState = 'waitingForUsername';
        (service as any).loginBuffer = '';
        (service as any).loginCredentials = { username, password };
    }

    function feedData(text: string) {
        (service as any).handleLoginData(text);
    }

    it('sends username on "Username: " prompt (Cisco ASA style)', () => {
        initLogin();
        feedData('Username: ');
        expect(mockSocket.write).toHaveBeenCalledWith(Buffer.from('admin\r\n'));
        expect((service as any).loginState).toBe('waitingForPassword');
    });

    it('sends username on "login:" prompt (traditional style)', () => {
        initLogin();
        feedData('login: ');
        expect(mockSocket.write).toHaveBeenCalledWith(Buffer.from('admin\r\n'));
        expect((service as any).loginState).toBe('waitingForPassword');
    });

    it('sends password after username', () => {
        initLogin();
        feedData('Username: ');
        mockSocket.write.mockClear();
        feedData('Password: ');
        expect(mockSocket.write).toHaveBeenCalledWith(Buffer.from('secret\r\n'));
        expect((service as any).loginState).toBe('done');
    });

    it('does NOT auto-send on second password prompt (enable)', () => {
        initLogin();
        feedData('Username: ');
        mockSocket.write.mockClear();
        feedData('Password: ');
        mockSocket.write.mockClear();
        // Simulate enable password prompt
        feedData('Password: ');
        expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('does not auto-login when no credentials provided', () => {
        // loginState defaults to 'done', loginCredentials defaults to null
        feedData('Username: ');
        feedData('Password: ');
        expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('handles password-only device (no username prompt)', () => {
        initLogin('admin', 'secret');
        feedData('Password: ');
        expect(mockSocket.write).toHaveBeenCalledWith(Buffer.from('secret\r\n'));
        expect((service as any).loginState).toBe('done');
    });

    it('handles split chunks for prompt detection', () => {
        initLogin();
        feedData('User');
        expect(mockSocket.write).not.toHaveBeenCalled();
        feedData('name: ');
        expect(mockSocket.write).toHaveBeenCalledWith(Buffer.from('admin\r\n'));
    });

    it('clears credentials from memory after login completes', () => {
        initLogin();
        feedData('Username: ');
        feedData('Password: ');
        expect((service as any).loginCredentials).toBeNull();
    });
});
