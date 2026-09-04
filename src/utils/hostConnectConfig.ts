import { isEncrypted } from '../services/tauriService';
import { decryptBatch, getCachedCredential } from '../hooks/useHostManager';
import { useSettingsStore } from '../stores/settingsStore';
import type { HostTreeNode, SshConnectionConfig, TelnetConnectionConfig } from '../types/appTypes';

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
