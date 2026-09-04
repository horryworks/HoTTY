import { describe, it, expect } from 'vitest';
import {
    parseConnectBody,
    describeParseErrors,
    connectRequestKey,
    sanitizeConnectName,
    sanitizeReason,
    resolveConnectRequest,
    decideConnectGate,
    summarizeAiOpened,
    type ConnectParseResult,
    type ResolveContext,
    type WatchedTerminalView,
    type GateInput,
} from './aiConnectRequest';
import type { HostTreeNode } from '../types/appTypes';

// ── parse ────────────────────────────────────────────────────────────────────

function okRequest(body: string) {
    const r = parseConnectBody(body);
    if (!r.ok) throw new Error(`expected ok, got ${describeParseErrors(r.errors)}`);
    return r.request;
}

function errorCodes(body: string): string[] {
    const r = parseConnectBody(body);
    return r.ok ? [] : r.errors.map((e) => e.code);
}

describe('parseConnectBody', () => {
    it('parses a full ssh request with colon separators', () => {
        const req = okRequest('type: ssh\nhost: 192.0.2.10\nport: 2222\nuser: alice\nname: sw-01\nvia: core-01\nreason: follow the CDP neighbor');
        expect(req).toEqual({
            type: 'ssh', host: '192.0.2.10', port: 2222, user: 'alice', name: 'sw-01', via: 'core-01', reason: 'follow the CDP neighbor',
        });
    });

    it('accepts key=value, mixed case keys, quoted values and CRLF', () => {
        const req = okRequest('TYPE=telnet\r\nHost = "192.0.2.20"\r\nUser: \'bob\'');
        expect(req).toEqual({ type: 'telnet', host: '192.0.2.20', user: 'bob' });
    });

    it('ignores host/port/user/via for a local shell', () => {
        const req = okRequest('type: local\nhost: whatever with spaces\nuser: ***\nreason: ping from the PC');
        expect(req).toEqual({ type: 'local', reason: 'ping from the PC' });
    });

    it('accumulates every error instead of stopping at the first', () => {
        expect(errorCodes('type: ssh\nhost: bad host\nport: 70000\nuser: a b\nfoo: bar\nhost: again\njunk line')).toEqual(
            ['unknown-key', 'duplicate-key', 'bad-line', 'bad-host', 'bad-port', 'bad-user'],
        );
    });

    it('rejects an empty body, a missing type and an unknown type', () => {
        expect(errorCodes('')).toEqual(['empty']);
        expect(errorCodes('   \n  ')).toEqual(['empty']);
        expect(errorCodes('host: 192.0.2.1')).toEqual(['missing-type']);
        expect(errorCodes('type: rdp\nhost: 192.0.2.1')).toEqual(['bad-type']);
    });

    it('requires a host for ssh/telnet', () => {
        expect(errorCodes('type: ssh')).toEqual(['missing-host']);
        expect(errorCodes('type: telnet\nhost:')).toEqual(['missing-host']);
    });

    it('rejects URLs, leading dashes, whitespace and over-long hosts, accepts IPv6', () => {
        expect(errorCodes('type: ssh\nhost: https://example.com')).toEqual(['bad-host']);
        expect(errorCodes('type: ssh\nhost: -evil')).toEqual(['bad-host']);
        expect(errorCodes(`type: ssh\nhost: ${'a'.repeat(254)}`)).toEqual(['bad-host']);
        expect(okRequest('type: ssh\nhost: 2001:db8::1').host).toBe('2001:db8::1');
        expect(okRequest('type: ssh\nhost: sw-01.example.com').host).toBe('sw-01.example.com');
    });

    it('validates the port range and the via alias charset', () => {
        expect(errorCodes('type: ssh\nhost: h\nport: 0')).toEqual(['bad-port']);
        expect(errorCodes('type: ssh\nhost: h\nport: 22a')).toEqual(['bad-port']);
        expect(errorCodes('type: ssh\nhost: h\nvia: core 01')).toEqual(['bad-via']);
        expect(okRequest('type: ssh\nhost: h\nport: 65535').port).toBe(65535);
    });

    it('sanitizes name and reason to one printable line with a length cap', () => {
        expect(sanitizeConnectName('  sw-01\u0007\n  core ')).toBe('sw-01 core');
        expect(sanitizeConnectName('x'.repeat(60))).toHaveLength(40);
        expect(sanitizeConnectName('')).toBeUndefined();
        expect(sanitizeReason('"quoted reason"')).toBe('quoted reason');
        expect(sanitizeReason('y'.repeat(300))).toHaveLength(200);
    });

    it('describes errors in one readable sentence', () => {
        const r = parseConnectBody('type: ssh\nhost: bad host\nzzz: 1');
        expect(r.ok).toBe(false);
        if (!r.ok) {
            const text = describeParseErrors(r.errors);
            expect(text).toContain('unknown key "zzz"');
            expect(text).toContain('not a valid hostname');
        }
    });
});

