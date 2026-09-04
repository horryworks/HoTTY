import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// --- tauriService mock: capture the status/error listeners so tests can fire events ---
const tv = vi.hoisted(() => ({
    resize: vi.fn(),
    connectSession: vi.fn(),
    disconnectSession: vi.fn(),
    getWatchBuffer: vi.fn(),
    confirmLogDir: vi.fn(),
    onSessionStatus: vi.fn(),
    onSessionError: vi.fn(),
    logDebug: vi.fn(),
}));
vi.mock('../services/tauriService', () => ({ tauriService: tv }));

import {
    useAiWorkerSessions,
    WORKER_PTY_COLS,
    WORKER_PTY_ROWS,
    WORKER_IDLE_SWEEP_MS,
    WORKER_REMOVE_GRACE_MS,
    type OpenWorkerSpec,
    type UseAiWorkerSessionsOptions,
} from './useAiWorkerSessions';
import { useAiWorkerSessionStore } from '../stores/aiWorkerSessionStore';
import { useSettingsStore } from '../stores/settingsStore';

type StatusCb = (p: { sessionId: string; status: 'connected' | 'disconnected' }) => void;
type ErrorCb = (p: { sessionId: string; error: string }) => void;
let statusCb: StatusCb | undefined;
let errorCb: ErrorCb | undefined;

function makeOptions(over: Partial<UseAiWorkerSessionsOptions> = {}): UseAiWorkerSessionsOptions {
    return {
        adoptSession: vi.fn(),
        addSessionToStore: vi.fn(),
        onWorkerGone: vi.fn(),
        onWorkerMaterialized: vi.fn(),
        ...over,
    };
}

const spec = (over: Partial<OpenWorkerSpec> = {}): OpenWorkerSpec => ({
    paneId: 'ai-1',
    tabId: 't1',
    key: 'ssh:alice@192.0.2.10:22',
    displayName: 'sw-01',
    protocol: 'ssh',
    config: { host: '192.0.2.10', port: 22, username: 'alice', password: 'hunter2', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
    host: '192.0.2.10',
    port: 22,
    username: 'alice',
    manualLogin: false,
    ...over,
});

const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };

beforeEach(() => {
    vi.useFakeTimers();
    useSettingsStore.getState().reset();
    useAiWorkerSessionStore.getState().clear();
    Object.values(tv).forEach((fn) => fn.mockReset());
    tv.resize.mockResolvedValue(undefined);
    tv.connectSession.mockResolvedValue(undefined);
    tv.disconnectSession.mockResolvedValue(undefined);
    tv.getWatchBuffer.mockResolvedValue('');
    tv.confirmLogDir.mockResolvedValue(false);
    tv.logDebug.mockResolvedValue(undefined);
    statusCb = undefined;
    errorCb = undefined;
    tv.onSessionStatus.mockImplementation((cb: StatusCb) => { statusCb = cb; return Promise.resolve(() => {}); });
    tv.onSessionError.mockImplementation((cb: ErrorCb) => { errorCb = cb; return Promise.resolve(() => {}); });
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('useAiWorkerSessions — open', () => {
    it('registers a connecting worker, seeds the pty size, then connects without retaining the config', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();

        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        expect(id.startsWith('h-')).toBe(true);
        const w = useAiWorkerSessionStore.getState().workers[id];
        expect(w).toMatchObject({ status: 'connecting', key: 'ssh:alice@192.0.2.10:22', host: '192.0.2.10', paneId: 'ai-1', tabId: 't1' });
        expect(JSON.stringify(w)).not.toContain('hunter2');

        await flush();
        expect(tv.resize).toHaveBeenCalledWith(id, WORKER_PTY_COLS, WORKER_PTY_ROWS);
        expect(tv.connectSession).toHaveBeenCalledWith(id, 'ssh', expect.objectContaining({ host: '192.0.2.10', password: 'hunter2' }), false, '');
        // termResize runs BEFORE connectSession so the initial pty-req sees the size.
        expect(tv.resize.mock.invocationCallOrder[0]).toBeLessThan(tv.connectSession.mock.invocationCallOrder[0]);
    });

    it('records a connect rejection as an error and forgets the worker after the grace period', async () => {
        tv.connectSession.mockRejectedValue(new Error('invalid ssh config: boom'));
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        await flush();
        expect(useAiWorkerSessionStore.getState().workers[id]).toMatchObject({ status: 'error', errorMessage: 'Error: invalid ssh config: boom' });
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_REMOVE_GRACE_MS); });
        expect(useAiWorkerSessionStore.getState().workers[id]).toBeUndefined();
        expect(opts.onWorkerGone).toHaveBeenCalledWith(expect.objectContaining({ id }));
    });
});

