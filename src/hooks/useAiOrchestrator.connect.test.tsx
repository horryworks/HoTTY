import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// --- tauriService mock (same surface the main orchestrator test stubs, plus detectGitBash) ---
const tv = vi.hoisted(() => ({
  clearWatchBuffer: vi.fn(),
  sendInput: vi.fn(),
  getWatchBuffer: vi.fn(),
  setWatching: vi.fn(),
  takeWatchBuffer: vi.fn(),
  listAllSessions: vi.fn(),
  onSessionStatus: vi.fn(),
  logDebug: vi.fn(),
  detectGitBash: vi.fn(),
}));
vi.mock('../services/tauriService', () => ({ tauriService: tv }));

// Host-tree credential decryption is exercised in its own module; stub it here.
const hostCfg = vi.hoisted(() => ({ buildConfigFromHostNode: vi.fn() }));
vi.mock('../utils/hostConnectConfig', () => hostCfg);

import { useAiOrchestrator, type UseAiOrchestratorOptions, type OrchestratorAiChatApi } from './useAiOrchestrator';
import type { AiChatState, ChatTab } from './useAiChat';
import type { SessionRecord } from './useSessionManager';
import type { FeaturePaneInfo } from '../utils/paneTypes';
import type { ResolvedConnect } from '../utils/aiConnectRequest';
import type { OpenWorkerSpec } from './useAiWorkerSessions';
import { useAiWorkerSessionStore } from '../stores/aiWorkerSessionStore';
import { useSettingsStore } from '../stores/settingsStore';

const PANE = 'ai-pane-1';
const TAB = 'tab-1';
const CORE = 's-core';

function makeStates(linked: ChatTab['linkedSessions'] = [{ sessionId: CORE }]): Map<string, AiChatState> {
  return new Map<string, AiChatState>([[PANE, {
    selectedModel: '',
    systemInstruction: 'You are a helpful assistant.',
    activeTabId: TAB,
    tabs: [{ id: TAB, ordinal: 1, title: '', linkedSessions: linked, lastFocusedWatchId: linked[0]?.sessionId }],
  } as unknown as AiChatState]]);
}