describe('connectRequestKey', () => {
    it('collapses local shells to the shell type and lower-cases remote hosts', () => {
        expect(connectRequestKey({ type: 'local' }, 'powershell')).toBe('local:powershell');
        expect(connectRequestKey({ type: 'ssh', host: 'SW-01.Example.com', user: 'alice' }, 'cmd')).toBe('ssh:alice@sw-01.example.com:22');
        expect(connectRequestKey({ type: 'telnet', host: '192.0.2.20', port: 2323 }, 'cmd')).toBe('telnet:192.0.2.20:2323');
    });
});

// ── resolve ──────────────────────────────────────────────────────────────────

const treeNode = (id: string, name: string, entry: Record<string, unknown>): HostTreeNode => ({
    id, type: 'host', name, entry: { protocol: 'ssh', port: 22, ...entry } as HostTreeNode['entry'],
});
const tree: HostTreeNode[] = [
    treeNode('n1', 'sw-01', { host: '192.0.2.10', username: 'alice', password: '[SAFE]abc' }),
    treeNode('n2', 'key-only', { host: '192.0.2.11', username: 'alice', privateKeyPath: 'C:/keys/id' }),
    treeNode('n3', 'no-creds', { host: '192.0.2.12' }),
    treeNode('n4', 'tn-01', { host: '192.0.2.20', protocol: 'telnet', port: 23, username: 'alice', password: '[SAFE]abc' }),
];

const watched = (over: Partial<WatchedTerminalView> & { alias: string }): WatchedTerminalView => ({
    sessionId: `s-${over.alias}`,
    displayName: over.alias,
    aiOpened: false,
    info: { protocol: 'ssh', status: 'connected', host: '192.0.2.1', username: 'alice', hasPassword: true, hasPrivateKey: false, headless: false },
    ...over,
});

function ctx(body: string, over: Partial<ResolveContext> = {}): ResolveContext {
    const parse = parseConnectBody(body);
    if (!parse.ok) throw new Error(describeParseErrors(parse.errors));
    return { request: parse.request, localShellType: 'powershell', reuseCredentials: false, watched: [], hostTree: tree, ...over };
}

