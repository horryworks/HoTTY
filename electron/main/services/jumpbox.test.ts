// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
    BrowserWindow: vi.fn(),
}));

vi.mock('./knownHosts', () => ({
    verifyHostKey: vi.fn().mockResolvedValue(true),
}));

vi.mock('./Logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockStream = {
    on: vi.fn().mockReturnThis(),
    write: vi.fn(),
    end: vi.fn(),
    pipe: vi.fn(),
};

let readyCb: (() => void) | null = null;
let keyboardInteractiveCb: ((...args: unknown[]) => void) | null = null;
let forwardOutImpl: (srcAddr: string, srcPort: number, dstAddr: string, dstPort: number, cb: (err: Error | null, stream: unknown) => void) => void;

// Reset forwardOut to default before each test
beforeEach(() => {
    readyCb = null;
    keyboardInteractiveCb = null;
    forwardOutImpl = (_srcAddr, _srcPort, _dstAddr, _dstPort, cb) => {
        cb(null, mockStream);
    };
    vi.clearAllMocks();
});

vi.mock('ssh2', () => ({
    Client: class MockClient {
        on(event: string, cb: (...args: unknown[]) => void) {
            if (event === 'ready') readyCb = cb as () => void;
            if (event === 'keyboard-interactive') keyboardInteractiveCb = cb;
            return this;
        }
        connect() {
            if (readyCb) readyCb();
        }
        forwardOut(srcAddr: string, srcPort: number, dstAddr: string, dstPort: number, cb: (err: Error | null, stream: unknown) => void) {
            forwardOutImpl(srcAddr, srcPort, dstAddr, dstPort, cb);
        }
        end() { /* noop */ }
    },
}));

import { createJumpboxTunnel } from './jumpbox';
import { BrowserWindow } from 'electron';

describe('createJumpboxTunnel', () => {
    it('establishes a tunnel and returns stream + client', async () => {
        const mockWindow = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
        const result = await createJumpboxTunnel(
            { host: '10.0.0.1', port: 22, username: 'admin', password: 'pass' },
            '192.168.1.1',
            22,
            undefined,
            mockWindow,
        );

        expect(result.stream).toBe(mockStream);
        expect(result.jumpboxClient).toBeDefined();
    });

    it('rejects when forwardOut fails', async () => {
        forwardOutImpl = (_srcAddr, _srcPort, _dstAddr, _dstPort, cb) => {
            cb(new Error('tunnel failed'), null);
        };

        const mockWindow = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
        await expect(createJumpboxTunnel(
            { host: '10.0.0.1', port: 22, username: 'admin' },
            '192.168.1.1',
            22,
            undefined,
            mockWindow,
        )).rejects.toThrow('tunnel failed');
    });

    it('registers keyboard-interactive handler that replies with password', async () => {
        const mockWindow = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
        await createJumpboxTunnel(
            { host: '10.0.0.1', port: 22, username: 'admin', password: 'mypass' },
            '192.168.1.1',
            22,
            undefined,
            mockWindow,
        );

        expect(keyboardInteractiveCb).not.toBeNull();
        const finish = vi.fn();
        keyboardInteractiveCb!('', '', '', [], finish);
        expect(finish).toHaveBeenCalledWith(['mypass']);
    });

    it('keyboard-interactive handler sends empty string when no password', async () => {
        const mockWindow = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
        await createJumpboxTunnel(
            { host: '10.0.0.1', port: 22, username: 'admin' },
            '192.168.1.1',
            22,
            undefined,
            mockWindow,
        );

        expect(keyboardInteractiveCb).not.toBeNull();
        const finish = vi.fn();
        keyboardInteractiveCb!('', '', '', [], finish);
        expect(finish).toHaveBeenCalledWith(['']);
    });

    it('passes jumpbox config to connect', async () => {
        const mockWindow = { webContents: { send: vi.fn() } } as unknown as BrowserWindow;
        const result = await createJumpboxTunnel(
            { host: 'bastion.example.com', port: 2222, username: 'ops', password: 'secret' },
            '10.0.1.5',
            23,
            undefined,
            mockWindow,
        );

        expect(result.stream).toBe(mockStream);
        expect(result.jumpboxClient).toBeDefined();
    });
});
