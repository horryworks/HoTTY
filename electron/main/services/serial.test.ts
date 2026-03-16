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

const mockPort = {
    on: vi.fn().mockReturnThis(),
    open: vi.fn((cb: (err: Error | null) => void) => cb(null)),
    write: vi.fn(),
    close: vi.fn(),
    isOpen: true,
};

vi.mock('serialport', () => ({
    SerialPort: vi.fn(function() { return mockPort; }),
}));

import { SerialService } from './serial';

function makeMockWin(): any {
    return {
        webContents: { send: vi.fn() },
        isDestroyed: vi.fn(() => false),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockPort.on.mockReturnThis();
    mockPort.open.mockImplementation((cb: (err: Error | null) => void) => cb(null));
    mockPort.isOpen = true;
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('SerialService — constructor', () => {
    it('creates an instance without throwing', () => {
        const win = makeMockWin();
        expect(() => new SerialService(win, 'session-1')).not.toThrow();
    });
});

// ── setEncoding ───────────────────────────────────────────────────────────────

describe('SerialService — setEncoding', () => {
    it('sets encoding without throwing', () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        expect(() => service.setEncoding('shift_jis')).not.toThrow();
        expect((service as any).encoding).toBe('shift_jis');
    });
});

// ── connect — path validation ─────────────────────────────────────────────────

describe('SerialService — connect path validation', () => {
    const validPaths = ['COM1', 'COM9', 'COM10', 'COM99', 'COM999', '/dev/ttyUSB0', '/dev/ttyS0', '/dev/ttyACM0'];
    const invalidPaths = ['COM0', 'COM1000', '/dev/sda', 'COM', 'invalid', '../etc/passwd', ''];

    for (const portPath of validPaths) {
        it(`accepts valid port path: ${portPath}`, async () => {
            const win = makeMockWin();
            const service = new SerialService(win, 's1');
            await service.connect({ path: portPath, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
            expect(win.webContents.send).not.toHaveBeenCalledWith('session-error', expect.anything());
        });
    }

    for (const portPath of invalidPaths) {
        it(`rejects invalid port path: "${portPath}"`, async () => {
            const win = makeMockWin();
            const service = new SerialService(win, 's1');
            await service.connect({ path: portPath, baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
            expect(win.webContents.send).toHaveBeenCalledWith('session-error', expect.objectContaining({
                error: 'Invalid serial port path.',
            }));
        });
    }
});

// ── connect — flow control ────────────────────────────────────────────────────

describe('SerialService — connect flow control options', () => {
    it('sets rtscts for rts/cts flow control', async () => {
        const { SerialPort } = await import('serialport');
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        await service.connect({ path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'rts/cts' });
        expect(SerialPort).toHaveBeenCalledWith(expect.objectContaining({ rtscts: true }));
    });

    it('sets xon/xoff for xon/xoff flow control', async () => {
        const { SerialPort } = await import('serialport');
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        await service.connect({ path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'xon/xoff' });
        expect(SerialPort).toHaveBeenCalledWith(expect.objectContaining({ xon: true, xoff: true }));
    });

    it('sets no flow control options for "none"', async () => {
        const { SerialPort } = await import('serialport');
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        await service.connect({ path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
        const callArgs = vi.mocked(SerialPort).mock.calls[0][0] as Record<string, unknown>;
        expect(callArgs.rtscts).toBeUndefined();
        expect(callArgs.xon).toBeUndefined();
        expect(callArgs.xoff).toBeUndefined();
    });
});

// ── write ─────────────────────────────────────────────────────────────────────

describe('SerialService — write', () => {
    it('does nothing when port is null (before connect)', () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        expect(() => service.write('hello')).not.toThrow();
        expect(mockPort.write).not.toHaveBeenCalled();
    });

    it('writes to port when open', async () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        await service.connect({ path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
        service.write('hello');
        expect(mockPort.write).toHaveBeenCalled();
    });
});

// ── resize ────────────────────────────────────────────────────────────────────

describe('SerialService — resize', () => {
    it('is a no-op (serial has no terminal size concept)', () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        expect(() => service.resize(80, 24)).not.toThrow();
    });
});

// ── onData ────────────────────────────────────────────────────────────────────

describe('SerialService — onData', () => {
    it('registers a data callback', () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        const cb = vi.fn();
        service.onData(cb);
        expect((service as any).dataCallback).toBe(cb);
    });
});

// ── disconnect ────────────────────────────────────────────────────────────────

describe('SerialService — disconnect', () => {
    it('does nothing when port is null', () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        expect(() => service.disconnect()).not.toThrow();
    });

    it('closes the port when open and clears callback', async () => {
        const win = makeMockWin();
        const service = new SerialService(win, 's1');
        service.onData(vi.fn());
        await service.connect({ path: 'COM1', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
        service.disconnect();
        expect(mockPort.close).toHaveBeenCalled();
        expect((service as any).dataCallback).toBeNull();
    });
});
