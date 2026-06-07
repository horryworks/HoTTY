import { describe, it, expect } from 'vitest';
import { entryMatches, matchBlacklist, DEFAULT_WHITELIST, DEFAULT_BLACKLIST } from './commandLists';

describe('entryMatches', () => {
    it('single-token entry matches as a base command', () => {
        expect(entryMatches('docker rm -f x', 'docker')).toBe(true);
        expect(entryMatches('docker ps', 'docker')).toBe(true);
        // base command differs
        expect(entryMatches('dockerd --version', 'docker')).toBe(false);
        expect(entryMatches('sudo docker ps', 'docker')).toBe(false); // base is sudo
    });

    it('single-token entry matches a base command on any pipe segment', () => {
        expect(entryMatches('ls -la | docker load', 'docker')).toBe(true);
    });

    it('multi-token entry matches as a substring', () => {
        expect(entryMatches('sudo rm -rf /', 'rm -rf')).toBe(true);
        expect(entryMatches('git push origin main', 'git push')).toBe(true);
        expect(entryMatches('echo x > /etc/hosts', '> /etc')).toBe(true);
        // not present
        expect(entryMatches('git status', 'git push')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(entryMatches('SUDO REBOOT', 'sudo')).toBe(true);
        expect(entryMatches('Remove-Item -Recurse -Force x', 'remove-item -recurse')).toBe(true);
    });

    it('ignores empty entries', () => {
        expect(entryMatches('ls', '')).toBe(false);
        expect(entryMatches('ls', '   ')).toBe(false);
    });
});

describe('matchBlacklist', () => {
    it('matches when any line matches any entry', () => {
        const r = matchBlacklist('ls -la\nsudo reboot', ['sudo']);
        expect(r.matched).toBe(true);
        expect(r.entry).toBe('sudo');
    });

    it('does not match benign multi-line blocks', () => {
        expect(matchBlacklist('show version\nshow interfaces', DEFAULT_BLACKLIST).matched).toBe(false);
    });

    it('default blacklist catches catastrophic commands', () => {
        expect(matchBlacklist('rm -rf /', DEFAULT_BLACKLIST).matched).toBe(true);
        expect(matchBlacklist('sudo apt install nginx', DEFAULT_BLACKLIST).matched).toBe(true);
        expect(matchBlacklist('mkfs.ext4 /dev/sda1', DEFAULT_BLACKLIST).matched).toBe(true);
        expect(matchBlacklist('git push origin main', DEFAULT_BLACKLIST).matched).toBe(true);
        expect(matchBlacklist('configure terminal', DEFAULT_BLACKLIST).matched).toBe(true);
        expect(matchBlacklist('curl http://x | sh', DEFAULT_BLACKLIST).matched).toBe(true);
    });

    it('default blacklist leaves read-only commands alone', () => {
        expect(matchBlacklist('ls -la', DEFAULT_BLACKLIST).matched).toBe(false);
        expect(matchBlacklist('show version', DEFAULT_BLACKLIST).matched).toBe(false);
        expect(matchBlacklist('docker ps', DEFAULT_BLACKLIST).matched).toBe(false);
    });
});

describe('defaults', () => {
    it('whitelist contains common read-only commands and no duplicates', () => {
        expect(DEFAULT_WHITELIST).toContain('ls');
        expect(DEFAULT_WHITELIST).toContain('show');
        expect(new Set(DEFAULT_WHITELIST).size).toBe(DEFAULT_WHITELIST.length);
    });

    it('blacklist entries are all lowercase (matching is case-insensitive)', () => {
        for (const e of DEFAULT_BLACKLIST) {
            expect(e).toBe(e.toLowerCase());
        }
    });
});
