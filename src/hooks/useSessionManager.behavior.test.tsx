import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// --- Mocks (must be declared before the hook import) ---

// Minimal xterm Terminal/FitAddon stubs. The real Terminal mounts a canvas and
// is unsuitable for jsdom; the hook only needs the methods exercised here.
const disposeMock = vi.fn();

vi.mock('@xterm/xterm', () => {
  class TerminalStub {
    loadAddon = vi.fn();
    write = vi.fn();
    onSelectionChange = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    onData = vi.fn();
    getSelection = vi.fn().mockReturnValue('');
    dispose = disposeMock;
  }
  return { Terminal: TerminalStub };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddonStub {}
  return { FitAddon: FitAddonStub };
});

const onSessionDataCb = { current: null as ((p: { sessionId: string; data: string }) => void) | null };
const onSessionStatusCb = { current: null as ((p: { sessionId: string; status: 'connected' | 'disconnected' }) => void) | null };
const onSessionErrorCb = { current: null as ((p: { sessionId: string; error: string }) => void) | null };
const onSshKnownHostsWarningCb = { current: null as ((message: string) => void) | null };

const connectSessionMock = vi.fn();
const disconnectSessionMock = vi.fn().mockResolvedValue(undefined);
const sendInputMock = vi.fn().mockResolvedValue(undefined);
const writeClipboardMock = vi.fn().mockResolvedValue(undefined);
const updateSessionLoggingMock = vi.fn().mockResolvedValue(undefined);
const logDebugMock = vi.fn().mockResolvedValue(undefined);
const confirmLogDirMock = vi.fn().mockResolvedValue(true);

vi.mock('../services/tauriService', () => ({
  tauriService: {
    connectSession: (...args: unknown[]) => connectSessionMock(...args),
    disconnectSession: (...args: unknown[]) => disconnectSessionMock(...args),
    sendInput: (...args: unknown[]) => sendInputMock(...args),
    writeClipboard: (...args: unknown[]) => writeClipboardMock(...args),
    updateSessionLogging: (...args: unknown[]) => updateSessionLoggingMock(...args),
    logDebug: (...args: unknown[]) => logDebugMock(...args),
    confirmLogDir: (...args: unknown[]) => confirmLogDirMock(...args),
    onSessionData: vi.fn().mockImplementation((cb: typeof onSessionDataCb.current) => {
      onSessionDataCb.current = cb;
      return Promise.resolve(() => { onSessionDataCb.current = null; });
    }),
    onSessionStatus: vi.fn().mockImplementation((cb: typeof onSessionStatusCb.current) => {
      onSessionStatusCb.current = cb;
      return Promise.resolve(() => { onSessionStatusCb.current = null; });
    }),
    onSessionError: vi.fn().mockImplementation((cb: typeof onSessionErrorCb.current) => {
      onSessionErrorCb.current = cb;
      return Promise.resolve(() => { onSessionErrorCb.current = null; });
    }),
    onSshKnownHostsWarning: vi.fn().mockImplementation((cb: typeof onSshKnownHostsWarningCb.current) => {
      onSshKnownHostsWarningCb.current = cb;
      return Promise.resolve(() => { onSshKnownHostsWarningCb.current = null; });
    }),
  },
}));

// --- Imports under test ---

import {
  useSessionManager,
  CONNECT_FAILURE_AUTO_CLOSE_MS,
  SESSION_END_AUTO_CLOSE_MS,
} from './useSessionManager';
import type { OpenRequest } from './useSessionManager';
import { useErrorNotificationStore } from '../stores/errorNotificationStore';

const sampleRequest: OpenRequest = {
  displayName: 'test-host',
  protocol: 'ssh',
  config: {
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    encoding: 'utf8',
    keepaliveIntervalSecs: 0,
    connectTimeoutSecs: 3,
  },
};