describe('resolveConnectRequest', () => {
    it('resolves a local shell and reuses a live AI-opened one', () => {
        const fresh = resolveConnectRequest(ctx('type: local'));
        expect(fresh).toMatchObject({ kind: 'local', shellType: 'powershell', displayName: 'PowerShell (AI)', key: 'local:powershell' });
        expect(fresh.existing).toBeUndefined();

        const shell = watched({ alias: 'powershell-ai', aiOpened: true, info: { protocol: 'powershell', status: 'connected', hasPassword: false, hasPrivateKey: false, headless: true } });
        const reused = resolveConnectRequest(ctx('type: local', { watched: [shell] }));
        expect(reused.existing).toEqual({ sessionId: 's-powershell-ai', alias: 'powershell-ai' });

        // A dead one (or one the USER opened) is not reused.
        const dead = { ...shell, info: { ...shell.info!, status: 'disconnected' } };
        expect(resolveConnectRequest(ctx('type: local', { watched: [dead] })).existing).toBeUndefined();
        const userShell = { ...shell, aiOpened: false };
        expect(resolveConnectRequest(ctx('type: local', { watched: [userShell] })).existing).toBeUndefined();
    });

    it('takes credentials from a single matching Host Tree entry', () => {
        const r = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10'));
        expect(r.kind).toBe('remote');
        if (r.kind !== 'remote') return;
        expect(r.credentialSource).toEqual({ kind: 'host-tree', nodeId: 'n1', nodeName: 'sw-01', hasPassword: true, hasKey: false, hasUsername: true });
        expect(r.hostNodeId).toBe('n1');
        expect(r.displayName).toBe('sw-01'); // tree name wins over the bare host
        expect(r.needsDialog).toBe(false);
        expect(r.manualLogin).toBe(false);
    });

    it('treats a key-only entry as a password source for SSH', () => {
        const r = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.11'));
        if (r.kind !== 'remote') throw new Error();
        expect(r.needsDialog).toBe(false);
    });

    it('needs the dialog for SSH with no password source, and never for Telnet', () => {
        const ssh = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.12\nuser: alice'));
        if (ssh.kind !== 'remote') throw new Error();
        expect(ssh.credentialSource.kind).toBe('host-tree');
        expect(ssh.needsDialog).toBe(true);

        const noUser = resolveConnectRequest(ctx('type: ssh\nhost: 203.0.113.5'));
        if (noUser.kind !== 'remote') throw new Error();
        expect(noUser.credentialSource).toEqual({ kind: 'none' });
        expect(noUser.needsDialog).toBe(true);

        const tn = resolveConnectRequest(ctx('type: telnet\nhost: 203.0.113.6'));
        if (tn.kind !== 'remote') throw new Error();
        expect(tn.needsDialog).toBe(false);
        expect(tn.manualLogin).toBe(true);

        const tnSaved = resolveConnectRequest(ctx('type: telnet\nhost: 192.0.2.20'));
        if (tnSaved.kind !== 'remote') throw new Error();
        expect(tnSaved.manualLogin).toBe(false);
    });

    it('inherits only the username from via unless reuse is allowed AND the source has a password', () => {
        const core = watched({ alias: 'core-01' });
        const noReuse = resolveConnectRequest(ctx('type: ssh\nhost: 203.0.113.7\nvia: core-01', { watched: [core] }));
        if (noReuse.kind !== 'remote') throw new Error();
        expect(noReuse.credentialSource).toEqual({ kind: 'inherit-username', alias: 'core-01', sessionId: 's-core-01', username: 'alice' });
        expect(noReuse.username).toBe('alice');
        expect(noReuse.needsDialog).toBe(true);

        const reuse = resolveConnectRequest(ctx('type: ssh\nhost: 203.0.113.7\nvia: CORE-01', { watched: [core], reuseCredentials: true }));
        if (reuse.kind !== 'remote') throw new Error();
        expect(reuse.credentialSource.kind).toBe('inherit');
        expect(reuse.needsDialog).toBe(false);

        const noPw = { ...core, info: { ...core.info!, hasPassword: false } };
        const reuseNoPw = resolveConnectRequest(ctx('type: ssh\nhost: 203.0.113.7\nvia: core-01', { watched: [noPw], reuseCredentials: true }));
        if (reuseNoPw.kind !== 'remote') throw new Error();
        expect(reuseNoPw.credentialSource.kind).toBe('inherit-username');
    });

    it('annotates an unusable via instead of failing, and lets the Host Tree fill in', () => {
        const local = watched({ alias: 'powershell-ai', info: { protocol: 'powershell', status: 'connected', hasPassword: false, hasPrivateKey: false, headless: true } });
        const remoteWindow = watched({ alias: 'far', info: undefined });
        const cases: [string, WatchedTerminalView[], string][] = [
            ['via: nope', [], 'unknown-alias'],
            ['via: powershell-ai', [local], 'not-remote-protocol'],
            ['via: far', [remoteWindow], 'no-config'],
        ];
        for (const [via, w, note] of cases) {
            const r = resolveConnectRequest(ctx(`type: ssh\nhost: 192.0.2.10\n${via}`, { watched: w }));
            if (r.kind !== 'remote') throw new Error();
            expect(r.viaNote, via).toBe(note);
            expect(r.credentialSource.kind, via).toBe('host-tree');
        }
    });

    it('prefers a full inheritance over the Host Tree, and the Host Tree over a username-only one', () => {
        const core = watched({ alias: 'core-01' });
        const full = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10\nvia: core-01', { watched: [core], reuseCredentials: true }));
        if (full.kind !== 'remote') throw new Error();
        expect(full.credentialSource.kind).toBe('inherit');
        const partial = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10\nvia: core-01', { watched: [core] }));
        if (partial.kind !== 'remote') throw new Error();
        expect(partial.credentialSource.kind).toBe('host-tree');
    });

    it('reports ambiguous Host Tree matches and falls back to none', () => {
        const dupTree = [...tree, treeNode('n5', 'sw-01-b', { host: '192.0.2.10', username: 'bob', password: '[SAFE]x' })];
        const r = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10', { hostTree: dupTree }));
        if (r.kind !== 'remote') throw new Error();
        expect(r.credentialSource).toEqual({ kind: 'none' });
        expect(r.hostTreeAmbiguous).toBe(2);
        expect(r.needsDialog).toBe(true);
    });

    it('flags a live watched terminal on the same host as existing (VTY protection)', () => {
        const core = watched({ alias: 'core-01', info: { protocol: 'ssh', status: 'connected', host: '192.0.2.10', username: 'alice', hasPassword: true, hasPrivateKey: false, headless: false } });
        const r = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10', { watched: [core] }));
        if (r.kind !== 'remote') throw new Error();
        expect(r.existing).toEqual({ sessionId: 's-core-01', alias: 'core-01' });
        const stale = { ...core, info: { ...core.info!, status: 'disconnected' } };
        const r2 = resolveConnectRequest(ctx('type: ssh\nhost: 192.0.2.10', { watched: [stale] }));
        if (r2.kind !== 'remote') throw new Error();
        expect(r2.existing).toBeUndefined();
    });

    it('lets an explicit user override the inherited login name and uses name for the title', () => {
        const core = watched({ alias: 'core-01' });
        const r = resolveConnectRequest(ctx('type: ssh\nhost: 203.0.113.8\nuser: bob\nvia: core-01\nname: edge-99', { watched: [core] }));
        if (r.kind !== 'remote') throw new Error();
        expect(r.username).toBe('bob');
        expect(r.displayName).toBe('edge-99');
        expect(r.key).toBe('ssh:bob@203.0.113.8:22');
    });
});

