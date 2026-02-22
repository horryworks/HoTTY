import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app, dialog, BrowserWindow } from 'electron';

const KNOWN_HOSTS_FILE = 'known_hosts.json';

interface KnownHostEntry {
    fingerprint: string;  // SHA-256 fingerprint of the host key
    addedAt: string;      // ISO timestamp
    algorithm: string;    // e.g. 'ssh-rsa', 'ssh-ed25519'
}

type KnownHosts = Record<string, KnownHostEntry>; // key: "hostname:port"

function getKnownHostsPath(): string {
    return path.join(app.getPath('userData'), KNOWN_HOSTS_FILE);
}

function loadKnownHosts(): KnownHosts {
    try {
        const filePath = getKnownHostsPath();
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
    } catch (err) {
        console.error('[KnownHosts] Failed to load known_hosts.json:', err);
    }
    return {};
}

function saveKnownHosts(hosts: KnownHosts): void {
    try {
        const filePath = getKnownHostsPath();
        fs.writeFileSync(filePath, JSON.stringify(hosts, null, 2), 'utf8');
    } catch (err) {
        console.error('[KnownHosts] Failed to save known_hosts.json:', err);
    }
}

/**
 * Computes SHA-256 fingerprint of a host key buffer.
 */
function computeFingerprint(key: Buffer): string {
    return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64');
}

/**
 * Verifies a host key against known_hosts.json.
 * If new host: shows a confirmation dialog.
 * If host key changed: shows a warning dialog.
 * Returns true if connection should proceed, false to abort.
 */
export async function verifyHostKey(
    win: BrowserWindow,
    hostname: string,
    port: number,
    hostKey: { key: Buffer; type: string }
): Promise<boolean> {
    const hostId = `${hostname}:${port}`;
    const fingerprint = computeFingerprint(hostKey.key);
    const knownHosts = loadKnownHosts();

    if (hostId in knownHosts) {
        const known = knownHosts[hostId];
        if (known.fingerprint === fingerprint) {
            // Key matches — trusted
            return true;
        }

        // Key has changed — MITM warning
        const result = await dialog.showMessageBox(win, {
            type: 'warning',
            title: 'SSH Host Key Changed!',
            message: `WARNING: Remote host identification has changed for:\n${hostname}:${port}`,
            detail:
                `The host key fingerprint has changed since the last connection.\n\n` +
                `Previous: ${known.fingerprint}\nCurrent:  ${fingerprint}\n\n` +
                `This could mean a man-in-the-middle attack is in progress.\n` +
                `Unless you know the host key has legitimately changed (e.g., server rebuild), ` +
                `you should NOT connect.`,
            buttons: ['Disconnect (Safe)', 'Update & Connect (Risky)'],
            defaultId: 0,
            cancelId: 0,
        });

        if (result.response === 1) {
            // User accepts the new key
            knownHosts[hostId] = {
                fingerprint,
                addedAt: new Date().toISOString(),
                algorithm: hostKey.type,
            };
            saveKnownHosts(knownHosts);
            return true;
        }
        return false;
    }

    // First-time connection to this host — Trust on First Use (TOFU)
    const result = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Unknown SSH Host',
        message: `Do you trust this host?\n${hostname}:${port}`,
        detail:
            `The authenticity of host "${hostname}:${port}" cannot be established.\n\n` +
            `Host key type: ${hostKey.type}\n` +
            `Fingerprint: ${fingerprint}\n\n` +
            `If you trust this host, click "Trust & Connect". ` +
            `The fingerprint will be saved and verified on future connections.`,
        buttons: ['Disconnect', 'Trust & Connect'],
        defaultId: 1,
        cancelId: 0,
    });

    if (result.response === 1) {
        knownHosts[hostId] = {
            fingerprint,
            addedAt: new Date().toISOString(),
            algorithm: hostKey.type,
        };
        saveKnownHosts(knownHosts);
        return true;
    }

    return false;
}