describe('useAiWorkerSessions — backend events', () => {
    it('marks the worker connected and materializes it right away when a human must log in', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec({ protocol: 'telnet', manualLogin: true, config: { host: '192.0.2.20', port: 23, encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 } })); });
        await flush();
        tv.getWatchBuffer.mockResolvedValue('Username:');

        act(() => { statusCb!({ sessionId: id, status: 'connected' }); });
        await flush();

        expect(opts.adoptSession).toHaveBeenCalledWith(expect.objectContaining({ id, protocol: 'telnet', status: 'connected', initialText: 'Username:' }));
        expect(opts.addSessionToStore).toHaveBeenCalledWith(id);
        expect(opts.onWorkerMaterialized).toHaveBeenCalledWith(expect.objectContaining({ id }));
        // The worker entry is gone — the tab record owns the session now.
        expect(useAiWorkerSessionStore.getState().workers[id]).toBeUndefined();
    });

    it('keeps a disconnected worker for the grace period so a poller can read the final status', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        await flush();
        act(() => { statusCb!({ sessionId: id, status: 'connected' }); });
        act(() => { statusCb!({ sessionId: id, status: 'disconnected' }); });
        expect(useAiWorkerSessionStore.getState().workers[id]?.status).toBe('disconnected');
        expect(opts.onWorkerGone).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_REMOVE_GRACE_MS); });
        expect(useAiWorkerSessionStore.getState().workers[id]).toBeUndefined();
        expect(opts.onWorkerGone).toHaveBeenCalledTimes(1);
    });

    it('records the backend error message and does not let a later disconnected event erase it', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        await flush();
        act(() => { errorCb!({ sessionId: id, error: 'Connection refused' }); });
        act(() => { statusCb!({ sessionId: id, status: 'disconnected' }); });
        expect(useAiWorkerSessionStore.getState().workers[id]).toMatchObject({ status: 'error', errorMessage: 'Connection refused' });
    });

    it('ignores events for ids that are not workers or not registered', async () => {
        const opts = makeOptions();
        renderHook(() => useAiWorkerSessions(opts));
        await flush();
        act(() => { statusCb!({ sessionId: 's-user-tab', status: 'disconnected' }); });
        act(() => { statusCb!({ sessionId: 'h-unknown', status: 'connected' }); });
        act(() => { errorCb!({ sessionId: 'h-unknown', error: 'x' }); });
        expect(useAiWorkerSessionStore.getState().workers).toEqual({});
        expect(opts.onWorkerGone).not.toHaveBeenCalled();
    });
});