function makeSessions(): Map<string, SessionRecord> {
  return new Map([[CORE, {
    id: CORE, status: 'connected', displayName: 'core-01', protocol: 'ssh',
    connectionConfig: { host: '192.0.2.1', port: 22, username: 'alice', password: 'hunter2', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
  }]]) as unknown as Map<string, SessionRecord>;
}

// aiChat mock whose addTabLink MUTATES the shared tab (so alias lookups see the new link).
function makeAiChat(states: Map<string, AiChatState>): OrchestratorAiChatApi {
  return {
    aiChatStates: states,
    updateAiChatState: vi.fn(),
    updateTabById: vi.fn(),
    enqueuePendingMessage: vi.fn(),
    addTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    addTabLink: vi.fn((paneId: string, tabId: string, sessionId: string, opts?: { aiOpened?: boolean }) => {
      const tab = states.get(paneId)?.tabs.find((t) => t.id === tabId);
      if (tab && !tab.linkedSessions.some((w) => w.sessionId === sessionId)) {
        tab.linkedSessions.push({ sessionId, aiOpened: opts?.aiOpened });
      }
    }),
    removeTabLink: vi.fn(),
    rebindTabLink: vi.fn(),
  } as unknown as OrchestratorAiChatApi;
}

// Worker API stub backed by the REAL worker store, so the orchestrator's status poll
// sees what the store says.
let nextWorkerId = 'h-1';
function makeWorkers(): UseAiOrchestratorOptions['workers'] {
  return {
    openWorkerSession: vi.fn((spec: OpenWorkerSpec) => {
      const id = nextWorkerId;
      useAiWorkerSessionStore.getState().upsert({
        id, key: spec.key, displayName: spec.displayName, protocol: spec.protocol, host: spec.host, port: spec.port,
        username: spec.username, status: 'connecting', paneId: spec.paneId, tabId: spec.tabId,
        openedAt: Date.now(), lastUsedAt: Date.now(), manualLogin: spec.manualLogin,
      });
      return id;
    }),
    closeWorkerSession: vi.fn(),
    closeWorkersForTab: vi.fn(),
    closeWorkersForPane: vi.fn(),
    materializeWorker: vi.fn().mockResolvedValue(true),
    touchWorker: vi.fn(),
  };
}

function makeOptions(overrides: Partial<UseAiOrchestratorOptions> = {}): UseAiOrchestratorOptions {
  return {
    sessions: makeSessions(),
    featurePanes: new Map<string, FeaturePaneInfo>([[PANE, { id: PANE, type: 'ai-chat', displayName: 'AI Chat' }]]),
    lastTerminalSessionId: null,
    setActivePaneId: vi.fn(),
    createAiChatPane: vi.fn(() => PANE),
    ensureConsent: vi.fn().mockResolvedValue(true),
    aiChat: makeAiChat(makeStates()),
    workers: makeWorkers(),
    hostTree: [],
    ...overrides,
  };
}

const localResolved: ResolvedConnect = { kind: 'local', shellType: 'powershell', displayName: 'PowerShell (AI)', key: 'local:powershell' };

function remoteResolved(over: Partial<Extract<ResolvedConnect, { kind: 'remote' }>> = {}): ResolvedConnect {
  return {
    kind: 'remote', protocol: 'ssh', host: '192.0.2.10', port: 22, username: 'alice', displayName: 'sw-01',
    key: 'ssh:alice@192.0.2.10:22', credentialSource: { kind: 'none' }, needsDialog: false, manualLogin: false,
    ...over,
  };
}

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  useSettingsStore.getState().reset();
  useAiWorkerSessionStore.getState().clear();
  nextWorkerId = 'h-1';
  Object.values(tv).forEach((fn) => fn.mockReset());
  hostCfg.buildConfigFromHostNode.mockReset();
  tv.clearWatchBuffer.mockResolvedValue(undefined);
  tv.sendInput.mockResolvedValue(undefined);
  tv.getWatchBuffer.mockResolvedValue('');
  tv.setWatching.mockResolvedValue(undefined);
  tv.takeWatchBuffer.mockResolvedValue('');
  tv.listAllSessions.mockResolvedValue([]);
  tv.onSessionStatus.mockResolvedValue(() => {});
  tv.logDebug.mockResolvedValue(undefined);
  tv.detectGitBash.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useAiOrchestrator — openAiTerminal (local shell)', () => {
  it('opens a worker, links it as AI-opened, and reports Terminal Connected once a prompt shows', async () => {
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));

    act(() => { result.current.openAiTerminal(PANE, TAB, localResolved); });
    await flush();

    expect(workers.openWorkerSession).toHaveBeenCalledWith(expect.objectContaining({
      paneId: PANE, tabId: TAB, key: 'local:powershell', protocol: 'powershell',
      config: expect.objectContaining({ shellType: 'powershell' }), manualLogin: false,
    }));
    expect(aiChat.addTabLink).toHaveBeenCalledWith(PANE, TAB, 'h-1', { aiOpened: true });
    expect(aiChat.enqueuePendingMessage).not.toHaveBeenCalled();

    // Still connecting after a while: no failure (the host-key modal may hold this).
    await flush(5_000);
    expect(aiChat.enqueuePendingMessage).not.toHaveBeenCalled();

    // Connected + a PowerShell prompt → connected envelope with the alias the model sees.
    useAiWorkerSessionStore.getState().setStatus('h-1', 'connected');
    tv.getWatchBuffer.mockResolvedValue('Windows PowerShell\nPS C:\\Users\\alice> ');
    await flush(400);

    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledTimes(1);
    const msg = (aiChat.enqueuePendingMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(msg.startsWith('Terminal Connected (local:powershell as powershell-ai):')).toBe(true);
    expect(msg).toContain('PS C:\\Users\\alice>');
    expect(tv.clearWatchBuffer).toHaveBeenCalledWith('h-1');
    expect(workers.touchWorker).toHaveBeenCalledWith('h-1');
  });

  it('reports Connection Failed with the backend error when the worker errors out', async () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));
    act(() => { result.current.openAiTerminal(PANE, TAB, localResolved); });
    await flush();
    useAiWorkerSessionStore.getState().setStatus('h-1', 'error', 'Git Bash exited immediately');
    await flush(400);
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringMatching(/^Connection Failed \(local:powershell\):\n\[Git Bash exited immediately\./),
    );
  });

  it('falls back to "connected but no prompt" when output stalls without a prompt char', async () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));
    act(() => { result.current.openAiTerminal(PANE, TAB, localResolved); });
    await flush();
    useAiWorkerSessionStore.getState().setStatus('h-1', 'connected');
    tv.getWatchBuffer.mockResolvedValue('Welcome banner without a prompt');
    // aiCommandIdleTimeoutSecs defaults to 10 s → idle fallback after 10 s of no growth.
    await flush(11_000);
    const msg = (aiChat.enqueuePendingMessage as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    expect(msg.startsWith('Terminal Connected (local:powershell as powershell-ai):')).toBe(true);
    expect(msg).toContain('no shell prompt detected yet');
  });

  it('refuses at the cap instead of opening, re-checked at open time', async () => {
    // Five live AI-opened terminals already linked (the default cap is 5).
    const linked = Array.from({ length: 5 }, (_, i) => ({ sessionId: `h-old-${i}`, aiOpened: true }));
    const states = makeStates(linked);
    for (const w of linked) {
      useAiWorkerSessionStore.getState().upsert({
        id: w.sessionId, key: `k${w.sessionId}`, displayName: w.sessionId, protocol: 'ssh', host: `192.0.2.${10 + linked.indexOf(w)}`,
        status: 'connected', paneId: PANE, tabId: TAB, openedAt: 0, lastUsedAt: 0, manualLogin: false,
      });
    }
    const aiChat = makeAiChat(states);
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));
    act(() => { result.current.openAiTerminal(PANE, TAB, localResolved); });
    await flush();
    expect(workers.openWorkerSession).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(
      PANE, TAB, expect.stringMatching(/^Connection Refused \(local:powershell\):\n\[Limit reached/),
    );
  });

  it('fails a Git Bash request when Git Bash is not installed', async () => {
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));
    act(() => { result.current.openAiTerminal(PANE, TAB, { ...localResolved, shellType: 'git-bash', key: 'local:git-bash' }); });
    await flush();
    expect(workers.openWorkerSession).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(PANE, TAB, expect.stringContaining('Git Bash was not found'));
  });
});