// ── gate ─────────────────────────────────────────────────────────────────────

const okParse = (body: string): ConnectParseResult => parseConnectBody(body);

function gate(body: string, over: Partial<GateInput> & Partial<ResolveContext> = {}): ReturnType<typeof decideConnectGate> {
    const parse = okParse(body);
    const resolved = parse.ok
        ? resolveConnectRequest({ request: parse.request, localShellType: 'powershell', reuseCredentials: over.reuseCredentials ?? false, watched: over.watched ?? [], hostTree: over.hostTree ?? tree })
        : undefined;
    return decideConnectGate({
        policy: 'local-auto',
        commandExecutionMode: 'auto-execute-safe',
        autoExecPaused: false,
        parse,
        resolved,
        openedLiveCount: 0,
        maxOpened: 5,
        blockCountInMessage: 1,
        hasExecuteInSameMessage: false,
        ...over,
    });
}

describe('decideConnectGate', () => {
    it('is inert when the policy is off, before anything else', () => {
        expect(gate('garbage', { policy: 'off' })).toEqual({ action: 'inert' });
    });

    it('refuses structural violations in order: multiple, with-execute, invalid', () => {
        expect(gate('type: local', { blockCountInMessage: 2 })).toEqual({ action: 'refuse', reason: 'multiple' });
        expect(gate('type: local', { hasExecuteInSameMessage: true })).toEqual({ action: 'refuse', reason: 'with-execute' });
        const invalid = gate('type: ssh\nhost: bad host');
        expect(invalid.action).toBe('refuse');
        if (invalid.action === 'refuse') {
            expect(invalid.reason).toBe('invalid');
            expect(invalid.errors?.[0].code).toBe('bad-host');
        }
    });

    it('reuses an existing terminal before checking the cap', () => {
        const core = watched({ alias: 'core-01', info: { protocol: 'ssh', status: 'connected', host: '192.0.2.10', username: 'alice', hasPassword: true, hasPrivateKey: false, headless: false } });
        expect(gate('type: ssh\nhost: 192.0.2.10', { watched: [core], openedLiveCount: 5 })).toEqual({ action: 'already-open', sessionId: 's-core-01', alias: 'core-01' });
    });

    it('refuses at the cap', () => {
        expect(gate('type: local', { openedLiveCount: 5, maxOpened: 5 })).toEqual({ action: 'refuse', reason: 'cap' });
    });

    it('auto-opens a local shell under local-auto in auto-execute mode only', () => {
        expect(gate('type: local')).toEqual({ action: 'auto' });
        expect(gate('type: local', { policy: 'ask' })).toEqual({ action: 'ask', variant: 'open', reuse: false });
        expect(gate('type: local', { commandExecutionMode: 'ask-before-execute' })).toEqual({ action: 'ask', variant: 'open', reuse: false });
        expect(gate('type: local', { autoExecPaused: true })).toEqual({ action: 'ask', variant: 'open', reuse: false });
    });

    it('auto-opens a Host Tree device only under local-and-host-tree-auto', () => {
        expect(gate('type: ssh\nhost: 192.0.2.10')).toEqual({ action: 'ask', variant: 'open', reuse: false });
        expect(gate('type: ssh\nhost: 192.0.2.10', { policy: 'local-and-host-tree-auto' })).toEqual({ action: 'auto' });
        // A Telnet entry without a saved password needs a human to log in — never auto.
        const tnTree = [treeNode('t1', 'tn', { host: '192.0.2.30', protocol: 'telnet', port: 23, username: 'alice' })];
        expect(gate('type: telnet\nhost: 192.0.2.30', { policy: 'local-and-host-tree-auto', hostTree: tnTree })).toEqual({ action: 'ask', variant: 'open', reuse: false });
    });

    it('always asks when credentials would be reused, whatever the policy', () => {
        const core = watched({ alias: 'core-01' });
        expect(gate('type: ssh\nhost: 203.0.113.9\nvia: core-01', { watched: [core], reuseCredentials: true, policy: 'local-and-host-tree-auto' }))
            .toEqual({ action: 'ask', variant: 'open', reuse: true });
    });

    it('routes SSH without a password source to the dialog variant', () => {
        expect(gate('type: ssh\nhost: 203.0.113.9\nuser: alice')).toEqual({ action: 'ask', variant: 'dialog', reuse: false });
    });
});

describe('summarizeAiOpened', () => {
    it('counts live AI-opened terminals and finds the local shell', () => {
        const shell = watched({ alias: 'powershell-ai', aiOpened: true, info: { protocol: 'powershell', status: 'connecting', hasPassword: false, hasPrivateKey: false, headless: true } });
        const dev = watched({ alias: 'sw-01', aiOpened: true });
        const dead = watched({ alias: 'old', aiOpened: true, info: { protocol: 'ssh', status: 'disconnected', hasPassword: false, hasPrivateKey: false, headless: true } });
        const user = watched({ alias: 'core-01' });
        expect(summarizeAiOpened([shell, dev, dead, user])).toEqual({ liveCount: 2, local: { sessionId: 's-powershell-ai', alias: 'powershell-ai' } });
        expect(summarizeAiOpened([user])).toEqual({ liveCount: 0, local: undefined });
    });
});
