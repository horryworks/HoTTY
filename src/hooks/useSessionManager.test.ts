import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSessionManager } from './useSessionManager';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@xterm/xterm', () => ({
    Terminal: vi.fn(function () {
        return {
            write: vi.fn(),
            loadAddon: vi.fn(),
            onSelectionChange: vi.fn(),
            attachCustomKeyEventHandler: vi.fn(),
            onData: vi.fn(),
            getSelection: vi.fn(() => ''),
            hasSelection: vi.fn(() => false),
            dispose: vi.fn(),
            options: { scrollback: 1000 },
        };
    }),
}));

vi.mock('@xterm/addon-fit', () => ({
    FitAddon: vi.fn(function () { return {}; }),
}));

vi.mock('../services/electronService', () => ({
    connectSession: vi.fn(),
    disconnectSession: vi.fn(),
    sendInput: vi.fn(),
    writeClipboard: vi.fn(),
    onSessionData: vi.fn(() => vi.fn()),
    onSessionStatus: vi.fn(() => vi.fn()),
    onSessionError: vi.fn(() => vi.fn()),
    geminiChatClear: vi.fn(),
    logDebug: vi.fn(),
}));

import * as electronService from '../services/electronService';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeOptions = (overrides = {}) => ({
    globalEncoding: 'utf-8',
    onPasteRequest: vi.fn(),
    onSessionConnected: vi.fn(),
    onSessionError: vi.fn(),
    setPaneAllocations: vi.fn(),
    setActivePaneId: vi.fn(),
    sshKeepAliveEnabled: false,
    sshKeepAliveInterval: 30,
    telnetKeepAliveEnabled: false,
    telnetKeepAliveInterval: 30,
    loggingEnabled: false,
    loggingPath: '',
    lineWrapEnabled: true,
    scrollback: 1000,
    backspaceSendsDel: false,
    showLeftSidebar: false,
    showRightSidebar: false,
    showTopBar: false,
    showBottomBar: false,
    watchBufferLimit: 100000,
    ...overrides,
});

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('useSessionManager — initial state', () => {
    it('sessions is empty initially', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        expect(result.current.sessions).toEqual([]);
    });

    it('tabOrder is empty initially', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        expect(result.current.tabOrder).toEqual([]);
    });
});

// ── createSession ─────────────────────────────────────────────────────────────

describe('useSessionManager — createSession', () => {
    it('creates an SSH session with title "SSH <host>"', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'myserver.example.com', port: 22 }); });
        expect(result.current.sessions.length).toBe(1);
        expect(result.current.sessions[0].title).toBe('SSH myserver.example.com');
    });

    it('creates a Telnet session with type "telnet"', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'telnet', host: '192.168.1.1', port: 23 }); });
        expect(result.current.sessions[0].type).toBe('telnet');
    });

    it('creates a Serial session with type "serial"', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'serial', path: 'COM3', baudRate: 9600 }); });
        expect(result.current.sessions[0].type).toBe('serial');
    });

    it('creates a WSL session with type "wsl"', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'wsl', distro: 'Ubuntu' }); });
        expect(result.current.sessions[0].type).toBe('wsl');
    });

    it('adds the new session to sessions and tabOrder', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        const sessionId = result.current.sessions[0].id;
        expect(result.current.sessions.length).toBe(1);
        expect(result.current.tabOrder).toContain(sessionId);
    });

    it('calls electronService.connectSession with session ID and config', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        const sessionId = result.current.sessions[0].id;
        expect(electronService.connectSession).toHaveBeenCalledWith(
            sessionId,
            expect.objectContaining({ protocol: 'ssh', host: 'box', port: 22 })
        );
    });

    it('creates a log-viewer session with type "log-viewer" and no connectSession call', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'log-viewer' }); });
        expect(result.current.sessions.length).toBe(1);
        expect(result.current.sessions[0].type).toBe('log-viewer');
        expect(electronService.connectSession).not.toHaveBeenCalled();
    });
});

// ── createAISession ───────────────────────────────────────────────────────────

describe('useSessionManager — createAISession', () => {
    it('creates an AI session with type "ai"', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createAISession(); });
        expect(result.current.sessions.length).toBe(1);
        expect(result.current.sessions[0].type).toBe('ai');
    });

    it('returns a session ID from createAISession', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        let sessionId: string | undefined;
        act(() => { sessionId = result.current.createAISession(); });
        expect(typeof sessionId).toBe('string');
        expect((sessionId as string).length).toBeGreaterThan(0);
    });

    it('calling createAISession twice calls onSessionError with single-AI message', async () => {
        const onSessionError = vi.fn();
        const { result } = renderHook(() => useSessionManager(makeOptions({ onSessionError })));
        act(() => { result.current.createAISession(); });
        await waitFor(() => expect(result.current.sessions.length).toBe(1));
        act(() => { result.current.createAISession(); });
        expect(onSessionError).toHaveBeenCalledWith(
            expect.stringContaining('Only one')
        );
    });
});