describe('useAiOrchestrator — openAiTerminal (remote credentials)', () => {
  it('copies the source terminal credentials for a full inheritance, username only otherwise', async () => {
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));

    act(() => {
      result.current.openAiTerminal(PANE, TAB, remoteResolved({
        credentialSource: { kind: 'inherit', alias: 'core-01', sessionId: CORE, username: 'alice' },
      }));
    });
    await flush();
    const full = (workers.openWorkerSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as OpenWorkerSpec;
    expect(full.config).toMatchObject({ host: '192.0.2.10', port: 22, username: 'alice', password: 'hunter2' });
    expect(full.manualLogin).toBe(false);

    nextWorkerId = 'h-2';
    act(() => {
      result.current.openAiTerminal(PANE, TAB, remoteResolved({
        host: '192.0.2.11', key: 'ssh:alice@192.0.2.11:22', username: 'bob',
        credentialSource: { kind: 'inherit-username', alias: 'core-01', sessionId: CORE, username: 'alice' },
        protocol: 'telnet', port: 23, manualLogin: true,
      }));
    });
    await flush();
    const partial = (workers.openWorkerSession as ReturnType<typeof vi.fn>).mock.calls[1][0] as OpenWorkerSpec;
    // The explicit `user:` wins over the inherited login name; no password is copied.
    expect(partial.config).toMatchObject({ host: '192.0.2.11', port: 23, username: 'bob' });
    expect((partial.config as { password?: string }).password).toBeUndefined();
    expect(partial.manualLogin).toBe(true);
  });

  it('fails when the source terminal of an inheritance is gone', async () => {
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers, sessions: new Map() })));
    act(() => {
      result.current.openAiTerminal(PANE, TAB, remoteResolved({
        credentialSource: { kind: 'inherit', alias: 'core-01', sessionId: CORE, username: 'alice' },
      }));
    });
    await flush();
    expect(workers.openWorkerSession).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(PANE, TAB, expect.stringContaining('"core-01" is no longer available'));
  });

  // The request names the HOST; the saved entry owns the PORT. Overriding the port
  // with the request's (which falls back to the protocol default when the model
  // omits one) would replay the saved credentials to a port the entry was never
  // saved for — and Telnet auto-types them in cleartext at whatever answers there.
  it('takes Host Tree credentials at open time, keeping the saved port and the requested host', async () => {
    hostCfg.buildConfigFromHostNode.mockResolvedValue({
      protocol: 'ssh',
      config: { host: 'saved-host', port: 2222, username: 'alice', password: 'tree-secret', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
    });
    const node = { id: 'n1', type: 'host' as const, name: 'sw-01', entry: { protocol: 'ssh' as const, host: '192.0.2.10', port: 22, username: 'alice', password: '[SAFE]x' } };
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers, hostTree: [node] })));
    act(() => {
      result.current.openAiTerminal(PANE, TAB, remoteResolved({
        credentialSource: { kind: 'host-tree', nodeId: 'n1', nodeName: 'sw-01', hasPassword: true, hasKey: false, hasUsername: true },
        hostNodeId: 'n1', username: undefined,
      }));
    });
    await flush();
    expect(hostCfg.buildConfigFromHostNode).toHaveBeenCalledWith(node, undefined);
    const spec = (workers.openWorkerSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as OpenWorkerSpec;
    expect(spec.config).toMatchObject({ host: '192.0.2.10', port: 2222, username: 'alice', password: 'tree-secret' });
    // The secret never reaches the diagnostic log.
    for (const call of tv.logDebug.mock.calls) expect(String(call[2])).not.toContain('tree-secret');
  });

  it('fails an SSH request that has no credential source at all', async () => {
    const aiChat = makeAiChat(makeStates());
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));
    act(() => { result.current.openAiTerminal(PANE, TAB, remoteResolved({ credentialSource: { kind: 'none' } })); });
    await flush();
    expect(workers.openWorkerSession).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(PANE, TAB, expect.stringContaining('no credentials are available'));
  });

  it('waits for the human login on a Telnet worker instead of idling out on the Username: banner', async () => {
    const aiChat = makeAiChat(makeStates());
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));
    act(() => {
      result.current.openAiTerminal(PANE, TAB, remoteResolved({ protocol: 'telnet', port: 23, key: 'telnet:192.0.2.20:23', host: '192.0.2.20', username: undefined, manualLogin: true }));
    });
    await flush();
    useAiWorkerSessionStore.getState().setStatus('h-1', 'connected');
    tv.getWatchBuffer.mockResolvedValue('Username: ');
    // 30 s of a stalled login banner: no envelope yet (manual login waits for a real prompt).
    await flush(30_000);
    expect(aiChat.enqueuePendingMessage).not.toHaveBeenCalled();
    // The user logs in → a prompt appears → connected.
    tv.getWatchBuffer.mockResolvedValue('Username: alice\nPassword:\nsw-01>');
    await flush(400);
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(PANE, TAB, expect.stringMatching(/^Terminal Connected \(telnet:192\.0\.2\.20:23 as sw-01\):/));
  });
});

