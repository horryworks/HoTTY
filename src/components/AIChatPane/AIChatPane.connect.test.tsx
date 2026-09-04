import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// AI-initiated terminal sessions (ADR-AI-007): the connect card, its gate, the
// envelopes fed back to the model, the worker tray chips, and the unknown-alias
// hard-fail. Same harness shape as AIChatPane.autoexec.test.tsx.
const h = vi.hoisted(() => ({
    onAiChatResponseCb: { current: null as null | ((d: unknown) => void) },
    onRunCommand: vi.fn(),
    onEnqueuePending: vi.fn(),
    onDequeuePending: vi.fn(),
    onEnqueuePendingUser: vi.fn(),
    onDequeuePendingUser: vi.fn(),
    onOpenTerminal: vi.fn(),
    onOpenTerminalInDialog: vi.fn(),
    onMaterializeWorker: vi.fn(),
    onCloseWorker: vi.fn(),
    ensureConsent: vi.fn().mockResolvedValue(true),
    settings: {
        activeAiProvider: 'gemini',
        commandExecutionMode: 'auto-execute-safe',
        whitelistCommands: ['display', 'show', 'ls', 'cat', 'ping', 'git'] as string[],
        blacklistCommands: ['sudo', 'rm -rf', 'reboot', 'shutdown', 'mkfs'] as string[],
        maxConsecutiveAutoExecutions: 5,
        aiAutoExecCountdownSecs: 0,
        classifierStrategy: 'static',
        aiClassifyConfidenceThreshold: 0.7,
        aiDataConsentAccepted: true,
        watchBufferLimit: 500000,
        terminalBackground: '#000',
        theme: 'dark',
        aiConnectPolicy: 'local-auto',
        aiConnectReuseCredentials: false,
        aiMaxWorkerSessionsPerTab: 5,
        aiWorkerIdleTimeoutMins: 10,
        aiLocalShellType: 'powershell',
        update: vi.fn(),
    },
    aiClassifyCommand: vi.fn().mockResolvedValue({ modifiesState: false, confidence: 0.95, reason: 'read-only' }),
}));

vi.mock('../../services/tauriService', () => ({
    tauriService: {
        aiAuthLogout: vi.fn().mockResolvedValue(undefined),
        aiAuthAuto: vi.fn().mockResolvedValue(false),
        aiSetProvider: vi.fn().mockResolvedValue(undefined),
        aiChatSend: vi.fn().mockResolvedValue(undefined),
        aiChatCancel: vi.fn().mockResolvedValue(undefined),
        aiChatClear: vi.fn().mockResolvedValue(undefined),
        aiClassifyCommand: h.aiClassifyCommand,
        aiListModels: vi.fn().mockResolvedValue([]),
        aiListLocations: vi.fn().mockResolvedValue([]),
        aiSetLocation: vi.fn().mockResolvedValue(undefined),
        dpapiDecrypt: vi.fn().mockResolvedValue(''),
        dpapiEncrypt: vi.fn().mockResolvedValue(''),
        focusWindow: vi.fn().mockResolvedValue(undefined),
        onAiChatResponse: vi.fn((cb: (d: unknown) => void) => {
            h.onAiChatResponseCb.current = cb;
            return Promise.resolve(() => {});
        }),
        onAiAuthResult: vi.fn(() => Promise.resolve(() => {})),
        selectServiceAccountKeyFile: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock('../../utils/applyTheme', () => ({ applyTheme: vi.fn() }));
vi.mock('../../themes/defaults', () => ({
    getTheme: () => ({ terminal: { foreground: '#fff', background: '#000', backgroundInactive: '#111', paneBackground: '#222' } }),
    DEFAULT_THEMES: {},
    DEFAULT_THEME_IDS: [],
}));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) => selector(h.settings),
        { getState: () => h.settings },
    ),
}));

Element.prototype.scrollIntoView = vi.fn();

const { AIChatPane } = await import('./AIChatPane');
const { useAiAuthStore } = await import('../../stores/aiAuthStore');
const { useAiWorkerSessionStore } = await import('../../stores/aiWorkerSessionStore');
const { connectedNote } = await import('./terminalOutputUtils');

