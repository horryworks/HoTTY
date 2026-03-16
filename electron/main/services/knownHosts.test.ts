// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

let tempDir: string;

vi.mock('electron', () => ({
    app: { getPath: vi.fn() },
    dialog: { showMessageBox: vi.fn() },
    BrowserWindow: vi.fn(),
}));

import { verifyHostKey } from './knownHosts';
import { app, dialog } from 'electron';

const mockWin = {} as any;

function makeHostKey(data: string): { key: Buffer; type: string } {
    const typeStr = 'ssh-ed25519';
    const typeBuf = Buffer.from(typeStr);
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(typeBuf.length, 0);
    const key = Buffer.concat([lenBuf, typeBuf, Buffer.from(data)]);
    return { key, type: typeStr };
}

function computeFingerprint(key: Buffer): string {
    return 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64');
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotty-knownhosts-test-'));
    vi.mocked(app.getPath).mockReturnValue(tempDir);
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockReturnValue(tempDir);
});

afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── Known host — fingerprint matches ─────────────────────────────────────────

describe('verifyHostKey — known host (fingerprint matches)', () => {
    it('returns true without showing a dialog', async () => {
        const { key, type } = makeHostKey('mykey');
        const fingerprint = computeFingerprint(key);
        const knownHosts = {
            'myhost:22': { fingerprint, addedAt: new Date().toISOString(), algorithm: type },
        };
        fs.writeFileSync(path.join(tempDir, 'known_hosts.json'), JSON.stringify(knownHosts));

        const result = await verifyHostKey(mockWin, 'myhost', 22, { key, type });

        expect(result).toBe(true);
        expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });
});

// ── Known host — fingerprint changed ─────────────────────────────────────────

describe('verifyHostKey — known host (fingerprint changed)', () => {
    it('returns false when user chooses Disconnect (response 0)', async () => {
        const { key, type } = makeHostKey('newkey');
        const oldFingerprint = 'SHA256:oldfingerprintXXX';
        const knownHosts = {
            'myhost:22': { fingerprint: oldFingerprint, addedAt: new Date().toISOString(), algorithm: type },
        };
        fs.writeFileSync(path.join(tempDir, 'known_hosts.json'), JSON.stringify(knownHosts));
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });

        const result = await verifyHostKey(mockWin, 'myhost', 22, { key, type });

        expect(result).toBe(false);
        expect(dialog.showMessageBox).toHaveBeenCalledWith(
            mockWin,
            expect.objectContaining({ title: 'SSH Host Key Changed!' })
        );
    });

    it('returns true and saves new key when user chooses Update & Connect (response 1)', async () => {
        const { key, type } = makeHostKey('newkey');
        const oldFingerprint = 'SHA256:oldfingerprintXXX';
        const knownHosts = {
            'myhost:22': { fingerprint: oldFingerprint, addedAt: new Date().toISOString(), algorithm: type },
        };
        fs.writeFileSync(path.join(tempDir, 'known_hosts.json'), JSON.stringify(knownHosts));
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });

        const result = await verifyHostKey(mockWin, 'myhost', 22, { key, type });

        expect(result).toBe(true);
        // Verify the known_hosts file was updated
        const savedHosts = JSON.parse(fs.readFileSync(path.join(tempDir, 'known_hosts.json'), 'utf8'));
        const newFingerprint = computeFingerprint(key);
        expect(savedHosts['myhost:22'].fingerprint).toBe(newFingerprint);
    });
});

// ── New host (TOFU) ───────────────────────────────────────────────────────────

describe('verifyHostKey — new host (TOFU)', () => {
    it('returns false when user chooses Disconnect (response 0)', async () => {
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });

        const { key, type } = makeHostKey('freshkey');
        const result = await verifyHostKey(mockWin, 'newhost', 22, { key, type });

        expect(result).toBe(false);
        expect(dialog.showMessageBox).toHaveBeenCalledWith(
            mockWin,
            expect.objectContaining({ title: 'Unknown SSH Host' })
        );
    });

    it('returns true and saves the host when user trusts (response 1)', async () => {
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });

        const { key, type } = makeHostKey('freshkey');
        const result = await verifyHostKey(mockWin, 'newhost', 22, { key, type });

        expect(result).toBe(true);
        // Verify the host was saved
        const savedHosts = JSON.parse(fs.readFileSync(path.join(tempDir, 'known_hosts.json'), 'utf8'));
        expect('newhost:22' in savedHosts).toBe(true);
        expect(savedHosts['newhost:22'].algorithm).toBe(type);
    });

    it('uses host:port as the key identifier', async () => {
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 1, checkboxChecked: false });

        const { key, type } = makeHostKey('key8022');
        await verifyHostKey(mockWin, 'myhost', 8022, { key, type });

        const savedHosts = JSON.parse(fs.readFileSync(path.join(tempDir, 'known_hosts.json'), 'utf8'));
        expect('myhost:8022' in savedHosts).toBe(true);
    });

    it('handles missing known_hosts.json gracefully (starts empty)', async () => {
        vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });

        const { key, type } = makeHostKey('key');
        // No known_hosts.json file
        const result = await verifyHostKey(mockWin, 'host', 22, { key, type });

        // Should show TOFU dialog (not changed-key dialog)
        expect(dialog.showMessageBox).toHaveBeenCalledWith(
            mockWin,
            expect.objectContaining({ title: 'Unknown SSH Host' })
        );
        expect(result).toBe(false);
    });
});