describe('useSessionManager — connect failure auto-close', () => {
  beforeEach(() => {
    disposeMock.mockClear();
    connectSessionMock.mockReset();
    disconnectSessionMock.mockClear();
    onSessionDataCb.current = null;
    onSessionStatusCb.current = null;
    onSessionErrorCb.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('openSession returns a session id synchronously (does not await connect)', () => {
    // Make connectSession hang forever — if openSession awaited it, this test
    // would never see a value back.
    connectSessionMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useSessionManager());

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(result.current.sessions.get(id)?.status).toBe('connecting');
  });

  it('removes the session after the auto-close delay when initial connect fails (catch path)', async () => {
    vi.useFakeTimers();
    connectSessionMock.mockImplementation(() => Promise.reject(new Error('connection refused')));

    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    // Flush the microtasks so the catch handler runs and transitions
    // status → 'error'.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.sessions.get(id)?.status).toBe('error');
    expect(onSessionRemoved).not.toHaveBeenCalled();

    // Before the timer fires the tab is still in the map showing the error
    // color. Once the delay elapses it should be removed.
    act(() => {
      vi.advanceTimersByTime(CONNECT_FAILURE_AUTO_CLOSE_MS);
    });

    expect(result.current.sessions.has(id)).toBe(false);
    expect(onSessionRemoved).toHaveBeenCalledWith(id);
    expect(disposeMock).toHaveBeenCalled();
  });

  it('does not auto-close on a mid-session error event alone (no follow-up disconnect)', async () => {
    connectSessionMock.mockImplementation(() => Promise.resolve());

    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    // Flush microtasks so the listener-registration promises resolve and the
    // mock callbacks are captured.
    await act(async () => { await flushMicrotasks(); });
    expect(onSessionStatusCb.current).not.toBeNull();
    expect(onSessionErrorCb.current).not.toBeNull();

    // Switch to fake timers AFTER listener setup so we can drive the auto-close
    // timer without breaking the promise-based listener registration.
    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    // Backend transitions session to 'connected' via session-status event.
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'connected' });
    });
    expect(result.current.sessions.get(id)?.status).toBe('connected');

    // Mid-session error fires onSessionError. The connect-failure auto-close
    // only triggers when status was 'connecting' at the moment of the error.
    act(() => {
      onSessionErrorCb.current?.({ sessionId: id, error: 'pipe broken' });
    });
    expect(result.current.sessions.get(id)?.status).toBe('error');

    act(() => {
      vi.advanceTimersByTime(CONNECT_FAILURE_AUTO_CLOSE_MS * 3);
    });

    // No 'disconnected' event was emitted, so the session-end auto-close path
    // should not fire either. Tab stays until the backend follows up with
    // session-status: disconnected (covered by other tests).
    expect(result.current.sessions.has(id)).toBe(true);
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it('schedules only one auto-close when both failure paths fire (catch + onSessionError)', async () => {
    connectSessionMock.mockImplementation(() => Promise.reject(new Error('refused')));

    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    // Flush microtasks so the listener-registration promises resolve.
    await act(async () => { await flushMicrotasks(); });
    expect(onSessionErrorCb.current).not.toBeNull();

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    // Drive the catch path: the connect promise rejection.
    await act(async () => { await flushMicrotasks(); });

    // Backend also fires its own error event for the same session.
    act(() => {
      onSessionErrorCb.current?.({ sessionId: id, error: 'refused' });
    });

    // Despite two paths firing, only a single auto-close should be scheduled.
    act(() => {
      vi.advanceTimersByTime(CONNECT_FAILURE_AUTO_CLOSE_MS);
    });

    expect(onSessionRemoved).toHaveBeenCalledTimes(1);
  });

  it('cancels pending auto-close when closeSession is called manually', async () => {
    vi.useFakeTimers();
    connectSessionMock.mockImplementation(() => Promise.reject(new Error('refused')));

    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // User clicks the close button before the auto-close fires.
    await act(async () => {
      await result.current.closeSession(id);
    });

    expect(result.current.sessions.has(id)).toBe(false);

    // Advancing past the auto-close window must not double-fire onSessionRemoved
    // — closeSession only goes through the manual path.
    act(() => {
      vi.advanceTimersByTime(CONNECT_FAILURE_AUTO_CLOSE_MS * 2);
    });

    expect(onSessionRemoved).not.toHaveBeenCalled();
  });
});