const F = '```';
const LOCAL_CONNECT = `Let me check from the PC.\n\n${F}connect\ntype: local\nreason: ping the gateway from this PC\n${F}`;
const SSH_CONNECT = `Following the CDP neighbor.\n\n${F}connect\ntype: ssh\nhost: 192.0.2.10\nuser: alice\nname: sw-01\nvia: local-usg\nreason: next hop\n${F}`;

const usgSession = {
    id: 'sess-1', displayName: 'Local USG', status: 'connected', protocol: 'ssh',
    connectionConfig: { host: '192.0.2.1', port: 22, username: 'alice', password: 'hunter2', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
};

const baseProps = {
    paneId: 'ai-1',
    active: true,
    aiPersonas: [{ id: 'default', label: 'General Helper', systemPrompt: 'You are helpful.' }],
    chatState: {
        selectedModel: 'gemini-pro',
        systemInstruction: 'You are a helpful assistant.',
        activeTabId: 't1',
        tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }] }],
    },
    sessions: new Map([['sess-1', usgSession]]),
    hostTree: [],
    onRunCommand: h.onRunCommand,
    onEnqueuePending: h.onEnqueuePending,
    onDequeuePending: h.onDequeuePending,
    onEnqueuePendingUser: h.onEnqueuePendingUser,
    onDequeuePendingUser: h.onDequeuePendingUser,
    onOpenTerminal: h.onOpenTerminal,
    onOpenTerminalInDialog: h.onOpenTerminalInDialog,
    onMaterializeWorker: h.onMaterializeWorker,
    onCloseWorker: h.onCloseWorker,
    ensureConsent: h.ensureConsent,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makePane = (extra: Record<string, unknown>) => <AIChatPane {...(baseProps as any)} {...(extra as any)} />;
const renderPane = (extra: Record<string, unknown> = {}) => render(makePane(extra));

async function authenticate() {
    await act(async () => { useAiAuthStore.setState({ isAuthenticated: true }); });
}

async function sendAndComplete(text: string, content: string) {
    const textarea = screen.getByPlaceholderText('Type a message...');
    await act(async () => { fireEvent.change(textarea, { target: { value: text } }); });
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }); });
    await act(async () => {
        h.onAiChatResponseCb.current?.({ sessionId: 'ai-1::t1', responseType: 'done', content });
    });
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    act(() => { useAiAuthStore.setState({ isAuthenticated: false, isAuthLoading: false, authError: null }); });
    useAiWorkerSessionStore.getState().clear();
    h.onRunCommand.mockClear();
    h.onEnqueuePending.mockClear();
    h.onOpenTerminal.mockClear();
    h.onOpenTerminalInDialog.mockClear();
    h.onMaterializeWorker.mockClear();
    h.onCloseWorker.mockClear();
    h.onAiChatResponseCb.current = null;
    h.settings.commandExecutionMode = 'auto-execute-safe';
    h.settings.aiConnectPolicy = 'local-auto';
    h.settings.aiConnectReuseCredentials = false;
    localStorage.clear();
});

