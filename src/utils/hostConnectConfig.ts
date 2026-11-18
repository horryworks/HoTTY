import { isEncrypted } from '../services/tauriService';
import { decryptBatch, findStoredHostNode, getCachedCredential } from '../hooks/useHostManager';
import { useSettingsStore } from '../stores/settingsStore';
import type { HostEntry, HostTreeNode, SshConnectionConfig, TelnetConnectionConfig } from '../types/appTypes';

/**
 * The saved login name of a Host Tree entry, as plaintext — for the AI connect
 * card, which must show who the AI will log in as before the user approves.
 * The name is usually stored DPAPI-encrypted, so this takes the same ladder as
 * a connect: the in-memory cache first, else a decrypt. Undefined when the
 * entry has no name or cannot be decrypted (the card then just omits the line).
 */
export async function resolveHostLoginName(nodeId: string): Promise<string | undefined> {
    const stored = findStoredHostNode(nodeId)?.entry?.username;
    if (!stored) return undefined;
    if (!isEncrypted(stored)) return stored;
    const cached = getCachedCredential(nodeId)?.username;
    if (cached !== undefined) return cached || undefined;
    try {
        const [plain] = await decryptBatch([stored]);
        return plain || undefined;
    } catch {
        return undefined;
    }
}

/**
 * A Host Tree entry's privileged-mode password (`enable` / `super`) as
 * plaintext — decrypted only at the moment the user sends it to a terminal.
 *
 * `stored` is the entry's `enablePassword` as the live tree holds it: plaintext
 * right after an edit in this window, ciphertext after a load or an edit in
 * another window. Ciphertext is always decrypted afresh rather than read from
 * the credential cache: one IPC per deliberate key press is cheap, and it keeps
 * this path independent of when the cache is filled or cleared.
 */
export type EnablePasswordResult =
    | { kind: 'none' }
    | { kind: 'failed' }
    | { kind: 'ok'; value: string };

/**
 * The entry's stored enable password if it is one the terminal may send, else
 * undefined. A gcloud-iap host is a cloud VM reached through IAP, not a network
 * device, so it never offers one. The header button and Ctrl+Shift+E both ask
 * here, so they cannot disagree.
 */
export function sendableEnablePassword(entry: HostEntry | undefined): string | undefined {
    if (!entry || entry.protocol === 'gcloud-iap') return undefined;
    return entry.enablePassword || undefined;
}

export async function resolveEnablePassword(stored: string | undefined): Promise<EnablePasswordResult> {
    if (!stored) return { kind: 'none' };
    if (!isEncrypted(stored)) return { kind: 'ok', value: stored };
    try {
        const [plain] = await decryptBatch([stored]);
        // decryptBatch fails open: when the IPC call itself is rejected it hands
        // the input back unchanged. Ciphertext must never be typed into a device.
        return plain && !isEncrypted(plain) ? { kind: 'ok', value: plain } : { kind: 'failed' };
    } catch {
        return { kind: 'failed' };
    }
}

/**
 * Build a ready-to-connect SSH / Telnet config from a Host Tree node — the same
 * decrypt ladder `SessionDialog.handleDoubleClickHost` runs when the user
 * double-clicks a host: take the in-memory plaintext cache when it has the value,
 * otherwise decrypt the DPAPI blobs in one batch. Keepalive / timeout come from
 * the global settings exactly as for a user-opened session.
 *
 * Used by the AI connect flow (ADR-AI-007) so an AI-requested login to a saved
 * host reuses the saved credentials WITHOUT the credentials ever passing through
 * the AI, the chat state, or the request card. Returns null for entries that
 * cannot be connected this way (GCP IAP, or a node without an entry).
 *
 * `usernameOverride` lets the AI's explicit `user:` win over the saved one.
 */
export async function buildConfigFromHostNode(
    node: HostTreeNode,
    usernameOverride?: string,
): Promise<{ protocol: 'ssh' | 'telnet'; config: SshConnectionConfig | TelnetConnectionConfig } | null> {
    const e = node.entry;
    if (!e || e.protocol === 'gcloud-iap') return null;

    let u = e.username ?? '';
    let p = e.password ?? '';
    let kpp = e.privateKeyPassphrase ?? '';

    const cached = getCachedCredential(node.id);
    const needsDecryption: (string | undefined)[] = [undefined, undefined, undefined];
    if (isEncrypted(u)) {
        if (cached?.username !== undefined) u = cached.username;
        else needsDecryption[0] = u;
    }
    if (isEncrypted(p)) {
        if (cached?.password !== undefined) p = cached.password;
        else needsDecryption[1] = p;
    }
    if (isEncrypted(kpp)) {
        if (cached?.privateKeyPassphrase !== undefined) kpp = cached.privateKeyPassphrase;
        else needsDecryption[2] = kpp;
    }
    if (needsDecryption.some((v) => v !== undefined)) {
        const [decU, decP, decKpp] = await decryptBatch(needsDecryption);
        if (decU !== undefined) u = decU;
        if (decP !== undefined) p = decP;
        if (decKpp !== undefined) kpp = decKpp;
    }
    if (usernameOverride) u = usernameOverride;

    const s = useSettingsStore.getState();
    if (e.protocol === 'ssh') {
        const config: SshConnectionConfig = {
            host: e.host,
            port: e.port,
            username: u,
            password: p || undefined,
            privateKeyPath: e.privateKeyPath || undefined,
            privateKeyPassphrase: kpp || undefined,
            encoding: s.globalEncoding,
            keepaliveIntervalSecs: s.sshKeepAliveEnabled ? s.sshKeepAliveInterval : 0,
            connectTimeoutSecs: s.sshConnectTimeoutSecs,
            fixedTerminalSize: e.fixedTerminalSize,
        };
        return { protocol: 'ssh', config };
    }
    const config: TelnetConnectionConfig = {
        host: e.host,
        port: e.port,
        username: u || undefined,
        password: p || undefined,
        encoding: s.globalEncoding,
        keepaliveIntervalSecs: s.telnetKeepAliveEnabled ? s.telnetKeepAliveInterval : 0,
        connectTimeoutSecs: s.telnetConnectTimeoutSecs,
        fixedTerminalSize: e.fixedTerminalSize,
    };
    return { protocol: 'telnet', config };
}