describe('useAiOrchestrator — worker liveness', () => {
  it('runs a command against a connected worker session and resets its idle clock', async () => {
    useAiWorkerSessionStore.getState().upsert({
      id: 'h-9', key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell', host: '',
      status: 'connected', paneId: PANE, tabId: TAB, openedAt: 0, lastUsedAt: 0, manualLogin: false,
    });
    const aiChat = makeAiChat(makeStates([{ sessionId: 'h-9', aiOpened: true }]));
    const workers = makeWorkers();
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat, workers })));
    act(() => { result.current.onRunCommand('h-9', 'ping 192.0.2.1', TAB, PANE); });
    await flush(200);
    expect(tv.sendInput).toHaveBeenCalledWith('h-9', 'ping 192.0.2.1\r');
    expect(workers.touchWorker).toHaveBeenCalledWith('h-9');
    expect(aiChat.enqueuePendingMessage).not.toHaveBeenCalledWith(PANE, TAB, expect.stringContaining('not connected'));
  });

  it('refuses a command against a worker that is still connecting', () => {
    useAiWorkerSessionStore.getState().upsert({
      id: 'h-9', key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell', host: '',
      status: 'connecting', paneId: PANE, tabId: TAB, openedAt: 0, lastUsedAt: 0, manualLogin: false,
    });
    const aiChat = makeAiChat(makeStates([{ sessionId: 'h-9', aiOpened: true }]));
    const { result } = renderHook(() => useAiOrchestrator(makeOptions({ aiChat })));
    act(() => { result.current.onRunCommand('h-9', 'ping 192.0.2.1', TAB, PANE); });
    expect(tv.sendInput).not.toHaveBeenCalled();
    expect(aiChat.enqueuePendingMessage).toHaveBeenCalledWith(PANE, TAB, expect.stringContaining('not connected'));
  });
});