describe('AIChatPane connect card — gate outcomes', () => {
    it('auto-opens a PC shell under local-auto in auto-execute mode', async () => {
        renderPane();
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);

        expect(h.onOpenTerminal).toHaveBeenCalledTimes(1);
        expect(h.onOpenTerminal).toHaveBeenLastCalledWith('t1', expect.objectContaining({ kind: 'local', shellType: 'powershell', key: 'local:powershell' }));
        expect(h.onEnqueuePending).not.toHaveBeenCalled();
        expect(screen.getByTestId('ai-connect-card')).toBeTruthy();
        expect(screen.getByText('Opening…')).toBeTruthy();
    });

    it('asks first under the ask policy; Open / Don\'t open resolve the card', async () => {
        h.settings.aiConnectPolicy = 'ask';
        renderPane();
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);

        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(screen.getByText('Reason: ping the gateway from this PC')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open terminal/ })); });
        expect(h.onOpenTerminal).toHaveBeenCalledWith('t1', expect.objectContaining({ kind: 'local' }));
    });

    it('declining feeds a Connection Declined envelope to the model', async () => {
        h.settings.aiConnectPolicy = 'ask';
        renderPane();
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Don't open/ })); });
        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', expect.stringMatching(/^Connection Declined \(local:powershell\):/));
    });

    it('asks (never auto-opens) for a device login, and routes SSH without a password to the connection dialog', async () => {
        // via: local-usg names the watched terminal; reuse is OFF so only the login name is inherited
        // → no password source → dialog variant.
        renderPane();
        await authenticate();
        await sendAndComplete('follow the neighbor', SSH_CONNECT);

        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(screen.getByText('SSH 192.0.2.10:22')).toBeTruthy();
        expect(screen.getByText('Login: alice')).toBeTruthy();
        expect(screen.getByText('Credentials: login name from local-usg, no password')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open in connection dialog/ })); });
        expect(h.onOpenTerminalInDialog).toHaveBeenCalledWith(
            't1',
            expect.objectContaining({ protocol: 'ssh', host: '192.0.2.10', port: 22, username: 'alice', displayName: 'sw-01' }),
            'ssh:alice@192.0.2.10:22',
        );
        expect(screen.getByText('Waiting for the connection dialog…')).toBeTruthy();
    });

    it('with credential reuse ON, shows the warning line and still asks under the most permissive policy', async () => {
        h.settings.aiConnectReuseCredentials = true;
        h.settings.aiConnectPolicy = 'local-and-host-tree-auto';
        renderPane();
        await authenticate();
        await sendAndComplete('follow the neighbor', SSH_CONNECT);

        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(screen.getByText('Credentials: reused from local-usg (login name and password)')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Open terminal/ })); });
        expect(h.onOpenTerminal).toHaveBeenCalledWith('t1', expect.objectContaining({
            kind: 'remote', host: '192.0.2.10', credentialSource: expect.objectContaining({ kind: 'inherit', alias: 'local-usg' }),
        }));
    });

    it('refuses at the per-conversation cap with an envelope and no open', async () => {
        const linked = [{ sessionId: 'sess-1' }];
        for (let i = 0; i < 5; i++) {
            useAiWorkerSessionStore.getState().upsert({
                id: `h-${i}`, key: `ssh:alice@192.0.2.${20 + i}:22`, displayName: `sw-${i}`, protocol: 'ssh', host: `192.0.2.${20 + i}`,
                status: 'connected', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
            });
            linked.push({ sessionId: `h-${i}`, aiOpened: true } as { sessionId: string });
        }
        renderPane({ chatState: { ...baseProps.chatState, tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: linked }] } });
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);

        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', expect.stringMatching(/^Connection Refused \(local:powershell\):\n\[Limit reached/));
        expect(screen.getByText(/Not opened: this conversation already has the maximum/)).toBeTruthy();
        expect(screen.getByText('AI 5/5')).toBeTruthy();
    });

    it('renders the card inert when the policy is off — nothing sent, nothing opened', async () => {
        h.settings.aiConnectPolicy = 'off';
        renderPane();
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);
        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).not.toHaveBeenCalled();
        expect(screen.getByText('AI-opened terminals are turned off (Settings → AI)')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Open terminal/ })).toBeNull();
    });

    it('refuses a connect block that shares a reply with a command, while the command still auto-runs', async () => {
        renderPane();
        await authenticate();
        await sendAndComplete('both', `${LOCAL_CONNECT}\n\n${F}execute\nping 192.0.2.1\n${F}`);
        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', expect.stringMatching(/^Connection Refused \(local:powershell\):\n\[A connect block must be the only/));
        expect(h.onRunCommand).toHaveBeenCalledWith('sess-1', 'ping 192.0.2.1', 't1');
    });

    it('reuses a live AI-opened PC shell instead of opening a second one', async () => {
        useAiWorkerSessionStore.getState().upsert({
            id: 'h-ps', key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell', host: '',
            status: 'connected', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
        });
        renderPane({ chatState: { ...baseProps.chatState, tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }, { sessionId: 'h-ps', aiOpened: true }] }] } });
        await authenticate();
        await sendAndComplete('ping again', LOCAL_CONNECT);
        expect(h.onOpenTerminal).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', expect.stringMatching(/^Terminal Connected \(local:powershell as powershell-ai\):\n\[Already watched/));
    });

    it('shows the Opened badge once the Terminal Connected envelope lands in the transcript', async () => {
        h.settings.aiConnectPolicy = 'ask';
        const { rerender } = renderPane();
        await authenticate();
        await sendAndComplete('ping the gateway', LOCAL_CONNECT);
        // The worker the orchestrator opened, now linked and connected.
        useAiWorkerSessionStore.getState().upsert({
            id: 'h-ps', key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell', host: '',
            status: 'connected', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
        });
        const envelope = connectedNote('local:powershell', 'powershell-ai', 'PowerShell (AI)', 'PS C:\\> ');
        await act(async () => {
            rerender(makePane({
                chatState: {
                    ...baseProps.chatState,
                    tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }, { sessionId: 'h-ps', aiOpened: true }], pendingMessages: [envelope] }],
                },
            }));
        });
        await act(async () => { await Promise.resolve(); });
        // The envelope was dispatched as a user turn → card derives its final state from it.
        expect(screen.getByText('Opened as powershell-ai')).toBeTruthy();
        expect(screen.getByText('Terminal connected')).toBeTruthy(); // the envelope block label
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open as tab' })); });
        expect(h.onMaterializeWorker).toHaveBeenCalledWith('h-ps');
    });
});

