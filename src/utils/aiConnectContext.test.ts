import { describe, it, expect } from 'vitest';
import { buildWatchedViews, buildConnectCapabilityInput } from './aiConnectContext';
import type { SessionRecord } from '../hooks/useSessionManager';
import type { AiWorkerSession } from '../stores/aiWorkerSessionStore';

const record = (id: string, name: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
    id, displayName: name, protocol: 'ssh', status: 'connected',
    term: {} as SessionRecord['term'], fitAddon: {} as SessionRecord['fitAddon'], fixedSize: false,
    connectionConfig: { host: '192.0.2.1', port: 22, username: 'alice', password: 'x', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
    ...over,
});
const worker = (id: string, over: Partial<AiWorkerSession> = {}): AiWorkerSession => ({
    id, key: 'local:powershell', displayName: 'PowerShell (AI)', protocol: 'powershell', host: '', status: 'connected',
    paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false, ...over,
});

describe('buildWatchedViews', () => {
    it('aliases every link in order (with collision suffixes) and attaches secret-free info', () => {
        const src = {
            sessions: new Map([['s-1', record('s-1', 'core-01')], ['s-2', record('s-2', 'core-01', { status: 'disconnected' })]]),
            workers: { 'h-1': worker('h-1') },
        };
        const { aliases, views } = buildWatchedViews([{ sessionId: 's-1' }, { sessionId: 's-2' }, { sessionId: 'h-1', aiOpened: true }, { sessionId: 'far' }], src);
        expect(aliases.map((a) => a.alias)).toEqual(['core-01', 'core-01-2', 'powershell-ai', 'far']);
        expect(views[0]).toMatchObject({ alias: 'core-01', aiOpened: false, info: { host: '192.0.2.1', hasPassword: true, headless: false, status: 'connected' } });
        expect(views[1].info?.status).toBe('disconnected');
        expect(views[2]).toMatchObject({ alias: 'powershell-ai', aiOpened: true, info: { protocol: 'powershell', headless: true } });
        expect(views[3].info).toBeUndefined(); // unknown to this window
        expect(JSON.stringify(views)).not.toContain('"password"');
    });
});

describe('buildConnectCapabilityInput', () => {
    it('derives the prompt input: terminal list, live AI shell alias and remaining slots', () => {
        const src = {
            sessions: new Map([['s-1', record('s-1', 'core-01')]]),
            workers: { 'h-1': worker('h-1'), 'h-2': worker('h-2', { key: 'ssh:alice@192.0.2.10:22', displayName: 'sw-01', protocol: 'ssh', host: '192.0.2.10', status: 'connecting' }) },
        };
        const input = buildConnectCapabilityInput(
            [{ sessionId: 's-1' }, { sessionId: 'h-1', aiOpened: true }, { sessionId: 'h-2', aiOpened: true }],
            src,
            { policy: 'local-auto', localShellType: 'powershell', maxOpened: 5, idleMinutes: 10 },
        );
        expect(input.policy).toBe('local-auto');
        expect(input.terminals).toEqual([
            { alias: 'core-01', displayName: 'core-01', live: true, host: '192.0.2.1', protocol: 'ssh', aiOpened: false },
            { alias: 'powershell-ai', displayName: 'PowerShell (AI)', live: true, host: undefined, protocol: 'powershell', aiOpened: true },
            { alias: 'sw-01', displayName: 'sw-01', live: false, host: '192.0.2.10', protocol: 'ssh', aiOpened: true },
        ]);
        expect(input.localShellOpen).toBe('powershell-ai');
        // Two live AI-opened (connected + connecting) of a cap of 5.
        expect(input.remainingSlots).toBe(3);
        expect(input.idleMinutes).toBe(10);
    });

    it('never reports negative slots', () => {
        const src = { workers: { 'h-1': worker('h-1'), 'h-2': worker('h-2') } };
        const input = buildConnectCapabilityInput([{ sessionId: 'h-1', aiOpened: true }, { sessionId: 'h-2', aiOpened: true }], src,
            { policy: 'ask', localShellType: 'cmd', maxOpened: 1, idleMinutes: 0 });
        expect(input.remainingSlots).toBe(0);
    });
});