describe('useAiWorkerSessions — lifecycle', () => {
    it('idle sweep disconnects connected workers past the timeout, never when the timeout is 0', async () => {
        useSettingsStore.getState().update('aiWorkerIdleTimeoutMins', 1);
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        await flush();
        act(() => { statusCb!({ sessionId: id, status: 'connected' }); });

        // t=30 s: still fresh (< 1 min).
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_IDLE_SWEEP_MS); });
        expect(tv.disconnectSession).not.toHaveBeenCalled();
        // A command at t=30 s resets the clock, so t=60 s is only 30 s idle.
        act(() => { result.current.touchWorker(id); });
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_IDLE_SWEEP_MS); });
        expect(tv.disconnectSession).not.toHaveBeenCalled();
        // Then a full minute of silence → disconnected + forgotten after the grace.
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_IDLE_SWEEP_MS * 2); });
        expect(tv.disconnectSession).toHaveBeenCalledWith(id);
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_REMOVE_GRACE_MS); });
        expect(useAiWorkerSessionStore.getState().workers[id]).toBeUndefined();
        expect(opts.onWorkerGone).toHaveBeenCalledTimes(1);

        useSettingsStore.getState().update('aiWorkerIdleTimeoutMins', 0);
        let id2 = '';
        act(() => { id2 = result.current.openWorkerSession(spec()); });
        await flush();
        act(() => { statusCb!({ sessionId: id2, status: 'connected' }); });
        tv.disconnectSession.mockClear();
        await act(async () => { await vi.advanceTimersByTimeAsync(WORKER_IDLE_SWEEP_MS * 100); });
        expect(tv.disconnectSession).not.toHaveBeenCalled();
    });

    it('closes workers per tab / per pane and notifies the owner', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let a = '', b = '', c = '';
        act(() => {
            a = result.current.openWorkerSession(spec({ tabId: 't1' }));
            b = result.current.openWorkerSession(spec({ tabId: 't2', host: '192.0.2.11' }));
            c = result.current.openWorkerSession(spec({ paneId: 'ai-2', host: '192.0.2.12' }));
        });
        await flush();
        act(() => { result.current.closeWorkersForTab('ai-1', 't1'); });
        expect(tv.disconnectSession).toHaveBeenCalledWith(a);
        expect(useAiWorkerSessionStore.getState().workers[a]).toBeUndefined();
        expect(useAiWorkerSessionStore.getState().workers[b]).toBeDefined();
        expect(opts.onWorkerGone).toHaveBeenCalledTimes(1);

        act(() => { result.current.closeWorkersForPane('ai-1'); });
        expect(useAiWorkerSessionStore.getState().workers[b]).toBeUndefined();
        expect(useAiWorkerSessionStore.getState().workers[c]).toBeDefined();
        expect(opts.onWorkerGone).toHaveBeenCalledTimes(2);
    });

    it('materializeWorker replays the captured output into a new tab record and keeps the id', async () => {
        const opts = makeOptions();
        const { result } = renderHook(() => useAiWorkerSessions(opts));
        await flush();
        let id = '';
        act(() => { id = result.current.openWorkerSession(spec()); });
        await flush();
        act(() => { statusCb!({ sessionId: id, status: 'connected' }); });
        tv.getWatchBuffer.mockResolvedValue('sw-01#show version\nCisco IOS');

        let ok = false;
        await act(async () => { ok = await result.current.materializeWorker(id); });
        expect(ok).toBe(true);
        expect(opts.adoptSession).toHaveBeenCalledWith({
            id,
            displayName: 'sw-01',
            protocol: 'ssh',
            config: expect.objectContaining({ host: '192.0.2.10', port: 22, username: 'alice' }),
            status: 'connected',
            errorMessage: undefined,
            initialText: 'sw-01#show version\nCisco IOS',
        });
        // No secret can be in the adopted config — the worker never had one.
        expect(JSON.stringify((opts.adoptSession as ReturnType<typeof vi.fn>).mock.calls[0][0])).not.toContain('hunter2');
        expect(opts.addSessionToStore).toHaveBeenCalledWith(id);
        expect(useAiWorkerSessionStore.getState().workers[id]).toBeUndefined();
        // Materializing is not "gone": the conversation keeps its link.
        expect(opts.onWorkerGone).not.toHaveBeenCalled();

        let unknown = true;
        await act(async () => { unknown = await result.current.materializeWorker('h-nope'); });
        expect(unknown).toBe(false);
    });
});