// ── closeSession ──────────────────────────────────────────────────────────────

describe('useSessionManager — closeSession', () => {
    it('removes the session from sessions', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        const sessionId = result.current.sessions[0].id;
        act(() => { result.current.closeSession(sessionId); });
        expect(result.current.sessions.find(s => s.id === sessionId)).toBeUndefined();
    });

    it('removes the session from tabOrder', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        const sessionId = result.current.sessions[0].id;
        act(() => { result.current.closeSession(sessionId); });
        expect(result.current.tabOrder).not.toContain(sessionId);
    });

    it('calls electronService.disconnectSession for SSH sessions', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        const sessionId = result.current.sessions[0].id;
        act(() => { result.current.closeSession(sessionId); });
        expect(electronService.disconnectSession).toHaveBeenCalledWith(sessionId);
    });

    it('calls electronService.geminiChatClear for AI sessions', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createAISession(); });
        const sessionId = result.current.sessions[0].id;
        act(() => { result.current.closeSession(sessionId); });
        expect(electronService.geminiChatClear).toHaveBeenCalledWith(sessionId);
    });
});

// ── handleTabReorder ──────────────────────────────────────────────────────────

describe('useSessionManager — handleTabReorder', () => {
    it('swaps two tabs correctly when fromIndex < toIndex', async () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => {
            result.current.createSession({ protocol: 'ssh', host: 'alpha', port: 22 });
            result.current.createSession({ protocol: 'ssh', host: 'beta', port: 22 });
            result.current.createSession({ protocol: 'ssh', host: 'gamma', port: 22 });
        });
        await waitFor(() => expect(result.current.tabOrder.length).toBe(3));
        const [id0, id1, id2] = result.current.tabOrder;
        act(() => { result.current.handleTabReorder(0, 2); });
        expect(result.current.tabOrder[0]).toBe(id1);
        expect(result.current.tabOrder[1]).toBe(id2);
        expect(result.current.tabOrder[2]).toBe(id0);
    });

    it('does nothing when fromIndex === toIndex', async () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => {
            result.current.createSession({ protocol: 'ssh', host: 'alpha', port: 22 });
            result.current.createSession({ protocol: 'ssh', host: 'beta', port: 22 });
        });
        await waitFor(() => expect(result.current.tabOrder.length).toBe(2));
        const orderBefore = [...result.current.tabOrder];
        act(() => { result.current.handleTabReorder(1, 1); });
        expect(result.current.tabOrder).toEqual(orderBefore);
    });
});

// ── toggleWatch ───────────────────────────────────────────────────────────────

describe('useSessionManager — toggleWatch', () => {
    it('turns watch on for a session (isWatching becomes true)', async () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        await waitFor(() => expect(result.current.sessions.length).toBe(1));
        const sessionId = result.current.sessions[0].id;
        act(() => { result.current.toggleWatch(sessionId); });
        expect(result.current.sessions.find(s => s.id === sessionId)?.isWatching).toBe(true);
    });

    it('turns watch off for a session (isWatching becomes false)', async () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        await waitFor(() => expect(result.current.sessions.length).toBe(1));
        const sessionId = result.current.sessions[0].id;
        // Toggle on, then off
        act(() => { result.current.toggleWatch(sessionId); });
        act(() => { result.current.toggleWatch(sessionId); });
        expect(result.current.sessions.find(s => s.id === sessionId)?.isWatching).toBe(false);
    });
});

// ── getWatchBuffer / clearWatchBuffer ─────────────────────────────────────────

describe('useSessionManager — getWatchBuffer / clearWatchBuffer', () => {
    it('getWatchBuffer returns empty string for untracked session', () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        expect(result.current.getWatchBuffer('non-existent-id')).toBe('');
    });

    it('clearWatchBuffer sets hasWatchData to false on the session', async () => {
        const { result } = renderHook(() => useSessionManager(makeOptions()));
        act(() => { result.current.createSession({ protocol: 'ssh', host: 'box', port: 22 }); });
        await waitFor(() => expect(result.current.sessions.length).toBe(1));
        const sessionId = result.current.sessions[0].id;
        // Enable watch so the session is tracked
        act(() => { result.current.toggleWatch(sessionId); });
        // Clear the buffer
        act(() => { result.current.clearWatchBuffer(sessionId); });
        await waitFor(() => {
            const session = result.current.sessions.find(s => s.id === sessionId);
            expect(session?.hasWatchData).toBe(false);
        });
    });
});