describe('AIChatPane connect — tray and target safety', () => {
    it('renders an AI worker chip with open-as-tab and disconnect actions plus the counter', async () => {
        useAiWorkerSessionStore.getState().upsert({
            id: 'h-1', key: 'ssh:alice@192.0.2.10:22', displayName: 'sw-01', protocol: 'ssh', host: '192.0.2.10',
            status: 'connected', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
        });
        renderPane({ chatState: { ...baseProps.chatState, tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }, { sessionId: 'h-1', aiOpened: true }] }] } });
        await authenticate();

        expect(screen.getByTestId('ai-worker-chip')).toBeTruthy();
        expect(screen.getByText('AI 1/5')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open sw-01 as a tab' })); });
        expect(h.onMaterializeWorker).toHaveBeenCalledWith('h-1');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Disconnect sw-01' })); });
        expect(h.onCloseWorker).toHaveBeenCalledWith('h-1');
    });

    it('never runs a target= command whose alias is not watched — it tells the model instead', async () => {
        renderPane();
        await authenticate();
        await sendAndComplete('check', `On it.\n\n${F}execute target=sw-99\nshow clock\n${F}`);
        expect(h.onRunCommand).not.toHaveBeenCalled();
        expect(h.onEnqueuePending).toHaveBeenCalledWith('t1', expect.stringContaining('target alias "sw-99" is not a watched terminal'));
    });

    it('labels a command targeted at a worker as an AI session', async () => {
        useAiWorkerSessionStore.getState().upsert({
            id: 'h-1', key: 'ssh:alice@192.0.2.10:22', displayName: 'sw-01', protocol: 'ssh', host: '192.0.2.10',
            status: 'connected', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
        });
        renderPane({ chatState: { ...baseProps.chatState, tabs: [{ id: 't1', title: 'Local USG', ordinal: 1, linkedSessions: [{ sessionId: 'sess-1' }, { sessionId: 'h-1', aiOpened: true }] }] } });
        await authenticate();
        await sendAndComplete('check', `On it.\n\n${F}execute target=sw-01\nshow clock\n${F}`);
        expect(h.onRunCommand).toHaveBeenCalledWith('h-1', 'show clock', 't1');
        expect(screen.getByText('Target: sw-01 (AI session)')).toBeTruthy();
    });
});
