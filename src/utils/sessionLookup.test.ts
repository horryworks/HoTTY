import { describe, it, expect } from 'vitest';
import { lookupSession, toWatchedTerminalInfo, viewFromRecord, viewFromWorker } from './sessionLookup';
import type { SessionRecord } from '../hooks/useSessionManager';
import type { AiWorkerSession } from '../stores/aiWorkerSessionStore';

const record = (over: Partial<SessionRecord>): SessionRecord => ({
    id: 's-1',
    displayName: 'core-01',
    protocol: 'ssh',
    status: 'connected',
    term: {} as SessionRecord['term'],
    fitAddon: {} as SessionRecord['fitAddon'],
    fixedSize: false,
    connectionConfig: { host: '192.0.2.1', port: 22, username: 'alice', password: 'hunter2', encoding: 'utf8', keepaliveIntervalSecs: 0, connectTimeoutSecs: 5 },
    ...over,
});

const worker: AiWorkerSession = {
    id: 'h-1', key: 'ssh:alice@192.0.2.10:22', displayName: 'sw-01', protocol: 'ssh', host: '192.0.2.10', port: 22, username: 'alice',
    status: 'connecting', paneId: 'ai-1', tabId: 't1', openedAt: 0, lastUsedAt: 0, manualLogin: false,
};

describe('sessionLookup', () => {
    it('describes a local record without exposing the secret itself', () => {
        const v = viewFromRecord(record({}));
        expect(v).toEqual({
            displayName: 'core-01', status: 'connected', protocol: 'ssh', host: '192.0.2.1', port: 22, username: 'alice',
            hasPassword: true, hasPrivateKey: false, headless: false, remote: false,
        });
        expect(JSON.stringify(v)).not.toContain('hunter2');
    });

    it('describes a worker as headless with no lendable secret', () => {
        expect(viewFromWorker(worker)).toMatchObject({ displayName: 'sw-01', status: 'connecting', host: '192.0.2.10', hasPassword: false, headless: true, remote: false });
    });

    it('resolves in order: record, worker, cross-window, linkable', () => {
        const src = {
            sessions: new Map([['s-1', record({})]]),
            workers: { 'h-1': worker },
            crossWindow: [{ sessionId: 's-far', host: '203.0.113.1', protocol: 'telnet', ownerLabel: 'w2' }],
            linkable: new Map([['h-far', { sessionId: 'h-far', displayName: 'far-worker', ownerLabel: 'w2', isLocal: false, status: 'connected', headless: true }]]),
        };
        expect(lookupSession('s-1', src)?.protocol).toBe('ssh');
        expect(lookupSession('h-1', src)?.headless).toBe(true);
        expect(lookupSession('s-far', src)).toMatchObject({ displayName: '203.0.113.1', status: 'connected', host: '203.0.113.1', remote: true });
        expect(lookupSession('h-far', src)).toMatchObject({ displayName: 'far-worker', headless: true, remote: true });
        expect(lookupSession('nope', src)).toBeUndefined();
    });

    it('handles a local shell record (no host) and a record without config', () => {
        const local = viewFromRecord(record({ protocol: 'powershell', connectionConfig: { shellType: 'powershell', encoding: 'utf8' } }));
        expect(local.host).toBeUndefined();
        expect(local.hasPassword).toBe(false);
        expect(viewFromRecord(record({ connectionConfig: undefined })).username).toBeUndefined();
    });

    it('projects a view into resolver info', () => {
        expect(toWatchedTerminalInfo(viewFromRecord(record({})))).toEqual({
            protocol: 'ssh', status: 'connected', host: '192.0.2.1', port: 22, username: 'alice', hasPassword: true, hasPrivateKey: false, headless: false,
        });
        expect(toWatchedTerminalInfo(undefined)).toBeUndefined();
    });

    // ADR-AI-007 keys its "one session per host per conversation" duplicate guard
    // off `info.host`. Returning undefined for another window's session made every
    // cross-window terminal invisible to that guard, so the AI opened a second
    // worker to a device already being watched (VTY exhaustion).
    it('projects a remote session so the connect duplicate guard can see its host', () => {
        const v = lookupSession('s-far', {
            crossWindow: [{ sessionId: 's-far', host: '192.0.2.10', protocol: 'ssh', ownerLabel: 'w2' }],
        });
        expect(toWatchedTerminalInfo(v)).toEqual({
            protocol: 'ssh', status: 'connected', host: '192.0.2.10', port: undefined,
            username: undefined, hasPassword: false, hasPrivateKey: false, headless: false,
        });
    });

    it('never lets a remote session lend credentials, whatever the view claims', () => {
        // Another window's config is not ours to inherit from: the flags are
        // forced false so `via:` can only ever resolve to inherit-username/none.
        const info = toWatchedTerminalInfo({
            displayName: 'sw-01', status: 'connected', protocol: 'ssh', host: '192.0.2.10',
            hasPassword: true, hasPrivateKey: true, headless: false, remote: true,
        });
        expect(info?.hasPassword).toBe(false);
        expect(info?.hasPrivateKey).toBe(false);
    });
});