describe('useSessionManager — session-end auto-close', () => {
  beforeEach(() => {
    disposeMock.mockClear();
    connectSessionMock.mockReset();
    disconnectSessionMock.mockClear();
    onSessionDataCb.current = null;
    onSessionStatusCb.current = null;
    onSessionErrorCb.current = null;
    connectSessionMock.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the tab after a clean exit (connected → disconnected)', async () => {
    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    await act(async () => { await flushMicrotasks(); });
    expect(onSessionStatusCb.current).not.toBeNull();

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    // Backend reaches 'connected', then user types `exit` and the shell ends,
    // emitting session-status: disconnected.
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'connected' });
    });
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });

    expect(result.current.sessions.get(id)?.status).toBe('disconnected');
    expect(onSessionRemoved).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(SESSION_END_AUTO_CLOSE_MS);
    });

    expect(result.current.sessions.has(id)).toBe(false);
    expect(onSessionRemoved).toHaveBeenCalledWith(id);
    expect(disconnectSessionMock).toHaveBeenCalledWith(id);
    expect(disposeMock).toHaveBeenCalled();
  });

  it('closes the tab after a mid-session error followed by disconnect', async () => {
    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    await act(async () => { await flushMicrotasks(); });

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'connected' });
    });

    // Network drop: backend emits session-error then session-status: disconnected.
    act(() => {
      onSessionErrorCb.current?.({ sessionId: id, error: 'connection reset' });
    });
    expect(result.current.sessions.get(id)?.status).toBe('error');

    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });

    act(() => {
      vi.advanceTimersByTime(SESSION_END_AUTO_CLOSE_MS);
    });

    expect(result.current.sessions.has(id)).toBe(false);
    expect(onSessionRemoved).toHaveBeenCalledWith(id);
  });

  it('does not stack timers when duplicate disconnected events arrive', async () => {
    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    await act(async () => { await flushMicrotasks(); });

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'connected' });
    });
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });

    act(() => {
      vi.advanceTimersByTime(SESSION_END_AUTO_CLOSE_MS);
    });

    expect(onSessionRemoved).toHaveBeenCalledTimes(1);
  });

  it('manual closeSession during the session-end window cancels the auto-close', async () => {
    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    await act(async () => { await flushMicrotasks(); });

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'connected' });
    });
    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });

    // User clicks close while the auto-close timer is still pending.
    await act(async () => {
      await result.current.closeSession(id);
    });

    expect(result.current.sessions.has(id)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(SESSION_END_AUTO_CLOSE_MS * 2);
    });

    // closeSession does not call onSessionRemoved (only finalizeRemoval does),
    // and the cancelled timer must not fire it either.
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });

  it('does not session-end auto-close on connecting → disconnected (connect-failure path owns this)', async () => {
    const onSessionRemoved = vi.fn();
    const { result } = renderHook(() => useSessionManager({ onSessionRemoved }));

    await act(async () => { await flushMicrotasks(); });

    vi.useFakeTimers();

    let id = '';
    act(() => {
      id = result.current.openSession(sampleRequest);
    });

    // Status was 'connecting' (never reached 'connected'); a direct disconnect
    // without a session-error event should NOT trigger session-end auto-close.
    expect(result.current.sessions.get(id)?.status).toBe('connecting');

    act(() => {
      onSessionStatusCb.current?.({ sessionId: id, status: 'disconnected' });
    });

    act(() => {
      vi.advanceTimersByTime(SESSION_END_AUTO_CLOSE_MS * 2);
    });

    expect(result.current.sessions.has(id)).toBe(true);
    expect(onSessionRemoved).not.toHaveBeenCalled();
  });
});

describe('useSessionManager — ssh known-hosts warning', () => {
  beforeEach(() => {
    onSshKnownHostsWarningCb.current = null;
    useErrorNotificationStore.getState().clear();
  });

  afterEach(() => {
    useErrorNotificationStore.getState().clear();
  });

  it('pushes an SSH toast when the backend fails to save a host key', async () => {
    const { result } = renderHook(() => useSessionManager());

    // Flush microtasks so the listener-registration promise resolves and the
    // mock callback is captured.
    await act(async () => { await flushMicrotasks(); });
    expect(onSshKnownHostsWarningCb.current).not.toBeNull();

    const message =
      'Could not save host key for example.com:22 to known_hosts: permission denied';
    act(() => {
      onSshKnownHostsWarningCb.current?.(message);
    });

    const { notifications } = useErrorNotificationStore.getState();
    expect(
      notifications.some((n) => n.category === 'SSH' && n.message === message),
    ).toBe(true);

    // The hook renders normally (guards against a wiring crash from an unmocked
    // listener).
    expect(result.current).toBeDefined();
  });
});
